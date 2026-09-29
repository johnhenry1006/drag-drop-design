import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { createUser } from '../../api/src/auth.js';
import { pool } from '../../api/src/db.js';
import { migrate } from '../../api/src/store.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lqkAAAAASUVORK5CYII=', 'base64');
const base = process.env.EDITOR_URL || 'http://127.0.0.1:5173';
async function documentFrom(page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download JSON' }).click()]);
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}
async function selectRegion(page, region) {
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.locator(`[data-layer-region="${region}"] > button:first-child`).click();
  await page.getByRole('button', { name: 'Elements', exact: true }).click();
}
async function ready(url) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(url)).ok) return; } catch { /* server is starting */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Export server did not start: ${url}`);
}

test('authenticated S3-backed page flow builds HTML, React, and Vue exports', { skip: process.env.AUTH_SMOKE !== '1', timeout: 120000 }, async () => {
  await migrate();
  const email = `smoke${Date.now()}@example.test`;
  const password = 'smoke password for local verification';
  const user = await createUser(email, password);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let projectId;
  let output;
  const servers = [];
  try {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(base);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'New project' }).waitFor();
    const answers = ['Smoke project', 'Smoke page', '/'];
    page.on('dialog', dialog => dialog.accept(answers.shift()));
    await page.getByRole('button', { name: 'New project' }).click();
    await page.locator('[data-save-state="saved"]').waitFor();
    await page.waitForFunction(() => Boolean(document.querySelector('select[aria-label="Project"]')?.value));
    projectId = await page.getByRole('combobox', { name: 'Project' }).inputValue();
    const start = await documentFrom(page);
    assert.deepEqual(start.regions, { header: [], main: [], footer: [] });
    await selectRegion(page, 'header');
    await page.locator('[data-palette="Navigation"]').click();
    await page.locator('[data-palette="Link"]').click();
    await page.getByLabel('Link label').fill('Home');
    await selectRegion(page, 'main');
    await page.locator('[data-palette="Container"]').click();
    await page.locator('[data-palette="Container"]').click();
    await page.locator('[data-palette="Image"]').click();
    await page.getByLabel('Upload image').setInputFiles({ name: 'smoke.png', mimeType: 'image/png', buffer: png });
    await page.waitForFunction(() => document.querySelector('.status-bar')?.textContent.includes('uploaded; save the page'));
    const uploaded = await documentFrom(page);
    const assetUrl = uploaded.regions.main[0].children[0].children[0].props.src;
    assert.match(assetUrl, /^\/api\/assets\//);
    for (const region of ['header', 'footer']) {
      await selectRegion(page, region);
      await page.locator('[data-palette="Image"]').click();
      await page.getByLabel('Image source').fill(assetUrl);
    }
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('[data-save-state="saved"]').waitFor();
    const saved = await documentFrom(page);
    assert.equal(saved.regions.main[0].children[0].children[0].type, 'Image');
    assert.equal(saved.regions.header.find(node => node.type === 'Image').props.src, assetUrl);
    assert.equal(saved.regions.footer.find(node => node.type === 'Image').props.src, assetUrl);
    const savedRevision = Number((await page.locator('.save-indicator').innerText()).match(/v(\d+)/)[1]);
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    assert.deepEqual(await documentFrom(page), saved);
    await page.locator('.page footer img').click();
    await page.getByLabel('Alternative text').fill('Temporary revision');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('[data-save-state="saved"]').waitFor();
    await page.getByRole('button', { name: 'Revisions' }).click();
    await page.getByRole('combobox', { name: 'Revision to restore' }).selectOption(String(savedRevision));
    await page.getByRole('button', { name: 'Restore revision' }).click();
    assert.deepEqual(await documentFrom(page), saved);
    await page.getByRole('button', { name: 'Preview page' }).click();
    for (const region of ['header', 'main', 'footer']) {
      await page.locator(`.preview-stage ${region} img`).evaluate(image => image.decode());
      assert.equal(await page.locator(`.preview-stage ${region} img`).evaluate(image => image.naturalWidth), 1);
    }
    await page.getByRole('button', { name: 'Back to editor' }).click();
    if (process.env.S3_RESTART === '1') {
      execFileSync('docker', ['compose', 'restart', 's3-ninja']);
      let restored = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        try { const response = await context.request.get(`${base}${assetUrl}`); if (response.ok() && Buffer.from(await response.body()).equals(png)) { restored = true; break; } }
        catch { /* emulator is starting */ }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      assert.equal(restored, true, 'Uploaded bytes survive the S3 Ninja restart');
    }
    output = await mkdtemp(join(tmpdir(), 'builder-auth-smoke-'));
    for (const [index, target] of ['html', 'react', 'vue'].entries()) {
      const response = await context.request.get(`${base}/api/projects/${projectId}/exports/${target}.zip`);
      assert.equal(response.status(), 200, target);
      const zip = join(output, `${target}.zip`);
      const directory = join(output, target);
      await writeFile(zip, await response.body());
      execFileSync('mkdir', ['-p', directory]);
      execFileSync('unzip', ['-q', zip, '-d', directory]);
      if (target !== 'html') execFileSync('npm', ['install', '--offline'], { cwd: directory });
      execFileSync('npm', ['run', 'build'], { cwd: directory });
      assert.deepEqual(await readFile(join(directory, target === 'html' ? `assets/${assetUrl.split('/')[3]}.png` : `public/assets/${assetUrl.split('/')[3]}.png`)), png);
      assert.deepEqual(await readFile(join(directory, `dist/assets/${assetUrl.split('/')[3]}.png`)), png);
      const port = 4173 + index;
      const child = target === 'html'
        ? spawn(process.execPath, ['server.js', 'dist'], { cwd: directory, stdio: 'ignore' })
        : spawn(join(directory, 'node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', String(port)], { cwd: directory, stdio: 'ignore' });
      servers.push(child);
      await ready(`http://127.0.0.1:${port}/`);
      const exported = await browser.newContext();
      await exported.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith('/api/') || ['3001', '5173', '9444', '19444'].includes(url.port) || url.hostname === 's3-ninja') return route.abort();
        return route.continue();
      });
      const rendered = await exported.newPage();
      await rendered.goto(`http://127.0.0.1:${port}/`);
      for (const region of ['header', 'main', 'footer']) {
        await rendered.locator(`${region} img`).evaluate(image => image.decode());
        assert.equal(await rendered.locator(`${region} img`).evaluate(image => image.naturalWidth), 1, `${target} ${region}`);
      }
      await exported.close();
      child.kill();
    }
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('heading', { name: 'Sign in to Builder' }).waitFor();
  } finally {
    for (const server of servers) server.kill();
    await browser.close();
    if (output) await rm(output, { recursive: true, force: true });
    await pool.query('DELETE FROM projects WHERE owner_id=$1', [user.id]);
    await pool.query('DELETE FROM users WHERE id=$1', [user.id]);
    await pool.end();
  }
});
