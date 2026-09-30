import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { findNode, samplePage, updateNode } from '@builder/document';
import { pool } from '../../api/src/db.js';

const base = process.env.API_BASE || 'http://127.0.0.1:3001/api';
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function request(path, options) {
  const response = await fetch(base + path, options);
  if (!response.ok) assert.fail(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

test('two roots keep their levels while a linked three-level subtree moves and reloads', { timeout: 60000 }, async () => {
  const projects = [];
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const alpha = (await request('/projects', json('POST', { name: `CRUD roots ${Date.now()}` }))).project; projects.push(alpha.id);
    const beta = (await request('/projects', json('POST', { name: `CRUD other ${Date.now()}` }))).project; projects.push(beta.id);
    const create = async (name, path, parentPageId = null) => (await request(`/projects/${alpha.id}/pages`, json('POST', { name, path, parentPageId, document: samplePage }))).page;
    const home = await create('Home', '/');
    const about = await create('About', '/about');
    let team = await create('Team', '/about/team', about.id);
    const culture = await create('Culture', '/about/team/culture', team.id);
    await request(`/projects/${beta.id}/pages`, json('POST', { name: 'Other home', path: '/', document: samplePage }));
    let homeDocument = updateNode(structuredClone(samplePage), 'nav_about', { props: { href: '', targetPageId: team.id, anchor: 'hero_title' } });
    homeDocument = updateNode(homeDocument, 'hero_inner', { styles: { mobile: { gap: '13px', gridTemplateColumns: '1fr' } } });
    const savedHome = (await request(`/pages/${home.id}`, json('PUT', { expectedRevision: home.revision, document: homeDocument }))).page;
    const aboutDocument = updateNode(structuredClone(samplePage), 'nav_about', { props: { href: '', targetPageId: home.id, anchor: '' } });
    await request(`/pages/${about.id}`, json('PUT', { expectedRevision: about.revision, document: aboutDocument }));
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    if (process.env.API_BASE) await page.route('**/api/**', async route => {
      const target = new URL(route.request().url());
      const source = new URL(base);
      target.host = source.host;
      const response = await route.fetch({ url: target.toString() });
      await route.fulfill({ response });
    });
    await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173/');
    await page.getByRole('combobox', { name: 'Project' }).selectOption(alpha.id);
    await page.getByRole('button', { name: 'Pages', exact: true }).click();
    const manager = page.getByRole('dialog', { name: 'Manage pages' });
    const row = name => manager.locator('.page-tree > li').filter({ has: page.locator('[data-page-select] strong', { hasText: name }) }).first();
    for (const [name, level] of [['Home', 0], ['About', 0], ['Team', 1], ['Culture', 2]]) {
      assert.equal(await row(name).getAttribute('aria-level'), String(level + 1));
      await row(name).getByText(`level ${level}`, { exact: false }).waitFor();
    }
    await row('Culture').locator('[data-page-select]').click();
    await page.waitForFunction(id => document.querySelector('select[aria-label="Page"]')?.value === id, culture.id);
    assert.match(await page.locator('.current-page-trail').innerText(), /About.*Team.*Culture/);
    await row('Team').getByRole('button', { name: 'Rename / path' }).click();
    await row('Team').getByLabel('Name').fill('Crew');
    await row('Team').getByLabel('Sibling slug').fill('crew');
    await row('Team').getByRole('button', { name: 'Apply changes' }).click();
    await row('Crew').getByRole('button', { name: 'Move / order' }).click();
    await row('Crew').getByLabel('Parent').selectOption(home.id);
    await row('Crew').getByLabel(/Position among siblings/).fill('0');
    await row('Crew').getByRole('button', { name: 'Move page' }).click();
    await row('Crew').getByText('Home > Crew · level 1 · /about/team').waitFor();
    await row('Crew').getByRole('button', { name: 'Rename / path' }).click();
    await row('Crew').getByLabel('URL path').fill('/crew');
    await row('Crew').getByRole('button', { name: 'Apply changes' }).click();
    await row('Crew').getByText('Home > Crew · level 1 · /crew').waitFor();
    await row('Culture').getByText('Home > Crew > Culture · level 2 · /about/team/culture').waitFor();
    await manager.getByRole('button', { name: 'Close pages' }).click();
    await page.reload();
    await page.getByRole('combobox', { name: 'Project' }).selectOption(alpha.id);
    await page.getByRole('combobox', { name: 'Page' }).selectOption(culture.id);
    assert.match(await page.locator('.current-page-trail').innerText(), /Home.*Crew.*Culture/);
    const tree = (await request(`/projects/${alpha.id}/pages`)).pages;
    assert.deepEqual(tree.map(item => [item.name, item.level, item.path]), [['Home', 0, '/'], ['Crew', 1, '/crew'], ['Culture', 2, '/about/team/culture'], ['About', 0, '/about']]);
    team = (await request(`/pages/${team.id}`)).page;
    assert.equal(team.parentPageId, home.id);
    assert.equal(team.revision, 4);
    assert.deepEqual((await request(`/pages/${team.id}/revisions`)).revisions.map(item => item.revision), [4, 3, 2, 1]);
    const reloadedHome = (await request(`/pages/${home.id}`)).page;
    assert.equal(reloadedHome.revision, savedHome.revision);
    assert.equal(findNode(reloadedHome.document, 'nav_about').node.props.targetPageId, team.id);
    assert.deepEqual(findNode(reloadedHome.document, 'hero_inner').node.styles.mobile, { gap: '13px', gridTemplateColumns: '1fr' });
    assert.equal((await request(`/pages/${culture.id}`)).page.parentPageId, team.id);
    assert.equal((await request(`/pages/${team.id}/references?mode=subtree`)).references.some(item => item.pageId === home.id && item.nodeId === 'nav_about'), true);
    await page.close();
  } finally {
    await browser.close();
    await pool.query('DELETE FROM projects WHERE id=ANY($1::uuid[])', [projects]);
    await pool.end();
  }
});
