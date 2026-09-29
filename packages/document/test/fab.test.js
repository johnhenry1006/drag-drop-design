import assert from 'node:assert/strict';
import test from 'node:test';
import { addNode, samplePage, updateNode, validateDocument, safeFabHref } from '../src/index.js';
import { buildProjectFiles } from '../../exporters/src/project.js';
import { createPaletteNode, paletteItems } from '../../../apps/editor/src/palette.js';

test('FAB is a JSON leaf with bounded actions, links, placement and icon IDs', () => {
  let page = structuredClone(samplePage);
  const fab = createPaletteNode('Floating Action Button');
  assert.ok(paletteItems.some(item => item.key === fab.type && item.group === 'Navigation'));
  assert.equal(fab.children, undefined);
  page = addNode(page, 'main', 0, fab);
  assert.equal(validateDocument(JSON.parse(JSON.stringify(page))).regions.main[0].props.visibleMobile, false);
  assert.equal(updateNode(page, fab.id, { props: { action: 'link', href: '/about', visibleMobile: true } }).regions.main[0].props.href, '/about');
  assert.equal(safeFabHref('#section_1'), false);
  assert.ok(safeFabHref('https://example.com/path'));
  for (const value of ['javascript:alert(1)', '//evil.example', 'https://user:pass@example.com', 'https://localhost/api', 'http://example.com', '/a b']) assert.equal(safeFabHref(value), false);
  assert.throws(() => updateNode(page, fab.id, { props: { action: 'link' } }), /must match the selected action/);
  assert.throws(() => updateNode(page, fab.id, { props: { href: 'https://example.com' } }), /must match the selected action/);
  assert.throws(() => updateNode(page, fab.id, { props: { icon: 'untrusted' } }), /icon is invalid/);
  assert.throws(() => updateNode(page, fab.id, { props: { offset: 500 } }), /offset is invalid/);
});

test('FAB exports scroll runtime and validates internal page routes', () => {
  let page = structuredClone(samplePage);
  const fab = createPaletteNode('Floating Action Button');
  fab.props.label = 'Back <top> & up';
  page = addNode(page, 'footer', 0, fab);
  const pages = [{ id: 'page_fab', name: 'FAB', path: '/', document: page }];
  for (const target of ['html', 'react', 'vue']) {
    const files = buildProjectFiles(target, pages);
    const source = files[target === 'html' ? 'index.html' : target === 'react' ? 'src/pages.jsx' : 'src/pages.js'];
    assert.match(source, /builder-fab/);
    assert.match(files[target === 'html' ? 'styles.css' : 'src/styles.css'], /data-visible-mobile/);
    if (target === 'html') {
      assert.match(source, /Back &lt;top&gt; &amp; up/);
      assert.match(files['fab.js'], /scrollTo/);
      assert.match(files['build.js'], /fab\.js/);
    } else assert.match(source, /scrollTo/);
  }
  page = updateNode(page, fab.id, { props: { action: 'link', href: '/missing' } });
  assert.throws(() => buildProjectFiles('html', [{ ...pages[0], document: page }]), error => error.issues.some(issue => /No page exists at \/missing/.test(issue.message)));
  page = updateNode(page, fab.id, { props: { href: 'https://example.com/path' } });
  assert.match(buildProjectFiles('html', [{ ...pages[0], document: page }])['index.html'], /https:\/\/example.com\/path/);
});
