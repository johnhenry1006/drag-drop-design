import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { samplePage, validateDocument } from '@builder/document';
import { pool } from './db.js';

const schema = fileURLToPath(new URL('./schema.sql', import.meta.url));
export const assetUrl = id => `/api/assets/${id}/content`;

export const sampleProjectId = '00000000-0000-4000-8000-000000000001';
export const samplePageId = '00000000-0000-4000-8000-000000000002';

export async function migrate() {
  await pool.query(await readFile(schema, 'utf8'));
  await pool.query('INSERT INTO projects(id,name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [sampleProjectId, 'Sample project']);
  await pool.query('INSERT INTO pages(id,project_id,name,document) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(id) DO NOTHING', [samplePageId, sampleProjectId, 'Sample page', JSON.stringify(samplePage)]);
  await pool.query('INSERT INTO page_revisions(page_id,revision,document) VALUES($1,1,$2::jsonb) ON CONFLICT(page_id,revision) DO NOTHING', [samplePageId, JSON.stringify(samplePage)]);
}

export function validName(value, label = 'Name') {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) throw Object.assign(new Error(`${label} must be 1–120 characters`), { statusCode: 400 });
  return value.trim();
}

export function validDocument(value) {
  try { return validateDocument(value); }
  catch (error) { throw Object.assign(new Error(`Invalid Page document: ${error.message}`), { statusCode: 400 }); }
}

const projectColumns = 'id, name, created_at AS "createdAt", updated_at AS "updatedAt"';
const pageColumns = 'id, project_id AS "projectId", name, document, revision, created_at AS "createdAt", updated_at AS "updatedAt"';
const assetColumns = 'id, project_id AS "projectId", filename, media_type AS "mediaType", byte_length AS "byteLength", sha256, created_at AS "createdAt"';

export async function listProjects() { return (await pool.query(`SELECT ${projectColumns} FROM projects ORDER BY created_at, id`)).rows; }
export async function getProject(id) { return (await pool.query(`SELECT ${projectColumns} FROM projects WHERE id=$1`, [id])).rows[0] || null; }
export async function createProject(name) {
  return (await pool.query(`INSERT INTO projects(id,name) VALUES($1,$2) RETURNING ${projectColumns}`, [randomUUID(), validName(name, 'Project name')])).rows[0];
}
export async function updateProject(id, name) {
  return (await pool.query(`UPDATE projects SET name=$2, updated_at=now() WHERE id=$1 RETURNING ${projectColumns}`, [id, validName(name, 'Project name')])).rows[0] || null;
}

export async function listPages(projectId) {
  return (await pool.query('SELECT id, project_id AS "projectId", name, revision, created_at AS "createdAt", updated_at AS "updatedAt" FROM pages WHERE project_id=$1 ORDER BY created_at, id', [projectId])).rows;
}
export async function getPage(id) { return (await pool.query(`SELECT ${pageColumns} FROM pages WHERE id=$1`, [id])).rows[0] || null; }

export async function createPage(projectId, name, document) {
  const pageName = validName(name, 'Page name');
  const pageDocument = validDocument(document);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`INSERT INTO pages(id,project_id,name,document) VALUES($1,$2,$3,$4::jsonb) RETURNING ${pageColumns}`, [randomUUID(), projectId, pageName, JSON.stringify(pageDocument)]);
    const page = result.rows[0];
    await client.query('INSERT INTO page_revisions(page_id,revision,document) VALUES($1,1,$2::jsonb)', [page.id, JSON.stringify(pageDocument)]);
    await client.query('COMMIT');
    return page;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function savePage(id, expectedRevision, document, name) {
  const pageDocument = validDocument(document);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw Object.assign(new Error('expectedRevision must be a positive integer'), { statusCode: 400 });
  const pageName = name === undefined ? undefined : validName(name, 'Page name');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`UPDATE pages SET document=$3::jsonb, name=COALESCE($4,name), revision=revision+1, updated_at=now() WHERE id=$1 AND revision=$2 RETURNING ${pageColumns}`, [id, expectedRevision, JSON.stringify(pageDocument), pageName ?? null]);
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
  const sha256 = createHash('sha256').update(contents).digest('hex');
  const result = await pool.query(`INSERT INTO assets(id,project_id,filename,media_type,byte_length,sha256,contents) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${assetColumns}`, [randomUUID(), projectId, filename, mediaType, contents.length, sha256, contents]);
  return { ...result.rows[0], url: assetUrl(result.rows[0].id) };
}
export async function getAsset(id) {
  return (await pool.query(`SELECT ${assetColumns}, contents FROM assets WHERE id=$1`, [id])).rows[0] || null;
}
