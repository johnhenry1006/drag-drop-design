import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { pool } from '../../api/src/db.js';

const api = 'http://127.0.0.1:3001/api';
const blank = { schemaVersion: 1, id: `page_${crypto.randomUUID().replaceAll('-', '')}`, type: 'Page', props: { title: 'Transfer flow' }, styles: { desktop: {}, tablet: {}, mobile: {} }, regions: { header: [], main: [], footer: [] } };
const request = async (path, options) => { const response = await fetch(api + path, options); if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`); return response; };
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function downloadDocument(page) { const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download JSON' }).click()]); return JSON.parse(await readFile(await download.path(), 'utf8')); }
async function selectRegion(page, name) { await page.getByRole('button', { name: 'Layers', exact: true }).click(); await page.locator(`[data-layer-region="${name}"] > button:first-child`).click(); await page.getByRole('button', { name: 'Elements', exact: true }).click(); }
async function ready(url) { for (let i = 0; i < 50; i++) { try { if ((await fetch(url)).ok) return; } catch { /* wait */ } await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Export server unavailable: ${url}`); }

async function checkRuntime(page, scope) {
  const root = page.locator(scope);
  const transfer = root.getByRole('group', { name: 'Move choices', exact: true });
  const groups = transfer.locator('.builder-transfer-group');
  const left = groups.first();
  const right = groups.last();
  const moveRight = transfer.getByRole('button', { name: 'Move right' });
  const moveLeft = transfer.getByRole('button', { name: 'Move left' });
  assert.match(await left.locator('legend').innerText(), /Available \(1 items, 0 selected\)/);
  assert.match(await right.locator('legend').innerText(), /Chosen \(1 items, 0 selected\)/);
  assert.equal(await left.getByRole('checkbox', { name: 'Same · left_value' }).count(), 1);
  assert.equal(await right.getByRole('checkbox', { name: 'Same · right_value' }).count(), 1);
  assert.equal(await moveRight.isDisabled(), true);
  const leftChoice = left.getByRole('checkbox', { name: 'Same · left_value' });
  await leftChoice.focus(); await leftChoice.press('Space');
  assert.equal(await leftChoice.isChecked(), true);
  assert.match(await left.locator('legend').innerText(), /1 items, 1 selected/);
  await moveRight.focus(); await moveRight.press('Enter');
  assert.match(await left.locator('legend').innerText(), /Available \(0 items, 0 selected\)/);
  assert.equal(await left.locator('.builder-transfer-empty').innerText(), 'No items');
  assert.match(await right.locator('legend').innerText(), /Chosen \(2 items, 0 selected\)/);
  await right.getByRole('checkbox', { name: 'Same · right_value' }).check();
  assert.match(await right.locator('legend').innerText(), /2 items, 1 selected/);
  await moveLeft.click();
  assert.match(await left.locator('legend').innerText(), /Available \(1 items, 0 selected\)/);
  assert.match(await right.locator('legend').innerText(), /Chosen \(1 items, 0 selected\)/);
  const empty = root.getByRole('group', { name: 'Empty transfer', exact: true });
  assert.equal(await empty.locator('.builder-transfer-empty:visible').count(), 2);
  assert.equal(await empty.getByRole('button', { name: 'Move right' }).isDisabled(), true);
  const disabled = root.getByRole('group', { name: 'Locked transfer', exact: true });
  assert.equal(await disabled.getByRole('checkbox').first().isDisabled(), true);
  assert.equal(await disabled.getByRole('button', { name: 'Move right' }).isDisabled(), true);
  if (scope === '.preview-stage') await page.getByRole('button', { name: 'mobile', exact: true }).click();
  else await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await transfer.locator('.builder-transfer-layout').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 1);
  assert.equal(await moveRight.isVisible(), true);
}

test('Transfer List moves both ways with keyboard, handles empty and duplicate labels, and builds all ZIPs', { timeout: 120000 }, async () => {
  const project = (await (await request('/projects', json('POST', { name: `Transfer ${Date.now()}` }))).json()).project;
  await request(`/projects/${project.id}/pages`, json('POST', { name: 'Transfer', path: '/', document: blank }));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let root;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173/');
    await page.getByRole('combobox', { name: 'Project' }).selectOption(project.id);
    await selectRegion(page, 'header');
    await page.locator('[data-palette="Transfer List"]').click();
    await page.getByRole('textbox', { name: 'Transfer label' }).fill('Empty transfer');
    await page.getByRole('textbox', { name: 'Transfer label' }).press('Tab');
    await page.getByRole('button', { name: 'Remove option 2' }).click();
    await page.getByRole('button', { name: 'Remove option 1' }).click();
    await selectRegion(page, 'main');
    await page.locator('[data-palette="Transfer List"]').click();
    await page.getByRole('textbox', { name: 'Transfer label' }).fill('Move choices');
    await page.getByRole('textbox', { name: 'Transfer label' }).press('Tab');
    await page.getByRole('textbox', { name: 'Option 1 label' }).fill('Same');
    await page.getByRole('textbox', { name: 'Option 1 label' }).press('Tab');
    await page.getByRole('textbox', { name: 'Option 1 value' }).fill('left_value');
    await page.getByRole('textbox', { name: 'Option 1 value' }).press('Tab');
    await page.getByRole('textbox', { name: 'Option 2 label' }).fill('Same');
    await page.getByRole('textbox', { name: 'Option 2 label' }).press('Tab');
    await page.getByRole('textbox', { name: 'Option 2 value' }).fill('right_value');
    await page.getByRole('textbox', { name: 'Option 2 value' }).press('Tab');
    await page.getByRole('checkbox', { name: 'Initially on right' }).last().check();
    await selectRegion(page, 'footer');
    await page.locator('[data-palette="Transfer List"]').click();
    await page.getByRole('textbox', { name: 'Transfer label' }).fill('Locked transfer');
    await page.getByRole('textbox', { name: 'Transfer label' }).press('Tab');
    await page.getByLabel('Disabled').check();
    const design = await downloadDocument(page);
    assert.equal(design.regions.header[0].props.options.length, 0);
    assert.deepEqual(design.regions.main[0].props.defaultRightIds, [design.regions.main[0].props.options[1].id]);
    assert.equal(design.regions.footer[0].props.disabled, true);
    await page.getByRole('button', { name: 'Clear selection' }).click();
    await page.locator('.canvas-area .builder-transfer').nth(1).click();
    assert.match(await page.locator('.selection-label').innerText(), /Transfer List/);
    assert.deepEqual(await downloadDocument(page), design);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('[data-save-state="saved"]').waitFor();
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    assert.deepEqual(await downloadDocument(page), design);
    await page.getByRole('button', { name: 'Preview page' }).click();
    await checkRuntime(page, '.preview-stage');
    assert.deepEqual(await downloadDocument(page), design);
    root = await mkdtemp(join(tmpdir(), 'builder-transfer-'));
    for (const [target, port] of [['html', 4573], ['react', 4574], ['vue', 4575]]) {
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
        await output.close();
      } finally { server.kill('SIGTERM'); if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve)); }
    }
    await context.close();
  } finally { await browser.close(); if (root) await rm(root, { recursive: true, force: true }); await pool.query('DELETE FROM projects WHERE id=$1', [project.id]); await pool.end(); }
});
