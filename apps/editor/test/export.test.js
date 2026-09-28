import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { unzipSync } from 'fflate';
import { chromium } from 'playwright-core';
import { samplePage, updateNode } from '@builder/document';
import { pool } from '../../api/src/db.js';

const editorUrl = process.env.EDITOR_URL || 'http://127.0.0.1:5173/';
const browserPath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const apiUrl = 'http://127.0.0.1:3001/api';
const request = async (path, method = 'GET', payload) => {
  const response = await fetch(`${apiUrl}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  return { status: response.status, body: await response.json() };
};

test('Export dialog lists unsupported CSS before download and downloads each target with saved paths', async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let projectId;
  try {
    projectId = (await request('/projects', 'POST', { name: `Export browser ${crypto.randomUUID()}` })).body.project.id;
    let home = updateNode(structuredClone(samplePage), 'nav_about', { props: { href: '/about' } });
    const bad = updateNode(home, 'hero', { styles: { mobile: { filter: 'blur(2px)' } } });
    const homePage = (await request(`/projects/${projectId}/pages`, 'POST', { name: 'Home', path: '/', document: bad })).body.page;
    const about = structuredClone(samplePage); about.props.title = 'About page';
    await request(`/projects/${projectId}/pages`, 'POST', { name: 'About', path: '/about', document: about });

    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(editorUrl);
    await page.getByRole('heading', { name: 'Make room for remarkable.' }).waitFor();
    await page.getByRole('combobox', { name: 'Project' }).selectOption(projectId);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Export project' });
    await dialog.getByText(/hero · mobile.filter: html cannot export filter/).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Download ZIP' }).isDisabled(), true);
    await dialog.getByRole('button', { name: 'Close export' }).click();

    assert.equal((await request(`/pages/${homePage.id}`, 'PUT', { expectedRevision: 1, document: home })).status, 200);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    for (const target of ['html', 'react', 'vue']) {
      await dialog.getByRole('combobox', { name: 'Export target' }).selectOption(target);
      await dialog.getByText('Ready to export 2 page(s).').waitFor();
      const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Download ZIP' }).click()]);
      assert.match(download.suggestedFilename(), new RegExp(`${target}\\.zip$`));
      const files = unzipSync(new Uint8Array(await readFile(await download.path())));
      assert.ok(files[target === 'html' ? 'about/index.html' : target === 'react' ? 'src/pages.jsx' : 'src/pages.js']);
    }
  } finally {
    await browser.close();
    if (projectId) await pool.query('DELETE FROM projects WHERE id=$1', [projectId]);
    await pool.end();
  }
});
