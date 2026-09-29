import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { addNode, samplePage, updateNode } from '@builder/document';
import { pool } from '../apps/api/src/db.js';

const apiRoot = 'http://127.0.0.1:3001/api';
const editorUrl = process.env.EDITOR_URL || 'http://127.0.0.1:5173/';
const output = resolve('generated/verification', Date.now().toString(36));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lqkAAAAASUVORK5CYII=', 'base64');
const servers = [];
let projectId;
let browser;

async function request(path, options = {}) {
  const response = await fetch(`${apiRoot}${path}`, options);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
  return response;
}
const json = (method, value) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
const run = (command, args, cwd) => {
  const text = execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  console.log(`${command} ${args.join(' ')} (${cwd}): ${text.trim().split('\n').at(-1)}`);
};
async function ready(url) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(url)).ok) return; } catch { /* retry until ready */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not start: ${url}`);
}
function serve(directory, command, args, url) {
  const child = spawn(command, args, { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
  servers.push(child);
  return ready(url);
}
async function snapshot(page, exported) {
  return page.evaluate(exported => {
    const root = exported ? document.querySelector('[class^="p-"]') : document.querySelector('.preview-stage .page');
    const region = name => root.querySelector(name).textContent.replace(/\s+/g, ' ').trim();
    const node = id => root.querySelector(exported ? `.n-${id}` : `[data-node-id="${id}"]`);
    const style = id => getComputedStyle(node(id));
    return {
      header: region('header'), main: region('main'), footer: region('footer'),
      headerPadding: style('header_shell').padding,
      bannerPadding: style('announcement').padding,
      heroGap: style('hero_inner').gap,
      heroColumns: style('hero_inner').gridTemplateColumns.split(/\s+/).length,
      footerGap: style('footer_grid').gap,
      footerColumns: style('footer_grid').gridTemplateColumns.split(/\s+/).length,
      imageLoaded: node('export_logo').naturalWidth > 0
    };
  }, exported);
}

try {
  await mkdir(output, { recursive: true });
  const project = (await (await request('/projects', json('POST', { name: `Visual verification ${Date.now()}` }))).json()).project;
  projectId = project.id;
  const asset = (await (await request(`/projects/${projectId}/assets`, { method: 'POST', headers: { 'Content-Type': 'image/png', 'X-File-Name': 'logo.png' }, body: png })).json()).asset;
  let home = structuredClone(samplePage);
  home = updateNode(home, 'brand', { props: { text: '✦ Export Studio' } });
  home = updateNode(home, 'nav_about', { props: { href: '/about' } });
  home = updateNode(home, 'announcement', { props: { text: 'Custom banner for every screen.' } });
  home = updateNode(home, 'hero_inner', { styles: { mobile: { gridTemplateColumns: '1fr', gap: '16px' } } });
  home = updateNode(home, 'footer_grid', { styles: { mobile: { gridTemplateColumns: '1fr', gap: '16px' } } });
  home = addNode(home, 'header', 0, { id: 'export_logo', type: 'Image', props: { src: asset.url, alt: 'Export logo' }, styles: { desktop: { width: '32px' }, tablet: {}, mobile: { width: '24px' } } });
  home = addNode(home, 'footer_contact', 2, { id: 'export_contact_link', type: 'Link', props: { text: 'Email the studio', href: 'mailto:hello@northstar.example' }, styles: { desktop: { color: '#fff' }, tablet: {}, mobile: {} } });
  let about = updateNode(structuredClone(samplePage), 'hero_title', { props: { text: 'About Export Studio' } });
  about = updateNode(about, 'nav_work', { props: { href: '/' } });
  about.props.title = 'About Export Studio';
  await request(`/projects/${projectId}/pages`, json('POST', { name: 'Home', path: '/', document: home }));
  await request(`/projects/${projectId}/pages`, json('POST', { name: 'About', path: '/about', document: about }));
  for (const target of ['html', 'react', 'vue']) {
    const archive = Buffer.from(await (await request(`/projects/${projectId}/exports/${target}.zip`)).arrayBuffer());
    const zipPath = join(output, `${target}.zip`);
    const directory = join(output, target);
    await mkdir(directory);
    await writeFile(zipPath, archive);
    run('unzip', ['-q', zipPath, '-d', directory], output);
    if (target !== 'html') run('npm', ['install', '--offline'], directory);
    run('npm', ['run', 'build'], directory);
  }
  await Promise.all([
    serve(join(output, 'html'), process.execPath, ['server.js'], 'http://127.0.0.1:4173/'),
    serve(join(output, 'react'), join(output, 'react/node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', '4174'], 'http://127.0.0.1:4174/'),
    serve(join(output, 'vue'), join(output, 'vue/node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', '4175'], 'http://127.0.0.1:4175/')
  ]);
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const editorContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const editor = await editorContext.newPage();
  await editor.goto(editorUrl);
  await editor.getByRole('heading', { name: 'Make room for remarkable.' }).waitFor();
  await editor.getByRole('combobox', { name: 'Project' }).selectOption(projectId);
  await editor.getByRole('button', { name: 'Preview page' }).click();
  for (const mode of ['desktop', 'mobile']) {
    if (mode === 'mobile') { await editor.setViewportSize({ width: 390, height: 1000 }); await editor.getByRole('button', { name: 'mobile', exact: true }).click(); }
    const width = mode === 'desktop' ? 1440 : 390;
    const previewWidth = Math.round(await editor.locator('.preview-stage .page').evaluate(element => element.getBoundingClientRect().width));
    console.log(`${mode}: Preview frame ${previewWidth}px, exported browser ${width}px`);
    const expected = await snapshot(editor, false);
    for (const [target, port] of [['html', 4173], ['react', 4174], ['vue', 4175]]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.locator('.n-export_logo').evaluate(element => element.decode());
      const actual = await snapshot(page, true);
      assert.deepEqual(actual, expected, `${target} ${mode} differs from Preview`);
      await page.locator('.n-nav_about').click();
      await page.waitForURL(/\/about\/?$/);
      assert.match(await page.title(), /About/);
      await page.locator('.n-nav_work').click();
      await page.waitForURL(/\/$/);
      assert.equal(await page.locator('.n-export_logo').count(), 1);
      await context.close();
      console.log(`${target} ${mode}: content, spacing, image, and /about navigation match Preview`);
    }
  }
  console.log(`Verified ZIPs and builds in ${output}`);
} finally {
  if (browser) await browser.close();
  for (const child of servers) child.kill('SIGTERM');
  if (projectId) await pool.query('DELETE FROM projects WHERE id=$1', [projectId]);
  await pool.end();
}
