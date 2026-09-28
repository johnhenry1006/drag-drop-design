import assert from 'node:assert/strict';
import test from 'node:test';
import { samplePage } from '../src/index.js';
import { exportHtml, exportReact, exportVue } from '../../exporters/src/index.js';

test('all targets contain the sample content, semantic regions, and stable classes', () => {
  const html = exportHtml(samplePage);
  const react = exportReact(samplePage);
  const vue = exportVue(samplePage);
  for (const phrase of ['Make room for remarkable.', 'Built with purpose.', 'hello@northstar.example']) {
    assert.ok(html['index.html'].includes(phrase));
    assert.ok(react['src/App.jsx'].includes(phrase));
    assert.ok(vue['src/main.js'].includes(phrase));
  }
  assert.match(html['index.html'], /<header class="region-header">/);
  assert.match(react['src/App.jsx'], /<main className="region-main">/);
  assert.match(vue['src/main.js'], /h\('footer'/);
  for (const css of [html['styles.css'], react['src/styles.css'], vue['src/styles.css']]) {
    assert.match(css, /\.n-hero_title\{/);
    assert.match(css, /\.n-footer_grid\{/);
  }
});

test('exporter names an unsupported property instead of dropping it', () => {
  const page = structuredClone(samplePage);
  page.regions.main[2].styles.desktop.backdropFilter = 'blur(2px)';
  for (const exporter of [exportHtml, exportReact, exportVue]) {
    assert.throws(() => exporter(page), /backdropFilter on node work_heading at desktop/);
  }
  const unknownProp = structuredClone(samplePage);
  unknownProp.regions.main[2].props.subtitle = 'Unexpected';
  assert.throws(() => exportHtml(unknownProp), /unsupported property subtitle/);
});
