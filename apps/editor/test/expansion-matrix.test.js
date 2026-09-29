import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { validateDocument } from '@builder/document';
import { createPaletteNode } from '../src/palette.js';
import { pool } from '../../api/src/db.js';

const api = 'http://127.0.0.1:3001/api';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lqkAAAAASUVORK5CYII=', 'base64');
const types = ['Avatar', 'Badge', 'Chip', 'Icons', 'Lists', 'Table', 'Tooltip', 'Checkbox', 'Radio Group', 'Rating', 'Autocomplete', 'Slider', 'Switch', 'Transfer List', 'Toggle Button', 'Floating Action Button'];
const fields = { Avatar: 'Initials fallback', Badge: 'Anchor text', Chip: 'Chip label', Icons: 'Accessible name', Lists: 'List mode', Table: 'Caption (optional)', Tooltip: 'Tooltip content', Checkbox: 'Field name', 'Radio Group': 'Option 1 label', Rating: 'Rating items (1–20)', Autocomplete: 'Placeholder', Slider: 'Minimum', Switch: 'Initially on', 'Transfer List': 'Left group label', 'Toggle Button': 'Initially pressed', 'Floating Action Button': 'Screen corner' };
const blank = title => ({ schemaVersion: 1, id: `page_${crypto.randomUUID().replaceAll('-', '')}`, type: 'Page', props: { title }, styles: { desktop: {}, tablet: {}, mobile: {} }, regions: { header: [], main: [], footer: [] } });
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const request = async (path, options) => { const response = await fetch(api + path, options); if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`); return response; };
async function doc(page) { const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download JSON' }).click()]); return JSON.parse(await readFile(await download.path(), 'utf8')); }
async function ready(url) { for (let i = 0; i < 50; i++) { try { if ((await fetch(url)).ok) return; } catch { /* wait */ } await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Export server unavailable: ${url}`); }

test('16-element editing, revision, Preview and standalone export matrix', { timeout: 180000 }, async () => {
  const project = (await (await request('/projects', json('POST', { name: `Element matrix ${Date.now()}` }))).json()).project;
  let root;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const asset = (await (await request(`/projects/${project.id}/assets`, { method: 'POST', headers: { 'content-type': 'image/png', 'x-file-name': 'matrix.png' }, body: png })).json()).asset;
    const nodes = Object.fromEntries(types.map(type => [type, createPaletteNode(type)]));
    nodes.Avatar.props.src = asset.url;
    nodes.Avatar.props.alt = 'Matrix avatar';
    nodes['Floating Action Button'].props.visibleMobile = true;
    const linkFab = createPaletteNode('Floating Action Button');
    Object.assign(linkFab.props, { action: 'link', href: '/about', label: 'About site', corner: 'topLeft', visibleMobile: true });
    for (const node of [...Object.values(nodes), linkFab]) node.styles.mobile.marginTop = '3px';
    const container = createPaletteNode('Container');
    container.styles.desktop.minHeight = '2400px';
    container.children = [...types.slice(5, 10).map(type => nodes[type]), nodes['Floating Action Button']];
    const design = blank('Element matrix');
    design.regions.header = types.slice(0, 5).map(type => nodes[type]);
    design.regions.main = [container];
    design.regions.footer = [...types.slice(10, 15).map(type => nodes[type]), linkFab];
    validateDocument(design);
    const created = (await (await request(`/projects/${project.id}/pages`, json('POST', { name: 'Matrix', path: '/', document: design }))).json()).page;
    const about = (await (await request(`/projects/${project.id}/pages`, json('POST', { name: 'About', path: '/about', document: blank('About') }))).json()).page;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173/');
    await page.getByRole('combobox', { name: 'Project' }).selectOption(project.id);
    await page.getByRole('combobox', { name: 'Page' }).selectOption(created.id);
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await page.locator(`[data-layer-id="${container.id}"]`).waitFor();
    await page.getByRole('button', { name: 'Elements', exact: true }).click();
    for (const type of types) {
      await page.getByLabel('Search elements').fill(type);
      assert.equal(await page.locator(`[data-palette="${type}"]`).count(), 1, `${type} palette search`);
    }
    await page.getByLabel('Search elements').fill('');
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await page.locator(`[data-layer-id="${container.id}"] .layer-toggle`).click();
    await page.getByRole('button', { name: 'mobile', exact: true }).click();
    for (const type of types) {
      const node = nodes[type];
      await page.locator(`[data-layer-id="${node.id}"] .layer-select`).click();
      assert.match(await page.locator('.selection-label').innerText(), new RegExp(type));
      await page.getByRole('tab', { name: 'content' }).click();
      assert.ok(await page.locator('.properties').getByLabel(fields[type]).count(), `${type} type-specific property`);
      await page.getByRole('tab', { name: 'layout' }).click();
      assert.equal(await page.locator('[data-style-field="marginTop"] input').inputValue(), '3px', `${type} mobile CSS`);
    }
    await page.locator(`[data-layer-id="${nodes['Floating Action Button'].id}"] .layer-select`).click();
    await page.locator('[data-style-field="marginTop"] input').fill('4px');
    await page.getByRole('tab', { name: 'content' }).click();
    await page.getByRole('textbox', { name: 'Accessible label' }).fill('Jump up');
    await page.getByRole('textbox', { name: 'Accessible label' }).press('Tab');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('[data-save-state="saved"]').waitFor();
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    const saved = await doc(page);
    assert.equal(saved.regions.main[0].children.at(-1).props.label, 'Jump up');
    assert.equal(saved.regions.main[0].children.at(-1).styles.mobile.marginTop, '4px');
    await page.getByRole('button', { name: 'Revisions' }).click();
    await page.getByRole('combobox', { name: 'Revision to restore' }).selectOption('1');
    await page.getByRole('button', { name: 'Restore revision' }).click();
    assert.deepEqual(await doc(page), design);
    await page.getByRole('button', { name: 'Preview page' }).click();
    await page.getByRole('button', { name: 'mobile', exact: true }).click();
    const preview = {};
    for (const type of types) {
      const node = nodes[type];
      const element = page.locator(`.preview-stage [data-node-id="${node.id}"]`);
      preview[type] = await element.evaluate(value => ({ text: value.innerText?.replace(/\s+/g, ' ').trim() || '', margin: getComputedStyle(value).marginTop }));
      assert.equal(preview[type].margin, '3px', `${type} Preview mobile CSS`);
    }
    const previewFab = page.locator(`.preview-stage [data-node-id="${nodes['Floating Action Button'].id}"]`);
    assert.equal(await previewFab.evaluate(value => getComputedStyle(value).position), 'fixed');
    assert.ok(Number.parseFloat(await previewFab.evaluate(value => getComputedStyle(value).bottom)) >= 80);
    const stage = page.locator('.preview-stage');
    const stageBox = await stage.locator('.page').boundingBox();
    const fabBox = await previewFab.boundingBox();
    assert.ok(fabBox.x >= stageBox.x && fabBox.x + fabBox.width <= stageBox.x + stageBox.width, 'Preview FAB stays inside simulated viewport');
    await stage.evaluate(value => { value.scrollTop = 900; });
    assert.ok(await stage.evaluate(value => value.scrollTop) > 0);
    await previewFab.focus();
    assert.equal(await previewFab.evaluate(value => getComputedStyle(value).outlineWidth), '3px');
    await previewFab.press('Enter');
    await page.waitForFunction(() => document.querySelector('.preview-stage').scrollTop < 5);
    const previewLink = page.locator('.preview-stage').getByRole('link', { name: 'About site' });
    await previewLink.focus(); await previewLink.press('Enter');
    await page.waitForFunction(id => document.querySelector('select[aria-label="Page"]')?.value === id, about.id);
    assert.equal(await page.getByRole('combobox', { name: 'Page' }).inputValue(), about.id);
    await page.getByRole('combobox', { name: 'Page' }).selectOption(created.id);
    assert.deepEqual(await doc(page), design);
    root = await mkdtemp(join(tmpdir(), 'builder-matrix-'));
    for (const [target, port] of [['html', 4673], ['react', 4674], ['vue', 4675]]) {
      const directory = join(root, target);
      const zip = join(root, `${target}.zip`);
      await writeFile(zip, Buffer.from(await (await request(`/projects/${project.id}/exports/${target}.zip`)).arrayBuffer()));
      execFileSync('mkdir', ['-p', directory]);
      execFileSync('unzip', ['-q', zip, '-d', directory]);
      const assetPath = join(directory, target === 'html' ? 'assets' : 'public/assets', `${asset.id}.png`);
      assert.deepEqual(await readFile(assetPath), png);
      for (const file of target === 'html' ? ['avatar.js', 'tooltip.js', 'controls.js', 'autocomplete.js', 'transfer.js', 'fab.js'] : [`src/tooltip.${target === 'react' ? 'jsx' : 'js'}`, `src/controls.${target === 'react' ? 'jsx' : 'js'}`, `src/autocomplete.${target === 'react' ? 'jsx' : 'js'}`, `src/transfer.${target === 'react' ? 'jsx' : 'js'}`]) assert.ok((await readFile(join(directory, file))).length > 0, `${target} ${file}`);
      if (target !== 'html') execFileSync('npm', ['install', '--offline'], { cwd: directory });
      execFileSync('npm', ['run', 'build'], { cwd: directory });
      const server = spawn(join(process.cwd(), 'node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: directory, stdio: 'ignore' });
      try {
        await ready(`http://127.0.0.1:${port}/`);
        const output = await context.newPage();
        const apiCalls = [];
        output.on('request', event => { if (event.url().includes(':3001/') || event.url().includes(':5173/')) apiCalls.push(event.url()); });
        await output.route('**/api/**', route => route.abort());
        await output.setViewportSize({ width: 390, height: 844 });
        await output.goto(`http://127.0.0.1:${port}/`);
        for (const type of types) {
          const node = nodes[type];
          const element = output.locator(`.n-${node.id}`);
          const signature = await element.evaluate(value => ({ text: value.innerText?.replace(/\s+/g, ' ').trim() || '', margin: getComputedStyle(value).marginTop }));
          assert.deepEqual(signature, preview[type], `${target} ${type} matches Preview`);
        }
        assert.equal(await output.locator(`.n-${nodes.Avatar.id} img`).evaluate(value => value.naturalWidth), 1);
        const button = output.getByRole('button', { name: 'Back to top' });
        await output.evaluate(() => window.scrollTo(0, 900));
        assert.ok(await output.evaluate(() => window.scrollY) > 0);
        await button.focus();
        assert.equal(await button.evaluate(value => getComputedStyle(value).outlineWidth), '3px');
        await button.press('Enter');
        await output.waitForFunction(() => window.scrollY < 5);
        const link = output.getByRole('link', { name: 'About site' });
        await link.focus(); await link.press('Enter');
        await output.waitForURL(/\/about\/?$/);
        assert.deepEqual(apiCalls, [], `${target} has no editor API dependency`);
        await output.close();
      } finally { server.kill('SIGTERM'); if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve)); }
    }
    await context.close();
  } finally { await browser.close(); if (root) await rm(root, { recursive: true, force: true }); await pool.query('DELETE FROM projects WHERE id=$1', [project.id]); await pool.end(); }
});
