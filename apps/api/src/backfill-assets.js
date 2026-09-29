import { createHash } from 'node:crypto';
import { assetBucket, assetStorageMode, checkObjectStore, getObject, putObject } from './object-store.js';
import { pool } from './db.js';
import { assetContents, getAsset } from './store.js';

const action = process.argv[2] || '--migrate';
if (!['--dry-run', '--migrate', '--verify', '--rollback'].includes(action)) throw new Error('Use --dry-run, --migrate, --verify, or --rollback');
if (assetStorageMode() !== 's3') throw new Error('Set ASSET_STORE=s3 before migrating assets');

const checksum = bytes => createHash('sha256').update(bytes).digest('hex');
const verifyBytes = (asset, bytes, label) => {
  if (!bytes || bytes.length !== asset.byte_length || checksum(bytes) !== asset.sha256) throw new Error(`${label} checksum or length mismatch for asset ${asset.id}`);
};

async function verifyLinked(asset) {
  verifyBytes(asset, asset.contents, 'Original database bytes');
  const current = await getAsset(asset.id);
  verifyBytes(asset, await assetContents(current), 'API asset read');
}

async function main() {
  const bucket = assetBucket();
  const summary = (await pool.query(`SELECT
    count(*) FILTER (WHERE contents IS NOT NULL AND object_key IS NULL) AS pending,
    count(*) FILTER (WHERE contents IS NOT NULL AND object_key IS NOT NULL) AS dual_backed,
    count(*) FILTER (WHERE contents IS NULL AND object_key IS NOT NULL) AS object_only
    FROM assets`)).rows[0];
  if (action === '--dry-run') {
    const rows = (await pool.query('SELECT id, byte_length, sha256, contents FROM assets WHERE contents IS NOT NULL AND object_key IS NULL ORDER BY id')).rows;
    for (const asset of rows) verifyBytes(asset, asset.contents, 'Original database bytes');
    console.log(JSON.stringify({ action: 'dry-run', ...summary, sourceChecksumsValid: rows.length, changes: 0 }));
    return;
  }
  if (action !== '--rollback') await checkObjectStore();
  if (action === '--rollback') {
    const rows = (await pool.query('SELECT id, byte_length, sha256, contents FROM assets WHERE contents IS NOT NULL AND object_key IS NOT NULL AND object_bucket=$1 ORDER BY id', [bucket])).rows;
    for (const asset of rows) {
      verifyBytes(asset, asset.contents, 'Original database bytes');
      await pool.query('UPDATE assets SET object_key=NULL, object_bucket=NULL WHERE id=$1 AND contents IS NOT NULL AND object_bucket=$2', [asset.id, bucket]);
    }
    console.log(JSON.stringify({ action: 'rollback', restoredDatabaseReads: rows.length, originalBytesRetained: true }));
    return;
  }
  let copied = 0;
  if (action === '--migrate') {
    for (;;) {
      const rows = (await pool.query('SELECT id, project_id, media_type, byte_length, sha256, contents FROM assets WHERE object_key IS NULL AND contents IS NOT NULL ORDER BY id LIMIT 100')).rows;
      if (!rows.length) break;
      for (const asset of rows) {
        verifyBytes(asset, asset.contents, 'Original database bytes');
        const key = `projects/${asset.project_id}/assets/${asset.id}`;
        await putObject(key, asset.contents, asset.media_type, bucket);
        verifyBytes(asset, await getObject(key, bucket), 'Uploaded object');
        const linked = await pool.query('UPDATE assets SET object_key=$2, object_bucket=$3 WHERE id=$1 AND object_key IS NULL AND contents IS NOT NULL', [asset.id, key, bucket]);
        if (!linked.rowCount) continue;
        try { await verifyLinked(asset); }
        catch (error) {
          await pool.query('UPDATE assets SET object_key=NULL, object_bucket=NULL WHERE id=$1 AND object_key=$2 AND contents IS NOT NULL', [asset.id, key]);
          throw error;
        }
        copied++;
      }
    }
  }
  const linked = (await pool.query('SELECT id, byte_length, sha256, contents FROM assets WHERE contents IS NOT NULL AND object_key IS NOT NULL AND object_bucket=$1 ORDER BY id', [bucket])).rows;
  for (const asset of linked) await verifyLinked(asset);
  console.log(JSON.stringify({ action: action.slice(2), copied, verifiedApiReads: linked.length, originalBytesRetained: true }));
}

try { await main(); }
finally { await pool.end(); }
