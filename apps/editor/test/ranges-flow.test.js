import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { pool } from '../../api/src/db.js';

const api = 'http://127.0.0.1:3001/api';
const blank = { schemaVersion: 1, id: `page_${crypto.randomUUID().replaceAll('-', '')}`, type: 'Page', props: { title: 'Ranges' }, styles: { desktop: {}, tablet: {}, mobile: {} }, regions: { header: [], main: [], footer: [] } };
const request = async (path, options) => { const response = await fetch(api + path, options); if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`); return response; };
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function downloadDocument(page) { const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download JSON' }).click()]); return JSON.parse(await readFile(await download.path(), 'utf8')); }
async function selectRegion(page, name) { await page.getByRole('button', { name: 'Layers', exact: true }).click(); await page.locator(`[data-layer-region="${name}"] > button:first-child`).click(); await page.getByRole('button', { name: 'Elements', exact: true }).click(); }
async function ready(url) { for (let i = 0; i < 50; i++) { try { if ((await fetch(url)).ok) return; } catch { /* wait */ } await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Export server unavailable: ${url}`); }

async function checkRuntime(page, scope) {
  const root = page.locator(scope);
  const rating = root.getByRole('slider', { name: 'Stars & points' });
  const slider = root.getByRole('slider', { name: 'Volume' });
  const readOnly = root.getByRole('slider', { name: 'Locked score' });
  const disabled = root.getByRole('slider', { name: 'Unavailable' });
  assert.equal(await rating.inputValue(), '5');
  assert.equal(await slider.inputValue(), '-10');
  assert.equal(await readOnly.inputValue(), '3');
  assert.equal(await disabled.isDisabled(), true);
  assert.equal(await rating.getAttribute('aria-valuetext'), '5 out of 5');
  await rating.focus(); await rating.press('ArrowLeft');
  assert.equal(await rating.inputValue(), '4');
  assert.equal(await root.locator('.builder-rating').first().locator('output').innerText(), '4 out of 5');
  await slider.focus(); await slider.press('End');
  assert.equal(await slider.inputValue(), '10');
  assert.equal(await root.locator('.builder-slider output').first().innerText(), '10');
  await readOnly.focus(); await readOnly.press('ArrowLeft');
  assert.equal(await readOnly.inputValue(), '3');
  const box = await rating.boundingBox();
  await rating.click({ position: { x: 1, y: box.height / 2 } });
  assert.equal(await rating.inputValue(), '0');
  await readOnly.click({ position: { x: 1, y: box.height / 2 } });
  assert.equal(await readOnly.inputValue(), '3');
}

test('ranges save defaults, keep runtime changes local, and run in built HTML/React/Vue ZIPs', { timeout: 120000 }, async () => {
  const project = (await (await request('/projects', json('POST', { name: `Ranges ${Date.now()}` }))).json()).project;
  await request(`/projects/${project.id}/pages`, json('POST', { name: 'Ranges', path: '/', document: blank }));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let root;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173/');
    await page.getByRole('combobox', { name: 'Project' }).selectOption(project.id);
    await selectRegion(page, 'header');
    await page.locator('[data-palette="Rating"]').click();
    await page.getByRole('textbox', { name: 'Accessible label' }).fill('Stars & points');
    await page.getByRole('textbox', { name: 'Accessible label' }).press('Tab');
    await page.getByRole('spinbutton', { name: 'Initial value' }).fill('5');
    await page.getByRole('spinbutton', { name: 'Initial value' }).press('Tab');
    await selectRegion(page, 'main');
    await page.locator('[data-palette="Slider"]').click();
    await page.getByRole('textbox', { name: 'Accessible label' }).fill('Volume');
    await page.getByRole('textbox', { name: 'Accessible label' }).press('Tab');
    await page.getByRole('spinbutton', { name: 'Initial value' }).fill('0');
    await page.getByRole('spinbutton', { name: 'Initial value' }).press('Tab');
    await page.getByRole('spinbutton', { name: 'Minimum' }).fill('-10');
    await page.getByRole('spinbutton', { name: 'Minimum' }).press('Tab');
    await page.getByRole('spinbutton', { name: 'Maximum' }).fill('10');
    await page.getByRole('spinbutton', { name: 'Maximum' }).press('Tab');
    await page.getByRole('spinbutton', { name: 'Initial value' }).fill('-10');
    await page.getByRole('spinbutton', { name: 'Initial value' }).press('Tab');
    await selectRegion(page, 'footer');
    await page.locator('[data-palette="Rating"]').click();
    await page.getByRole('textbox', { name: 'Accessible label' }).fill('Locked score');
    await page.getByRole('textbox', { name: 'Accessible label' }).press('Tab');
    await page.getByLabel('Read-only').check();
    await selectRegion(page, 'footer');
    await page.locator('[data-palette="Slider"]').click();
    await page.getByRole('textbox', { name: 'Accessible label' }).fill('Unavailable');
    await page.getByRole('textbox', { name: 'Accessible label' }).press('Tab');
    await page.getByLabel('Disabled').check();
    await page.locator('.canvas-area .builder-rating').last().click();
    await page.getByRole('button', { name: 'mobile', exact: true }).click();
    await page.getByRole('tab', { name: 'layout' }).click();
    await page.locator('[data-style-field="width"] input').fill('220px');
    const design = await downloadDocument(page);
    assert.equal(design.regions.header[0].props.defaultValue, 5);
    assert.equal(design.regions.main[0].props.min, -10);
    assert.equal(design.regions.main[0].props.defaultValue, -10);
    assert.equal(design.regions.footer[0].props.readOnly, true);
    assert.equal(design.regions.footer[0].styles.mobile.width, '220px');
    await page.getByRole('button', { name: 'Clear selection' }).click();
    await page.locator('.canvas-area .builder-rating').first().click();
    assert.match(await page.locator('.selection-label').innerText(), /Rating/);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('[data-save-state="saved"]').waitFor();
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    assert.deepEqual(await downloadDocument(page), design);
    await page.getByRole('button', { name: 'Preview page' }).click();
    await checkRuntime(page, '.preview-stage');
    assert.deepEqual(await downloadDocument(page), design);
    root = await mkdtemp(join(tmpdir(), 'builder-ranges-'));
    for (const [target, port] of [['html', 4373], ['react', 4374], ['vue', 4375]]) {
      const directory = join(root, target);
      const zip = join(root, `${target}.zip`);
      await writeFile(zip, Buffer.from(await (await request(`/projects/${project.id}/exports/${target}.zip`)).arrayBuffer()));
      execFileSync('mkdir', ['-p', directory]);
      execFileSync('unzip', ['-q', zip, '-d', directory]);
      if (target !== 'html') execFileSync('npm', ['install', '--offline'], { cwd: directory });
      execFileSync('npm', ['run', 'build'], { cwd: directory });
      const server = spawn(join(process.cwd(), 'node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: directory, stdio: 'ignore' });
      try {
        await ready(`http://127.0.0.1:${port}/`);
        const output = await context.newPage();
        await output.goto(`http://127.0.0.1:${port}/`);
        await checkRuntime(output, 'body');
        await output.setViewportSize({ width: 390, height: 844 });
        assert.equal(await output.locator('.builder-rating').last().evaluate(element => getComputedStyle(element).width), '220px');
        await output.close();
      } finally { server.kill('SIGTERM'); if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve)); }
    }
    await context.close();
  } finally { await browser.close(); if (root) await rm(root, { recursive: true, force: true }); await pool.query('DELETE FROM projects WHERE id=$1', [project.id]); await pool.end(); }
});
