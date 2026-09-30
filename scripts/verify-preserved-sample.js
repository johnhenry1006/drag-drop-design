import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { chromium } from 'playwright-core';
import { pool } from '../apps/api/src/db.js';
import { samplePageId, sampleProjectId } from '../apps/api/src/store.js';

const api = process.env.API_URL || 'http://127.0.0.1:3001/api';
const editor = process.env.EDITOR_URL || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const sample = (await pool.query('SELECT id,project_id,parent_page_id,name,path,slug,sort_order,revision,document,md5(document::text) AS hash FROM pages WHERE id=$1', [samplePageId])).rows[0];
  assert.ok(sample, 'Fixture-identified sample page is missing');
  assert.equal(sample.project_id, sampleProjectId);
  const projectName = (await pool.query('SELECT name FROM projects WHERE id=$1', [sampleProjectId])).rows[0]?.name;
  assert.ok(projectName);
  const nodes = [];
  const visit = node => { nodes.push(node); node.children?.forEach(visit); };
  Object.values(sample.document.regions).flat().forEach(visit);
  assert.ok(sample.document.regions.header.length && sample.document.regions.main.length && sample.document.regions.footer.length);
  const links = nodes.filter(node => ['Button', 'Link', 'Floating Action Button'].includes(node.type) && (node.props.href || node.props.targetPageId));
  const assetRefs = new Set();
  const revisions = (await pool.query('SELECT document FROM page_revisions WHERE page_id=$1', [samplePageId])).rows;
  for (const revision of [{ document: sample.document }, ...revisions]) {
    const scan = node => { if (typeof node.props?.src === 'string' && node.props.src.startsWith('/api/assets/')) assetRefs.add(node.props.src); node.children?.forEach(scan); };
    Object.values(revision.document.regions).flat().forEach(scan);
  }
  const assets = (await pool.query('SELECT id,filename,sha256,byte_length,contents FROM assets WHERE project_id=$1 ORDER BY id', [sampleProjectId])).rows;
  for (const asset of assets) {
    const response = await fetch(`${api}/assets/${asset.id}/content`);
    assert.equal(response.status, 200, asset.filename);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, asset.byte_length);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
  }
  for (const url of assetRefs) assert.ok(assets.some(asset => url === `/api/assets/${asset.id}/content`), `Missing referenced asset ${url}`);

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(editor);
  const projectSelect = page.getByRole('combobox', { name: 'Project' });
  await projectSelect.locator(`option[value="${sampleProjectId}"]`).waitFor({ state: 'attached' });
  await projectSelect.selectOption(sampleProjectId);
  const pageSelect = page.getByRole('combobox', { name: 'Page' });
  await pageSelect.locator(`option[value="${samplePageId}"]`).waitFor({ state: 'attached' });
  await pageSelect.selectOption(samplePageId);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  const projects = page.getByRole('dialog', { name: 'Manage projects' });
  await projects.getByLabel('Search projects').fill(projectName);
  assert.match(await projects.locator('.project-manager-list li').innerText(), /1 page/);
  await projects.getByRole('button', { name: 'Close projects' }).click();
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  const pages = page.getByRole('dialog', { name: 'Manage pages' });
  const sampleRow = pages.locator('.page-tree [role="treeitem"]').filter({ has: page.locator('[data-page-select] strong', { hasText: sample.name }) });
  assert.equal(await sampleRow.count(), 1);
  assert.equal(await sampleRow.getAttribute('aria-selected'), 'true');
  await sampleRow.locator('[data-page-select]').click();
  await pages.getByRole('button', { name: 'Close pages' }).click();
  assert.equal(await page.locator('.canvas-area [data-node-id="hero_title"]').count(), 1);
  assert.equal(await page.locator('.canvas-area [data-node-id="footer_grid"]').count(), 1);
  await page.getByRole('button', { name: 'Preview page' }).click();
  assert.equal(await page.locator('.preview-stage [data-node-id="hero_title"]').count(), 1);
  for (const link of links) if (link.props.href) assert.equal(await page.locator(`.preview-stage [data-node-id="${link.id}"]`).getAttribute('href'), link.props.href);
  const anchorTargets = [...new Set(links.map(node => node.props.href).filter(href => href?.startsWith('#') && href.length > 1))];
  const unresolvedAnchorTargets = [];
  for (const href of anchorTargets) if (await page.locator(`.preview-stage [id="${href.slice(1)}"]`).count() === 0) unresolvedAnchorTargets.push(href);
  await context.close();

  const targets = {};
  for (const target of ['html', 'react', 'vue']) {
    const report = await fetch(`${api}/projects/${sampleProjectId}/exports/${target}/check`);
    assert.equal(report.status, 200, target);
    const details = await report.json();
    assert.deepEqual(details.issues, []);
    assert.ok(details.pages.some(item => item.id === samplePageId && item.path === sample.path));
    const response = await fetch(`${api}/projects/${sampleProjectId}/exports/${target}.zip`);
    assert.equal(response.status, 200, target);
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    const source = new TextDecoder().decode(files[target === 'html' ? 'index.html' : target === 'react' ? 'src/pages.jsx' : 'src/pages.js']);
    assert.ok(source.includes(sample.document.props.title), `${target} missing page title`);
    assert.ok(source.includes(nodes.find(node => node.id === 'hero_title').props.text), `${target} missing hero title`);
    for (const link of links) if (link.props.href) assert.ok(source.includes(link.props.href), `${target} missing ${link.props.href}`);
    targets[target] = Object.keys(files).length;
  }
  const unchanged = (await pool.query('SELECT project_id,parent_page_id,name,path,slug,sort_order,revision,md5(document::text) AS hash FROM pages WHERE id=$1', [samplePageId])).rows[0];
  assert.deepEqual(unchanged, { project_id: sample.project_id, parent_page_id: sample.parent_page_id, name: sample.name, path: sample.path, slug: sample.slug, sort_order: sample.sort_order, revision: sample.revision, hash: sample.hash });
  console.log(JSON.stringify({ samplePageId, projectId: sampleProjectId, revision: sample.revision, hash: sample.hash, regions: Object.fromEntries(Object.entries(sample.document.regions).map(([region, items]) => [region, items.length])), links: links.map(node => ({ id: node.id, href: node.props.href })), unresolvedAnchorTargets, retainedAssets: assets.map(asset => asset.filename), referencedAssetCount: assetRefs.size, exportFileCounts: targets }));
} finally { await browser.close(); await pool.end(); }
