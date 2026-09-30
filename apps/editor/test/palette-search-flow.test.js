import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { samplePage } from '@builder/document';
import { pool } from '../../api/src/db.js';
import { paletteGroupsStorageKey } from '../src/palette-preferences.js';

const base = 'http://127.0.0.1:3001/api';
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function request(path, options) {
  const response = await fetch(base + path, options);
  if (!response.ok) assert.fail(`${path}: ${response.status} ${await response.text()}`);
  return response;
}
async function ready(url) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(url)).ok) return; } catch { /* exported server starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(`Exported server did not start: ${url}`);
}

test('search temporarily reveals stored groups while palette drops and exports keep the saved page', { timeout: 120000 }, async () => {
  const ids = [];
  const directory = await mkdtemp(join(tmpdir(), 'builder-palette-search-'));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const project = (await (await request('/projects', json('POST', { name: `Palette search ${Date.now()}` }))).json()).project; ids.push(project.id);
    const otherProject = (await (await request('/projects', json('POST', { name: `Palette other ${Date.now()}` }))).json()).project; ids.push(otherProject.id);
    const home = (await (await request(`/projects/${project.id}/pages`, json('POST', { name: 'Home', path: '/', document: samplePage }))).json()).page;
    const otherPage = (await (await request(`/projects/${project.id}/pages`, json('POST', { name: 'Other page', path: '/other', document: samplePage }))).json()).page;
    const otherProjectHome = (await (await request(`/projects/${otherProject.id}/pages`, json('POST', { name: 'Other project home', path: '/', document: samplePage }))).json()).page;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173/');
    await page.getByRole('combobox', { name: 'Project' }).selectOption(project.id);
    await page.getByRole('combobox', { name: 'Page' }).selectOption(home.id);
    const disclosure = group => page.locator(`.palette-disclosure[aria-controls="palette-group-${group.toLowerCase()}"]`);
    const search = page.getByLabel('Search elements');
    for (const group of ['Basic', 'Layout', 'Forms']) await disclosure(group).click();
    assert.deepEqual((await page.evaluate(key => JSON.parse(localStorage.getItem(key)), paletteGroupsStorageKey)).collapsed, ['Basic', 'Layout', 'Forms']);
    await search.fill('wrapper');
    assert.deepEqual(await page.locator('[data-palette]').evaluateAll(rows => rows.map(row => row.dataset.palette)), ['Container']);
    assert.equal(await disclosure('Layout').getAttribute('aria-expanded'), 'true');
    await disclosure('Layout').click();
    assert.equal(await disclosure('Layout').getAttribute('aria-expanded'), 'false');
    await search.fill('typeahead');
    assert.deepEqual(await page.locator('[data-palette]').evaluateAll(rows => rows.map(row => row.dataset.palette)), ['Autocomplete']);
    assert.equal(await disclosure('Forms').getAttribute('aria-expanded'), 'true');
    await search.fill('missing-element-xyz');
    assert.match(await page.locator('.palette-no-results').innerText(), /No elements match/);
    assert.equal(await page.locator('.palette-group').count(), 0);
    assert.equal(await page.locator('.suggestion-panel').count(), 0);
    await search.fill('');
    for (const group of ['Basic', 'Layout', 'Forms']) assert.equal(await disclosure(group).getAttribute('aria-expanded'), 'false');
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await page.getByRole('button', { name: 'Elements', exact: true }).click();
    assert.equal(await disclosure('Basic').getAttribute('aria-expanded'), 'false');
    await page.getByRole('combobox', { name: 'Page' }).selectOption(otherPage.id);
    await page.waitForFunction(id => document.querySelector('select[aria-label="Page"]')?.value === id, otherPage.id);
    assert.equal(await disclosure('Layout').getAttribute('aria-expanded'), 'false');
    await page.getByRole('combobox', { name: 'Project' }).selectOption(otherProject.id);
    await page.waitForFunction(id => document.querySelector('select[aria-label="Page"]')?.value === id, otherProjectHome.id);
    assert.equal(await disclosure('Forms').getAttribute('aria-expanded'), 'false');
    await page.getByRole('combobox', { name: 'Project' }).selectOption(project.id);
    await page.getByRole('combobox', { name: 'Page' }).locator(`option[value="${home.id}"]`).waitFor({ state: 'attached' });
    await page.getByRole('combobox', { name: 'Page' }).selectOption(home.id);
    await page.reload();
    await page.getByRole('combobox', { name: 'Project' }).selectOption(project.id);
    await page.getByRole('combobox', { name: 'Page' }).selectOption(home.id);
    for (const group of ['Basic', 'Layout', 'Forms']) assert.equal(await disclosure(group).getAttribute('aria-expanded'), 'false');
    assert.equal(await disclosure('Content').getAttribute('aria-expanded'), 'true');
    await search.fill('typeahead');
    await page.getByRole('button', { name: 'Add Autocomplete' }).click();
    const autocompleteId = await page.locator('.canvas-area .page [data-node-id^="node_"]').last().getAttribute('data-node-id');
    await search.fill('wrapper');
    await page.getByRole('button', { name: 'Add Container' }).click();
    const draft = await page.evaluate(() => document.querySelector('[data-save-state]')?.dataset.saveState);
    assert.equal(draft, 'unsaved');
    const containerId = await page.locator('.canvas-area .page [data-node-id^="node_"]').last().getAttribute('data-node-id');
    await search.fill('title');
    const heading = page.locator('.left-sidebar [data-palette="Heading"] .palette-item-main:not([data-dnd-placeholder])');
    const drops = [
      page.locator('.canvas-area [data-region="header"]'),
      page.locator('.canvas-area [data-node-id="hero"]'),
      page.locator('.canvas-area [data-region="footer"]'),
      page.locator(`.canvas-area [data-node-id="${containerId}"]`)
    ];
    for (const [index, target] of drops.entries()) {
      const bounds = await target.boundingBox();
      await heading.dragTo(target, { targetPosition: { x: index === 3 ? bounds.width / 2 : 10, y: index === 1 ? 1 : index === 3 ? bounds.height / 2 : 10 }, steps: 12 });
      await page.waitForTimeout(250);
      assert.match(await page.locator('.status-bar').innerText(), /Placed Heading/);
    }
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('[data-save-state="saved"]').waitFor();
    const saved = (await (await request(`/pages/${home.id}`)).json()).page;
    const inserted = region => saved.document.regions[region].filter(node => node.type === 'Heading' && node.id.startsWith('node_'));
    assert.equal(inserted('header').length, 1);
    assert.equal(inserted('main').length, 1);
    assert.equal(inserted('footer').length, 1);
    assert.equal(saved.document.regions.main.some(node => node.id === autocompleteId && node.type === 'Autocomplete'), true);
    const container = saved.document.regions.main.find(node => node.id === containerId);
    assert.equal(container.children.filter(node => node.type === 'Heading').length, 1);
    assert.equal(saved.document.schemaVersion, samplePage.schemaVersion);
    assert.equal(JSON.stringify(saved.document).includes(paletteGroupsStorageKey), false);
    await page.reload();
    await page.getByRole('combobox', { name: 'Project' }).selectOption(project.id);
    await page.getByRole('combobox', { name: 'Page' }).selectOption(home.id);
    await page.getByRole('button', { name: 'Preview page' }).click();
    for (const node of [...inserted('header'), ...inserted('main'), ...inserted('footer'), ...container.children, { id: autocompleteId }]) assert.equal(await page.locator(`.preview-stage [data-node-id="${node.id}"]`).count(), 1);
    await page.getByRole('button', { name: 'Back to editor' }).click();
    const nodeIds = [...inserted('header'), ...inserted('main'), ...inserted('footer'), ...container.children, { id: autocompleteId }].map(node => node.id);
    for (const [target, port] of [['html', 4173], ['react', 4184], ['vue', 4185]]) {
      const response = await request(`/projects/${project.id}/exports/${target}.zip`);
      const zip = join(directory, `${target}.zip`);
      const output = join(directory, target);
      await writeFile(zip, Buffer.from(await response.arrayBuffer()));
      execFileSync('mkdir', ['-p', output]);
      execFileSync('unzip', ['-q', zip, '-d', output]);
      if (target !== 'html') execFileSync('npm', ['install', '--offline'], { cwd: output });
      execFileSync('npm', ['run', 'build'], { cwd: output });
      const server = target === 'html' ? spawn(process.execPath, ['server.js', 'dist'], { cwd: output, stdio: 'ignore' }) : spawn(join(output, 'node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: output, stdio: 'ignore' });
      try {
        await ready(`http://127.0.0.1:${port}/`);
        const exported = await context.newPage();
        await exported.goto(`http://127.0.0.1:${port}/`);
        for (const id of nodeIds) assert.equal(await exported.locator(`.n-${id}`).count(), 1, `${target} ${id}`);
        await exported.close();
      } finally { server.kill('SIGTERM'); if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve)); }
    }
    await context.close();
  } finally {
    await browser.close();
    await pool.query('DELETE FROM projects WHERE id=ANY($1::uuid[])', [ids]);
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  }
});
