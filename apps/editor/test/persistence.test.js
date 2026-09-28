import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { pool } from '../../api/src/db.js';

const editorUrl = process.env.EDITOR_URL || 'http://127.0.0.1:5173/';
const browserPath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lqkAAAAASUVORK5CYII=', 'base64');

async function pageJson(page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download JSON' }).click()]);
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}

test('editor saves nested responsive Page JSON, reopens it, restores a revision, and previews an uploaded asset', async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const projectName = `Browser persistence ${crypto.randomUUID()}`;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept(dialog.message().includes('Project') ? projectName : dialog.message().includes('copy') ? 'Conflict copy' : 'Nested saved page'));
    await page.goto(editorUrl);
    await page.getByRole('heading', { name: 'Make room for remarkable.' }).waitFor();
    await page.getByRole('button', { name: 'New project' }).click();
    await page.locator('select[aria-label="Page"] option', { hasText: 'Nested saved page' }).waitFor({ state: 'attached' });
    assert.equal(await page.locator('[data-save-state]').getAttribute('data-save-state'), 'saved');

    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await page.locator('[data-layer-region="main"] > button:first-child').click();
    await page.getByRole('button', { name: 'Elements', exact: true }).click();
    await page.locator('[data-palette="Container"]').click();
    await page.locator('[data-palette="Container"]').click();
    const rootContainer = (await pageJson(page)).regions.main[0];
    const nested = rootContainer.children[0];
    await page.getByRole('tab', { name: 'layout' }).click();
    await page.locator('.properties [data-style-field="display"] select').selectOption('grid');
    await page.locator('.properties [data-style-field="gridTemplateColumns"] input').fill('1fr 1fr');
    await page.getByRole('button', { name: 'mobile', exact: true }).click();
    await page.locator('.properties [data-style-field="gridTemplateColumns"] input').fill('1fr');
    await page.locator('[data-palette="Heading"]').click();
    await page.getByLabel('Heading text').fill('Saved nested heading');

    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await page.locator(`[data-layer-id="${nested.id}"] .layer-select`).click();
    await page.getByRole('button', { name: 'Elements', exact: true }).click();
    await page.locator('[data-palette="Image"]').click();
    await page.getByLabel('Upload image').setInputFiles({ name: 'persist.png', mimeType: 'image/png', buffer: png });
    await page.getByRole('status').getByText(/uploaded; save the page/).waitFor();
    const edited = await pageJson(page);
    const savedNested = edited.regions.main[0].children[0];
    assert.equal(savedNested.styles.desktop.gridTemplateColumns, '1fr 1fr');
    assert.equal(savedNested.styles.mobile.gridTemplateColumns, '1fr');
    const image = savedNested.children.find(node => node.type === 'Image');
    assert.match(image.props.src, /^\/api\/assets\/[0-9a-f-]+\/content$/);
    assert.equal(await page.locator('[data-save-state]').getAttribute('data-save-state'), 'unsaved');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Saved · v2').waitFor();

    await page.reload();
    await page.getByText('Saved · v2').waitFor();
    assert.deepEqual(await pageJson(page), edited);
    const assetImage = page.locator(`.canvas-area [data-node-id="${image.id}"]`);
    await assetImage.evaluate(element => element.decode());
    assert.ok(await assetImage.evaluate(element => element.naturalWidth > 0));

    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await page.locator(`[data-layer-id="${rootContainer.id}"] .layer-toggle`).click();
    await page.locator(`[data-layer-id="${nested.id}"] .layer-toggle`).click();
    const heading = savedNested.children.find(node => node.type === 'Heading');
    await page.locator(`[data-layer-id="${heading.id}"] .layer-select`).click();
    await page.getByLabel('Heading text').fill('Later edit');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Saved · v3').waitFor();
    await page.getByRole('button', { name: 'Revisions' }).click();
    await page.getByLabel('Revision to restore').selectOption('2');
    await page.getByRole('button', { name: 'Restore revision' }).click();
    await page.getByText('Saved · v4').waitFor();
    assert.deepEqual(await pageJson(page), edited);
    await page.getByRole('button', { name: 'Preview page' }).click();
    const previewImage = page.locator(`.preview-stage [data-node-id="${image.id}"]`);
    await previewImage.evaluate(element => element.decode());
    assert.ok(await previewImage.evaluate(element => element.naturalWidth > 0));
    assert.equal(await previewImage.getAttribute('src'), image.props.src);
    await page.getByRole('button', { name: 'Back to editor' }).click();
    await page.locator(`.canvas-area [data-node-id="${heading.id}"]`).click();
    await page.getByLabel('Heading text').fill('Local conflict edit');
    const pageId = await page.getByRole('combobox', { name: 'Page' }).inputValue();
    const external = await fetch(`http://127.0.0.1:3001/api/pages/${pageId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: 4, document: edited }) });
    assert.equal(external.status, 200);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('status').getByText(/Version conflict/).waitFor();
    assert.equal(await page.locator('[data-save-state]').getAttribute('data-save-state'), 'unsaved');
    await page.getByRole('button', { name: 'Save as copy' }).click();
    await page.getByText('Saved · v1').waitFor();
    assert.equal((await pageJson(page)).regions.main[0].children[0].children.find(node => node.id === heading.id).props.text, 'Local conflict edit');
    await page.locator(`.canvas-area [data-node-id="${heading.id}"]`).click();
    await page.getByLabel('Heading text').fill('After network retry');
    await page.route('**/api/pages/*', route => route.request().method() === 'PUT' ? route.abort() : route.continue());
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('status').getByText(/Save failed: Network error/).waitFor();
    assert.equal(await page.locator('[data-save-state]').getAttribute('data-save-state'), 'unsaved');
    await page.unroute('**/api/pages/*');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Saved · v2').waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await pool.query('DELETE FROM projects WHERE name=$1', [projectName]);
    await pool.end();
  }
});
