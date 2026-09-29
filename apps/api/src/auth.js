import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { pool } from './db.js';

const scrypt = promisify(scryptCallback);
const sessionSeconds = 60 * 60 * 24 * 7;
export const authMode = process.env.AUTH_MODE || 'disabled';
if (process.env.NODE_ENV === 'production' && authMode !== 'local') throw new Error('Production requires AUTH_MODE=local');

export async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw Object.assign(new Error('Password must be 12–1024 characters'), { statusCode: 400 });
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || !stored) return false;
  const [salt, hex] = stored.split(':');
  if (!salt || !hex) return false;
  const expected = Buffer.from(hex, 'hex');
  const actual = await scrypt(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export async function createUser(email, password) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) throw new Error('Invalid email');
  const hash = await passwordHash(password);
  return (await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3) RETURNING id,email', [randomUUID(), normalized, hash])).rows[0];
}
export async function signIn(email, password) {
  const normalized = String(email || '').trim().toLowerCase();
  const user = (await pool.query('SELECT id,email,password_hash FROM users WHERE email=$1', [normalized])).rows[0];
  if (!user || !await verifyPassword(password, user.password_hash)) return null;
  const token = randomBytes(32).toString('base64url');
  await pool.query('DELETE FROM sessions WHERE expires_at<=now()');
  await pool.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval \'7 days\')', [tokenHash(token), user.id]);
  return { user: { id: user.id, email: user.email }, token };
}
export async function currentUser(token) {
  if (!token) return null;
  return (await pool.query('SELECT users.id,users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=$1 AND sessions.expires_at>now()', [tokenHash(token)])).rows[0] || null;
}
export async function signOut(token) { if (token) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash(token)]); }
export function cookie(token) {
  return `builder_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionSeconds}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
export function clearCookie() { return `builder_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`; }
export function sessionToken(request) { return /(?:^|;\s*)builder_session=([^;]+)/.exec(request.headers.cookie || '')?.[1] || null; }
export async function ownsProject(userId, projectId) {
  return Boolean((await pool.query('SELECT 1 FROM projects WHERE id=$1 AND owner_id=$2', [projectId, userId])).rowCount);
}
export async function ownsPage(userId, pageId) {
  return Boolean((await pool.query('SELECT 1 FROM pages JOIN projects ON projects.id=pages.project_id WHERE pages.id=$1 AND projects.owner_id=$2', [pageId, userId])).rowCount);
}
export async function ownsAsset(userId, assetId) {
  return Boolean((await pool.query('SELECT 1 FROM assets JOIN projects ON projects.id=assets.project_id WHERE assets.id=$1 AND projects.owner_id=$2', [assetId, userId])).rowCount);
}
