import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { linkNode, normalizePagePath, samplePage, validateDocument } from '@builder/document';
import { pool } from './db.js';
import { assetBucket, assetStorageMode, deleteObject, getObject, putObject } from './object-store.js';

const migrations = ['001_baseline', '002_accounts_storage', '003_asset_bucket', '004_project_management', '005_page_hierarchy'].map((name, index) => ({ version: index + 1, path: fileURLToPath(new URL(`./migrations/${name}.sql`, import.meta.url)) }));
export const assetUrl = id => `/api/assets/${id}/content`;

export const sampleProjectId = '00000000-0000-4000-8000-000000000001';
export const samplePageId = '00000000-0000-4000-8000-000000000002';

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(83140721)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const latest = (await client.query('SELECT max(version) AS version FROM schema_migrations')).rows[0].version;
    if (latest > migrations.at(-1).version) throw new Error(`Database schema version ${latest} is newer than this API`);
    for (const migration of migrations) {
      if ((await client.query('SELECT 1 FROM schema_migrations WHERE version=$1', [migration.version])).rowCount) continue;
      await client.query('BEGIN');
      try {
        await client.query(await readFile(migration.path, 'utf8'));
        await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [migration.version]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
    if (process.env.NODE_ENV !== 'production') {
      await client.query('INSERT INTO projects(id,name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [sampleProjectId, 'Sample project']);
      await client.query('INSERT INTO pages(id,project_id,name,path,document,slug,sort_order) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7) ON CONFLICT(id) DO NOTHING', [samplePageId, sampleProjectId, 'Sample page', '/', JSON.stringify(samplePage), 'home', 0]);
      await client.query('INSERT INTO page_revisions(page_id,revision,document) VALUES($1,1,$2::jsonb) ON CONFLICT(page_id,revision) DO NOTHING', [samplePageId, JSON.stringify(samplePage)]);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(83140721)');
    client.release();
  }
}

export function validName(value, label = 'Name') {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) throw Object.assign(new Error(`${label} must be 1–120 characters`), { statusCode: 400 });
  return value.trim();
}

export function validDocument(value) {
  try { return validateDocument(value); }
  catch (error) { throw Object.assign(new Error(`Invalid Page document: ${error.message}`), { statusCode: 400 }); }
}
function validPath(value) {
  try { return normalizePagePath(value); }
  catch (error) { throw Object.assign(error, { statusCode: 400 }); }
}

const projectColumns = 'p.id, p.name, p.version, p.created_at AS "createdAt", p.updated_at AS "updatedAt", GREATEST(p.updated_at, COALESCE(pg.last_updated, p.updated_at), COALESCE(a.last_updated, p.updated_at)) AS "lastUpdatedAt", COALESCE(pg.page_count, 0)::integer AS "pageCount", COALESCE(pg.revision_count, 0)::integer AS "revisionCount", COALESCE(a.asset_count, 0)::integer AS "assetCount"';
const projectFrom = `FROM projects p LEFT JOIN LATERAL (SELECT COUNT(*) AS page_count, MAX(updated_at) AS last_updated, (SELECT COUNT(*) FROM page_revisions pr JOIN pages rp ON rp.id=pr.page_id WHERE rp.project_id=p.id) AS revision_count FROM pages WHERE project_id=p.id) pg ON true LEFT JOIN LATERAL (SELECT COUNT(*) AS asset_count, MAX(created_at) AS last_updated FROM assets WHERE project_id=p.id) a ON true`;
const pageColumns = 'id, project_id AS "projectId", parent_page_id AS "parentPageId", slug, sort_order AS "sortOrder", name, path, document, revision, created_at AS "createdAt", updated_at AS "updatedAt"';
const assetColumns = 'id, project_id AS "projectId", filename, media_type AS "mediaType", byte_length AS "byteLength", sha256, created_at AS "createdAt"';

export async function listProjects(ownerId = null) { return (await pool.query(`SELECT ${projectColumns} ${projectFrom} WHERE ($1::uuid IS NULL OR p.owner_id=$1) ORDER BY p.created_at, p.id`, [ownerId])).rows; }
export async function getProject(id) { return (await pool.query(`SELECT ${projectColumns} ${projectFrom} WHERE p.id=$1`, [id])).rows[0] || null; }
export async function createProject(name, ownerId = null) {
  const id = randomUUID();
  await pool.query('INSERT INTO projects(id,name,owner_id) VALUES($1,$2,$3)', [id, validName(name, 'Project name'), ownerId]);
  return getProject(id);
}
export async function updateProject(id, name, expectedVersion) {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw Object.assign(new Error('expectedVersion must be a positive integer'), { statusCode: 400 });
  const result = await pool.query('UPDATE projects SET name=$2, version=version+1, updated_at=now() WHERE id=$1 AND version=$3 RETURNING id', [id, validName(name, 'Project name'), expectedVersion]);
  return result.rowCount ? { project: await getProject(id) } : { project: null, current: await getProject(id) };
}

export async function deleteProject(id, name, expectedVersion, expectedCounts) {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw Object.assign(new Error('expectedVersion must be a positive integer'), { statusCode: 400 });
  if (typeof name !== 'string' || !name.trim() || name.length > 120) throw Object.assign(new Error('Confirmed project name is required'), { statusCode: 400 });
  if (!expectedCounts || ['pageCount', 'revisionCount', 'assetCount'].some(key => !Number.isInteger(expectedCounts[key]) || expectedCounts[key] < 0)) throw Object.assign(new Error('Expected project counts are required'), { statusCode: 400 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = (await client.query('SELECT id, name, version FROM projects WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!locked) { await client.query('ROLLBACK'); return { missing: true }; }
    const counts = (await client.query(`SELECT (SELECT count(*) FROM pages WHERE project_id=$1)::integer AS "pageCount", (SELECT count(*) FROM page_revisions pr JOIN pages pg ON pg.id=pr.page_id WHERE pg.project_id=$1)::integer AS "revisionCount", (SELECT count(*) FROM assets WHERE project_id=$1)::integer AS "assetCount"`, [id])).rows[0];
    if (locked.name !== name || locked.version !== expectedVersion || Object.keys(counts).some(key => counts[key] !== expectedCounts[key])) { await client.query('ROLLBACK'); return { conflict: true }; }
    const objects = (await client.query('SELECT DISTINCT object_bucket AS bucket, object_key AS key FROM assets WHERE project_id=$1 AND object_key IS NOT NULL', [id])).rows;
    for (const object of objects) {
      if (!object.bucket) throw Object.assign(new Error('Asset object bucket is missing; deletion stopped'), { statusCode: 409 });
      const shared = await client.query('SELECT 1 FROM assets WHERE project_id<>$1 AND object_bucket=$2 AND object_key=$3 LIMIT 1', [id, object.bucket, object.key]);
      if (!shared.rowCount) await client.query('INSERT INTO asset_object_deletions(object_bucket,object_key) VALUES($1,$2) ON CONFLICT DO NOTHING', [object.bucket, object.key]);
    }
    await client.query('DELETE FROM projects WHERE id=$1', [id]);
    await client.query('COMMIT');
    return { deleted: true, counts };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function drainAssetObjectDeletions() {
  const jobs = (await pool.query('SELECT id, object_bucket AS bucket, object_key AS key FROM asset_object_deletions ORDER BY id LIMIT 100')).rows;
  for (const job of jobs) {
    const shared = await pool.query('SELECT 1 FROM assets WHERE object_bucket=$1 AND object_key=$2 LIMIT 1', [job.bucket, job.key]);
    if (!shared.rowCount) {
      try { await deleteObject(job.key, job.bucket); }
      catch { continue; }
    }
    await pool.query('DELETE FROM asset_object_deletions WHERE id=$1', [job.id]);
  }
  return jobs.length;
}

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const badRequest = message => Object.assign(new Error(message), { statusCode: 400 });
const conflict = message => Object.assign(new Error(message), { statusCode: 409 });
function validSlug(value) {
  if (typeof value !== 'string' || value.length > 120 || !slugPattern.test(value)) throw badRequest('Slug must use lowercase letters, numbers, and single hyphens');
  return value;
}
const slugFromPath = path => path === '/' ? 'home' : path.slice(path.lastIndexOf('/') + 1).replace(/-+/g, '-').replace(/^-|-$/g, '') || 'page';
const pageMetadataColumns = 'id, project_id AS "projectId", parent_page_id AS "parentPageId", slug, sort_order AS "sortOrder", name, path, revision, created_at AS "createdAt", updated_at AS "updatedAt"';
export async function listPages(projectId) {
  const rows = (await pool.query(`SELECT ${pageMetadataColumns} FROM pages WHERE project_id=$1 ORDER BY sort_order,id`, [projectId])).rows;
  const children = new Map();
  for (const row of rows) { const key = row.parentPageId || ''; if (!children.has(key)) children.set(key, []); children.get(key).push(row); }
  const result = [];
  const visit = (parentId, level) => { for (const row of children.get(parentId || '') || []) { result.push({ ...row, level }); visit(row.id, level + 1); } };
  visit(null, 0);
  if (result.length !== rows.length) throw new Error('Page hierarchy has a cycle or missing parent');
  return result;
}
export async function getPage(id) { return (await pool.query(`SELECT ${pageColumns} FROM pages WHERE id=$1`, [id])).rows[0] || null; }

export async function createPage(projectId, name, document, path, parentPageId = null, slug) {
  const pageName = validName(name, 'Page name');
  const pageDocument = validDocument(document);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!(await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [projectId])).rowCount) throw Object.assign(new Error('Project not found'), { statusCode: 404 });
    const parent = parentPageId === null ? null : (await client.query('SELECT id,path FROM pages WHERE id=$1 AND project_id=$2', [parentPageId, projectId])).rows[0];
    if (parentPageId !== null && !parent) throw badRequest('Parent page must be in this project');
    await assertPageTargets(client, projectId, pageDocument);
    const defaultSlug = path === undefined ? pageName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page' : slugFromPath(validPath(path));
    const pageSlug = validSlug(slug === undefined ? defaultSlug : slug);
    const pagePath = validPath(path === undefined ? parent ? `${parent.path === '/' ? '' : parent.path}/${pageSlug}` : (await client.query('SELECT 1 FROM pages WHERE project_id=$1 AND path=\'/\'', [projectId])).rowCount ? `/${pageSlug}` : '/' : path);
    const nextOrder = (await client.query('SELECT COALESCE(MAX(sort_order)+1,0) AS value FROM pages WHERE project_id=$1 AND parent_page_id IS NOT DISTINCT FROM $2::uuid', [projectId, parentPageId])).rows[0].value;
    const result = await client.query(`INSERT INTO pages(id,project_id,parent_page_id,slug,sort_order,name,path,document) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING ${pageColumns}`, [randomUUID(), projectId, parentPageId, pageSlug, nextOrder, pageName, pagePath, JSON.stringify(pageDocument)]);
    const page = result.rows[0];
    await client.query('INSERT INTO page_revisions(page_id,revision,document) VALUES($1,1,$2::jsonb)', [page.id, JSON.stringify(pageDocument)]);
    await client.query('UPDATE projects SET version=version+1,updated_at=now() WHERE id=$1', [projectId]);
    await client.query('COMMIT');
    return page;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

function visitDocumentNodes(document, visit) {
  const node = value => { visit(value); value.children?.forEach(node); };
  for (const region of ['header', 'main', 'footer']) document.regions[region].forEach(node);
}
function internalPath(href) {
  if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) return null;
  return href.split(/[?#]/, 1)[0];
}
async function assertPageTargets(client, projectId, document) {
  const targets = new Set();
  visitDocumentNodes(document, node => { if (linkNode(node) && node.props.targetPageId) targets.add(node.props.targetPageId); });
  if (!targets.size) return;
  const found = (await client.query('SELECT id FROM pages WHERE project_id=$1 AND id=ANY($2::uuid[])', [projectId, [...targets]])).rows;
  const available = new Set(found.map(row => row.id));
  const missing = [...targets].filter(id => !available.has(id));
  if (missing.length) throw conflict(`Target pages are missing or inaccessible in this project: ${missing.join(', ')}`);
}
function rewriteDocumentLinks(document, oldPath, newPath) {
  const copy = structuredClone(document);
  let changed = 0;
  visitDocumentNodes(copy, node => {
    if (!['Button', 'Link', 'Floating Action Button'].includes(node.type) || (node.type === 'Floating Action Button' && node.props.action !== 'link')) return;
    const href = node.props.href;
    if (internalPath(href) !== oldPath) return;
    node.props.href = newPath + href.slice(oldPath.length);
    changed++;
  });
  return { document: copy, changed };
}
async function rewriteOtherPages(client, projectId, excludedPageId, oldPath, newPath) {
  const rows = (await client.query('SELECT id,document FROM pages WHERE project_id=$1 AND id<>$2 ORDER BY id FOR UPDATE', [projectId, excludedPageId])).rows;
  for (const row of rows) {
    const next = rewriteDocumentLinks(row.document, oldPath, newPath);
    if (!next.changed) continue;
    validDocument(next.document);
    const updated = (await client.query('UPDATE pages SET document=$2::jsonb,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING revision', [row.id, JSON.stringify(next.document)])).rows[0];
    await client.query('INSERT INTO page_revisions(page_id,revision,document) VALUES($1,$2,$3::jsonb)', [row.id, updated.revision, JSON.stringify(next.document)]);
  }
}

export async function savePage(id, expectedRevision, document, name, path, slug, requireValidLinks = false) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw Object.assign(new Error('expectedRevision must be a positive integer'), { statusCode: 400 });
  const pageName = name === undefined ? undefined : validName(name, 'Page name');
  const pagePath = path === undefined ? undefined : validPath(path);
  const pageSlug = slug === undefined ? undefined : validSlug(slug);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const identity = (await client.query('SELECT project_id FROM pages WHERE id=$1', [id])).rows[0];
    if (!identity) { await client.query('ROLLBACK'); return { page: null, current: null }; }
    await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [identity.project_id]);
    const current = (await client.query(`SELECT ${pageColumns} FROM pages WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!current || current.revision !== expectedRevision) { await client.query('ROLLBACK'); return { page: null, current }; }
    let pageDocument = validDocument(document === undefined ? current.document : document);
    await assertPageTargets(client, current.projectId, pageDocument);
    const nextPath = pagePath ?? current.path;
    if (nextPath !== current.path) pageDocument = validDocument(rewriteDocumentLinks(pageDocument, current.path, nextPath).document);
    if (requireValidLinks) {
      const paths = new Set((await client.query('SELECT path FROM pages WHERE project_id=$1', [current.projectId])).rows.map(row => row.path));
      paths.add(nextPath);
      const missing = new Set();
      visitDocumentNodes(pageDocument, node => {
        if (!linkNode(node)) return;
        const route = internalPath(node.props.href);
        if (route && !paths.has(route)) missing.add(route);
      });
      if (missing.size) throw conflict(`Restored document links to missing page paths: ${[...missing].join(', ')}`);
    }
    const result = await client.query(`UPDATE pages SET document=$2::jsonb, name=COALESCE($3,name), path=$4, slug=COALESCE($5,slug), revision=revision+1, updated_at=now() WHERE id=$1 RETURNING ${pageColumns}`, [id, JSON.stringify(pageDocument), pageName ?? null, nextPath, pageSlug ?? null]);
    const page = result.rows[0];
    await client.query('INSERT INTO page_revisions(page_id,revision,document) VALUES($1,$2,$3::jsonb)', [id, page.revision, JSON.stringify(pageDocument)]);
    if (nextPath !== current.path) await rewriteOtherPages(client, current.projectId, id, current.path, nextPath);
    await client.query('UPDATE projects SET version=version+1,updated_at=now() WHERE id=$1', [current.projectId]);
    await client.query('COMMIT');
    return { page };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function lockedHierarchy(client, pageId) {
  const identity = (await client.query('SELECT project_id FROM pages WHERE id=$1', [pageId])).rows[0];
  if (!identity) return null;
  await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [identity.project_id]);
  const rows = (await client.query('SELECT id,project_id AS "projectId",parent_page_id AS "parentPageId",slug,sort_order AS "sortOrder",revision,document,path FROM pages WHERE project_id=$1 ORDER BY id FOR UPDATE', [identity.project_id])).rows;
  return { projectId: identity.project_id, rows, target: rows.find(row => row.id === pageId) };
}
const parentKey = id => id || '';
function siblingGroups(rows) {
  const groups = new Map();
  for (const row of rows) { const key = parentKey(row.parentPageId); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
  for (const items of groups.values()) items.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  return groups;
}
async function writeSiblingOrder(client, rows, groups, parentChanges = new Map()) {
  for (const [index, row] of rows.entries()) await client.query('UPDATE pages SET sort_order=$2 WHERE id=$1', [row.id, -index - 1]);
  for (const [id, parentId] of parentChanges) await client.query('UPDATE pages SET parent_page_id=$2 WHERE id=$1', [id, parentId]);
  for (const items of groups.values()) for (const [index, row] of items.entries()) await client.query('UPDATE pages SET sort_order=$2 WHERE id=$1', [row.id, index]);
}
async function bumpPageRevision(client, row) {
  const updated = (await client.query('UPDATE pages SET revision=revision+1,updated_at=now() WHERE id=$1 RETURNING revision', [row.id])).rows[0];
  await client.query('INSERT INTO page_revisions(page_id,revision,document) VALUES($1,$2,$3::jsonb)', [row.id, updated.revision, JSON.stringify(row.document)]);
}
function descendantIds(rows, id) {
  const children = new Map();
  for (const row of rows) { const key = parentKey(row.parentPageId); if (!children.has(key)) children.set(key, []); children.get(key).push(row.id); }
  const found = new Set();
  const visit = current => { if (found.has(current)) throw conflict('Page hierarchy contains a cycle'); found.add(current); for (const child of children.get(current) || []) visit(child); };
  visit(id);
  return found;
}
function inboundReferences(rows, removed) {
  const removedPaths = new Set(rows.filter(row => removed.has(row.id)).map(row => row.path));
  const references = [];
  for (const row of rows.filter(item => !removed.has(item.id))) visitDocumentNodes(row.document, node => {
    if (!linkNode(node)) return;
    if (removed.has(node.props.targetPageId) || removedPaths.has(internalPath(node.props.href))) references.push({ pageId: row.id, nodeId: node.id, href: node.props.href, targetPageId: node.props.targetPageId || null });
  });
  return references;
}
export async function pageInboundReferences(id, mode = 'subtree') {
  if (!['subtree', 'reparent'].includes(mode)) throw badRequest('mode must be subtree or reparent');
  const identity = (await pool.query('SELECT project_id FROM pages WHERE id=$1', [id])).rows[0];
  if (!identity) return null;
  const rows = (await pool.query('SELECT id,parent_page_id AS "parentPageId",path,document FROM pages WHERE project_id=$1', [identity.project_id])).rows;
  const removed = mode === 'subtree' ? descendantIds(rows, id) : new Set([id]);
  return { affectedPageIds: [...removed], references: inboundReferences(rows, removed) };
}

export async function movePage(id, expectedRevision, parentPageId, index) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1 || !Number.isInteger(index) || index < 0 || parentPageId === undefined) throw badRequest('expectedRevision, parentPageId, and a nonnegative index are required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const state = await lockedHierarchy(client, id);
    if (!state) { await client.query('ROLLBACK'); return { missing: true }; }
    const { rows, target, projectId } = state;
    if (target.revision !== expectedRevision) { await client.query('ROLLBACK'); return { conflict: true }; }
    if (parentPageId !== null && !rows.some(row => row.id === parentPageId)) throw badRequest('Parent page must be in this project');
    if (descendantIds(rows, id).has(parentPageId)) throw badRequest('A page cannot move under itself or a descendant');
    const groups = siblingGroups(rows);
    const old = groups.get(parentKey(target.parentPageId));
    old.splice(old.findIndex(row => row.id === id), 1);
    const destination = groups.get(parentKey(parentPageId)) || [];
    if (index > destination.length) throw badRequest('Index exceeds the destination sibling count');
    if (destination.some(row => row.slug === target.slug)) throw conflict('Sibling slug already exists under that parent');
    destination.splice(index, 0, target);
    groups.set(parentKey(parentPageId), destination);
    await writeSiblingOrder(client, rows, groups, new Map([[id, parentPageId]]));
    await bumpPageRevision(client, target);
    await client.query('UPDATE projects SET version=version+1,updated_at=now() WHERE id=$1', [projectId]);
    await client.query('COMMIT');
    return { page: await getPage(id) };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function deletePage(id, expectedRevision, mode, destinationParentPageId, confirmedPageIds) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1 || !['subtree', 'reparent'].includes(mode) || !Array.isArray(confirmedPageIds)) throw badRequest('expectedRevision, deletion mode, and confirmedPageIds are required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const state = await lockedHierarchy(client, id);
    if (!state) { await client.query('ROLLBACK'); return { missing: true }; }
    const { rows, target, projectId } = state;
    if (target.revision !== expectedRevision) { await client.query('ROLLBACK'); return { conflict: true }; }
    const subtree = descendantIds(rows, id);
    const removed = mode === 'subtree' ? subtree : new Set([id]);
    if (confirmedPageIds.length !== removed.size || new Set(confirmedPageIds).size !== removed.size || confirmedPageIds.some(value => !removed.has(value))) throw conflict('The pages affected by deletion changed; review them again');
    if (mode === 'reparent' && destinationParentPageId === undefined) throw badRequest('Select a destination parent, or null for root');
    if (mode === 'reparent' && destinationParentPageId !== null && !rows.some(row => row.id === destinationParentPageId)) throw badRequest('Destination parent must be in this project');
    if (mode === 'reparent' && subtree.has(destinationParentPageId)) throw badRequest('Destination parent cannot be inside the deleted page subtree');
    const references = inboundReferences(rows, removed);
    if (references.length) { await client.query('ROLLBACK'); return { references }; }
    const parentChanges = new Map();
    if (mode === 'reparent') {
      const groups = siblingGroups(rows);
      const children = groups.get(id) || [];
      const destination = (groups.get(parentKey(destinationParentPageId)) || []).filter(row => row.id !== id);
      for (const child of children) {
        if (destination.some(row => row.slug === child.slug)) throw conflict(`Sibling slug ${child.slug} already exists at the destination`);
        parentChanges.set(child.id, destinationParentPageId);
      }
    }
    await client.query('DELETE FROM pages WHERE id=ANY($1::uuid[])', [[...removed]]);
    const survivors = rows.filter(row => !removed.has(row.id));
    const finalGroups = siblingGroups(survivors);
    if (mode === 'reparent') {
      const children = finalGroups.get(id) || [];
      const key = parentKey(destinationParentPageId);
      const atDestination = finalGroups.get(key) || [];
      finalGroups.set(key, atDestination.concat(children));
      finalGroups.delete(id);
    }
    await writeSiblingOrder(client, survivors, finalGroups, parentChanges);
    for (const row of survivors.filter(item => parentChanges.has(item.id))) await bumpPageRevision(client, row);
    await client.query('UPDATE projects SET version=version+1,updated_at=now() WHERE id=$1', [projectId]);
    await client.query('COMMIT');
    return { deletedPageIds: [...removed], reparentedPageIds: [...parentChanges.keys()] };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function listRevisions(pageId) {
  return (await pool.query('SELECT revision, created_at AS "createdAt" FROM page_revisions WHERE page_id=$1 ORDER BY revision DESC', [pageId])).rows;
}
export async function getRevision(pageId, revision) {
  return (await pool.query('SELECT revision, document, created_at AS "createdAt" FROM page_revisions WHERE page_id=$1 AND revision=$2', [pageId, revision])).rows[0] || null;
}
export async function restorePage(id, revision, expectedRevision) {
  const previous = await getRevision(id, revision);
  if (!previous) return { missingRevision: true };
  return savePage(id, expectedRevision, previous.document, undefined, undefined, undefined, true);
}

export async function listAssets(projectId) {
  return (await pool.query(`SELECT ${assetColumns} FROM assets WHERE project_id=$1 ORDER BY created_at DESC, id`, [projectId])).rows.map(asset => ({ ...asset, url: assetUrl(asset.id) }));
}
export async function createAsset(projectId, filename, mediaType, contents) {
  const id = randomUUID();
  const sha256 = createHash('sha256').update(contents).digest('hex');
  const objectBucket = assetStorageMode() === 's3' ? assetBucket() : null;
  const objectKey = objectBucket ? `assets/${randomUUID()}` : null;
  if (objectKey) await putObject(objectKey, contents, mediaType, objectBucket);
  try {
    const result = await pool.query(`INSERT INTO assets(id,project_id,filename,media_type,byte_length,sha256,contents,object_key,object_bucket) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${assetColumns}`, [id, projectId, filename, mediaType, contents.length, sha256, objectKey ? null : contents, objectKey, objectBucket]);
    return { ...result.rows[0], url: assetUrl(id) };
  } catch (error) {
    if (objectKey) await deleteObject(objectKey, objectBucket).catch(() => {});
    throw error;
  }
}
export async function getAsset(id) {
  return (await pool.query(`SELECT ${assetColumns}, contents, object_key AS "objectKey", object_bucket AS "objectBucket" FROM assets WHERE id=$1`, [id])).rows[0] || null;
}
export async function assetContents(asset) {
  if (asset.objectKey && assetStorageMode() === 's3') return getObject(asset.objectKey, asset.objectBucket || assetBucket());
  if (asset.contents) return asset.contents;
  if (asset.objectKey) return getObject(asset.objectKey, asset.objectBucket || assetBucket());
  return null;
}

export async function projectExportData(projectId) {
  const [pages, assets] = await Promise.all([
    pool.query('SELECT id, name, path, document FROM pages WHERE project_id=$1 ORDER BY path, id', [projectId]),
    pool.query(`SELECT ${assetColumns} FROM assets WHERE project_id=$1`, [projectId])
  ]);
  if (pages.rows.length > 100) throw Object.assign(new Error('Export exceeds the page limit'), { statusCode: 413 });
  return { pages: pages.rows, assets: assets.rows };
}

export async function projectExportAssets(projectId, assetIds) {
  if (!assetIds.length) return [];
  const rows = (await pool.query(`SELECT ${assetColumns}, contents, object_key AS "objectKey", object_bucket AS "objectBucket" FROM assets WHERE project_id=$1 AND id=ANY($2::uuid[])`, [projectId, assetIds])).rows;
  const byId = new Map(rows.map(asset => [asset.id, asset]));
  const totalBytes = rows.reduce((sum, asset) => sum + asset.byteLength, 0);
  if (totalBytes > 100 * 1024 * 1024) throw Object.assign(new Error('Referenced assets exceed the 100 MB export limit'), { statusCode: 413 });
  return Promise.all(assetIds.map(async id => {
    const asset = byId.get(id);
    if (!asset) throw Object.assign(new Error(`Referenced asset ${id} is missing`), { statusCode: 422 });
    let contents;
    try { contents = await assetContents(asset); }
    catch { throw Object.assign(new Error(`Referenced asset ${id} cannot be read from storage`), { statusCode: 422 }); }
    if (!contents || contents.length !== asset.byteLength || createHash('sha256').update(contents).digest('hex') !== asset.sha256) throw Object.assign(new Error(`Referenced asset ${id} failed integrity verification`), { statusCode: 422 });
    return { ...asset, contents };
  }));
}
