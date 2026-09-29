import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { samplePage } from '@builder/document';
import { pool } from '../../api/src/db.js';

const base = 'http://127.0.0.1:3001/api';
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function send(path, options) {
  const response = await fetch(base + path, options);
  if (!response.ok) assert.fail(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
}
async function waitForPage(projectId, pageId, predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const current = (await send(`/projects/${projectId}/pages`)).pages.find(item => item.id === pageId);
    if (predicate(current)) return current;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.fail(`Timed out waiting for page mutation: ${JSON.stringify((await send(`/projects/${projectId}/pages`)).pages.map(item => [item.name, item.parentPageId, item.sortOrder]))}`);
}

test('page tree manages a three-level hierarchy and keeps editor selection in sync', { timeout: 60000 }, async () => {
  const ids = [];
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const alpha = (await send('/projects', json('POST', { name: `Tree alpha ${Date.now()}` }))).project; ids.push(alpha.id);
    const beta = (await send('/projects', json('POST', { name: `Tree beta ${Date.now()}` }))).project; ids.push(beta.id);
    const create = async (project, name, path, parentPageId = null) => (await send(`/projects/${project.id}/pages`, json('POST', { name, path, parentPageId, document: samplePage }))).page;
    const home = await create(alpha, 'Home', '/');
    const about = await create(alpha, 'About', '/about', home.id);
    const team = await create(alpha, 'Team', '/about/team', about.id);
    const betaHome = await create(beta, 'Beta home', '/');
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const movePayloads = [];
    page.on('request', request => { if (request.url().endsWith('/move')) movePayloads.push(JSON.parse(request.postData())); });
    const prompts = [];
    page.on('dialog', dialog => dialog.type() === 'prompt' ? dialog.accept(prompts.shift() || '') : dialog.accept());
    await page.goto(process.env.EDITOR_URL || 'http://127.0.0.1:5173/');
    await page.getByRole('combobox', { name: 'Project' }).selectOption(alpha.id);
    await page.getByRole('button', { name: 'Pages', exact: true }).click();
    const manager = page.getByRole('dialog', { name: 'Manage pages' });
    await manager.getByText('Home > About > Team · level 2 · /about/team').waitFor();
    await manager.getByLabel('Search pages').fill('team');
    assert.equal(await manager.locator('.page-tree > li').count(), 3);
    await manager.getByLabel('Search pages').fill('');
    const row = name => manager.locator('.page-tree > li').filter({ has: page.locator('[data-page-select] strong', { hasText: name }) }).first();
    for (const selected of [home, about]) {
      await row(selected.name).locator('[data-page-select]').click();
      await page.waitForFunction(id => document.querySelector('select[aria-label="Page"]')?.value === id, selected.id);
    }
    await row('Team').locator('[data-page-select]').click();
    await page.waitForFunction(id => document.querySelector('select[aria-label="Page"]')?.value === id, team.id);
    assert.equal(await page.getByRole('combobox', { name: 'Page' }).inputValue(), team.id);
    assert.match(await page.locator('.current-page-trail').innerText(), /level 2/);
    prompts.push('Culture', '/about/team/culture');
    await row('Team').getByRole('button', { name: 'Create child' }).click();
    await manager.getByText('Culture', { exact: true }).waitFor();
    const culture = (await send(`/projects/${alpha.id}/pages`)).pages.find(item => item.name === 'Culture');
    assert.equal(culture.parentPageId, team.id);
    assert.equal(await page.getByRole('combobox', { name: 'Page' }).inputValue(), culture.id);
    await row('Team').getByRole('button', { name: 'Rename / path' }).click();
    await row('Team').getByLabel('Name').fill('Our team');
    await row('Team').getByLabel('Sibling slug').fill('our-team');
    await row('Team').getByRole('button', { name: 'Apply changes' }).click();
    await row('Team').locator('form').waitFor({ state: 'detached' });
    await manager.getByText('Our team', { exact: true }).waitFor();
    await row('Our team').getByRole('button', { name: 'Move / order' }).click();
    await row('Our team').getByLabel('Parent').selectOption(home.id);
    await row('Our team').getByLabel(/Position among siblings/).fill('0');
    await row('Our team').getByRole('button', { name: 'Move page' }).click();
    await row('Our team').locator('form').waitFor({ state: 'detached' });
    await row('Our team').getByText('Home > Our team · level 1 · /about/team').waitFor();
    let tree = (await send(`/projects/${alpha.id}/pages`)).pages;
    assert.equal(tree.find(item => item.id === team.id).parentPageId, home.id);
    assert.equal(tree.find(item => item.id === team.id).sortOrder, 0);
    assert.equal(tree.find(item => item.id === culture.id).level, 2);
    await row('Our team').getByRole('button', { name: 'Move / order' }).click();
    await row('Our team').getByLabel(/Position among siblings/).fill('1');
    assert.equal(await row('Our team').getByLabel(/Position among siblings/).inputValue(), '1');
    await row('Our team').getByRole('button', { name: 'Move page' }).click();
    await row('Our team').locator('form').waitFor({ state: 'detached' });
    assert.equal(movePayloads.at(-1)?.index, 1);
    assert.equal(await manager.getByRole('alert').count(), 0, (await manager.getByRole('alert').allInnerTexts()).join('; '));
    await waitForPage(alpha.id, team.id, item => item.sortOrder === 1);
    tree = (await send(`/projects/${alpha.id}/pages`)).pages;
    assert.equal(tree.find(item => item.id === team.id).sortOrder, 1);
    await row('Our team').getByRole('button', { name: 'Rename / path' }).click();
    await row('Our team').getByLabel('URL path').fill('/team');
    await row('Our team').getByText('Route change: /about/team → /team').waitFor();
    await row('Our team').getByRole('button', { name: 'Apply changes' }).click();
    await row('Our team').locator('form').waitFor({ state: 'detached' });
    await row('Our team').getByText('Home > Our team · level 1 · /team').waitFor();
    tree = (await send(`/projects/${alpha.id}/pages`)).pages;
    assert.equal(tree.find(item => item.id === team.id).path, '/team');
    assert.equal(tree.find(item => item.id === culture.id).path, '/about/team/culture');
    await row('Our team').getByRole('button', { name: 'Delete' }).click();
    await row('Our team').getByLabel('Delete policy').selectOption('reparent');
    await row('Our team').getByLabel('Move children under').selectOption(about.id);
    await row('Our team').getByLabel('Type page name to confirm').fill('Our team');
    await row('Our team').getByRole('button', { name: 'Confirm deletion' }).click();
    await row('Our team').waitFor({ state: 'detached' });
    tree = (await send(`/projects/${alpha.id}/pages`)).pages;
    assert.equal(tree.some(item => item.id === team.id), false);
    assert.equal(tree.find(item => item.id === culture.id).parentPageId, about.id);
    await send(`/pages/${about.id}`, json('PATCH', { expectedRevision: tree.find(item => item.id === about.id).revision, name: 'About remote' }));
    await row('About').getByRole('button', { name: 'Rename / path' }).click();
    await row('About').getByLabel('Name').fill('Local rename');
    await row('About').getByRole('button', { name: 'Apply changes' }).click();
    await manager.getByRole('alert').getByText('Conflict:', { exact: false }).waitFor();
    await manager.getByText('About remote', { exact: true }).waitFor();
    await manager.getByRole('button', { name: 'Close pages' }).click();
    prompts.push('/culture');
    await page.getByRole('button', { name: 'Path', exact: true }).click();
    await waitForPage(alpha.id, culture.id, item => item.path === '/culture');
    prompts.push('Extra root', '/extra');
    await page.getByRole('button', { name: 'New page' }).click();
    await page.getByRole('combobox', { name: 'Page' }).locator('option', { hasText: 'Extra root' }).waitFor({ state: 'attached' });
    const extra = (await send(`/projects/${alpha.id}/pages`)).pages.find(item => item.name === 'Extra root');
    assert.equal(extra.parentPageId, null);
    assert.equal(extra.level, 0);
    await page.locator('[data-palette="Heading"]').click();
    assert.equal(await page.locator('[data-save-state]').getAttribute('data-save-state'), 'unsaved');
    await page.getByRole('combobox', { name: 'Project' }).selectOption(beta.id);
    const unsaved = page.getByRole('dialog', { name: 'Unsaved changes' });
    await unsaved.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(await page.getByRole('combobox', { name: 'Project' }).inputValue(), alpha.id);
    await page.getByRole('combobox', { name: 'Project' }).selectOption(beta.id);
    await unsaved.getByRole('button', { name: 'Save and continue' }).click();
    await page.waitForFunction(id => document.querySelector('select[aria-label="Project"]')?.value === id, beta.id);
    assert.equal((await send(`/pages/${extra.id}`)).page.revision > 1, true);
    assert.equal(await page.getByRole('combobox', { name: 'Page' }).locator('option').count(), 1);
    await page.locator('[data-palette="Heading"]').click();
    await page.getByRole('combobox', { name: 'Project' }).selectOption(alpha.id);
    await unsaved.getByRole('button', { name: 'Discard changes' }).click();
    await page.waitForFunction(id => document.querySelector('select[aria-label="Project"]')?.value === id, alpha.id);
    assert.equal((await send(`/pages/${betaHome.id}`)).page.revision, 1);
    await page.setViewportSize({ width: 390, height: 800 });
    await page.getByRole('button', { name: 'Pages', exact: true }).click();
    await page.getByRole('dialog', { name: 'Manage pages' }).getByText('Extra root', { exact: true }).waitFor();
    await page.close();
  } finally {
    await browser.close();
    await pool.query('DELETE FROM projects WHERE id=ANY($1::uuid[])', [ids]);
    await pool.end();
  }
});
