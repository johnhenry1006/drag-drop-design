import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from 'playwright-core';

const editorUrl = process.env.EDITOR_URL || 'http://127.0.0.1:5173/';
const browserPath = process.env.CHROME_PATH || '/usr/bin/google-chrome';

async function pageJson(page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download JSON' }).click()
  ]);
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}

async function selectRegion(page, region) {
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.locator(`[data-layer-region="${region}"] button`).click();
  await page.getByRole('button', { name: 'Elements', exact: true }).click();
}

async function clickAdd(page, key) {
  await page.locator(`[data-palette="${key}"]`).click();
}

test('editor flow keeps flexible regions and nested content in Page JSON', async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(editorUrl);
    await page.getByRole('heading', { name: 'Make room for remarkable.' }).waitFor();

    await selectRegion(page, 'header');
    await clickAdd(page, 'Navigation');
    let document = await pageJson(page);
    const navigation = document.regions.header.at(-1);
    assert.equal(navigation.type, 'Navigation');

    await selectRegion(page, 'header');
    await clickAdd(page, 'Container');
    document = await pageJson(page);
    const headerContainer = document.regions.header.at(-1);
    assert.equal(headerContainer.type, 'Container');
    assert.equal(document.regions.header.at(-2).id, navigation.id);

    const announcement = page.locator('[data-node-id="announcement"]');
    const announcementBox = await announcement.boundingBox();
    const textPaletteBox = await page.locator('[data-palette="Text"]').boundingBox();
    await page.mouse.move(textPaletteBox.x + textPaletteBox.width / 2, textPaletteBox.y + textPaletteBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(announcementBox.x + 40, announcementBox.y + announcementBox.height - 2, { steps: 12 });
    await page.waitForFunction(() => document.querySelector('[data-node-id="announcement"]')?.dataset.drop === 'after');
    await page.mouse.up();
    document = await pageJson(page);
    assert.equal(document.regions.header[2].type, 'Text', await page.locator('.status-bar').innerText());
    assert.equal(document.regions.header[2].props.text, 'Text');

    await selectRegion(page, 'main');
    await clickAdd(page, 'Heading');
    document = await pageJson(page);
    const heading = document.regions.main.at(-1);
    assert.equal(heading.type, 'Heading');

    await clickAdd(page, 'Container');
    document = await pageJson(page);
    const outer = document.regions.main.at(-1);
    assert.equal(outer.type, 'Container');
    await clickAdd(page, 'Container');
    document = await pageJson(page);
    const inner = document.regions.main.at(-1).children[0];
    assert.equal(inner.type, 'Container');

    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    const headingHandle = page.getByRole('button', { name: 'Drag Heading' });
    const innerRow = page.locator(`[data-layer-id="${inner.id}"]`);
    await headingHandle.scrollIntoViewIfNeeded();
    await innerRow.scrollIntoViewIfNeeded();
    const rowBox = await innerRow.boundingBox();
    await headingHandle.dragTo(innerRow, { targetPosition: { x: Math.min(90, rowBox.width / 2), y: rowBox.height / 2 } });
    document = await pageJson(page);
    assert.equal(document.regions.main.at(-1).children[0].children[0]?.id, heading.id, `${await page.locator('.status-bar').innerText()} :: ${JSON.stringify(document.regions.main.slice(-2))}`);
    assert.equal(document.regions.main.some(node => node.id === heading.id), false);
    await page.waitForTimeout(300);

    const beforeInvalidMove = structuredClone(document);
    const leafRow = page.locator('[data-layer-id="work_label"]');
    await leafRow.scrollIntoViewIfNeeded();
    const leafBox = await leafRow.boundingBox();
    await page.locator(`[data-layer-id="${heading.id}"] .layer-handle`).first().dragTo(leafRow, { targetPosition: { x: Math.min(90, leafBox.width / 2), y: leafBox.height / 2 } });
    assert.match(await page.locator('.status-bar').innerText(), /cannot contain children/);
    assert.deepEqual(await pageJson(page), beforeInvalidMove);

    await selectRegion(page, 'footer');
    await clickAdd(page, 'Columns3');
    document = await pageJson(page);
    const footerLayout = document.regions.footer.at(-1);
    assert.equal(footerLayout.type, 'Layout');
    assert.equal(footerLayout.children.length, 3);

    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await page.getByRole('button', { name: 'Expand Three columns' }).click();
    await page.locator(`[data-layer-id="${footerLayout.children[0].id}"] .layer-select`).click();
    await page.getByRole('button', { name: 'Elements', exact: true }).click();
    await clickAdd(page, 'Link');
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await page.locator(`[data-layer-id="${footerLayout.children[1].id}"] .layer-select`).click();
    await page.getByRole('button', { name: 'Elements', exact: true }).click();
    await clickAdd(page, 'Link');
    document = await pageJson(page);
    const links = document.regions.footer.at(-1).children.slice(0, 2).map(column => column.children[0]);
    assert.deepEqual(links.map(node => node.type), ['Link', 'Link']);

    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await page.locator(`[data-layer-id="${links[0].id}"] .layer-select`).click();
    await assert.doesNotReject(() => page.locator('.breadcrumbs').getByRole('button', { name: 'Column 1' }).waitFor());
    assert.match(await page.locator('.selection-label').innerText(), /Link/);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
  }
});
