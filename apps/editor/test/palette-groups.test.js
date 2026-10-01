import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { paletteGroups, paletteItems } from '../src/palette.js';
import { deleteEditableSample, openEditableSample } from './editable-sample.js';


async function pageJson(page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download JSON' }).click()]);
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}

test('palette groups disclose independently without changing add or drag behavior', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let projectId;
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    projectId = await openEditableSample(page);
    await page.getByRole('heading', { name: 'Elements' }).waitFor();
    assert.deepEqual(paletteGroups, ['Basic', 'Layout', 'Media', 'Navigation', 'Content', 'Forms']);
    assert.equal(paletteItems.length, 27);
    const disclosure = group => page.locator(`.palette-disclosure[aria-controls="palette-group-${group.toLowerCase()}"]`);
    const basic = disclosure('Basic');
    const layout = disclosure('Layout');
    const heading = page.locator('[data-palette="Heading"]');
    const container = page.locator('[data-palette="Container"]');
    const beforeToggle = await pageJson(page);
    for (const group of paletteGroups) {
      const button = disclosure(group);
      assert.equal(await button.getAttribute('aria-expanded'), 'true');
      const controlled = await button.getAttribute('aria-controls');
      assert.equal(await page.locator(`#${controlled}`).isVisible(), true);
    }
    await basic.click();
    assert.equal(await basic.getAttribute('aria-expanded'), 'false');
    assert.equal(await heading.isVisible(), false);
    assert.equal(await layout.getAttribute('aria-expanded'), 'true');
    await basic.focus();
    await page.keyboard.press('Tab');
    assert.equal(await layout.evaluate(element => element === document.activeElement), true);
    await basic.focus();
    await page.keyboard.press('Space');
    assert.equal(await basic.getAttribute('aria-expanded'), 'true');
    await basic.focus();
    await page.keyboard.press('Enter');
    assert.equal(await basic.getAttribute('aria-expanded'), 'false');
    await basic.click();
    await layout.click();
    assert.equal(await heading.isVisible(), true);
    assert.equal(await container.isVisible(), false);
    assert.equal(await basic.getAttribute('aria-expanded'), 'true');
    await layout.click();
    assert.deepEqual(await pageJson(page), beforeToggle);
    await page.getByRole('button', { name: 'Add Heading' }).click();
    assert.equal(await basic.getAttribute('aria-expanded'), 'true');
    const added = await pageJson(page);
    assert.equal(added.regions.main.some(node => node.type === 'Heading' && node.id.startsWith('node_')), true);
    const main = page.locator('.canvas-area [data-region="main"]');
    await heading.locator('.palette-item-main').dragTo(main, { targetPosition: { x: 25, y: 25 }, steps: 12 });
    await page.waitForTimeout(300);
    await container.locator('.palette-item-main').dragTo(page.locator('.canvas-area [data-node-id="hero"]'), { targetPosition: { x: 25, y: 1 }, steps: 12 });
    const afterDrag = await pageJson(page);
    const inserted = [];
    const visit = node => { if (node.id.startsWith('node_')) inserted.push(node); node.children?.forEach(visit); };
    Object.values(afterDrag.regions).flat().forEach(visit);
    assert.equal(inserted.filter(node => node.type === 'Heading').length, 2);
    assert.equal(inserted.filter(node => node.type === 'Container').length, 1, `${await page.locator('.status-bar').innerText()} :: ${inserted.map(node => node.type).join(', ')}`);
    assert.equal(await basic.getAttribute('aria-expanded'), 'true');
    assert.equal(await layout.getAttribute('aria-expanded'), 'true');
    await page.getByLabel('Search elements').fill('heading');
    assert.equal(await heading.isVisible(), true);
    assert.equal(await container.count(), 0);
    await page.getByLabel('Search elements').fill('');
    await page.setViewportSize({ width: 390, height: 800 });
    const sidebar = page.locator('.left-sidebar');
    assert.equal(await sidebar.evaluate(element => element.getBoundingClientRect().height <= 280), true);
    assert.equal(await page.locator('.left-sidebar .panel-scroll').evaluate(element => element.scrollHeight > element.clientHeight), true);
    assert.equal(await page.locator('.canvas-area').isVisible(), true);
    await page.close();
  } finally { await browser.close(); await deleteEditableSample(projectId); }
});
