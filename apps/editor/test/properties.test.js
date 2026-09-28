import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { exportHtml, exportReact, exportVue } from '@builder/exporters';

const editorUrl = process.env.EDITOR_URL || 'http://127.0.0.1:5173/';
const browserPath = process.env.CHROME_PATH || '/usr/bin/google-chrome';

async function pageJson(page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download JSON' }).click()]);
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}

test('Properties tabs edit breakpoint styles, scoped CSS, and content without covering canvas', async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(editorUrl);
    await page.getByRole('heading', { name: 'Make room for remarkable.' }).waitFor();
    const canvasBox = await page.locator('.canvas-area').boundingBox();
    const propertiesBox = await page.locator('.properties').boundingBox();
    assert.ok(propertiesBox.x >= canvasBox.x + canvasBox.width - 1);
    assert.match(await page.locator('.empty-selection').innerText(), /Nothing selected/);

    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await page.getByRole('button', { name: 'Expand Hero', exact: true }).click();
    await page.locator('[data-layer-id="hero_inner"] .layer-select').click();
    await page.getByRole('tab', { name: 'layout' }).click();
    const columns = page.locator('.properties [data-style-field="gridTemplateColumns"] input');
    await columns.fill('1fr 1fr');
    await page.getByRole('button', { name: 'mobile', exact: true }).click();
    assert.equal(await columns.inputValue(), '');
    await columns.fill('1fr');
    const mobileColumns = await page.locator('[data-node-id="hero_inner"]').evaluate(element => getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length);
    assert.equal(mobileColumns, 1);
    await page.getByRole('button', { name: 'desktop', exact: true }).click();
    const desktopColumns = await page.locator('[data-node-id="hero_inner"]').evaluate(element => getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length);
    assert.equal(desktopColumns, 2);
    await page.getByRole('button', { name: 'tablet', exact: true }).click();
    assert.equal(await columns.inputValue(), '');
    await page.getByRole('button', { name: 'mobile', exact: true }).click();

    await page.getByRole('button', { name: 'Expand Hero content' }).click();
    await page.locator('[data-layer-id="hero_copy"] .layer-select').click();
    await page.getByRole('tab', { name: 'style' }).click();
    await page.locator('.properties [data-style-field="backgroundColor"] input').fill('#ffeedd');
    await page.locator('[data-advanced-css]').fill('letter-spacing: .08em; border-radius: 12px;');
    await page.getByRole('button', { name: 'Apply declarations' }).click();
    const copyColor = await page.locator('[data-node-id="hero_copy"]').evaluate(element => getComputedStyle(element).backgroundColor);
    const siblingColor = await page.locator('[data-node-id="hero_art"]').evaluate(element => getComputedStyle(element).backgroundColor);
    assert.equal(copyColor, 'rgb(255, 238, 221)');
    assert.equal(siblingColor, 'rgb(223, 231, 255)');

    const beforeInvalidCss = await pageJson(page);
    await page.locator('[data-advanced-css]').fill('body { color: red; }');
    await page.getByRole('button', { name: 'Apply declarations' }).click();
    assert.match(await page.getByRole('alert').innerText(), /declarations only/);
    assert.deepEqual(await pageJson(page), beforeInvalidCss);

    await page.getByRole('button', { name: 'Expand Introduction' }).click();
    await page.locator('[data-layer-id="hero_title"] .layer-select').click();
    await page.getByRole('tab', { name: 'content' }).click();
    await page.getByLabel('Heading text').fill('Edited heading');
    await page.getByLabel('Heading level').selectOption('2');
    await page.locator('[data-layer-id="hero_action"] .layer-select').click();
    await page.getByLabel('Button label').fill('Explore edited work');
    await page.getByLabel('Link destination').fill('#edited');

    await page.getByRole('button', { name: 'Elements', exact: true }).click();
    await page.locator('[data-palette="Image"]').click();
    await page.getByLabel('Image source').fill('/assets/edited.png');
    await page.getByLabel('Alternative text').fill('Edited illustration');
    const edited = await pageJson(page);
    const heroInner = edited.regions.main[0].children[0];
    const heroCopy = heroInner.children[0];
    assert.deepEqual(heroInner.styles.mobile, { gridTemplateColumns: '1fr' });
    assert.deepEqual(heroInner.styles.tablet, {});
    assert.equal(heroCopy.styles.mobile.backgroundColor, '#ffeedd');
    assert.equal(heroCopy.advancedCss.mobile, 'letter-spacing:.08em;border-radius:12px');
    assert.equal(heroInner.children[1].styles.mobile.backgroundColor, undefined);
    assert.equal(heroCopy.children.find(node => node.id === 'hero_title').props.text, 'Edited heading');
    const image = heroCopy.children.at(-1);
    assert.equal(image.type, 'Image');
    assert.equal(image.props.alt, 'Edited illustration');

    const html = exportHtml(edited);
    const react = exportReact(edited);
    const vue = exportVue(edited);
    for (const output of [html['index.html'], react['src/App.jsx'], vue['src/main.js']]) {
      assert.match(output, /Edited heading/);
      assert.match(output, /Explore edited work/);
      assert.match(output, /Edited illustration/);
      assert.match(output, /assets\/edited\.png/);
    }
    for (const css of [html['styles.css'], react['src/styles.css'], vue['src/styles.css']]) {
      assert.match(css, /@media \(max-width: 600px\)\{[^]*\.n-hero_inner\{grid-template-columns:1fr\}/);
      assert.match(css, /\.n-hero_copy\{background-color:#ffeedd;letter-spacing:\.08em;border-radius:12px\}/);
    }
    assert.deepEqual(pageErrors, []);
  } finally { await browser.close(); }
});
