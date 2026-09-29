import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizePagePath, samplePage, validateDocument } from '@builder/document';
import { pool } from './db.js';
import { assetBucket, assetStorageMode, deleteObject, getObject, putObject } from './object-store.js';

const migrations = ['001_baseline', '002_accounts_storage', '003_asset_bucket'].map((name, index) => ({ version: index + 1, path: fileURLToPath(new URL(`./migrations/${name}.sql`, import.meta.url)) }));
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
      await client.query('INSERT INTO pages(id,project_id,name,path,document) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(id) DO NOTHING', [samplePageId, sampleProjectId, 'Sample page', '/', JSON.stringify(samplePage)]);
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

const projectColumns = 'id, name, created_at AS "createdAt", updated_at AS "updatedAt"';
const pageColumns = 'id, project_id AS "projectId", name, path, document, revision, created_at AS "createdAt", updated_at AS "updatedAt"';
const assetColumns = 'id, project_id AS "projectId", filename, media_type AS "mediaType", byte_length AS "byteLength", sha256, created_at AS "createdAt"';

export async function listProjects(ownerId = null) { return (await pool.query(`SELECT ${projectColumns} FROM projects WHERE ($1::uuid IS NULL OR owner_id=$1) ORDER BY created_at, id`, [ownerId])).rows; }
export async function getProject(id) { return (await pool.query(`SELECT ${projectColumns} FROM projects WHERE id=$1`, [id])).rows[0] || null; }
export async function createProject(name, ownerId = null) {
  return (await pool.query(`INSERT INTO projects(id,name,owner_id) VALUES($1,$2,$3) RETURNING ${projectColumns}`, [randomUUID(), validName(name, 'Project name'), ownerId])).rows[0];
}
export async function updateProject(id, name) {
  return (await pool.query(`UPDATE projects SET name=$2, updated_at=now() WHERE id=$1 RETURNING ${projectColumns}`, [id, validName(name, 'Project name')])).rows[0] || null;
}

export async function listPages(projectId) {
  return (await pool.query('SELECT id, project_id AS "projectId", name, path, revision, created_at AS "createdAt", updated_at AS "updatedAt" FROM pages WHERE project_id=$1 ORDER BY created_at, id', [projectId])).rows;
}
export async function getPage(id) { return (await pool.query(`SELECT ${pageColumns} FROM pages WHERE id=$1`, [id])).rows[0] || null; }

export async function createPage(projectId, name, document, path = '/') {
  const pageName = validName(name, 'Page name');
  const pagePath = validPath(path);
  const pageDocument = validDocument(document);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`INSERT INTO pages(id,project_id,name,path,document) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING ${pageColumns}`, [randomUUID(), projectId, pageName, pagePath, JSON.stringify(pageDocument)]);
    const page = result.rows[0];
    await client.query('INSERT INTO page_revisions(page_id,revision,document) VALUES($1,1,$2::jsonb)', [page.id, JSON.stringify(pageDocument)]);
    await client.query('COMMIT');
    return page;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function savePage(id, expectedRevision, document, name, path) {
  const pageDocument = validDocument(document);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw Object.assign(new Error('expectedRevision must be a positive integer'), { statusCode: 400 });
  const pageName = name === undefined ? undefined : validName(name, 'Page name');
  const pagePath = path === undefined ? undefined : validPath(path);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`UPDATE pages SET document=$3::jsonb, name=COALESCE($4,name), path=COALESCE($5,path), revision=revision+1, updated_at=now() WHERE id=$1 AND revision=$2 RETURNING ${pageColumns}`, [id, expectedRevision, JSON.stringify(pageDocument), pageName ?? null, pagePath ?? null]);
    if (!result.rowCount) { await client.query('ROLLBACK'); return { page: null, current: await getPage(id) }; }
    const page = result.rows[0];
    await client.query('INSERT INTO page_revisions(page_id,revision,document) VALUES($1,$2,$3::jsonb)', [id, page.revision, JSON.stringify(pageDocument)]);
    await client.query('COMMIT');
    return { page };
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
  return savePage(id, expectedRevision, previous.document);
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
  return asset.objectKey ? getObject(asset.objectKey, asset.objectBucket || assetBucket()) : asset.contents;
}

export async function projectExportData(projectId, includeContents = true) {
  const [pages, assets] = await Promise.all([
    pool.query('SELECT id, name, path, document FROM pages WHERE project_id=$1 ORDER BY path, id', [projectId]),
    pool.query(`SELECT ${assetColumns}, contents, object_key AS "objectKey", object_bucket AS "objectBucket" FROM assets WHERE project_id=$1`, [projectId])
  ]);
  const totalBytes = assets.rows.reduce((sum, asset) => sum + asset.byteLength, 0);
  if (pages.rows.length > 100 || (includeContents && totalBytes > 100 * 1024 * 1024)) throw Object.assign(new Error('Export exceeds the page or asset size limit'), { statusCode: 413 });
  return { pages: pages.rows, assets: includeContents ? await Promise.all(assets.rows.map(async asset => ({ ...asset, contents: await assetContents(asset) }))) : assets.rows };
}
