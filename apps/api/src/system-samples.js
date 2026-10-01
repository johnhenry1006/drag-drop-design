import { samplePage, validateDocument } from '@builder/document';

export const systemProject = Object.freeze({ id: '00000000-0000-4000-8000-000000000001', key: 'reference-templates', name: 'Sample project' });
export const northstarPageId = '00000000-0000-4000-8000-000000000002';
export const showcasePageId = '00000000-0000-4000-8000-000000000003';
export const showcaseAssetId = '00000000-0000-4000-8000-000000000004';

const showcase = structuredClone(samplePage);
showcase.id = 'page_responsive_showcase';
showcase.props.title = 'Northstar Responsive Showcase';
const visit = (node, id) => node.id === id ? node : node.children?.map(child => visit(child, id)).find(Boolean);
const find = id => Object.values(showcase.regions).flat().map(node => visit(node, id)).find(Boolean);
find('hero_title').props.text = 'Build across every screen.';
find('hero_description').props.text = 'A responsive reference page with flexible regions, nested content, and a bundled visual.';
find('header_shell').styles.mobile = { flexDirection: 'column', alignItems: 'flex-start', gap: '16px' };
find('hero_inner').styles.tablet = { gridTemplateColumns: '1fr', gap: '32px' };
find('hero_inner').styles.mobile = { gridTemplateColumns: '1fr', gap: '24px' };
find('work_cards').styles.tablet = { gridTemplateColumns: 'repeat(2, 1fr)' };
find('work_cards').styles.mobile = { gridTemplateColumns: '1fr' };
find('footer_grid').styles.mobile = { gridTemplateColumns: '1fr', gap: '20px' };
find('hero_art').children = [{ id: 'showcase_visual', type: 'Image', props: { src: `/api/assets/${showcaseAssetId}/content`, alt: 'Abstract Northstar visual with nested circles and a rounded card' }, styles: { desktop: { width: '100%', borderRadius: '24px' }, tablet: {}, mobile: { width: '100%' } } }];
for (const [id, href] of [['nav_work', '#work_cards'], ['nav_about', '#hero'], ['nav_contact', '#footer_grid'], ['hero_action', '#work_cards']]) find(id).props.href = href;

export const systemSamples = Object.freeze([
  { id: northstarPageId, key: 'northstar-studio', fixtureVersion: 1, name: 'Sample page', path: '/', slug: 'home', document: samplePage, assetIds: [] },
  { id: showcasePageId, key: 'responsive-showcase', fixtureVersion: 1, name: 'Responsive showcase', path: '/responsive-showcase', slug: 'responsive-showcase', document: validateDocument(showcase), assetIds: [showcaseAssetId] }
]);

export const systemSampleAssets = Object.freeze([
  { id: showcaseAssetId, filename: 'northstar-visual.png', mediaType: 'image/png', file: new URL('./fixtures/northstar-visual.png', import.meta.url) }
]);
