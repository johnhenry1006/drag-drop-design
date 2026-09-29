import { createHash } from 'node:crypto';
import { assetBucket, assetStorageMode, getObject, putObject } from './object-store.js';
import { pool } from './db.js';

if (assetStorageMode() !== 's3') throw new Error('Set ASSET_STORE=s3 before backfilling assets');
let moved = 0;
try {
  for (;;) {
    const rows = (await pool.query('SELECT id, project_id, media_type, sha256, contents FROM assets WHERE object_key IS NULL AND contents IS NOT NULL ORDER BY id LIMIT 100')).rows;
    if (!rows.length) break;
    for (const asset of rows) {
      if (createHash('sha256').update(asset.contents).digest('hex') !== asset.sha256) throw new Error(`Asset checksum mismatch: ${asset.id}`);
      const key = `projects/${asset.project_id}/assets/${asset.id}`;
      const bucket = assetBucket();
      await putObject(key, asset.contents, asset.media_type, bucket);
      if (createHash('sha256').update(await getObject(key, bucket)).digest('hex') !== asset.sha256) throw new Error(`Object checksum mismatch: ${asset.id}`);
      await pool.query('UPDATE assets SET object_key=$2, object_bucket=$3 WHERE id=$1 AND object_key IS NULL', [asset.id, key, bucket]);
      moved++;
    }
  }
  console.log(`Copied ${moved} assets to object storage; original database bytes retained`);
} finally { await pool.end(); }
