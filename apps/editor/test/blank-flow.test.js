import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { pool } from '../../api/src/db.js';

const api = 'http://127.0.0.1:3001/api';
const blank = { schemaVersion: 1, id: `page_${crypto.randomUUID().replaceAll('-', '')}`, type: 'Page', props: { title: 'Blank flow' }, styles: { desktop: {}, tablet: {}, mobile: {} }, regions: { header: [], main: [], footer: [] } };
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const request = async (path, options) => { const response = await fetch(api + path, options); if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`); return response; };
const add = (page, type) => page.locator(`[data-palette="${type}"]`).click();
async function selectRegion(page, region) {
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.locator(`[data-layer-region="${region}"] > button:first-child`).click();
  await page.getByRole('button', { name: 'Elements', exact: true }).click();
}
async function doc(page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download JSON' }).click()]);
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}

test('blank page edits, history, save/reload, preview, and all exported project builds', { timeout: 120000 }, async () => {
  const project = (await (await request('/projects', json('POST', { name: `Blank flow ${Date.now()}` }))).json()).project;
  const created = (await (await request(`/projects/${project.id}/pages`, json('POST', { name: 'Blank flow', path: '/', document: blank }))).json()).page;
  let root;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173/');
    await page.getByRole('combobox', { name: 'Project' }).selectOption(project.id);
    await page.waitForFunction(() => document.querySelector('.status-bar')?.textContent.includes('Blank flow opened'));
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await page.locator('[data-layer-region="header"]').waitFor();
    await page.getByRole('button', { name: 'Elements', exact: true }).click();
    assert.deepEqual((await doc(page)).regions, { header: [], main: [], footer: [] });

    await selectRegion(page, 'header');
    await add(page, 'Navigation');
    await add(page, 'Link');
    await page.getByLabel('Link label').fill('Studio');
    await page.getByLabel('Link destination').fill('#studio');
    await page.getByRole('button', { name: 'mobile', exact: true }).click();
    await page.getByRole('tab', { name: 'style' }).click();
    await page.locator('[data-advanced-css]').fill('letter-spacing:.08em');
    await page.getByRole('button', { name: 'Apply declarations' }).click();

    await selectRegion(page, 'main');
    await add(page, 'Heading');
    await page.getByLabel('Heading text').fill('Directly in Main');
    await selectRegion(page, 'main');
    await add(page, 'Container');
    await add(page, 'Container');
    await page.getByLabel('Search elements').fill('Card');
    await add(page, 'Card');
    await page.getByLabel('Layer name').fill('Editable card');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal((await doc(page)).regions.main.at(-1).children[0].children[0].props.label, 'Card');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await page.getByLabel('Search elements').fill('');
    await page.getByRole('button', { name: 'Clear selection' }).click();
    assert.equal(await page.locator('.selection-label').count(), 0);
    const cardId = (await doc(page)).regions.main.at(-1).children[0].children[0].id;
    await page.locator(`.page [data-node-id="${cardId}"]`).focus();
    await page.keyboard.press('Enter');
    assert.match(await page.locator('.selection-label').innerText(), /Card/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.selection-label').count(), 0);
    await page.getByRole('button', { name: 'desktop', exact: true }).click();
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await page.locator('[data-layer-region="main"] > button:first-child').click();
    await page.getByRole('button', { name: 'Elements', exact: true }).click();
    await page.getByRole('button', { name: 'Two columns' }).click();
    await page.getByLabel('Layer name').fill('Modified suggestion');
    await page.getByRole('button', { name: 'mobile', exact: true }).click();
    await page.getByRole('tab', { name: 'style' }).click();
    await page.locator('[data-advanced-css]').fill('row-gap:10px');
    await page.getByRole('button', { name: 'Apply declarations' }).click();

    await selectRegion(page, 'footer');
    await page.locator('.suggestion-regions').getByRole('button', { name: 'Footer' }).click();
    await page.getByRole('button', { name: 'Links and contact' }).click();
    await page.getByLabel('Layer name').fill('Three-column footer');
    await page.getByRole('tab', { name: 'style' }).click();
    await page.locator('[data-advanced-css]').fill('column-gap:12px');
    await page.getByRole('button', { name: 'Apply declarations' }).click();
    const before = await doc(page);
    assert.equal(before.regions.header[0].type, 'Navigation');
    assert.equal(before.regions.main[0].type, 'Heading');
    assert.equal(before.regions.main[1].children[0].children[0].type, 'Card');
    assert.equal(before.regions.footer[0].children.length, 3);
    assert.equal(before.regions.header[0].children[0].advancedCss.mobile, 'letter-spacing:.08em');
    assert.equal(before.regions.main.at(-1).advancedCss.mobile, 'row-gap:10px');
    assert.equal(before.regions.footer[0].advancedCss.mobile, 'column-gap:12px');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('[data-save-state="saved"]').waitFor();
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    assert.deepEqual(await doc(page), before);
    await page.getByRole('button', { name: 'Preview page' }).click();
    assert.match(await page.locator('.preview-stage').innerText(), /Directly in Main/);
    assert.match(await page.locator('.preview-stage').innerText(), /Studio/);
    await page.getByRole('button', { name: 'Back to editor' }).click();

    root = await mkdtemp(join(tmpdir(), 'builder-blank-flow-'));
    for (const target of ['html', 'react', 'vue']) {
      const archive = Buffer.from(await (await request(`/projects/${project.id}/exports/${target}.zip`)).arrayBuffer());
      const zip = join(root, `${target}.zip`);
      const directory = join(root, target);
      await writeFile(zip, archive);
      execFileSync('mkdir', ['-p', directory]);
      execFileSync('unzip', ['-q', zip, '-d', directory]);
      if (target !== 'html') execFileSync('npm', ['install', '--offline'], { cwd: directory });
      execFileSync('npm', ['run', 'build'], { cwd: directory });
      assert.match(await readFile(join(directory, target === 'html' ? 'index.html' : `src/pages.${target === 'react' ? 'jsx' : 'js'}`), 'utf8'), /article/);
    }
  } finally {
    await browser.close();
    if (root) await rm(root, { recursive: true, force: true });
    await pool.query('DELETE FROM projects WHERE id=$1', [project.id]);
    await pool.end();
  }
});
