import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { samplePage } from '@builder/document';

const api = process.env.API_URL || 'http://127.0.0.1:3001/api';
const editor = process.env.EDITOR_URL || 'http://127.0.0.1:5173/';
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function request(path, options) {
  const response = await fetch(api + path, options);
  if (!response.ok) assert.fail(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

export async function openEditableSample(page) {
  const project = (await request('/projects', json('POST', { name: `Editor regression ${randomUUID()}` }))).project;
  try {
    const sample = (await request(`/projects/${project.id}/pages`, json('POST', { name: 'Editable fixture', path: '/', document: samplePage }))).page;
    await page.goto(editor);
    const projectSelect = page.getByRole('combobox', { name: 'Project' });
    await projectSelect.locator(`option[value="${project.id}"]`).waitFor({ state: 'attached' });
    await projectSelect.selectOption(project.id);
    const pageSelect = page.getByRole('combobox', { name: 'Page' });
    await pageSelect.locator(`option[value="${sample.id}"]`).waitFor({ state: 'attached' });
    await pageSelect.selectOption(sample.id);
    await page.getByRole('heading', { name: 'Make room for remarkable.' }).waitFor();
    return project.id;
  } catch (error) { await deleteEditableSample(project.id); throw error; }
}

export async function deleteEditableSample(projectId) {
  if (!projectId) return;
  const { project } = await request(`/projects/${projectId}`);
  await request(`/projects/${projectId}`, json('DELETE', { name: project.name, expectedVersion: project.version, expectedCounts: { pageCount: project.pageCount, revisionCount: project.revisionCount, assetCount: project.assetCount } }));
}
