import { regions } from './registry.js';

const cssName = name => name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);

function collect(nodes, output) {
  for (const node of nodes) {
    output.push(node);
    if (node.children) collect(node.children, output);
  }
}

export function documentCss(document, selectorFor = id => `[data-node-id="${id}"]`) {
  const nodes = [document];
  for (const region of regions) collect(document.regions[region], nodes);
  return ['desktop', 'tablet', 'mobile'].map(breakpoint => {
    const declarations = nodes.map(node => {
      const body = Object.entries(node.styles[breakpoint]).map(([name, value]) => `${cssName(name)}:${value}`).join(';');
      return body ? `${selectorFor(node.id)}{${body}}` : '';
    }).join('');
    if (breakpoint === 'tablet') return `@media (max-width: 900px){${declarations}}`;
    if (breakpoint === 'mobile') return `@media (max-width: 600px){${declarations}}`;
    return declarations;
  }).join('\n');
}
