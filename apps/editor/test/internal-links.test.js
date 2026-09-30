import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { findNode, samplePage, updateNode } from '@builder/document';
import { analyzeProjectExport } from '@builder/exporters/project';
import { pool } from '../../api/src/db.js';

const base = 'http://127.0.0.1:3001/api';
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function request(path, options) {
  const response = await fetch(base + path, options);
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response;
}
async function ready(url) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(url)).ok) return; } catch { /* server starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Export server did not start at ${url}`);
}

test('page-ID links resolve after route edits in Preview and three built ZIPs', { timeout: 120000 }, async () => {
  const project = (await (await request('/projects', json('POST', { name: `Internal links ${Date.now()}` }))).json()).project;
  const other = (await (await request('/projects', json('POST', { name: `Other links ${Date.now()}` }))).json()).project;
  let root;
  const directory = await mkdtemp(join(tmpdir(), 'builder-internal-links-'));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    root = (await (await request(`/projects/${project.id}/pages`, json('POST', { name: 'Home', path: '/', document: samplePage }))).json()).page;
    const about = (await (await request(`/projects/${project.id}/pages`, json('POST', { name: 'About', path: '/about', parentPageId: root.id, document: samplePage }))).json()).page;
    let team = (await (await request(`/projects/${project.id}/pages`, json('POST', { name: 'Team', path: '/about/team', parentPageId: about.id, document: samplePage }))).json()).page;
    const otherPage = (await (await request(`/projects/${other.id}/pages`, json('POST', { name: 'Other home', path: '/', document: samplePage }))).json()).page;
    let home = updateNode(structuredClone(samplePage), 'nav_contact', { props: { href: 'https://example.org/info' } });
    home.regions.header.push({ id: 'linked_navigation', type: 'Navigation', props: { label: 'Linked navigation' }, styles: { desktop: {}, tablet: {}, mobile: {} }, children: [{ id: 'linked_team', type: 'Link', props: { text: 'Linked team', href: '', targetPageId: team.id, anchor: 'hero_title' }, styles: { desktop: {}, tablet: {}, mobile: {} } }] });
    home.regions.footer.push({ id: 'team_fab', type: 'Floating Action Button', props: { icon: 'home', label: 'Open team', action: 'link', href: '', targetPageId: team.id, anchor: '', corner: 'bottomRight', offset: 24, shape: 'circle', visibleDesktop: true, visibleTablet: true, visibleMobile: true }, styles: { desktop: {}, tablet: {}, mobile: {} } });
    root = (await (await request(`/pages/${root.id}`, json('PUT', { expectedRevision: root.revision, document: home }))).json()).page;
    const invalid = updateNode(home, 'linked_team', { props: { targetPageId: otherPage.id } });
    const rejected = await fetch(base + `/pages/${root.id}`, json('PUT', { expectedRevision: root.revision, document: invalid }));
    assert.equal(rejected.status, 409);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173/');
    await page.getByRole('combobox', { name: 'Project' }).selectOption(project.id);
    await page.getByRole('combobox', { name: 'Page' }).selectOption(root.id);
    await page.locator('.canvas-area [data-node-id="nav_about"]').click();
    await page.getByLabel('Destination type').selectOption('page');
    await page.getByLabel('Target page').selectOption(team.id);
    await page.getByLabel('Page anchor (optional, without #)').fill('hero_title');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('[data-save-state="saved"]').waitFor();
    const saved = (await (await request(`/pages/${root.id}`)).json()).page;
    assert.equal(findNode(saved.document, 'nav_about').node.props.targetPageId, team.id);
    const moved = (await (await request(`/pages/${team.id}/move`, json('POST', { expectedRevision: team.revision, parentPageId: root.id, index: 0 }))).json()).page;
    team = (await (await request(`/pages/${team.id}`, json('PATCH', { expectedRevision: moved.revision, name: 'Crew', slug: 'crew', path: '/crew' }))).json()).page;
    assert.equal(team.path, '/crew');
    assert.equal(team.parentPageId, root.id);
    assert.equal((await (await request(`/projects/${project.id}/pages`)).json()).pages.find(item => item.id === root.id).level, 0);
    const unavailable = updateNode(saved.document, 'nav_about', { props: { targetPageId: otherPage.id } });
    const report = analyzeProjectExport('html', [{ id: root.id, path: '/', document: unavailable }, { id: team.id, path: '/crew', document: samplePage }]);
    assert.equal(report.some(item => item.nodeId === 'nav_about' && item.property === 'targetPageId' && item.message.includes('missing or inaccessible')), true);
    assert.equal((await (await request(`/pages/${root.id}`)).json()).page.revision, saved.revision);
    const references = (await (await request(`/pages/${team.id}/references?mode=reparent`)).json()).references;
    assert.equal(references.some(item => item.nodeId === 'nav_about' && item.targetPageId === team.id), true);
    assert.equal(references.some(item => item.nodeId === 'linked_team'), true);
    const deletion = await fetch(base + `/pages/${team.id}`, json('DELETE', { expectedRevision: team.revision, mode: 'reparent', destinationParentPageId: root.id, confirmedPageIds: [team.id] }));
    assert.equal(deletion.status, 409);
    await page.reload();
    await page.getByRole('combobox', { name: 'Project' }).selectOption(project.id);
    await page.getByRole('combobox', { name: 'Page' }).selectOption(root.id);
    await page.getByRole('button', { name: 'Preview page' }).click();
    assert.equal(await page.locator('.preview-stage [data-node-id="nav_about"]').getAttribute('href'), '/crew#hero_title');
    assert.equal(await page.locator('.preview-stage [data-node-id="nav_contact"]').getAttribute('href'), 'https://example.org/info');
    assert.equal(await page.locator('.preview-stage [data-node-id="nav_work"]').getAttribute('href'), '#work');
    await page.locator('.preview-stage [data-node-id="nav_about"]').click();
    await page.waitForFunction(id => document.querySelector('select[aria-label="Page"]')?.value === id, team.id);
    assert.match(await page.locator('.current-page-trail').innerText(), /Crew.*\/crew/);
    assert.equal(await page.locator('.preview-stage #hero_title').count(), 1);
    await page.getByRole('button', { name: 'Back to editor' }).click();
    await page.getByRole('button', { name: 'Pages', exact: true }).click();
    const manager = page.getByRole('dialog', { name: 'Manage pages' });
    const crewRow = manager.locator('.page-tree > li').filter({ has: page.locator('[data-page-select] strong', { hasText: 'Crew' }) }).first();
    await crewRow.getByRole('button', { name: 'Delete', exact: true }).click();
    await crewRow.getByText('Fix these inbound links before deleting:').waitFor();
    await crewRow.getByRole('button', { name: 'Confirm deletion' }).waitFor();
    assert.equal(await crewRow.getByRole('button', { name: 'Confirm deletion' }).isDisabled(), true);
    await manager.getByRole('button', { name: 'Close pages' }).click();
    for (const [target, port] of [['html', 4173], ['react', 4174], ['vue', 4175]]) {
      const response = await request(`/projects/${project.id}/exports/${target}.zip`);
      const zip = join(directory, `${target}.zip`);
      const output = join(directory, target);
      await writeFile(zip, Buffer.from(await response.arrayBuffer()));
      execFileSync('mkdir', ['-p', output]);
      execFileSync('unzip', ['-q', zip, '-d', output]);
      if (target !== 'html') execFileSync('npm', ['install', '--offline'], { cwd: output });
      execFileSync('npm', ['run', 'build'], { cwd: output });
      const source = await readFile(join(output, target === 'html' ? 'dist/index.html' : `src/pages.${target === 'react' ? 'jsx' : 'js'}`), 'utf8');
      assert.match(source, target === 'html' ? /href="\.\/crew\/#hero_title"/ : /\/crew#hero_title/);
      assert.ok((source.match(/crew/g) || []).length >= 3);
      assert.match(source, /https:\/\/example.org\/info/);
      assert.match(source, /#work/);
      const server = target === 'html' ? spawn(process.execPath, ['server.js', 'dist'], { cwd: output, stdio: 'ignore' }) : spawn(join(output, 'node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: output, stdio: 'ignore' });
      try {
        await ready(`http://127.0.0.1:${port}/`);
        const exported = await browser.newPage();
        await exported.goto(`http://127.0.0.1:${port}/`);
        await exported.getByRole('link', { name: 'About', exact: true }).click();
        await exported.waitForURL(url => url.pathname.replace(/\/$/, '') === '/crew' && url.hash === '#hero_title');
        assert.equal(await exported.locator('#hero_title').count(), 1);
        await exported.getByRole('heading', { name: 'Make room for remarkable.' }).waitFor();
        await exported.close();
      } finally { server.kill('SIGTERM'); if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve)); }
    }
    await page.close();
  } finally {
    await browser.close();
    await pool.query('DELETE FROM projects WHERE id=ANY($1::uuid[])', [[project.id, other.id]]);
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  }
});
