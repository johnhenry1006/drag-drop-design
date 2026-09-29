import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { pool } from '../../api/src/db.js';

const api = 'http://127.0.0.1:3001/api';
const blank = { schemaVersion: 1, id: `page_${crypto.randomUUID().replaceAll('-', '')}`, type: 'Page', props: { title: 'Control flow' }, styles: { desktop: {}, tablet: {}, mobile: {} }, regions: { header: [], main: [], footer: [] } };
const request = async (path, options) => { const response = await fetch(api + path, options); if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`); return response; };
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function documentFrom(page) { const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download JSON' }).click()]); return JSON.parse(await readFile(await download.path(), 'utf8')); }
async function region(page, name) { await page.getByRole('button', { name: 'Layers', exact: true }).click(); await page.locator(`[data-layer-region="${name}"] > button:first-child`).click(); await page.getByRole('button', { name: 'Elements', exact: true }).click(); }
async function ready(url) { for (let i = 0; i < 50; i++) { try { if ((await fetch(url)).ok) return; } catch { /* wait */ } await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Export server unavailable: ${url}`); }

async function runtimeChecks(page, selector) {
  const root = page.locator(selector);
  const checkbox = root.getByRole('checkbox', { name: 'Consent "now" <yes>' });
  const disabled = root.getByRole('checkbox', { name: 'Locked' });
  const sw = root.getByRole('switch', { name: 'Notifications' });
  const radios = root.locator('.builder-radio');
  const toggle = root.getByRole('button', { name: 'Favorite' });
  assert.equal(await checkbox.isChecked(), true);
  assert.equal(await sw.isChecked(), true);
  assert.equal(await radios.getByRole('radio', { name: 'Premium' }).isChecked(), true);
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  assert.equal(await disabled.isDisabled(), true);
  await checkbox.click();
  assert.equal(await checkbox.isChecked(), false);
  await sw.focus(); await sw.press('Space');
  assert.equal(await sw.isChecked(), false);
  await radios.getByRole('radio', { name: 'Premium' }).focus();
  await radios.getByRole('radio', { name: 'Premium' }).press('ArrowUp');
  assert.equal(await radios.getByRole('radio', { name: 'Basic' }).isChecked(), true);
  await toggle.focus(); await toggle.press('Space');
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(await disabled.isChecked(), false);
}

test('form controls edit defaults, keep runtime state local, and work in three built exports', { timeout: 120000 }, async () => {
  const project = (await (await request('/projects', json('POST', { name: `Controls ${Date.now()}` }))).json()).project;
  await request(`/projects/${project.id}/pages`, json('POST', { name: 'Controls', path: '/', document: blank }));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let root;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173/');
    await page.getByRole('combobox', { name: 'Project' }).selectOption(project.id);
    await region(page, 'header');
    await page.locator('[data-palette="Checkbox"]').click();
    await page.getByRole('textbox', { name: 'Field name' }).fill('consent_name');
    await page.getByRole('textbox', { name: 'Field name' }).press('Tab');
    await page.getByRole('textbox', { name: 'Accessible label' }).fill('Consent "now" <yes>');
    await page.getByRole('textbox', { name: 'Accessible label' }).press('Tab');
    await page.getByLabel('Initially checked').check();
    await page.getByLabel('Required if placed in a form').check();
    await region(page, 'header');
    await page.locator('[data-palette="Checkbox"]').click();
    await page.getByRole('textbox', { name: 'Accessible label' }).fill('Locked');
    await page.getByRole('textbox', { name: 'Accessible label' }).press('Tab');
    await page.getByLabel('Disabled').check();
    await region(page, 'main');
    await page.locator('[data-palette="Radio Group"]').click();
    await page.getByRole('textbox', { name: 'Accessible label' }).fill('Plan');
    await page.getByRole('textbox', { name: 'Accessible label' }).press('Tab');
    await page.getByRole('textbox', { name: 'Option 1 ID' }).fill('plan_basic');
    await page.getByRole('textbox', { name: 'Option 1 ID' }).press('Tab');
    await page.getByRole('textbox', { name: 'Option 1 label' }).fill('Basic');
    await page.getByRole('textbox', { name: 'Option 1 label' }).press('Tab');
    await page.getByRole('textbox', { name: 'Option 1 value' }).fill('basic');
    await page.getByRole('textbox', { name: 'Option 1 value' }).press('Tab');
    await page.getByRole('textbox', { name: 'Option 2 label' }).fill('Premium');
    await page.getByRole('textbox', { name: 'Option 2 label' }).press('Tab');
    await page.getByLabel('Initially selected').selectOption({ label: 'Premium' });
    await page.getByRole('textbox', { name: 'Option 2 value' }).fill('premium');
    await page.getByRole('textbox', { name: 'Option 2 value' }).press('Tab');
    await region(page, 'footer');
    await page.locator('[data-palette="Switch"]').click();
    await page.getByRole('textbox', { name: 'Accessible label' }).fill('Notifications');
    await page.getByRole('textbox', { name: 'Accessible label' }).press('Tab');
    await page.getByLabel('Initially on').check();
    await region(page, 'footer');
    await page.locator('[data-palette="Toggle Button"]').click();
    await page.getByRole('textbox', { name: 'Accessible label' }).fill('Favorite');
    await page.getByRole('textbox', { name: 'Accessible label' }).press('Tab');
    await page.getByLabel('Initially pressed').check();
    await page.getByRole('button', { name: 'mobile', exact: true }).click();
    await page.getByRole('tab', { name: 'style' }).click();
    await page.locator('[data-style-field="backgroundColor"] input').fill('#123456');
    const design = await documentFrom(page);
    assert.equal(design.regions.header.length, 2);
    assert.equal(design.regions.header[0].props.name, 'consent_name');
    assert.equal(design.regions.main[0].props.options[0].id, 'plan_basic');
    assert.deepEqual(design.regions.main[0].props.options.map(option => option.value), ['basic', 'premium']);
    assert.equal(design.regions.main[0].props.defaultValue, design.regions.main[0].props.options[1].value);
    await page.getByRole('button', { name: 'Clear selection' }).click();
    await page.locator('.canvas-area .builder-checkbox').first().click();
    assert.match(await page.locator('.selection-label').innerText(), /Checkbox/);
    assert.deepEqual(await documentFrom(page), design);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('[data-save-state="saved"]').waitFor();
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    assert.deepEqual(await documentFrom(page), design);
    await page.getByRole('button', { name: 'Preview page' }).click();
    await page.getByRole('button', { name: 'mobile', exact: true }).click();
    await runtimeChecks(page, '.preview-stage');
    assert.equal(await page.locator('.preview-stage .builder-toggle').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(18, 52, 86)');
    assert.deepEqual(await documentFrom(page), design);
    root = await mkdtemp(join(tmpdir(), 'builder-controls-'));
    for (const [target, port] of [['html', 4273], ['react', 4274], ['vue', 4275]]) {
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
        const outputPage = await context.newPage();
        await outputPage.goto(`http://127.0.0.1:${port}/`);
        await outputPage.setViewportSize({ width: 390, height: 844 });
        await runtimeChecks(outputPage, 'body');
        assert.equal(await outputPage.locator('.builder-toggle').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(18, 52, 86)');
        await outputPage.close();
      } finally { server.kill('SIGTERM'); if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve)); }
    }
    await context.close();
  } finally { await browser.close(); if (root) await rm(root, { recursive: true, force: true }); await pool.query('DELETE FROM projects WHERE id=$1', [project.id]); await pool.end(); }
});
