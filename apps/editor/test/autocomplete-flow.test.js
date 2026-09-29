import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { pool } from '../../api/src/db.js';

const api = 'http://127.0.0.1:3001/api';
const blank = { schemaVersion: 1, id: `page_${crypto.randomUUID().replaceAll('-', '')}`, type: 'Page', props: { title: 'Autocomplete flow' }, styles: { desktop: {}, tablet: {}, mobile: {} }, regions: { header: [], main: [], footer: [] } };
const request = async (path, options) => { const response = await fetch(api + path, options); if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`); return response; };
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function downloadDocument(page) { const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download JSON' }).click()]); return JSON.parse(await readFile(await download.path(), 'utf8')); }
async function selectRegion(page, name) { await page.getByRole('button', { name: 'Layers', exact: true }).click(); await page.locator(`[data-layer-region="${name}"] > button:first-child`).click(); await page.getByRole('button', { name: 'Elements', exact: true }).click(); }
async function ready(url) { for (let i = 0; i < 50; i++) { try { if ((await fetch(url)).ok) return; } catch { /* wait */ } await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Export server unavailable: ${url}`); }

async function checkRuntime(page, scope, secondId) {
  const root = page.locator(scope);
  const fruit = root.getByRole('combobox', { name: 'Fruit' });
  const empty = root.getByRole('combobox', { name: 'Empty options' });
  const locked = root.getByRole('combobox', { name: 'Locked options' });
  assert.equal(await fruit.inputValue(), 'Orange');
  assert.equal(await locked.isDisabled(), true);
  assert.equal(await fruit.getAttribute('aria-autocomplete'), 'list');
  assert.equal(await fruit.getAttribute('aria-required'), 'true');
  await fruit.click();
  assert.equal(await fruit.evaluate(element => getComputedStyle(element).outlineWidth), '3px');
  const list = root.getByRole('listbox', { name: 'Fruit options' });
  assert.equal(await list.getByRole('option').count(), 2);
  assert.equal(await list.locator(`[id$="${secondId}"]`).getAttribute('aria-selected'), 'true');
  await fruit.press('ArrowUp');
  assert.match(await fruit.getAttribute('aria-activedescendant'), new RegExp(`${secondId}$`));
  await fruit.fill('orange_b');
  assert.equal(await list.getByRole('option').count(), 1);
  await fruit.press('ArrowDown');
  assert.match(await fruit.getAttribute('aria-activedescendant'), new RegExp(`${secondId}$`));
  await fruit.press('Enter');
  assert.equal(await fruit.inputValue(), 'Orange');
  assert.equal(await fruit.getAttribute('aria-expanded'), 'false');
  await fruit.fill('zzzz');
  assert.equal(await list.getByRole('status').innerText(), 'No matching fruit');
  await fruit.press('Escape');
  assert.equal(await fruit.getAttribute('aria-expanded'), 'false');
  await fruit.fill('orange_a');
  await list.getByRole('option').tap();
  assert.equal(await fruit.inputValue(), 'Orange');
  assert.equal(await fruit.getAttribute('aria-expanded'), 'false');
  await empty.tap();
  assert.equal(await root.getByRole('listbox', { name: 'Empty options options' }).getByRole('status').innerText(), 'Nothing to choose');
}

test('Autocomplete filters locally, supports keyboard and touch, persists config, and builds three ZIPs', { timeout: 120000 }, async () => {
  const project = (await (await request('/projects', json('POST', { name: `Autocomplete ${Date.now()}` }))).json()).project;
  await request(`/projects/${project.id}/pages`, json('POST', { name: 'Autocomplete', path: '/', document: blank }));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let root;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true, acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173/');
    await page.getByRole('combobox', { name: 'Project' }).selectOption(project.id);
    await selectRegion(page, 'header');
    await page.locator('[data-palette="Autocomplete"]').click();
    await page.getByRole('textbox', { name: 'Accessible label' }).fill('Fruit');
    await page.getByRole('textbox', { name: 'Accessible label' }).press('Tab');
    await page.getByRole('textbox', { name: 'No-results text' }).fill('No matching fruit');
    await page.getByRole('textbox', { name: 'No-results text' }).press('Tab');
    await page.getByRole('textbox', { name: 'Option 1 label' }).fill('Orange');
    await page.getByRole('textbox', { name: 'Option 1 label' }).press('Tab');
    await page.getByRole('textbox', { name: 'Option 1 value' }).fill('orange_a');
    await page.getByRole('textbox', { name: 'Option 1 value' }).press('Tab');
    await page.getByRole('textbox', { name: 'Option 2 label' }).fill('Orange');
    await page.getByRole('textbox', { name: 'Option 2 label' }).press('Tab');
    await page.getByRole('textbox', { name: 'Option 2 value' }).fill('orange_b');
    await page.getByRole('textbox', { name: 'Option 2 value' }).press('Tab');
    await page.getByLabel('Initial selection').selectOption({ label: 'Orange · orange_b' });
    await page.getByLabel('Required', { exact: true }).check();
    await page.getByRole('button', { name: 'mobile', exact: true }).click();
    await page.getByRole('tab', { name: 'layout' }).click();
    await page.locator('[data-style-field="width"] input').fill('240px');
    await selectRegion(page, 'main');
    await page.locator('[data-palette="Autocomplete"]').click();
    await page.getByRole('textbox', { name: 'Accessible label' }).fill('Empty options');
    await page.getByRole('textbox', { name: 'Accessible label' }).press('Tab');
    await page.getByRole('textbox', { name: 'Empty-list text' }).fill('Nothing to choose');
    await page.getByRole('textbox', { name: 'Empty-list text' }).press('Tab');
    await page.getByRole('button', { name: 'Remove option 2' }).click();
    await page.getByRole('button', { name: 'Remove option 1' }).click();
    await selectRegion(page, 'footer');
    await page.locator('[data-palette="Autocomplete"]').click();
    await page.getByRole('textbox', { name: 'Accessible label' }).fill('Locked options');
    await page.getByRole('textbox', { name: 'Accessible label' }).press('Tab');
    await page.getByLabel('Disabled').check();
    const design = await downloadDocument(page);
    const secondId = design.regions.header[0].props.options[1].id;
    assert.equal(design.regions.header[0].props.defaultOptionId, secondId);
    assert.equal(design.regions.header[0].props.required, true);
    assert.equal(design.regions.main[0].props.options.length, 0);
    assert.equal(design.regions.header[0].styles.mobile.width, '240px');
    await page.getByRole('button', { name: 'Clear selection' }).click();
    await page.locator('.canvas-area .builder-autocomplete').first().click();
    assert.match(await page.locator('.selection-label').innerText(), /Autocomplete/);
    assert.deepEqual(await downloadDocument(page), design);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('[data-save-state="saved"]').waitFor();
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    assert.deepEqual(await downloadDocument(page), design);
    await page.getByRole('button', { name: 'Preview page' }).click();
    await checkRuntime(page, '.preview-stage', secondId);
    assert.deepEqual(await downloadDocument(page), design);
    root = await mkdtemp(join(tmpdir(), 'builder-autocomplete-'));
    for (const [target, port] of [['html', 4473], ['react', 4474], ['vue', 4475]]) {
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
        await checkRuntime(output, 'body', secondId);
        await output.setViewportSize({ width: 390, height: 844 });
        assert.equal(await output.locator('.builder-autocomplete').first().evaluate(element => getComputedStyle(element).width), '240px');
        await output.close();
      } finally { server.kill('SIGTERM'); if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve)); }
    }
    await context.close();
  } finally { await browser.close(); if (root) await rm(root, { recursive: true, force: true }); await pool.query('DELETE FROM projects WHERE id=$1', [project.id]); await pool.end(); }
});
