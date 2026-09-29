import { posix } from 'node:path';
import { documentCss, normalizePagePath, regions, registry, supportedStyles, validateDocument } from '@builder/document';
import { avatarFallbackScript, classFor, componentCss, contentCss, controlRuntimeScript, escapeHtml, formCss, htmlRegions, jsxRegions, packageFile, rangeCss, rangeRuntimeScript, reactControlComponents, reactRangeComponents, reactTooltipComponent, tooltipRuntimeScript, vueControlComponents, vueRangeComponents, vueRegions, vueTooltipComponent } from './index.js';
import { autocompleteCss, autocompleteRuntimeScript, reactAutocompleteComponent, vueAutocompleteComponent } from './autocomplete.js';
import { transferCss, transferRuntimeScript, reactTransferComponent, vueTransferComponent } from './transfer.js';

const targets = new Set(['html', 'react', 'vue']);
const mediaExtensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const assetPattern = /^\/api\/assets\/([0-9a-f-]{36})\/content$/i;
const pageClass = page => `p-${page.id.replaceAll('-', '')}`;
const pageFile = path => path === '/' ? 'index.html' : `${path.slice(1)}/index.html`;
const pageDirectory = path => path === '/' ? '.' : path.slice(1);
const issue = (page, node, property, message) => ({ pagePath: page.path, nodeId: node?.id || null, property, message });

function walk(document, visit) {
  const visitNode = node => { visit(node); node.children?.forEach(visitNode); };
  visit(document);
  regions.forEach(region => document.regions[region].forEach(visitNode));
}

export function referencedAssetIds(pages) {
  const ids = new Set();
  for (const page of pages) walk(page.document, node => {
    if (node.type !== 'Image' && node.type !== 'Avatar') return;
    const match = assetPattern.exec(node.props.src);
    if (match) ids.add(match[1]);
  });
  return [...ids];
}

function localAssetDependency(src) {
  if (!/^https?:\/\//i.test(src)) return false;
  try {
    const url = new URL(src);
    return ['localhost', '127.0.0.1', '[::1]', 's3-ninja'].includes(url.hostname) || url.hostname.endsWith('.localhost') || assetPattern.test(url.pathname);
  } catch { return true; }
}

function hrefRoute(value) {
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  const [path] = value.split(/[?#]/, 1);
  return normalizePagePath(path);
}

export function analyzeProjectExport(target, pages, assets = []) {
  const issues = [];
  if (!targets.has(target)) return [{ pagePath: null, nodeId: null, property: 'target', message: `Unknown export target ${target}` }];
  if (!Array.isArray(pages) || !pages.length) return [{ pagePath: null, nodeId: null, property: 'pages', message: 'Project has no pages' }];
  const paths = new Set();
  for (const page of pages) {
    try { normalizePagePath(page.path); }
    catch (error) { issues.push(issue(page, null, 'path', error.message)); continue; }
    if (paths.has(page.path)) issues.push(issue(page, null, 'path', `Duplicate page path ${page.path}`));
    paths.add(page.path);
  }
  const assetsById = new Map(assets.map(asset => [asset.id, asset]));
  for (const page of pages) {
    try { validateDocument(page.document); }
    catch (error) { issues.push(issue(page, null, 'document', error.message)); continue; }
    walk(page.document, node => {
      if (node.type !== 'Page' && !registry[node.type].exports.includes(target)) issues.push(issue(page, node, 'type', `${target} does not support ${node.type}`));
      for (const [breakpoint, styles] of Object.entries(node.styles)) {
        for (const property of Object.keys(styles)) if (!supportedStyles.has(property)) issues.push(issue(page, node, `${breakpoint}.${property}`, `${target} cannot export ${property}`));
      }
      if (node.type === 'Image' || node.type === 'Avatar') {
        const src = node.props.src;
        if (node.type === 'Avatar' && !src) return;
        const match = assetPattern.exec(src);
        if (match) {
          const asset = assetsById.get(match[1]);
          if (!asset || !mediaExtensions[asset.mediaType]) issues.push(issue(page, node, 'src', `Asset ${match[1]} is missing or unsupported`));
        } else if (localAssetDependency(src)) {
          issues.push(issue(page, node, 'src', `Image source ${src} depends on a local service or the editor API`));
        } else if (!/^https?:\/\//i.test(src) && !/^data:image\/(?:png|jpeg|gif|webp|svg\+xml)[;,]/i.test(src)) {
          issues.push(issue(page, node, 'src', `Image source ${src || '(empty)'} cannot be bundled`));
        }
      }
      if (node.type === 'Button' || node.type === 'Link') {
        const href = node.props.href;
        if (href.startsWith('//') || href.includes('\\')) issues.push(issue(page, node, 'href', `Unsafe link URL ${href}`));
        else if (href.startsWith('/')) {
          try { const route = hrefRoute(href); if (!paths.has(route)) issues.push(issue(page, node, 'href', `No page exists at ${route}`)); }
          catch { issues.push(issue(page, node, 'href', `Invalid internal route ${href}`)); }
        }
      }
    });
  }
  return issues;
}

function relativeUrl(fromPagePath, targetFile) {
  const relative = posix.relative(pageDirectory(fromPagePath), targetFile);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function urlMapper(target, page, assetsById) {
  return (value, node, property) => {
    if (property === 'src') {
      const match = assetPattern.exec(value);
      if (!match) return value;
      const asset = assetsById.get(match[1]);
      const file = `assets/${asset.id}.${mediaExtensions[asset.mediaType]}`;
      return target === 'html' ? relativeUrl(page.path, file) : `./${file}`;
    }
    if (value.startsWith('/') && !value.startsWith('//')) {
      const route = hrefRoute(value);
      const suffix = value.slice(value.split(/[?#]/, 1)[0].length);
      if (target === 'html') {
        const directory = pageDirectory(route);
        const path = posix.relative(pageDirectory(page.path), directory);
        return `${path ? (path.startsWith('.') ? path : `./${path}`) : '.'}/${suffix}`;
      }
      return `${route}${suffix}`;
    }
    return value;
  };
}

const baseCss = '*{box-sizing:border-box}html,body,#app{margin:0;min-height:100%}a{text-decoration:none}.region-footer{background:#172b58}.page-region{min-height:75px}\n';
const projectCss = pages => baseCss + componentCss + contentCss + formCss + rangeCss + autocompleteCss + transferCss + pages.map(page => {
  const scope = `.${pageClass(page)}`;
  return `${scope}{background:#fff;max-width:1440px;margin:0 auto}${documentCss(page.document, id => id === page.document.id ? scope : `${scope} .${classFor(id)}`)}`;
}).join('\n');

const readme = (target, pages) => `# Exported ${target.toUpperCase()} project\n\nThis project was generated from validated Page JSON. Edit source files to customize it.\n\n## Files\n\n${target === 'html' ? `- \`styles.css\`: shared responsive styles\n- \`assets/\`: referenced uploaded images\n- \`server.js\` and \`build.js\`: local server and production copy\n${pages.map(page => `- \`${pageFile(page.path)}\`: ${page.path} (${page.name})`).join('\n')}` : `- \`index.html\`: app entry\n- \`src/main.${target === 'react' ? 'jsx' : 'js'}\`: client router and app mount\n- \`src/pages.${target === 'react' ? 'jsx' : 'js'}\`: generated page components for ${pages.map(page => page.path).join(', ')}\n- \`src/styles.css\`: shared responsive styles\n- \`public/assets/\`: referenced uploaded images`}\n\n## Run\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\nOpen the local URL printed by the server. Run \`npm run build\` for production files in \`dist/\`, then \`npm run preview\` to serve that build.\n\nPaths: ${target === 'html' ? 'each page has its own index.html directory; internal links are relative.' : 'the client router uses History API paths; production hosting needs a fallback to index.html.'}\nExternal image URLs still require their original host.\n`;

function htmlScripts() {
  return {
    'package.json': JSON.stringify({ name: 'builder-html-export', private: true, version: '1.0.0', type: 'module', scripts: { dev: 'node server.js', build: 'node build.js', preview: 'node server.js dist' } }, null, 2) + '\n',
    'build.js': `import { cp, mkdir, readdir } from 'node:fs/promises';\nawait mkdir('dist', { recursive: true });\nfor (const entry of await readdir('.', { withFileTypes: true })) {\n  if (entry.name === 'dist' || entry.name === 'node_modules') continue;\n  if (entry.name === 'assets' || entry.name === 'styles.css' || entry.name === 'avatar.js' || entry.name === 'tooltip.js' || entry.name === 'controls.js' || entry.name === 'autocomplete.js' || entry.name === 'transfer.js' || entry.name === 'index.html' || entry.isDirectory()) await cp(entry.name, 'dist/' + entry.name, { recursive: true });\n}\nconsole.log('Built HTML project in dist/');\n`,
    'server.js': `import { createServer } from 'node:http';\nimport { readFile, stat } from 'node:fs/promises';\nimport { resolve, sep } from 'node:path';\nconst root = resolve(process.argv[2] || '.');\nconst types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp' };\ncreateServer(async (request, response) => {\n  try {\n    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);\n    const path = resolve(root, '.' + pathname);\n    if (path !== root && !path.startsWith(root + sep)) throw new Error('Forbidden');\n    const info = await stat(path).catch(() => null);\n    const file = info?.isDirectory() ? resolve(path, 'index.html') : info ? path : resolve(path, 'index.html');\n    const data = await readFile(file);\n    const extension = file.slice(file.lastIndexOf('.'));\n    response.writeHead(200, { 'Content-Type': types[extension] || 'application/octet-stream' }); response.end(data);\n  } catch { response.writeHead(404); response.end('Not found'); }\n}).listen(4173, '127.0.0.1', () => console.log('http://127.0.0.1:4173'));\n`
  };
}

export function buildProjectFiles(target, pages, assets = []) {
  const issues = analyzeProjectExport(target, pages, assets);
  if (issues.length) { const error = new Error('Export has unsupported content'); error.issues = issues; throw error; }
  const files = {};
  const assetsById = new Map(assets.map(asset => [asset.id, asset]));
  if (target === 'html') {
    Object.assign(files, htmlScripts());
    files['avatar.js'] = avatarFallbackScript;
    files['tooltip.js'] = tooltipRuntimeScript;
    files['controls.js'] = controlRuntimeScript + rangeRuntimeScript;
    files['autocomplete.js'] = autocompleteRuntimeScript;
    files['transfer.js'] = transferRuntimeScript;
    files['README.md'] = readme(target, pages);
    files['styles.css'] = projectCss(pages);
    for (const page of pages) {
      const scope = pageClass(page);
      const cssHref = relativeUrl(page.path, 'styles.css');
      const markup = htmlRegions(page.document, urlMapper(target, page, assetsById));
      files[pageFile(page.path)] = `<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(page.document.props.title)}</title><link rel="stylesheet" href="${escapeHtml(cssHref)}"><script src="${escapeHtml(relativeUrl(page.path, 'avatar.js'))}" defer></script><script src="${escapeHtml(relativeUrl(page.path, 'tooltip.js'))}" defer></script><script src="${escapeHtml(relativeUrl(page.path, 'controls.js'))}" defer></script><script src="${escapeHtml(relativeUrl(page.path, 'autocomplete.js'))}" defer></script><script src="${escapeHtml(relativeUrl(page.path, 'transfer.js'))}" defer></script></head><body><div class="${scope}">${markup}</div></body></html>\n`;
    }
    if (!pages.some(page => page.path === '/')) files['index.html'] = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pages</title></head><body><main><h1>Pages</h1><ul>${pages.map(page => `<li><a href=".${escapeHtml(page.path)}/">${escapeHtml(page.name)}</a></li>`).join('')}</ul></main></body></html>\n`;
  } else if (target === 'react') {
    files['package.json'] = packageFile('builder-react-export', { react: '^19.2.0', 'react-dom': '^19.2.0', vite: '^6.3.0' });
    files['README.md'] = readme(target, pages);
    files['index.html'] = '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base href="/"><title>Exported site</title></head><body><div id="app"></div><script type="module" src="/src/main.jsx"></script></body></html>\n';
    files['src/styles.css'] = projectCss(pages);
    files['src/pages.jsx'] = `import React from 'react';\nimport TooltipControl from './tooltip.jsx';\nimport AutocompleteControl from './autocomplete.jsx';\nimport TransferControl from './transfer.jsx';\nimport {CheckboxControl,RadioControl,SwitchControl,ToggleControl,RatingControl,SliderControl} from './controls.jsx';\nexport const pages = [${pages.map(page => `{path:${JSON.stringify(page.path)},title:${JSON.stringify(page.document.props.title)},render:()=> <div className=${JSON.stringify(pageClass(page))}>${jsxRegions(page.document, urlMapper(target, page, assetsById))}</div>}`).join(',')}];\n`;
    files['src/tooltip.jsx'] = reactTooltipComponent;
    files['src/controls.jsx'] = reactControlComponents + reactRangeComponents;
    files['src/autocomplete.jsx'] = reactAutocompleteComponent;
    files['src/transfer.jsx'] = reactTransferComponent;
    files['src/main.jsx'] = `import React, { useEffect, useState } from 'react';\nimport { createRoot } from 'react-dom/client';\nimport { pages } from './pages.jsx';\nimport './styles.css';\nconst route = () => window.location.pathname.replace(/\\/$/, '') || '/';\nfunction App(){const [path,setPath]=useState(route);useEffect(()=>{const update=()=>setPath(route());window.addEventListener('popstate',update);return()=>window.removeEventListener('popstate',update)},[]);const page=pages.find(item=>item.path===path);useEffect(()=>{document.title=page?.title||'Not found'},[page]);const navigate=event=>{const anchor=event.target.closest('a[href]');if(!anchor)return;const url=new URL(anchor.href);if(url.origin!==window.location.origin||!pages.some(item=>item.path===(url.pathname.replace(/\\/$/,'')||'/')))return;event.preventDefault();window.history.pushState({},'',url.pathname+url.search+url.hash);setPath(route())};return <div onClick={navigate}>{page?page.render():<main><h1>Page not found</h1><a href="/">Home</a></main>}</div>}\ncreateRoot(document.getElementById('app')).render(<App />);\n`;
  } else {
    files['package.json'] = packageFile('builder-vue-export', { vue: '^3.5.0', vite: '^6.3.0' });
    files['README.md'] = readme(target, pages);
    files['index.html'] = '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base href="/"><title>Exported site</title></head><body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>\n';
    files['src/styles.css'] = projectCss(pages);
    files['src/pages.js'] = `import { h } from 'vue';\nimport TooltipControl from './tooltip.js';\nimport AutocompleteControl from './autocomplete.js';\nimport TransferControl from './transfer.js';\nimport {CheckboxControl,RadioControl,SwitchControl,ToggleControl,RatingControl,SliderControl} from './controls.js';\nexport const pages = [${pages.map(page => `{path:${JSON.stringify(page.path)},title:${JSON.stringify(page.document.props.title)},render:()=>h('div',{class:${JSON.stringify(pageClass(page))}},[${vueRegions(page.document, urlMapper(target, page, assetsById))}])}`).join(',')}];\n`;
    files['src/tooltip.js'] = vueTooltipComponent;
    files['src/controls.js'] = vueControlComponents + vueRangeComponents;
    files['src/autocomplete.js'] = vueAutocompleteComponent;
    files['src/transfer.js'] = vueTransferComponent;
    files['src/main.js'] = `import { createApp, h, ref, onMounted, onUnmounted, watch } from 'vue';\nimport { pages } from './pages.js';\nimport './styles.css';\nconst route=()=>window.location.pathname.replace(/\\/$/,'')||'/';\ncreateApp({setup(){const path=ref(route());const update=()=>{path.value=route()};onMounted(()=>window.addEventListener('popstate',update));onUnmounted(()=>window.removeEventListener('popstate',update));watch(path,()=>{document.title=pages.find(item=>item.path===path.value)?.title||'Not found'},{immediate:true});const navigate=event=>{const anchor=event.target.closest('a[href]');if(!anchor)return;const url=new URL(anchor.href);if(url.origin!==window.location.origin||!pages.some(item=>item.path===(url.pathname.replace(/\\/$/,'')||'/')))return;event.preventDefault();window.history.pushState({},'',url.pathname+url.search+url.hash);update()};return()=>h('div',{onClick:navigate},[pages.find(item=>item.path===path.value)?.render()||h('main',[h('h1','Page not found'),h('a',{href:'/'},'Home')])])}}).mount('#app');\n`;
  }
  const referenced = new Set(referencedAssetIds(pages));
  for (const asset of assets) {
    if (!mediaExtensions[asset.mediaType]) continue;
    if (referenced.has(asset.id)) files[`${target === 'html' ? '' : 'public/'}assets/${asset.id}.${mediaExtensions[asset.mediaType]}`] = asset.contents;
  }
  return files;
}
