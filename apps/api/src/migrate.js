import { pool } from './db.js';
import { migrate } from './store.js';

try { await migrate(); console.log('Database schema ready'); }
finally { await pool.end(); }
