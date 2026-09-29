import assert from 'node:assert/strict';
import test from 'node:test';
import { addNode, moveNode, updateNode, validateDocument } from '../src/index.js';
import { exportHtml, exportReact, exportVue } from '../../exporters/src/index.js';

const styles = () => ({ desktop: {}, tablet: {}, mobile: {} });
const node = (id, type, props, children) => ({ id, type, props, styles: styles(), ...(children ? { children } : {}) });

test('Card accepts nested content in any region and exports through all three renderers', () => {
  let page = { schemaVersion: 1, id: 'page_card', type: 'Page', props: { title: 'Cards' }, styles: styles(), regions: { header: [], main: [], footer: [] } };
  page = addNode(page, 'main', 0, node('card_a', 'Card', { label: 'Feature' }, [node('heading_a', 'Heading', { text: 'Hello', level: 2 }), node('link_a', 'Link', { text: 'Read', href: '#' })]));
  page = updateNode(page, 'card_a', { styles: { mobile: { padding: '12px' } }, advancedCss: { desktop: 'letter-spacing: .1em;' } });
  page = moveNode(page, 'card_a', 'footer', 0);
  assert.equal(validateDocument(JSON.parse(JSON.stringify(page))).regions.footer[0].type, 'Card');
  assert.match(exportHtml(page)['index.html'], /<footer[^>]*><article[^>]*><h2[^>]*>Hello<\/h2>/);
  assert.match(exportReact(page)['src/App.jsx'], /<article[^>]*><h2[^>]*>/);
  assert.match(exportVue(page)['src/main.js'], /h\("article"/);
  assert.match(exportHtml(page)['styles.css'], /12px/);
});
