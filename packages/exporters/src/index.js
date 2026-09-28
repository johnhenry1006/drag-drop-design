import { documentCss, regions, registry, validateDocument } from '@builder/document';

const supportedStyles = new Set([
  'alignItems', 'backgroundColor', 'border', 'borderColor', 'borderRadius', 'borderWidth', 'boxShadow',
  'color', 'display', 'flex', 'flexDirection', 'fontFamily', 'fontSize', 'fontWeight', 'gap',
  'gridTemplateColumns', 'height', 'justifyContent', 'letterSpacing', 'lineHeight', 'margin',
  'marginBottom', 'marginLeft', 'marginRight', 'marginTop', 'maxWidth', 'minHeight', 'minWidth',
  'objectFit', 'opacity', 'padding', 'paddingBottom', 'paddingLeft', 'paddingRight', 'paddingTop',
  'textAlign', 'textDecoration', 'width'
]);

const classFor = id => `n-${id}`;
const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const tagFor = node => node.type === 'Heading' ? `h${node.props.level || 2}` : registry[node.type].tag;

function eachNode(document, callback) {
  const walk = node => { callback(node); node.children?.forEach(walk); };
  callback(document);
  for (const region of regions) document.regions[region].forEach(walk);
}

function checkSupport(document, target) {
  validateDocument(document);
  eachNode(document, node => {
    if (node.type !== 'Page' && !registry[node.type].exports.includes(target)) throw new Error(`${target} does not support ${node.type} at ${node.id}`);
    for (const [breakpoint, styles] of Object.entries(node.styles)) {
      for (const property of Object.keys(styles)) {
        if (!supportedStyles.has(property)) throw new Error(`${target} export does not support style ${property} on node ${node.id} at ${breakpoint}`);
      }
    }
  });
}

function stylesheet(document) {
  return `*{box-sizing:border-box}html,body,#app{margin:0;min-height:100%}a{text-decoration:none}.region-footer{background:#172b58}\n${documentCss(document, id => `.${classFor(id)}`)}\n`;
}

function attributes(node, syntax) {
  const attrs = { class: classFor(node.id) };
  if (node.type === 'Image') { attrs.src = node.props.src; attrs.alt = node.props.alt; }
  if (node.type === 'Button') attrs.href = node.props.href;
  if (syntax === 'html') return Object.entries(attrs).map(([key, value]) => ` ${key}="${escapeHtml(value)}"`).join('');
  return Object.entries(attrs).map(([key, value]) => ` ${key === 'class' ? 'className' : key}={${JSON.stringify(value)}}`).join('');
}

function htmlNode(node) {
  const tag = tagFor(node);
  const attrs = attributes(node, 'html');
  if (node.type === 'Image') return `<img${attrs}>`;
  const content = node.children ? node.children.map(htmlNode).join('') : escapeHtml(node.props.text || '');
  return `<${tag}${attrs}>${content}</${tag}>`;
}

function jsxNode(node) {
  const tag = tagFor(node);
  const attrs = attributes(node, 'jsx');
  if (node.type === 'Image') return `<img${attrs} />`;
  const content = node.children ? node.children.map(jsxNode).join('') : `{${JSON.stringify(node.props.text || '')}}`;
  return `<${tag}${attrs}>${content}</${tag}>`;
}

function vueNode(node) {
  const props = { class: classFor(node.id) };
  if (node.type === 'Image') { props.src = node.props.src; props.alt = node.props.alt; }
  if (node.type === 'Button') props.href = node.props.href;
  const children = node.children ? `[${node.children.map(vueNode).join(',')}]` : node.type === 'Image' ? 'undefined' : JSON.stringify(node.props.text || '');
  return `h(${JSON.stringify(tagFor(node))},${JSON.stringify(props)},${children})`;
}

function htmlRegions(document) {
  return regions.map(region => `<${region} class="region-${region}">${document.regions[region].map(htmlNode).join('')}</${region}>`).join('\n');
}

function jsxRegions(document) {
  return regions.map(region => `<${region} className="region-${region}">${document.regions[region].map(jsxNode).join('')}</${region}>`).join('\n');
}

function vueRegions(document) {
  return regions.map(region => `h('${region}',{class:'region-${region}'},[${document.regions[region].map(vueNode).join(',')}])`).join(',');
}

function packageFile(name, dependencies) {
  return JSON.stringify({ name, private: true, version: '1.0.0', type: 'module', scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' }, dependencies }, null, 2) + '\n';
}

export function exportHtml(document) {
  checkSupport(document, 'html');
  return {
    'index.html': `<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(document.props.title)}</title><link rel="stylesheet" href="./styles.css"></head><body><div class="${classFor(document.id)}">${htmlRegions(document)}</div></body></html>\n`,
    'styles.css': stylesheet(document)
  };
}

export function exportReact(document) {
  checkSupport(document, 'react');
  return {
    'package.json': packageFile('builder-react-export', { react: '^19.2.0', 'react-dom': '^19.2.0', vite: '^6.3.0' }),
    'index.html': `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(document.props.title)}</title></head><body><div id="app"></div><script type="module" src="/src/main.jsx"></script></body></html>\n`,
    'src/main.jsx': `import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\nimport './styles.css';\ncreateRoot(document.getElementById('app')).render(<App />);\n`,
    'src/App.jsx': `import React from 'react';\nexport default function App(){return <div className="${classFor(document.id)}">${jsxRegions(document)}</div>;}\n`,
    'src/styles.css': stylesheet(document)
  };
}

export function exportVue(document) {
  checkSupport(document, 'vue');
  return {
    'package.json': packageFile('builder-vue-export', { vue: '^3.5.0', vite: '^6.3.0' }),
    'index.html': `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(document.props.title)}</title></head><body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>\n`,
    'src/main.js': `import { createApp, h } from 'vue';\nimport './styles.css';\nconst App = { render(){ return h('div',{class:'${classFor(document.id)}'},[${vueRegions(document)}]); } };\ncreateApp(App).mount('#app');\n`,
    'src/styles.css': stylesheet(document)
  };
}
