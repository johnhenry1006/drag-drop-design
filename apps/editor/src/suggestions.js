import { addNode, findNode, registry, regions } from '@builder/document';
import { createPaletteNode } from './palette.js';

function node(type, props = {}, desktop = {}, mobile = {}, children = []) {
  const created = createPaletteNode(type);
  created.props = { ...registry[type].defaults, ...props };
  created.styles = { desktop, tablet: {}, mobile };
  if (created.children) created.children = children;
  return created;
}

const image = (label, color) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><rect width="600" height="400" fill="${color}"/><circle cx="430" cy="120" r="90" fill="#ffffff55"/><path d="M0 335 170 160 310 290 425 200 600 370v30H0" fill="#ffffff99"/></svg>`;
  return node('Image', { src: `data:image/svg+xml,${encodeURIComponent(svg)}`, alt: label }, { width: '100%', borderRadius: '16px' });
};

export const layoutSuggestions = [
  { key: 'header-navigation', region: 'header', label: 'Navigation', description: 'Logo and editable links' },
  { key: 'header-banner', region: 'header', label: 'Banner', description: 'Heading, text, and action' },
  { key: 'main-hero', region: 'main', label: 'Hero', description: 'Two flexible columns' },
  { key: 'main-columns', region: 'main', label: 'Two columns', description: 'Independent content areas' },
  { key: 'main-gallery', region: 'main', label: 'Gallery', description: 'Three image cards' },
  { key: 'footer-links', region: 'footer', label: 'Links and contact', description: 'Three editable columns' }
];

export function createSuggestion(key) {
  switch (key) {
    case 'header-navigation': return [node('Navigation', { label: 'Site navigation' }, { display: 'flex', alignItems: 'center', gap: '24px', padding: '18px 24px' }, { flexWrap: 'wrap' }, [
      node('Heading', { text: 'Your brand', level: 2 }, { fontSize: '20px', margin: '0', marginRight: 'auto' }),
      node('Link', { text: 'About', href: '#about' }, { color: '#22395f' }),
      node('Link', { text: 'Work', href: '#work' }, { color: '#22395f' }),
      node('Link', { text: 'Contact', href: '#contact' }, { color: '#22395f' })
    ])];
    case 'header-banner': return [node('Section', { label: 'Banner' }, { padding: '36px 24px', backgroundColor: '#eaf0ff' }, { padding: '24px 18px' }, [
      node('Heading', { text: 'A space for your story', level: 1 }, { fontSize: '36px', margin: '0 0 12px' }, { fontSize: '28px' }),
      node('Text', { text: 'Make this banner your own.' }, { margin: '0 0 18px' }),
      node('Button', { text: 'Get started', href: '#start' }, { display: 'inline-block', padding: '10px 16px', backgroundColor: '#385dca', color: '#fff', borderRadius: '8px' })
    ])];
    case 'main-hero': return [node('Layout', { label: 'Hero' }, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '28px', padding: '48px 24px' }, { gridTemplateColumns: '1fr', padding: '24px 18px' }, [
      node('Container', { label: 'Hero copy' }, {}, {}, [
        node('Heading', { text: 'Build something memorable', level: 1 }, { fontSize: '42px', margin: '0 0 18px' }, { fontSize: '30px' }),
        node('Text', { text: 'Edit every part of this page.' }, { lineHeight: '1.6' }),
        node('Button', { text: 'Explore', href: '#explore' }, { display: 'inline-block', padding: '10px 16px', backgroundColor: '#385dca', color: '#fff', borderRadius: '8px' })
      ]),
      node('Container', { label: 'Hero visual' }, { minHeight: '240px', backgroundColor: '#dfe7ff', borderRadius: '20px' })
    ])];
    case 'main-columns': return [node('Layout', { label: 'Two columns' }, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', padding: '24px' }, { gridTemplateColumns: '1fr', padding: '18px' }, [
      node('Container', { label: 'First column' }, { padding: '18px' }, {}, [node('Heading', { text: 'First column', level: 2 }, { margin: '0 0 12px' }), node('Text', { text: 'Add your content here.' })]),
      node('Container', { label: 'Second column' }, { padding: '18px' }, {}, [node('Heading', { text: 'Second column', level: 2 }, { margin: '0 0 12px' }), node('Text', { text: 'Move or replace these nodes.' })])
    ])];
    case 'main-gallery': return [node('Layout', { label: 'Gallery' }, { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '18px', padding: '24px' }, { gridTemplateColumns: '1fr', padding: '18px' }, [
      ...['Gallery image one', 'Gallery image two', 'Gallery image three'].map((label, index) => node('Container', { label: `Gallery card ${index + 1}` }, {}, {}, [image(label, ['#dce8ff', '#f7dfeb', '#daf1e5'][index]), node('Text', { text: `Caption ${index + 1}` }, { margin: '10px 0' })]))
    ])];
    case 'footer-links': return [node('Layout', { label: 'Footer links and contact' }, { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '28px', padding: '36px 24px', color: '#fff' }, { gridTemplateColumns: '1fr', padding: '24px 18px' }, [
      node('Container', { label: 'Brand column' }, {}, {}, [node('Heading', { text: 'Your brand', level: 2 }, { fontSize: '20px', margin: '0 0 12px' }), node('Text', { text: 'A short note about your work.' })]),
      node('Navigation', { label: 'Footer navigation' }, { display: 'flex', flexDirection: 'column', gap: '10px' }, {}, [node('Link', { text: 'About', href: '#about' }, { color: '#fff' }), node('Link', { text: 'Work', href: '#work' }, { color: '#fff' }), node('Link', { text: 'Contact', href: '#contact' }, { color: '#fff' })]),
      node('Container', { label: 'Contact column' }, {}, {}, [node('Heading', { text: 'Say hello', level: 3 }, { fontSize: '18px', margin: '0 0 12px' }), node('Link', { text: 'hello@example.com', href: 'mailto:hello@example.com' }, { color: '#fff' })])
    ])];
    default: throw new Error(`Unknown layout suggestion ${key}`);
  }
}

export function suggestionLocation(document, region, selectedId) {
  if (!regions.includes(region)) throw new Error(`Unknown region ${region}`);
  const selected = selectedId ? findNode(document, selectedId) : null;
  if (!selected || selected.region !== region) return { parent: region, index: document.regions[region].length };
  if (registry[selected.node.type].kind === 'container') return { parent: selectedId, index: selected.node.children.length };
  return { parent: selected.parentId || region, index: selected.index + 1 };
}

export function insertSuggestion(document, key, region, selectedId = null) {
  const suggestion = layoutSuggestions.find(item => item.key === key);
  if (!suggestion || suggestion.region !== region) throw new Error(`Suggestion ${key} is unavailable in ${region}`);
  const { parent, index } = suggestionLocation(document, region, selectedId);
  const nodes = createSuggestion(key);
  let next = document;
  nodes.forEach((created, offset) => { next = addNode(next, parent, index + offset, created); });
  return { document: next, insertedIds: nodes.map(created => created.id), parent };
}
