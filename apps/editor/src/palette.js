import { registry } from '@builder/document';

export const paletteItems = Object.entries(registry).flatMap(([key, definition]) => {
  const palette = definition.palette;
  if (!palette) return [];
  return [{ key, label: palette.label || key, group: palette.group, icon: palette.icon, order: palette.order },
    ...(palette.variants || []).map(variant => ({ ...variant, group: palette.group }))];
}).sort((left, right) => left.order - right.order);
export const paletteGroups = [...new Set(paletteItems.map(item => item.group))];

const styles = desktop => ({ desktop, tablet: {}, mobile: {} });
const id = () => `node_${crypto.randomUUID().replaceAll('-', '')}`;

function basic(type, props = {}, desktop = {}) {
  return {
    id: id(),
    type,
    props: { ...registry[type].defaults, ...props },
    styles: styles(desktop),
    ...(registry[type].kind === 'container' ? { children: [] } : {})
  };
}

export function createPaletteNode(key) {
  if (key === 'Columns3') {
    return { ...basic('Layout', { label: 'Three columns' }, { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', padding: '20px' }),
      children: [1, 2, 3].map(number => basic('Container', { label: `Column ${number}` }, { minHeight: '80px', padding: '16px' })) };
  }
  if (!registry[key]) throw new Error(`Unknown palette item ${key}`);
  if (key === 'Navigation') return basic(key, {}, { display: 'flex', gap: '20px', alignItems: 'center', minHeight: '48px', padding: '8px' });
  if (key === 'Card') return basic(key, {}, { padding: '20px', borderRadius: '12px', border: '1px solid #dce3ee' });
  if (key === 'Container') return basic(key, {}, { minHeight: '80px', padding: '16px' });
  if (key === 'Section') return basic(key, {}, { minHeight: '100px', padding: '24px' });
  if (key === 'Layout') return basic(key, {}, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', padding: '16px' });
  if (key === 'Heading') return basic(key, {}, { fontSize: '32px', margin: '12px 0' });
  if (key === 'Text') return basic(key, {}, { lineHeight: '1.5' });
  if (key === 'Link') return basic(key, {}, { color: '#4f6fdd', display: 'inline-block', padding: '6px' });
  if (key === 'Button') return basic(key, {}, { display: 'inline-block', backgroundColor: '#4f6fdd', color: '#fff', padding: '10px 16px', borderRadius: '8px' });
  if (key === 'Lists') return basic(key, { items: registry.Lists.defaults.items.map(item => ({ ...item, id: id() })) });
  if (key === 'Table') {
    const columns = registry.Table.defaults.columns.map(column => ({ ...column, id: id() }));
    const rows = registry.Table.defaults.rows.map(row => ({ id: id(), cells: Object.fromEntries(registry.Table.defaults.columns.map((column, index) => [columns[index].id, row.cells[column.id]])) }));
    return basic(key, { columns, rows });
  }
  if (['Checkbox', 'Radio Group', 'Switch', 'Toggle Button', 'Rating', 'Slider', 'Autocomplete'].includes(key)) {
    const node = basic(key, { name: `field_${id()}` });
    if (key === 'Radio Group' || key === 'Autocomplete') {
      const options = registry[key].defaults.options.map(option => ({ ...option, id: id() }));
      node.props.options = options;
    }
    return node;
  }
  if (key === 'Transfer List') return basic(key, { options: registry[key].defaults.options.map(option => ({ ...option, id: id() })) });
  return basic(key);
}
