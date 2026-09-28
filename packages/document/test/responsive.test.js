import assert from 'node:assert/strict';
import test from 'node:test';
import { documentCss, findNode, parseAdvancedCss, samplePage, updateNode, validateDocument } from '../src/index.js';
import { exportHtml, exportReact, exportVue } from '../../exporters/src/index.js';

test('mobile grid override and nested styles cascade without changing a sibling', () => {
  let page = structuredClone(samplePage);
  page = updateNode(page, 'hero_inner', { styles: { desktop: { gridTemplateColumns: '1fr 1fr' }, mobile: { gridTemplateColumns: '1fr' } } });
  page = updateNode(page, 'hero_copy', { styles: { mobile: { backgroundColor: '#ffeedd', paddingLeft: '18px' } }, advancedCss: { mobile: 'letter-spacing: .08em; border-radius: 12px;' } });
  assert.deepEqual(findNode(page, 'hero_inner').node.styles.mobile, { gridTemplateColumns: '1fr' });
  assert.equal(findNode(page, 'hero_art').node.styles.mobile.backgroundColor, undefined);
  assert.equal(findNode(page, 'hero_copy').node.advancedCss.mobile, 'letter-spacing: .08em; border-radius: 12px;');

  const desktop = documentCss(page, undefined, 'desktop');
  const mobile = documentCss(page, undefined, 'mobile');
  assert.match(desktop, /\[data-node-id="hero_inner"\]\{[^}]*grid-template-columns:1fr 1fr/);
  assert.doesNotMatch(desktop, /grid-template-columns:1fr\}/);
  assert.match(mobile, /\[data-node-id="hero_inner"\]\{grid-template-columns:1fr\}/);
  assert.match(mobile, /\[data-node-id="hero_copy"\]\{background-color:#ffeedd;padding-left:18px;letter-spacing:\.08em;border-radius:12px\}/);
  assert.doesNotMatch(mobile, /\[data-node-id="hero_art"\]\{[^}]*#ffeedd/);

  const responsive = documentCss(page);
  assert.match(responsive, /@media \(max-width: 600px\)\{[^]*\[data-node-id="hero_inner"\]\{grid-template-columns:1fr\}/);
  for (const exported of [exportHtml(page)['styles.css'], exportReact(page)['src/styles.css'], exportVue(page)['src/styles.css']]) {
    assert.match(exported, /@media \(max-width: 600px\)\{[^]*\.n-hero_inner\{grid-template-columns:1fr\}/);
    assert.match(exported, /\.n-hero_copy\{background-color:#ffeedd;padding-left:18px;letter-spacing:\.08em;border-radius:12px\}/);
    assert.doesNotMatch(exported, /\.n-hero_art\{[^}]*#ffeedd/);
  }

  const cleared = updateNode(page, 'hero_copy', { styles: { mobile: { backgroundColor: null } }, advancedCss: { mobile: null } });
  assert.equal(findNode(cleared, 'hero_copy').node.styles.mobile.backgroundColor, undefined);
  assert.equal(findNode(cleared, 'hero_copy').node.advancedCss, undefined);
});

test('all exporters retain edited content and element-specific properties', () => {
  let page = structuredClone(samplePage);
  page = updateNode(page, 'hero_title', { props: { text: 'Edited heading', level: 2 } });
  page = updateNode(page, 'hero_action', { props: { text: 'See projects', href: '#work' } });
  const html = exportHtml(page)['index.html'];
  const react = exportReact(page)['src/App.jsx'];
  const vue = exportVue(page)['src/main.js'];
  assert.match(html, /<h2 class="n-hero_title">Edited heading<\/h2>/);
  assert.match(react, /<h2 className=\{"n-hero_title"\}>\{"Edited heading"\}<\/h2>/);
  assert.match(vue, /h\("h2",\{"class":"n-hero_title"\},"Edited heading"\)/);
  for (const output of [html, react, vue]) assert.match(output, /See projects/);
});

test('Advanced CSS accepts safe declarations and rejects selectors, resources, and invalid values', () => {
  assert.equal(parseAdvancedCss('color: red; padding: 12px;'), 'color:red;padding:12px');
  for (const source of ['body { color:red }', '@import "evil.css";', 'color: nope;', 'background-color: url(https://example.com/x)']) {
    assert.throws(() => parseAdvancedCss(source));
  }
  const page = structuredClone(samplePage);
  page.regions.main[0].advancedCss = { mobile: 'color: nope' };
  assert.throws(() => validateDocument(page), /advancedCss.mobile/);
});
