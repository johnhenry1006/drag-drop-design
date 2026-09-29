import { createUser } from './auth.js';
import { pool } from './db.js';
import { migrate } from './store.js';

try {
  await migrate();
  if (!process.env.BUILDER_USER_EMAIL || !process.env.BUILDER_USER_PASSWORD) throw new Error('Set BUILDER_USER_EMAIL and BUILDER_USER_PASSWORD for this command');
  const user = await createUser(process.env.BUILDER_USER_EMAIL, process.env.BUILDER_USER_PASSWORD);
  console.log(`Created user ${user.email}`);
} finally { await pool.end(); }
