import { documentCss, iconPaths, regions, registry, supportedStyles, validateDocument } from '@builder/document';

export const classFor = id => `n-${id}`;
export const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const componentCss = `.builder-avatar{display:inline-grid;place-items:center;position:relative;overflow:hidden;width:var(--avatar-size);height:var(--avatar-size);background:#dbe4f2;color:#26344a;font-weight:700;vertical-align:middle}.builder-avatar[data-shape="circle"]{border-radius:50%}.builder-avatar[data-shape="rounded"]{border-radius:18%}.builder-avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.builder-avatar img[hidden]{display:none}.builder-badge{display:inline-block;position:relative;padding:4px 10px}.builder-badge-mark{position:absolute;background:var(--badge-color);color:white;border-radius:999px;padding:2px 6px;min-width:19px;text-align:center;font-size:11px;line-height:15px;white-space:nowrap}.builder-badge[data-placement="topRight"] .builder-badge-mark{top:0;right:0;transform:translate(50%,-50%)}.builder-badge[data-placement="topLeft"] .builder-badge-mark{top:0;left:0;transform:translate(-50%,-50%)}.builder-badge[data-placement="bottomRight"] .builder-badge-mark{bottom:0;right:0;transform:translate(50%,50%)}.builder-badge[data-placement="bottomLeft"] .builder-badge-mark{bottom:0;left:0;transform:translate(-50%,50%)}.builder-chip{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:5px 11px;background:#e9edf5;color:#26344a}.builder-chip svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.builder-icon{display:inline-block;width:var(--icon-size);height:var(--icon-size);color:var(--icon-color);fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vertical-align:middle}\n`;
export const avatarFallbackScript = `for(const image of document.querySelectorAll('.builder-avatar img')){const fallback=()=>{image.hidden=true};image.addEventListener('error',fallback);if(image.complete&&image.naturalWidth===0)fallback()}\n`;
const initials = props => props.initials || props.name.split(/\s+/).map(word => word[0]).slice(0, 2).join('').toUpperCase();
const badgeValue = props => props.text || (props.maxCount > 0 && props.count > props.maxCount ? `${props.maxCount}+` : String(props.count));
const iconMarkup = id => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${iconPaths[id]}"/></svg>`;
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

export function stylesheet(document, selectorFor = id => `.${classFor(id)}`) {
  return `*{box-sizing:border-box}html,body,#app{margin:0;min-height:100%}a{text-decoration:none}.region-footer{background:#172b58}\n${componentCss}${documentCss(document, selectorFor)}\n`;
}

function attributes(node, syntax, transformUrl = value => value) {
  const attrs = { class: classFor(node.id) };
  if (node.type === 'Image') { attrs.src = transformUrl(node.props.src, node, 'src'); attrs.alt = node.props.alt; }
  if (node.type === 'Button' || node.type === 'Link') attrs.href = transformUrl(node.props.href, node, 'href');
  if (syntax === 'html') return Object.entries(attrs).map(([key, value]) => ` ${key}="${escapeHtml(value)}"`).join('');
  return Object.entries(attrs).map(([key, value]) => ` ${key === 'class' ? 'className' : key}={${JSON.stringify(value)}}`).join('');
}

function htmlNode(node, transformUrl) {
  const tag = tagFor(node);
  const attrs = attributes(node, 'html', transformUrl);
  if (node.type === 'Avatar') { const p = node.props; const src = p.src ? `<img src="${escapeHtml(transformUrl(p.src, node, 'src'))}" alt="" aria-hidden="true">` : ''; return `<span class="${classFor(node.id)} builder-avatar" data-shape="${p.shape}" role="img" aria-label="${escapeHtml(p.alt || p.name)}" style="--avatar-size:${p.size}px"><span aria-hidden="true">${escapeHtml(initials(p))}</span>${src}</span>`; }
  if (node.type === 'Badge') { const p = node.props; const value = badgeValue(p); return `<span class="${classFor(node.id)} builder-badge" data-placement="${p.placement}" style="--badge-color:${p.color}"><span>${escapeHtml(p.content)}</span><span class="builder-badge-mark" aria-label="${escapeHtml(value)}">${escapeHtml(value)}</span></span>`; }
  if (node.type === 'Chip') return `<span class="${classFor(node.id)} builder-chip">${node.props.icon ? iconMarkup(node.props.icon) : ''}<span>${escapeHtml(node.props.label)}</span></span>`;
  if (node.type === 'Icons') { const p = node.props; return `<svg class="${classFor(node.id)} builder-icon" viewBox="0 0 24 24" role="img" aria-label="${escapeHtml(p.name)}" style="--icon-size:${p.size}px;--icon-color:${p.color}"><path d="${iconPaths[p.icon]}"/></svg>`; }
  if (node.type === 'Image') return `<img${attrs}>`;
  const content = node.children ? node.children.map(child => htmlNode(child, transformUrl)).join('') : escapeHtml(node.props.text || '');
  return `<${tag}${attrs}>${content}</${tag}>`;
}

function jsxNode(node, transformUrl) {
  const tag = tagFor(node);
  const attrs = attributes(node, 'jsx', transformUrl);
  if (node.type === 'Avatar') { const p = node.props; const src = p.src ? `<img src={${JSON.stringify(transformUrl(p.src, node, 'src'))}} alt="" aria-hidden="true" onError={event=>{event.currentTarget.hidden=true}} />` : ''; return `<span className=${JSON.stringify(`${classFor(node.id)} builder-avatar`)} data-shape=${JSON.stringify(p.shape)} role="img" aria-label=${JSON.stringify(p.alt || p.name)} style={{'--avatar-size':${JSON.stringify(`${p.size}px`)}}}><span aria-hidden="true">{${JSON.stringify(initials(p))}}</span>${src}</span>`; }
  if (node.type === 'Badge') { const p = node.props; const value = badgeValue(p); return `<span className=${JSON.stringify(`${classFor(node.id)} builder-badge`)} data-placement=${JSON.stringify(p.placement)} style={{'--badge-color':${JSON.stringify(p.color)}}}><span>{${JSON.stringify(p.content)}}</span><span className="builder-badge-mark" aria-label=${JSON.stringify(value)}>{${JSON.stringify(value)}}</span></span>`; }
  if (node.type === 'Chip') return `<span className=${JSON.stringify(`${classFor(node.id)} builder-chip`)}>${node.props.icon ? `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d=${JSON.stringify(iconPaths[node.props.icon])} /></svg>` : ''}<span>{${JSON.stringify(node.props.label)}}</span></span>`;
  if (node.type === 'Icons') { const p = node.props; return `<svg className=${JSON.stringify(`${classFor(node.id)} builder-icon`)} viewBox="0 0 24 24" role="img" aria-label=${JSON.stringify(p.name)} style={{'--icon-size':${JSON.stringify(`${p.size}px`)},'--icon-color':${JSON.stringify(p.color)}}}><path d=${JSON.stringify(iconPaths[p.icon])} /></svg>`; }
  if (node.type === 'Image') return `<img${attrs} />`;
  const content = node.children ? node.children.map(child => jsxNode(child, transformUrl)).join('') : `{${JSON.stringify(node.props.text || '')}}`;
  return `<${tag}${attrs}>${content}</${tag}>`;
}

function vueNode(node, transformUrl = value => value) {
  if (node.type === 'Avatar') { const p = node.props; return `h('span',{class:${JSON.stringify(`${classFor(node.id)} builder-avatar`)},'data-shape':${JSON.stringify(p.shape)},role:'img','aria-label':${JSON.stringify(p.alt || p.name)},style:{'--avatar-size':${JSON.stringify(`${p.size}px`)}}},[h('span',{'aria-hidden':'true'},${JSON.stringify(initials(p))})${p.src ? `,h('img',{src:${JSON.stringify(transformUrl(p.src, node, 'src'))},alt:'','aria-hidden':'true',onError:event=>{event.target.hidden=true}})` : ''}])`; }
  if (node.type === 'Badge') { const p = node.props; const value = badgeValue(p); return `h('span',{class:${JSON.stringify(`${classFor(node.id)} builder-badge`)},'data-placement':${JSON.stringify(p.placement)},style:{'--badge-color':${JSON.stringify(p.color)}}},[h('span',${JSON.stringify(p.content)}),h('span',{class:'builder-badge-mark','aria-label':${JSON.stringify(value)}},${JSON.stringify(value)})])`; }
  if (node.type === 'Chip') return `h('span',{class:${JSON.stringify(`${classFor(node.id)} builder-chip`)}},[${node.props.icon ? `h('svg',{viewBox:'0 0 24 24','aria-hidden':'true',focusable:'false'},[h('path',{d:${JSON.stringify(iconPaths[node.props.icon])}})]),` : ''}h('span',${JSON.stringify(node.props.label)})])`;
  if (node.type === 'Icons') { const p = node.props; return `h('svg',{class:${JSON.stringify(`${classFor(node.id)} builder-icon`)},viewBox:'0 0 24 24',role:'img','aria-label':${JSON.stringify(p.name)},style:{'--icon-size':${JSON.stringify(`${p.size}px`)},'--icon-color':${JSON.stringify(p.color)}}},[h('path',{d:${JSON.stringify(iconPaths[p.icon])}})])`; }
  const props = { class: classFor(node.id) };
  if (node.type === 'Image') { props.src = transformUrl(node.props.src, node, 'src'); props.alt = node.props.alt; }
  if (node.type === 'Button' || node.type === 'Link') props.href = transformUrl(node.props.href, node, 'href');
  const children = node.children ? `[${node.children.map(child => vueNode(child, transformUrl)).join(',')}]` : node.type === 'Image' ? 'undefined' : JSON.stringify(node.props.text || '');
  return `h(${JSON.stringify(tagFor(node))},${JSON.stringify(props)},${children})`;
}

export function htmlRegions(document, transformUrl) {
  return regions.map(region => `<${region} class="region-${region}">${document.regions[region].map(node => htmlNode(node, transformUrl)).join('')}</${region}>`).join('\n');
}

export function jsxRegions(document, transformUrl) {
  return regions.map(region => `<${region} className="region-${region}">${document.regions[region].map(node => jsxNode(node, transformUrl)).join('')}</${region}>`).join('\n');
}

export function vueRegions(document, transformUrl) {
  return regions.map(region => `h('${region}',{class:'region-${region}'},[${document.regions[region].map(node => vueNode(node, transformUrl)).join(',')}])`).join(',');
}

export function packageFile(name, dependencies) {
  return JSON.stringify({ name, private: true, version: '1.0.0', type: 'module', scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' }, dependencies }, null, 2) + '\n';
}

export function exportHtml(document) {
  checkSupport(document, 'html');
  return {
    'index.html': `<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(document.props.title)}</title><link rel="stylesheet" href="./styles.css"><script src="./avatar.js" defer></script></head><body><div class="${classFor(document.id)}">${htmlRegions(document)}</div></body></html>\n`,
    'avatar.js': avatarFallbackScript,
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
