import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { addNode, findNode, samplePage, updateNode } from '@builder/document';
import { app } from '../src/server.js';
import { pool } from '../src/db.js';
import { migrate } from '../src/store.js';

const send = (method, url, payload) => app.inject({ method, url, payload, headers: { 'content-type': 'application/json' } });
const create = async (projectId, name, path, parentPageId, document = samplePage, slug) => (await send('POST', `/api/projects/${projectId}/pages`, { name, path, parentPageId, slug, document })).json().page;
after(async () => { await app.close(); await pool.end(); });

test('root and nested page CRUD preserves URLs on moves and guards deletion', async () => {
  await migrate();
  const projectIds = [];
  try {
    const first = (await send('POST', '/api/projects', { name: 'Hierarchy test' })).json().project; projectIds.push(first.id);
    const other = (await send('POST', '/api/projects', { name: 'Other hierarchy' })).json().project; projectIds.push(other.id);
    const linked = updateNode(structuredClone(samplePage), 'nav_about', { props: { href: '/about' } });
    const home = await create(first.id, 'Home', '/', null, linked);
    const about = await create(first.id, 'About', '/about', home.id);
    const team = await create(first.id, 'Team', '/about/team', about.id);
    const contact = await create(first.id, 'Contact', '/contact', null);
    const otherRoot = await create(other.id, 'Other', '/', null);
    assert.equal((await send('POST', `/api/projects/${first.id}/pages`, { name: 'Duplicate slug', path: '/different', parentPageId: home.id, slug: 'about', document: samplePage })).statusCode, 409);
    assert.equal((await send('POST', `/api/projects/${first.id}/pages`, { name: 'Duplicate path', path: '/about', parentPageId: null, slug: 'another', document: samplePage })).statusCode, 409);
    assert.equal((await send('POST', `/api/projects/${first.id}/pages`, { name: 'Wrong parent', path: '/wrong', parentPageId: otherRoot.id, document: samplePage })).statusCode, 400);
    const listed = (await send('GET', `/api/projects/${first.id}/pages`)).json().pages;
    assert.deepEqual(listed.map(page => [page.id, page.level]), [[home.id, 0], [about.id, 1], [team.id, 2], [contact.id, 0]]);
    assert.equal((await send('POST', `/api/pages/${contact.id}/move`, { expectedRevision: 1, parentPageId: otherRoot.id, index: 0 })).statusCode, 400);
    assert.equal((await send('POST', `/api/pages/${home.id}/move`, { expectedRevision: 1, parentPageId: team.id, index: 0 })).statusCode, 400);
    const collision = await create(first.id, 'Collision', '/alias', contact.id, samplePage, 'about');
    assert.equal((await send('POST', `/api/pages/${about.id}/move`, { expectedRevision: 1, parentPageId: contact.id, index: 0 })).statusCode, 409);
    assert.equal((await send('DELETE', `/api/pages/${collision.id}`, { expectedRevision: 1, mode: 'subtree', confirmedPageIds: [collision.id] })).statusCode, 200);
    const moved = (await send('POST', `/api/pages/${about.id}/move`, { expectedRevision: 1, parentPageId: contact.id, index: 0 })).json().page;
    assert.equal(moved.parentPageId, contact.id);
    assert.equal(moved.path, '/about');
    assert.equal((await send('GET', `/api/pages/${team.id}`)).json().page.parentPageId, about.id);
    assert.equal((await send('GET', `/api/pages/${team.id}`)).json().page.path, '/about/team');
    assert.equal((await send('POST', `/api/pages/${contact.id}/move`, { expectedRevision: 1, parentPageId: team.id, index: 0 })).statusCode, 400);
    const reordered = (await send('POST', `/api/pages/${contact.id}/move`, { expectedRevision: 1, parentPageId: null, index: 0 })).json().page;
    assert.equal(reordered.sortOrder, 0);
    assert.equal((await send('PATCH', `/api/pages/${about.id}`, { expectedRevision: moved.revision, path: '/contact' })).statusCode, 409);
    const renamed = (await send('PATCH', `/api/pages/${about.id}`, { expectedRevision: moved.revision, name: 'Company', slug: 'company', path: '/company' })).json().page;
    assert.equal(renamed.name, 'Company');
    assert.equal(renamed.slug, 'company');
    assert.equal(renamed.path, '/company');
    const homeAfter = (await send('GET', `/api/pages/${home.id}`)).json().page;
    assert.equal(findNode(homeAfter.document, 'nav_about').node.props.href, '/company');
    assert.equal(findNode((await send('GET', `/api/pages/${home.id}/revisions/1`)).json().revision.document, 'nav_about').node.props.href, '/about');
    assert.equal((await send('POST', `/api/pages/${home.id}/restore`, { revision: 1, expectedRevision: homeAfter.revision })).statusCode, 409);
    assert.equal((await send('DELETE', `/api/pages/${about.id}`, { expectedRevision: renamed.revision, mode: 'reparent', destinationParentPageId: home.id, confirmedPageIds: [about.id] })).statusCode, 409);
    assert.equal((await send('DELETE', `/api/pages/${about.id}`, { expectedRevision: renamed.revision, mode: 'reparent', destinationParentPageId: otherRoot.id, confirmedPageIds: [about.id] })).statusCode, 400);
    assert.equal((await send('DELETE', `/api/pages/${about.id}`, { expectedRevision: renamed.revision, mode: 'subtree', confirmedPageIds: [about.id] })).statusCode, 409);
    const unlinked = updateNode(homeAfter.document, 'nav_about', { props: { href: '/about/team' } });
    assert.equal((await send('PUT', `/api/pages/${home.id}`, { expectedRevision: homeAfter.revision, document: unlinked })).statusCode, 200);
    const deleted = await send('DELETE', `/api/pages/${about.id}`, { expectedRevision: renamed.revision, mode: 'reparent', destinationParentPageId: home.id, confirmedPageIds: [about.id] });
    assert.equal(deleted.statusCode, 200, deleted.body);
    assert.deepEqual(deleted.json().reparentedPageIds, [team.id]);
    assert.equal((await send('GET', `/api/pages/${team.id}`)).json().page.parentPageId, home.id);
    assert.equal((await send('GET', `/api/pages/${about.id}`)).statusCode, 404);
    const homeCurrent = (await send('GET', `/api/pages/${home.id}`)).json().page;
    const subtree = await send('DELETE', `/api/pages/${home.id}`, { expectedRevision: homeCurrent.revision, mode: 'subtree', confirmedPageIds: [home.id, team.id] });
    assert.equal(subtree.statusCode, 200, subtree.body);
    assert.equal((await send('GET', `/api/pages/${team.id}`)).statusCode, 404);
    assert.equal((await send('GET', `/api/pages/${contact.id}`)).statusCode, 200);
  } finally {
    await pool.query('DELETE FROM projects WHERE id=ANY($1::uuid[])', [projectIds]);
  }
});

test('migration preserves existing paths, documents, revisions, and asset references', async () => {
  const client = await pool.connect();
  const schema = `hierarchy_${randomUUID().replaceAll('-', '')}`;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    for (const name of ['001_baseline', '002_accounts_storage', '003_asset_bucket', '004_project_management']) await client.query(await readFile(new URL(`../src/migrations/${name}.sql`, import.meta.url), 'utf8'));
    const projectId = randomUUID(); const firstId = randomUUID(); const secondId = randomUUID(); const assetId = randomUUID();
    const document = addNode(updateNode(structuredClone(samplePage), 'nav_about', { props: { href: '/about' } }), 'main', 0, { id: 'legacy_asset_image', type: 'Image', props: { src: `/api/assets/${assetId}/content`, alt: 'Legacy asset' }, styles: { desktop: {}, tablet: {}, mobile: {} } });
    await client.query('INSERT INTO projects(id,name) VALUES($1,$2)', [projectId, 'Existing']);
    await client.query('INSERT INTO pages(id,project_id,name,path,document,revision) VALUES($1,$2,$3,$4,$5::jsonb,$6),($7,$2,$8,$9,$5::jsonb,$6)', [firstId, projectId, 'Home', '/', JSON.stringify(document), 2, secondId, 'About', '/--about--']);
    await client.query('INSERT INTO page_revisions(page_id,revision,document) VALUES($1,1,$3::jsonb),($1,2,$3::jsonb),($2,1,$3::jsonb)', [firstId, secondId, JSON.stringify(document)]);
    await client.query('INSERT INTO assets(id,project_id,filename,media_type,byte_length,sha256,contents) VALUES($1,$2,$3,$4,$5,$6,$7)', [assetId, projectId, 'old.png', 'image/png', 1, 'hash', Buffer.from([1])]);
    const before = (await client.query('SELECT id,path,document,revision FROM pages ORDER BY id')).rows;
    const revisions = (await client.query('SELECT page_id,revision,document FROM page_revisions ORDER BY page_id,revision')).rows;
    await client.query(await readFile(new URL('../src/migrations/005_page_hierarchy.sql', import.meta.url), 'utf8'));
    const after = (await client.query('SELECT id,path,document,revision,parent_page_id,slug,sort_order FROM pages ORDER BY id')).rows;
    assert.deepEqual(after.map(({ id, path, document: data, revision }) => ({ id, path, document: data, revision })), before);
    assert.ok(after.every(page => page.parent_page_id === null));
    assert.equal(after.find(page => page.id === secondId).slug, 'about');
    assert.deepEqual(after.map(page => page.sort_order).sort(), [0, 1]);
    assert.deepEqual((await client.query('SELECT page_id,revision,document FROM page_revisions ORDER BY page_id,revision')).rows, revisions);
    assert.equal((await client.query('SELECT project_id FROM assets WHERE id=$1', [assetId])).rows[0].project_id, projectId);
  } finally {
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    client.release();
  }
});
