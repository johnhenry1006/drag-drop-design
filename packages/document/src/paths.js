export function normalizePagePath(value) {
  if (typeof value !== 'string') throw new Error('Page path must be text');
  const path = value.trim().toLowerCase().replace(/\/$/, '') || '/';
  if (!/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/.test(path)) throw new Error('Page path must use / and lowercase letters, numbers, or hyphens');
  return path;
}
