export async function api(path, options = {}) {
  let response;
  try { response = await fetch(`/api${path}`, options); }
  catch { throw new Error('Network error. Check that the API and PostgreSQL are running.'); }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `API returned ${response.status}`);
    error.status = response.status;
    error.currentRevision = payload.currentRevision;
    error.references = payload.references;
    throw error;
  }
  return payload;
}

export const jsonOptions = (method, value) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });

export async function uploadImage(projectId, file) {
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, GIF, or WebP image.');
  return (await api(`/projects/${projectId}/assets`, {
    method: 'POST',
    headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) },
    body: file
  })).asset;
}
