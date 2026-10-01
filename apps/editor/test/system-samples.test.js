import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { chromium } from 'playwright-core';

const editorUrl = process.env.EDITOR_URL || 'http://127.0.0.1:5173/';
const browserPath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const systemProjectId = '00000000-0000-4000-8000-000000000001';
const showcasePageId = '00000000-0000-4000-8000-000000000003';

test('system reference pages are viewable without editor or manager mutation controls', async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    await page.goto(editorUrl);
    const project = page.getByRole('combobox', { name: 'Project' });
    await project.locator(`option[value="${systemProjectId}"]`).waitFor({ state: 'attached' });
    await project.selectOption(systemProjectId);
    const pageSelect = page.getByRole('combobox', { name: 'Page' });
    await pageSelect.locator(`option[value="${showcasePageId}"]`).waitFor({ state: 'attached' });
    await pageSelect.selectOption(showcasePageId);
    await page.getByText('System template · view only').waitFor();
    assert.equal(await page.getByRole('button', { name: 'New page' }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Path', exact: true }).isDisabled(), true);
    await page.getByRole('img', { name: /Abstract Northstar visual/ }).waitFor();
    await page.getByRole('button', { name: 'Pages', exact: true }).click();
    const manager = page.getByRole('dialog', { name: 'Manage pages' });
    await manager.getByText('System reference templates are read only.').waitFor();
    assert.equal(await manager.getByRole('button', { name: 'Delete', exact: true }).count(), 0);
    assert.equal(await manager.getByRole('button', { name: 'Create root page' }).count(), 0);
    await manager.getByRole('button', { name: 'Close pages' }).click();
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    const projects = page.getByRole('dialog', { name: 'Manage projects' });
    const systemRow = projects.locator('li').filter({ hasText: 'Sample project' });
    assert.equal(await systemRow.getByRole('button', { name: 'Delete' }).count(), 0);
  } finally { await browser.close(); }
});

test('Use this template opens an editable copy while the canonical sample remains protected', async () => {
  const api = process.env.API_URL || 'http://127.0.0.1:3001/api';
  const projectResponse = await fetch(`${api}/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `Template browser ${randomUUID()}` }) });
  const project = (await projectResponse.json()).project;
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    await page.goto(editorUrl);
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    const samples = page.getByRole('region', { name: 'Sample templates' });
    await samples.getByText('System reference templates are read only.').waitFor();
    const row = samples.locator('li').filter({ hasText: 'Responsive showcase' });
    await row.getByRole('button', { name: 'Preview / View' }).click();
    await page.getByText('System template · view only').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
    await page.keyboard.press('Control+z');
    assert.equal(await page.getByText('System template · view only').count(), 1);
    await page.getByRole('button', { name: 'Pages', exact: true }).click();
    await page.getByRole('dialog', { name: 'Manage pages' }).getByRole('button', { name: 'Use this template' }).last().click();
    const dialog = page.getByRole('dialog', { name: 'Use sample template' });
    await dialog.getByLabel('Destination project').selectOption(project.id);
    await dialog.getByLabel('Page name').fill('Editable showcase');
    await dialog.getByLabel('Page path').fill('/editable-showcase');
    await dialog.getByRole('button', { name: 'Create editable copy' }).click();
    await page.locator('.canvas-area').waitFor();
    assert.equal(await page.getByRole('combobox', { name: 'Project' }).inputValue(), project.id);
    const copyId = await page.getByRole('combobox', { name: 'Page' }).inputValue();
    assert.notEqual(copyId, showcasePageId);
    await page.locator('.canvas-area').getByRole('heading', { name: 'Build across every screen.' }).click();
    await page.getByLabel('Heading text').fill('My editable showcase');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Saved · v2').waitFor();
    await page.reload();
    await page.locator('.canvas-area').getByRole('heading', { name: 'My editable showcase' }).waitFor();
    await page.getByRole('button', { name: 'mobile', exact: true }).click();
    await page.getByRole('button', { name: 'Preview page' }).click();
    await page.getByRole('img', { name: /Abstract Northstar visual/ }).waitFor();
    assert.equal(await page.locator('.preview-stage').getAttribute('data-preview-breakpoint'), 'mobile');
    await page.getByRole('button', { name: 'Back to editor' }).click();
    const copy = (await (await fetch(`${api}/pages/${copyId}`)).json()).page;
    assert.equal(copy.sampleKey, null);
    assert.equal(copy.path, '/editable-showcase');
    assert.equal((await fetch(`${api}/pages/${showcasePageId}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: 1, mode: 'subtree', confirmedPageIds: [showcasePageId] }) })).status, 409);
  } finally {
    await browser.close();
    const current = (await (await fetch(`${api}/projects/${project.id}`)).json()).project;
    await fetch(`${api}/projects/${project.id}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: current.name, expectedVersion: current.version, expectedCounts: { pageCount: current.pageCount, revisionCount: current.revisionCount, assetCount: current.assetCount } }) });
  }
});
