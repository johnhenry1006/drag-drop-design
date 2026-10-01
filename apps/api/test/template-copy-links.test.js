import assert from 'node:assert/strict';
import test from 'node:test';
import { systemSamples } from '../src/system-samples.js';
import { cloneTemplateDocument, nodeIdMap } from '../src/template-copy.js';

test('copy-set links remap to copied pages and missing sample dependencies are reported', () => {
  const [first, second] = structuredClone(systemSamples);
  const nav = first.document.regions.header[0].children.flatMap(node => node.children || []);
  const byId = id => nav.find(node => node.id === id);
  byId('nav_work').props.href = '';
  byId('nav_work').props.targetPageId = second.id;
  byId('nav_work').props.anchor = 'hero';
  byId('nav_about').props.href = '/responsive-showcase#hero';
  const copiedId = '00000000-0000-4000-8000-000000000099';
  const sourcePages = [first, second];
  const context = {
    pageIds: new Map([[first.id, '00000000-0000-4000-8000-000000000098'], [second.id, copiedId]]),
    paths: new Map([[first.id, '/home-copy'], [second.id, '/showcase-copy']]),
    samplesById: new Map(sourcePages.map(page => [page.id, page])),
    samplesByPath: new Map(sourcePages.map(page => [page.path, page])),
    destinationPaths: new Set(),
    assetIds: new Map(),
    nodeIdsByPage: new Map(sourcePages.map(page => [page.id, nodeIdMap(page.document)]))
  };
  const copied = cloneTemplateDocument(first, context);
  const copiedNav = copied.regions.header[0].children.flatMap(node => node.children || []);
  const target = copiedNav.find(node => node.props.targetPageId === copiedId);
  assert.equal(target.props.anchor, context.nodeIdsByPage.get(second.id).get('hero'));
  assert.equal(copiedNav.find(node => node.props.href?.startsWith('/showcase-copy')).props.href, `/showcase-copy#${context.nodeIdsByPage.get(second.id).get('hero')}`);
  assert.throws(() => cloneTemplateDocument(first, { ...context, pageIds: new Map([[first.id, context.pageIds.get(first.id)]]), paths: new Map([[first.id, '/home-copy']]) }), /Copy these linked sample pages too/);
});
