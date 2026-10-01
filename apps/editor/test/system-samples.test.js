import assert from 'node:assert/strict';
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
    assert.equal(await systemRow.getByRole('button', { name: 'Delete' }).isDisabled(), true);
  } finally { await browser.close(); }
});
