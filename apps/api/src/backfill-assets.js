import { createHash } from 'node:crypto';
import { assetStorageMode, putObject } from './object-store.js';
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
      await putObject(key, asset.contents, asset.media_type);
      await pool.query('UPDATE assets SET object_key=$2, contents=NULL WHERE id=$1 AND object_key IS NULL', [asset.id, key]);
      moved++;
    }
  }
  console.log(`Backfilled ${moved} assets to object storage`);
} finally { await pool.end(); }
