import assert from 'node:assert/strict';
import test from 'node:test';
import { addNode, findNode, moveNode, removeNode, samplePage, updateNode, validateDocument } from '@builder/document';
import { exportHtml } from '@builder/exporters';
import { createPaletteNode } from '../src/palette.js';
import { insertSuggestion, layoutSuggestions, suggestionLocation } from '../src/suggestions.js';

test('all suggestions insert valid, ordinary nodes with unique IDs into their regions', () => {
  let page = structuredClone(samplePage);
  for (const item of layoutSuggestions) {
    const result = insertSuggestion(page, item.key, item.region);
    page = result.document;
    const inserted = findNode(page, result.insertedIds[0]);
    assert.equal(inserted.region, item.region);
    assert.ok(['Section', 'Container', 'Layout', 'Navigation'].includes(inserted.node.type));
    assert.equal('suggestion' in inserted.node, false);
  }
  validateDocument(page);
  assert.match(exportHtml(page)['index.html'], /Gallery image one/);
  const twice = insertSuggestion(page, 'main-gallery', 'main');
  validateDocument(twice.document);
  assert.notEqual(twice.insertedIds[0], findNode(page, twice.insertedIds[0])?.node.id);
});

test('free composition needs no suggestion or container, and suggestions can be restructured', () => {
  let page = structuredClone(samplePage);
  page.regions = { header: [], main: [], footer: [] };
  const headerHeading = createPaletteNode('Heading');
  const headerLink = createPaletteNode('Link');
  const mainText = createPaletteNode('Text');
  const footerText = createPaletteNode('Text');
  page = addNode(page, 'header', 0, headerHeading);
  page = addNode(page, 'header', 1, headerLink);
  page = addNode(page, 'main', 0, mainText);
  page = addNode(page, 'footer', 0, footerText);
  assert.deepEqual(page.regions.main.map(node => node.type), ['Text']);
  assert.deepEqual(page.regions.header.map(node => node.type), ['Heading', 'Link']);
  assert.deepEqual(page.regions.footer.map(node => node.type), ['Text']);

  const result = insertSuggestion(page, 'footer-links', 'footer', footerText.id);
  page = result.document;
  const layoutId = result.insertedIds[0];
  assert.equal(findNode(page, layoutId).index, 1);
  const brandColumn = findNode(page, layoutId).node.children[0];
  const brandHeading = brandColumn.children[0];
  page = moveNode(page, brandHeading.id, 'footer', 0);
  page = updateNode(page, brandHeading.id, { props: { text: 'Restructured footer' }, styles: { mobile: { marginTop: '12px' } } });
  page = removeNode(page, brandColumn.id);
  assert.deepEqual(page.regions.footer.map(node => node.type), ['Heading', 'Text', 'Layout']);
  assert.equal(findNode(page, brandHeading.id).node.props.text, 'Restructured footer');
  assert.equal(findNode(page, brandColumn.id), null);
  assert.equal(suggestionLocation(page, 'header', brandHeading.id).parent, 'header');
  assert.match(exportHtml(page)['index.html'], /Restructured footer/);
});
