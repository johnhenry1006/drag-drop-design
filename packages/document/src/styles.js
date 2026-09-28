import { regions } from './registry.js';
import { parseAdvancedCss } from './advanced-css.js';
import { cssName } from './style-support.js';


function collect(nodes, output) {
  for (const node of nodes) {
    output.push(node);
    if (node.children) collect(node.children, output);
  }
}

export function documentCss(document, selectorFor = id => `[data-node-id="${id}"]`, mode = 'responsive') {
  const nodes = [document];
  for (const region of regions) collect(document.regions[region], nodes);
  if (!['responsive', 'desktop', 'tablet', 'mobile'].includes(mode)) throw new Error(`Unknown CSS mode ${mode}`);
  const active = mode === 'desktop' ? ['desktop'] : mode === 'tablet' ? ['desktop', 'tablet'] : ['desktop', 'tablet', 'mobile'];
  return active.map(breakpoint => {
    const declarations = nodes.map(node => {
      const basic = Object.entries(node.styles[breakpoint]).map(([name, value]) => `${cssName(name)}:${value}`).join(';');
      const advanced = node.advancedCss?.[breakpoint] ? parseAdvancedCss(node.advancedCss[breakpoint]) : '';
      const body = [basic, advanced].filter(Boolean).join(';');
      return body ? `${selectorFor(node.id)}{${body}}` : '';
    }).join('');
    if (mode === 'responsive' && breakpoint === 'tablet') return `@media (max-width: 900px){${declarations}}`;
    if (mode === 'responsive' && breakpoint === 'mobile') return `@media (max-width: 600px){${declarations}}`;
    return declarations;
  }).join('\n');
}
