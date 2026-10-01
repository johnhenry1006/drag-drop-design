import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { deleteEditableSample, openEditableSample } from './editable-sample.js';

const browserPath = process.env.CHROME_PATH || '/usr/bin/google-chrome';

async function pageJson(page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download JSON' }).click()]);
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}

async function selectRegion(page, region) {
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.locator(`[data-layer-region="${region}"] > button:first-child`).click();
  await page.getByRole('button', { name: 'Elements', exact: true }).click();
}

async function snapshot(page, ids) {
  return page.locator('.page').evaluate((root, ids) => {
    const style = id => getComputedStyle(root.querySelector(`[data-node-id="${id}"]`));
    const banner = style(ids.banner);
    return {
      width: root.getBoundingClientRect().width,
      header: root.querySelector('header').textContent,
      main: root.querySelector('main').textContent,
      footer: root.querySelector('footer').textContent,
      bannerPadding: banner.padding,
      bannerBackground: banner.backgroundColor,
      headingMargin: style(ids.headerHeading).margin,
      mainLineHeight: style(ids.mainText).lineHeight
    };
  }, ids);
}

test('Preview matches free composition and restructured suggestion at desktop and mobile widths', async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let projectId;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    projectId = await openEditableSample(page);

    await selectRegion(page, 'header');
    await page.locator('[data-palette="Heading"]').click();
    await page.getByLabel('Heading text').fill('Independent header');
    await selectRegion(page, 'header');
    await page.locator('[data-palette="Link"]').click();
    await page.getByLabel('Link label').fill('Header link');

    await selectRegion(page, 'main');
    await page.locator('[data-palette="Text"]').click();
    await page.locator('.properties .property-body textarea').fill('Unassisted main content');
    await selectRegion(page, 'footer');
    await page.locator('[data-palette="Text"]').click();
    await page.locator('.properties .property-body textarea').fill('Independent footer');

    await page.locator('.suggestion-regions button', { hasText: 'header' }).click();
    await page.getByRole('button', { name: /Banner Heading, text, and action/ }).click();
    await page.getByRole('tab', { name: 'layout' }).click();
    await page.locator('.properties [data-style-field="paddingTop"] input').fill('30px');
    await page.getByRole('tab', { name: 'content' }).click();
    await page.getByRole('button', { name: '↑ Move up' }).click();
    await page.locator('.canvas-area .page a', { hasText: 'Get started' }).click();
    await page.getByRole('button', { name: 'Remove selected node' }).click();

    const before = await pageJson(page);
    const headerHeading = before.regions.header.find(node => node.props.text === 'Independent header');
    const banner = before.regions.header.find(node => node.props.label === 'Banner');
    const mainText = before.regions.main.find(node => node.props.text === 'Unassisted main content');
    assert.deepEqual(before.regions.header.slice(-3).map(node => node.type), ['Heading', 'Section', 'Link']);
    assert.equal(before.regions.main.at(-1).type, 'Text');
    assert.equal(before.regions.footer.at(-1).props.text, 'Independent footer');
    assert.equal(banner.children.some(node => node.type === 'Button'), false);
    const ids = { headerHeading: headerHeading.id, banner: banner.id, mainText: mainText.id };

    const desktopCanvas = await snapshot(page, ids);
    await page.getByRole('button', { name: 'Preview page' }).click();
    assert.equal(await page.locator('.left-sidebar, .properties, .canvas-area').count(), 0);
    assert.equal(await page.locator('.page [data-selected], .page [data-drop], .page [data-drop-invalid], .page [data-empty]').count(), 0);
    assert.deepEqual(await snapshot(page, ids), desktopCanvas);

    await page.getByRole('button', { name: 'tablet', exact: true }).click();
    assert.equal(await page.locator('.page').getAttribute('data-breakpoint'), 'tablet');
    assert.equal((await snapshot(page, ids)).width, 768);
    await page.getByRole('button', { name: 'mobile', exact: true }).click();
    const mobilePreview = await snapshot(page, ids);
    assert.equal(mobilePreview.width, 390);
    await page.getByRole('button', { name: 'Back to editor' }).click();
    assert.deepEqual(await snapshot(page, ids), mobilePreview);
    assert.deepEqual(await pageJson(page), before);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await deleteEditableSample(projectId); }
});

test('region suggestion shortcut inserts Gallery images that render from Page JSON in Preview', async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let projectId;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    projectId = await openEditableSample(page);
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await page.getByRole('button', { name: 'Suggest layout for main' }).click();
    assert.equal((await page.locator('.suggestion-regions button.active').innerText()).toLowerCase(), 'main');
    await page.getByRole('button', { name: /Gallery Three image cards/ }).click();
    const document = await pageJson(page);
    const gallery = document.regions.main.at(-1);
    assert.equal(gallery.props.label, 'Gallery');
    const image = gallery.children[0].children[0];
    assert.match(image.props.src, /^data:image\/svg\+xml,/);
    const canvasImage = page.locator(`.canvas-area [data-node-id="${image.id}"]`);
    await canvasImage.evaluate(element => element.decode());
    assert.ok(await canvasImage.evaluate(element => element.naturalWidth > 0));
    const src = await canvasImage.getAttribute('src');
    await page.getByRole('button', { name: 'Preview page' }).click();
    const previewImage = page.locator(`.preview-stage [data-node-id="${image.id}"]`);
    await previewImage.evaluate(element => element.decode());
    assert.equal(await previewImage.getAttribute('src'), src);
    assert.ok(await previewImage.evaluate(element => element.naturalWidth > 0));
  } finally { await browser.close(); await deleteEditableSample(projectId); }
});
