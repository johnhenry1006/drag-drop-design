import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DragDropProvider, useDraggable, useDroppable } from '@dnd-kit/react';
import { pointerIntersection } from '@dnd-kit/collision';
import { addNode, findNode, getAncestors, normalizePagePath, regions, registry, removeNode, reorderNode, samplePage, updateNode, validateDocument } from '@builder/document';
import { applyDrop, placementFromPointer } from './drop.js';
import { createPaletteNode, paletteGroups, paletteItems } from './palette.js';
import { emptyHistory, recordChange, travel } from './history.js';
import { PageView } from './render.jsx';
import { PropertiesPanel } from './properties.jsx';
import { insertSuggestion, layoutSuggestions } from './suggestions.js';
import { api, jsonOptions, uploadImage } from './api.js';
import './style.css';

const labelFor = node => node.props.label || node.props.text || node.type;

function PaletteButton({ item, onAdd }) {
  const { ref, isDragging } = useDraggable({ id: `palette:${item.key}`, type: 'palette' });
  return <button ref={ref} className="palette-item" data-palette={item.key} data-dragging={isDragging || undefined} onClick={() => onAdd(item.key)} title={`Click to add ${item.label}; drag to place it`}>
    <span className="palette-icon">{item.icon}</span><span>{item.label}</span><span className="palette-plus">＋</span>
  </button>;
}

function ElementsPanel({ onAdd, suggestionRegion, onSuggest, onInsertSuggestion }) {
  const [query, setQuery] = useState('');
  const matches = paletteItems.filter(item => `${item.label} ${item.group}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="panel-scroll"><div className="panel-heading"><span className="panel-kicker">BUILD</span><h2>Elements</h2><p>Drag onto the canvas or select a target and click to add.</p></div>
    <label className="palette-search"><span>Search elements</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search elements…" /></label>
    {paletteGroups.map(group => { const items = matches.filter(item => item.group === group); return <section className="palette-group" key={group}><h3>{group}</h3>{items.map(item => <div key={item.key}><PaletteButton item={item} onAdd={onAdd} />{registry[item.key]?.exportNote && <p className="palette-support">HTML5, React, Vue · {registry[item.key].exportNote}</p>}</div>)}{!items.length && !query && <p className="palette-support">{group === 'Forms' ? 'Form controls and submission are not supported yet.' : group === 'Custom' ? 'Custom code and components are not supported yet.' : 'No elements yet.'}</p>}</section>; })}
    {query && matches.length === 0 && <p className="palette-no-results">No matching elements.</p>}
    <section className="suggestion-panel" aria-label="Layout suggestions"><h3>Layout suggestions</h3><p>Optional starting points. Every inserted node stays editable.</p><div className="suggestion-regions">{regions.map(region => <button key={region} className={suggestionRegion === region ? 'active' : ''} onClick={() => onSuggest(region)}>{region}</button>)}</div>
      {layoutSuggestions.filter(item => item.region === suggestionRegion).map(item => <button className="suggestion-item" key={item.key} onClick={() => onInsertSuggestion(item.key, suggestionRegion)}><strong>{item.label}</strong><span>{item.description}</span></button>)}
    </section>
  </div>;
}

function LayerRow({ node, depth, selectedId, expanded, onToggle, onSelect, dropTarget }) {
  const { ref: dropRef } = useDroppable({ id: `layer-node:${node.id}`, accept: ['palette', 'tree-node'], collisionDetector: pointerIntersection, collisionPriority: depth + 2 });
  const { ref: dragRef, handleRef, isDragging } = useDraggable({ id: `node:${node.id}`, type: 'tree-node' });
  const combinedRef = useCallback(element => { dropRef(element); dragRef(element); }, [dropRef, dragRef]);
  const isContainer = registry[node.type].kind === 'container';
  const isOpen = expanded.has(node.id);
  const active = dropTarget?.targetId === `layer-node:${node.id}`;
  return <React.Fragment>
    <div ref={combinedRef} className={`layer-row ${selectedId === node.id ? 'active' : ''}`} data-layer-id={node.id} data-drop={active && dropTarget.valid ? dropTarget.placement : undefined} data-drop-invalid={active && !dropTarget.valid ? 'true' : undefined} data-dragging={isDragging || undefined} style={{ paddingLeft: 8 + depth * 15 }}>
      <button className="layer-toggle" onClick={() => isContainer && onToggle(node.id)} aria-label={isContainer ? `${isOpen ? 'Collapse' : 'Expand'} ${labelFor(node)}` : undefined} disabled={!isContainer}>{isContainer ? (isOpen ? '▾' : '▸') : '·'}</button>
      <button ref={handleRef} className="layer-handle" aria-label={`Drag ${labelFor(node)}`} title="Drag to move">⠿</button>
      <button className="layer-select" onClick={() => onSelect(node.id)} title={`${node.type}: ${labelFor(node)}`}><span className="layer-icon">{isContainer ? '▣' : '◇'}</span><span className="layer-name">{labelFor(node)}</span><small>{node.type}</small></button>
    </div>
    {isContainer && isOpen && node.children.map(child => <LayerRow key={child.id} node={child} depth={depth + 1} selectedId={selectedId} expanded={expanded} onToggle={onToggle} onSelect={onSelect} dropTarget={dropTarget} />)}
  </React.Fragment>;
}

function RegionLayer({ region, nodes, selectedRegion, selectedId, expanded, onToggle, onSelect, onSelectRegion, onSuggest, dropTarget }) {
  const { ref } = useDroppable({ id: `layer-region:${region}`, accept: ['palette', 'tree-node'], collisionDetector: pointerIntersection, collisionPriority: 1 });
  const active = dropTarget?.targetId === `layer-region:${region}`;
  return <section className="region-group"><div ref={ref} className={`region-row ${selectedRegion === region ? 'active' : ''}`} data-layer-region={region} data-drop={active && dropTarget.valid ? 'inside' : undefined} data-drop-invalid={active && !dropTarget.valid ? 'true' : undefined}>
    <button onClick={() => onSelectRegion(region)}><span>⌑</span>{region}<small>{nodes.length}</small></button><button className="region-suggest" aria-label={`Suggest layout for ${region}`} title={`Layout suggestions for ${region}`} onClick={() => onSuggest(region)}>＋ Layout</button>
  </div>{nodes.map(node => <LayerRow key={node.id} node={node} depth={0} selectedId={selectedId} expanded={expanded} onToggle={onToggle} onSelect={onSelect} dropTarget={dropTarget} />)}</section>;
}

function LayersPanel({ document, selectedId, selectedRegion, expanded, onToggle, onSelect, onSelectRegion, onSuggest, dropTarget }) {
  return <div className="panel-scroll"><div className="panel-heading"><span className="panel-kicker">STRUCTURE</span><h2>Layers</h2><p>Select, expand, or drag a row to move it.</p></div>
    {regions.map(region => <RegionLayer key={region} region={region} nodes={document.regions[region]} selectedId={selectedId} selectedRegion={selectedRegion} expanded={expanded} onToggle={onToggle} onSelect={onSelect} onSelectRegion={onSelectRegion} onSuggest={onSuggest} dropTarget={dropTarget} />)}
  </div>;
}

function ViewportSwitch({ breakpoint, onChange }) {
  return <div className="breakpoint-switch" role="group" aria-label="Page viewport">{['desktop', 'tablet', 'mobile'].map(mode => <button key={mode} className={breakpoint === mode ? 'active' : ''} aria-pressed={breakpoint === mode} onClick={() => onChange(mode)}>{mode}</button>)}</div>;
}

function sourceFromDrag(source, paletteNode) {
  if (!source) return null;
  const id = String(source.id);
  if (id.startsWith('palette:')) return { kind: 'palette', node: paletteNode || createPaletteNode(id.slice(8)) };
  if (id.startsWith('node:')) return { kind: 'node', id: id.slice(5) };
  return null;
}

function hitTarget(pointer, sourceId) {
  if (!Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return null;
  for (const element of window.document.elementsFromPoint(pointer.x, pointer.y)) {
    const layer = element.closest('[data-layer-id]');
    if (layer && layer.dataset.layerId !== sourceId) return { id: `layer-node:${layer.dataset.layerId}`, element: layer };
    const layerRegion = element.closest('[data-layer-region]');
    if (layerRegion) return { id: `layer-region:${layerRegion.dataset.layerRegion}`, element: layerRegion };
    const canvasNode = element.closest('.page [data-node-id]');
    if (canvasNode && !canvasNode.classList.contains('page') && canvasNode.dataset.nodeId !== sourceId) return { id: `canvas-node:${canvasNode.dataset.nodeId}`, element: canvasNode };
    const canvasRegion = element.closest('.page [data-region]');
    if (canvasRegion) return { id: `canvas-region:${canvasRegion.dataset.region}`, element: canvasRegion };
  }
  return null;
}

function Editor({ document, setDocument, selectedId, setSelectedId, selectedRegion, setSelectedRegion, breakpoint, setBreakpoint, onStatus, onUploadAsset, assets }) {
  const [leftTab, setLeftTab] = useState('elements');
  const [suggestionRegion, setSuggestionRegion] = useState('main');
  const [expanded, setExpanded] = useState(() => new Set());
  const [dropTarget, setDropTarget] = useState(null);
  const pointer = useRef({ x: null, y: null });
  const paletteNode = useRef(null);
  useEffect(() => {
    const track = event => { pointer.current = { x: event.clientX, y: event.clientY }; };
    window.addEventListener('pointermove', track, true);
    return () => window.removeEventListener('pointermove', track, true);
  }, []);
  const select = id => { setSelectedId(id); setSelectedRegion(null); };
  const selectRegion = region => { setSelectedId(null); setSelectedRegion(region); setSuggestionRegion(region); };
  const toggle = id => setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const expandAncestors = (page, id) => setExpanded(previous => new Set([...previous, ...getAncestors(page, id)]));
  const change = (id, patch) => {
    try { setDocument(updateNode(document, id, patch)); onStatus('Page JSON updated', 'success'); }
    catch (error) { onStatus(error.message, 'error'); }
  };
  const reorder = (id, index) => {
    try { setDocument(reorderNode(document, id, index)); onStatus('Node reordered', 'success'); }
    catch (error) { onStatus(error.message, 'error'); }
  };
  const remove = id => {
    try { setDocument(removeNode(document, id)); setSelectedId(null); onStatus('Node removed from Page JSON', 'success'); }
    catch (error) { onStatus(error.message, 'error'); }
  };
  const suggest = region => { setSuggestionRegion(region); setLeftTab('elements'); };
  const addSuggestion = (key, region) => {
    try {
      const result = insertSuggestion(document, key, region, selectedId);
      setDocument(result.document); select(result.insertedIds[0]); expandAncestors(result.document, result.insertedIds[0]);
      onStatus(`${layoutSuggestions.find(item => item.key === key).label} added to ${result.parent}`, 'success');
    } catch (error) { onStatus(error.message, 'error'); }
  };
  const add = key => {
    try {
      const node = createPaletteNode(key);
      let parent = selectedRegion || 'main';
      let index = document.regions[parent].length;
      if (selectedId) {
        const location = findNode(document, selectedId);
        if (registry[location.node.type].kind === 'container') { parent = selectedId; index = location.node.children.length; }
        else { parent = location.parentId || location.region; index = location.index + 1; }
      }
      const next = addNode(document, parent, index, node);
      setDocument(next); select(node.id); expandAncestors(next, node.id); onStatus(`${key === 'Columns3' ? 'Three columns' : key} added to ${parent}`, 'success');
    } catch (error) { onStatus(error.message, 'error'); }
  };
  const inspectDrop = event => {
    const source = sourceFromDrag(event.operation.source, paletteNode.current);
    const target = hitTarget(pointer.current, source?.kind === 'node' ? source.id : null) || event.operation.target;
    if (!source || !target) { setDropTarget(null); return null; }
    const targetId = String(target.id);
    const placement = placementFromPointer(targetId, pointer.current.y, target.element?.getBoundingClientRect());
    try {
      applyDrop(document, source, targetId, placement);
      const info = { source, targetId, placement, valid: true };
      setDropTarget(info); return info;
    } catch (error) {
      const info = { source, targetId, placement, valid: false, reason: error.message };
      setDropTarget(info); onStatus(error.message, 'error'); return info;
    }
  };
  const finishDrop = event => {
    if (event.canceled) { setDropTarget(null); paletteNode.current = null; onStatus('Drag canceled', 'info'); return; }
    const info = inspectDrop(event);
    setDropTarget(null); paletteNode.current = null;
    if (!info) { onStatus('Drop onto a region or node', 'error'); return; }
    if (!info.valid) { onStatus(info.reason, 'error'); return; }
    try {
      const next = applyDrop(document, info.source, info.targetId, info.placement);
      const id = info.source.kind === 'palette' ? info.source.node.id : info.source.id;
      setDocument(next); select(id); expandAncestors(next, id); onStatus(`Placed ${findNode(next, id).node.type} ${info.placement} ${info.targetId.split(':')[1]}`, 'success');
    } catch (error) { onStatus(error.message, 'error'); }
  };
  return <DragDropProvider onDragStart={event => { const id = String(event.operation.source?.id || ''); paletteNode.current = id.startsWith('palette:') ? createPaletteNode(id.slice(8)) : null; onStatus('Drag over a region or node', 'info'); }} onDragMove={inspectDrop} onDragOver={inspectDrop} onDragEnd={finishDrop}>
    <div className="workspace">
      <aside className="sidebar left-sidebar"><div className="left-tabs"><button className={leftTab === 'elements' ? 'active' : ''} onClick={() => setLeftTab('elements')}>Elements</button><button className={leftTab === 'layers' ? 'active' : ''} onClick={() => setLeftTab('layers')}>Layers</button></div>
        {leftTab === 'elements' ? <ElementsPanel onAdd={add} suggestionRegion={suggestionRegion} onSuggest={suggest} onInsertSuggestion={addSuggestion} /> : <LayersPanel document={document} selectedId={selectedId} selectedRegion={selectedRegion} expanded={expanded} onToggle={toggle} onSelect={select} onSelectRegion={selectRegion} onSuggest={suggest} dropTarget={dropTarget} />}
      </aside>
      <main className="canvas-area"><div className="canvas-toolbar"><div><span className="canvas-dot" /> Canvas <span className="canvas-size">{breakpoint === 'desktop' ? 'Fluid desktop' : breakpoint === 'tablet' ? '768px tablet' : '390px mobile'}</span></div><ViewportSwitch breakpoint={breakpoint} onChange={setBreakpoint} /></div><div className="canvas-scroll"><PageView document={document} selectedId={selectedId} onSelect={select} dropTarget={dropTarget} breakpoint={breakpoint} /></div></main>
      <aside className="sidebar properties"><PropertiesPanel document={document} selectedId={selectedId} selectedRegion={selectedRegion} breakpoint={breakpoint} onSelect={select} onSelectRegion={selectRegion} onChange={change} onReorder={reorder} onRemove={remove} onUploadAsset={onUploadAsset} assets={assets} /></aside>
    </div>
  </DragDropProvider>;
}

function App() {
  const [auth, setAuth] = useState(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [document, setDocument] = useState(null);
  const documentRef = useRef(null);
  const historyRef = useRef(emptyHistory());
  const [history, setHistory] = useState(historyRef.current);
  const replaceDocument = next => { documentRef.current = next; setDocument(next); historyRef.current = emptyHistory(); setHistory(historyRef.current); };
  const commitDocument = value => {
    const current = documentRef.current;
    const next = typeof value === 'function' ? value(current) : value;
    if (!current || JSON.stringify(current) === JSON.stringify(next)) return;
    historyRef.current = recordChange(historyRef.current, current, next);
    setHistory(historyRef.current); documentRef.current = next; setDocument(next);
  };
  const navigateHistory = direction => {
    const step = travel(historyRef.current, documentRef.current, direction);
    if (!step) return;
    historyRef.current = step.history; setHistory(step.history); documentRef.current = step.document; setDocument(step.document);
    setSelectedId(id => id && findNode(step.document, id) ? id : null);
    setStatus({ message: direction === 'undo' ? 'Undid change' : 'Redid change', tone: 'info' });
  };
  const [savedDocument, setSavedDocument] = useState(null);
  const [projects, setProjects] = useState([]);
  const [pages, setPages] = useState([]);
  const [assets, setAssets] = useState([]);
  const [currentProject, setCurrentProject] = useState(null);
  const [currentPage, setCurrentPage] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState({ message: 'Select a region or drag an element to begin', tone: 'info' });
  const [preview, setPreview] = useState(false);
  const [breakpoint, setBreakpoint] = useState('desktop');
  const [previewDesktopWidth, setPreviewDesktopWidth] = useState(960);
  const [saving, setSaving] = useState(false);
  const uploadingRef = useRef(0);
  const [uploading, setUploading] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [showRevisions, setShowRevisions] = useState(false);
  const [revisions, setRevisions] = useState([]);
  const [chosenRevision, setChosenRevision] = useState('');
  const [showExport, setShowExport] = useState(false);
  const [exportTarget, setExportTarget] = useState('html');
  const [exportReport, setExportReport] = useState(null);
  const [exportError, setExportError] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const dirty = Boolean(document && savedDocument && JSON.stringify(document) !== JSON.stringify(savedDocument));

  const activatePage = page => {
    const next = validateDocument(page.document);
    replaceDocument(next); setSavedDocument(next); setCurrentPage(page);
    setConflict(false);
    window.localStorage.setItem('builder:lastProjectId', page.projectId);
    window.localStorage.setItem('builder:lastPageId', page.id);
    setSelectedId(null); setSelectedRegion(null); setShowRevisions(false);
    setShowExport(false);
    setStatus({ message: `${page.name} opened at revision ${page.revision}`, tone: 'success' });
  };
  const openProject = async project => {
    const [{ pages: available }, { assets: storedAssets }] = await Promise.all([api(`/projects/${project.id}/pages`), api(`/projects/${project.id}/assets`)]);
    setCurrentProject(project); setPages(available); setAssets(storedAssets);
    if (available.length) {
      const preferred = available.find(page => page.id === window.localStorage.getItem('builder:lastPageId')) || available[0];
      activatePage((await api(`/pages/${preferred.id}`)).page);
    }
    else {
      replaceDocument(null); setSavedDocument(null); setCurrentPage(null);
      setStatus({ message: 'Create a page to start editing', tone: 'info' });
    }
  };
  useEffect(() => {
    api('/auth/me').then(setAuth).catch(cause => { if (cause.status === 401) setAuth({ enabled: true, user: null }); else setError(cause.message); });
  }, []);
  useEffect(() => {
    if (!auth || (auth.enabled && !auth.user)) return;
    (async () => {
      try {
        const { projects: available } = await api('/projects');
        setProjects(available);
        if (available.length) await openProject(available.find(project => project.id === window.localStorage.getItem('builder:lastProjectId')) || available.find(project => project.id === '00000000-0000-4000-8000-000000000001') || available[0]);
        else if (!auth.enabled) {
          const project = (await api('/projects', jsonOptions('POST', { name: 'Sample project' }))).project;
          const page = (await api(`/projects/${project.id}/pages`, jsonOptions('POST', { name: 'Sample page', document: samplePage }))).page;
          setProjects([project]); setCurrentProject(project); setPages([page]); activatePage(page);
        }
      } catch (cause) { setError(cause.message); }
    })();
  }, [auth?.enabled, auth?.user?.id]);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    const keydown = event => {
      if (preview || !documentRef.current) return;
      const target = event.target;
      const editing = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if (editing) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); navigateHistory(event.shiftKey ? 'redo' : 'undo'); }
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); navigateHistory('redo'); }
      else if (event.key === 'Escape') { setSelectedId(null); setSelectedRegion(null); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [preview]);

  const login = async event => {
    event.preventDefault(); setLoginError('');
    try { setAuth(await api('/auth/login', jsonOptions('POST', { email: loginEmail, password: loginPassword }))); setLoginPassword(''); }
    catch (cause) { setLoginError(cause.message); }
  };
  const logout = async () => {
    await api('/auth/logout', jsonOptions('POST', {}));
    replaceDocument(null); setCurrentProject(null); setCurrentPage(null); setProjects([]); setPages([]); setAssets([]);
    setAuth({ enabled: true, user: null });
  };
  const save = async () => {
    if (!document || !currentPage || saving || uploadingRef.current) return;
    const snapshot = document;
    setSaving(true);
    try {
      const page = (await api(`/pages/${currentPage.id}`, jsonOptions('PUT', { expectedRevision: currentPage.revision, document: snapshot }))).page;
      setCurrentPage(page); setSavedDocument(snapshot);
      setConflict(false);
      setPages(previous => previous.map(item => item.id === page.id ? { ...item, revision: page.revision, updatedAt: page.updatedAt } : item));
      setStatus({ message: `Saved revision ${page.revision}`, tone: 'success' });
    } catch (cause) {
      if (cause.status === 409) setConflict(true);
      setStatus({ message: cause.status === 409 ? `Version conflict: server is at revision ${cause.currentRevision}. Your edits remain local; reload the page or save as copy.` : `Save failed: ${cause.message}`, tone: 'error' });
    } finally { setSaving(false); }
  };
  const reloadPage = async () => {
    if (!currentPage || (dirty && !window.confirm('Discard unsaved changes and reload this page?'))) return;
    try { activatePage((await api(`/pages/${currentPage.id}`)).page); }
    catch (cause) { setStatus({ message: `Reload failed: ${cause.message}`, tone: 'error' }); }
  };
  const chooseProject = async id => {
    if (dirty && !window.confirm('Discard unsaved changes and open another project?')) return;
    try { await openProject(projects.find(project => project.id === id)); }
    catch (cause) { setStatus({ message: `Open project failed: ${cause.message}`, tone: 'error' }); }
  };
  const choosePage = async id => {
    if (dirty && !window.confirm('Discard unsaved changes and open another page?')) return;
    try { activatePage((await api(`/pages/${id}`)).page); }
    catch (cause) { setStatus({ message: `Open page failed: ${cause.message}`, tone: 'error' }); }
  };
  const navigateFabPreview = href => {
    const path = href.split('?', 1)[0];
    const target = pages.find(page => page.path === path);
    if (target) choosePage(target.id);
    else setStatus({ message: `No page exists at ${path}`, tone: 'error' });
  };
  const blankPage = name => ({ schemaVersion: 1, id: `page_${crypto.randomUUID().replaceAll('-', '')}`, type: 'Page', props: { title: name }, styles: { desktop: {}, tablet: {}, mobile: {} }, regions: { header: [], main: [], footer: [] } });
  const createNewPage = async (project, skipDirtyCheck = false) => {
    if (!skipDirtyCheck && dirty && !window.confirm('Discard unsaved changes and create a blank page?')) return;
    const name = window.prompt('Page name', 'New page');
    if (name === null) return;
    const suggestedPath = !skipDirtyCheck && pages.length ? `/${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page'}` : '/';
    const requestedPath = window.prompt('Page path', suggestedPath);
    if (requestedPath === null) return;
    try {
      const path = normalizePagePath(requestedPath);
      const page = (await api(`/projects/${project.id}/pages`, jsonOptions('POST', { name, path, document: blankPage(name) }))).page;
      setPages(previous => [...previous, page]); activatePage(page);
    } catch (cause) { setStatus({ message: `Create page failed: ${cause.message}`, tone: 'error' }); }
  };
  const changePagePath = async () => {
    const requested = window.prompt('Page path', currentPage.path);
    if (requested === null) return;
    try {
      const path = normalizePagePath(requested);
      const snapshot = document;
      const page = (await api(`/pages/${currentPage.id}`, jsonOptions('PUT', { expectedRevision: currentPage.revision, document: snapshot, path }))).page;
      setCurrentPage(page); setSavedDocument(snapshot);
      setPages(previous => previous.map(item => item.id === page.id ? { ...item, path, revision: page.revision } : item));
      setStatus({ message: `Page path saved as ${path}`, tone: 'success' });
    } catch (cause) { setStatus({ message: `Path update failed: ${cause.message}`, tone: 'error' }); }
  };
  const createNewProject = async () => {
    if (dirty && !window.confirm('Discard unsaved changes and create another project?')) return;
    const name = window.prompt('Project name', 'New project');
    if (name === null) return;
    try {
      const project = (await api('/projects', jsonOptions('POST', { name }))).project;
      setProjects(previous => [...previous, project]); setCurrentProject(project); setPages([]); setAssets([]); replaceDocument(null); setSavedDocument(null); setCurrentPage(null);
      await createNewPage(project, true);
    } catch (cause) { setStatus({ message: `Create project failed: ${cause.message}`, tone: 'error' }); }
  };
  const saveAsCopy = async () => {
    const name = window.prompt('Name for a copy of this page', `${currentPage.name} copy`);
    if (name === null) return;
    const requestedPath = window.prompt('Path for the copy', `/copy-${Date.now().toString(36)}`);
    if (requestedPath === null) return;
    try {
      const path = normalizePagePath(requestedPath);
      const page = (await api(`/projects/${currentProject.id}/pages`, jsonOptions('POST', { name, path, document }))).page;
      setPages(previous => [...previous, page]); activatePage(page);
      setStatus({ message: `Saved a copy as ${name}`, tone: 'success' });
    } catch (cause) { setStatus({ message: `Save as copy failed: ${cause.message}`, tone: 'error' }); }
  };
  const showHistory = async () => {
    if (showRevisions) { setShowRevisions(false); return; }
    try {
      const { revisions: history } = await api(`/pages/${currentPage.id}/revisions`);
      setRevisions(history); setChosenRevision(String(history.at(-1)?.revision || '')); setShowRevisions(true);
    } catch (cause) { setStatus({ message: `Revision history failed: ${cause.message}`, tone: 'error' }); }
  };
  const restore = async () => {
    if (!chosenRevision || (dirty && !window.confirm('Discard unsaved changes and restore this revision?'))) return;
    try {
      const page = (await api(`/pages/${currentPage.id}/restore`, jsonOptions('POST', { revision: Number(chosenRevision), expectedRevision: currentPage.revision }))).page;
      activatePage(page);
      setPages(previous => previous.map(item => item.id === page.id ? { ...item, revision: page.revision, updatedAt: page.updatedAt } : item));
      setStatus({ message: `Restored revision ${chosenRevision} as revision ${page.revision}`, tone: 'success' });
    } catch (cause) { setStatus({ message: cause.status === 409 ? `Restore conflict: server is at revision ${cause.currentRevision}. Reload before restoring.` : `Restore failed: ${cause.message}`, tone: 'error' }); }
  };
  const uploadAsset = async (nodeId, file) => {
    uploadingRef.current++; setUploading(true);
    try {
      const asset = await uploadImage(currentProject.id, file);
      setAssets(previous => [asset, ...previous]);
      commitDocument(previous => updateNode(previous, nodeId, { props: { src: asset.url } }));
      setStatus({ message: `${asset.filename} uploaded; save the page to keep its reference`, tone: 'success' });
    } catch (cause) { setStatus({ message: `Image upload failed: ${cause.message}`, tone: 'error' }); }
    finally { uploadingRef.current--; setUploading(uploadingRef.current > 0); }
  };
  useEffect(() => {
    if (!showExport || !currentProject || dirty) { setExportReport(null); return undefined; }
    let canceled = false;
    setExportReport(null); setExportError('');
    api(`/projects/${currentProject.id}/exports/${exportTarget}/check`)
      .then(report => { if (!canceled) setExportReport(report); })
      .catch(cause => { if (!canceled) setExportError(cause.message); });
    return () => { canceled = true; };
  }, [showExport, currentProject?.id, exportTarget, dirty, currentPage?.revision]);
  const downloadExport = async () => {
    if (!exportReport || exportReport.issues.length || dirty || exportBusy) return;
    setExportBusy(true); setExportError('');
    try {
      const response = await fetch(`/api/projects/${currentProject.id}/exports/${exportTarget}.zip`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (payload.issues) setExportReport(previous => ({ ...previous, issues: payload.issues }));
        throw new Error(payload.error || `Export failed with HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `website-${exportTarget}.zip`;
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a'); link.href = url; link.download = filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus({ message: `${exportTarget.toUpperCase()} ZIP downloaded`, tone: 'success' });
    } catch (cause) { setExportError(cause.message); }
    finally { setExportBusy(false); }
  };
  const download = () => {
    const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a'); link.href = url; link.download = 'page.json'; link.click(); URL.revokeObjectURL(url);
  };
  const togglePreview = () => {
    if (!preview) setPreviewDesktopWidth(window.document.querySelector('.canvas-area .page')?.getBoundingClientRect().width || 960);
    setShowRevisions(false);
    setShowExport(false);
    setPreview(value => !value);
  };
  if (auth?.enabled && !auth.user) return <main className="login-shell"><form onSubmit={login}><h1>Sign in to Builder</h1><label>Email<input type="email" required autoComplete="username" value={loginEmail} onChange={event => setLoginEmail(event.target.value)} /></label><label>Password<input type="password" required autoComplete="current-password" value={loginPassword} onChange={event => setLoginPassword(event.target.value)} /></label>{loginError && <p role="alert">{loginError}</p>}<button type="submit">Sign in</button></form></main>;
  return <div className="app-shell">
    <header className="app-header"><div className="app-brand"><span className="brand-mark">✦</span><strong>Northstar Builder</strong>{auth?.user && <button className="toolbar-button" onClick={logout}>Sign out</button>}</div>
      <div className="header-actions"><select aria-label="Project" value={currentProject?.id || ''} onChange={event => chooseProject(event.target.value)} disabled={!projects.length}>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select><button className="toolbar-button" onClick={createNewProject}>New project</button><select aria-label="Page" value={currentPage?.id || ''} onChange={event => choosePage(event.target.value)} disabled={!pages.length}>{pages.map(page => <option key={page.id} value={page.id}>{page.name} · {page.path}</option>)}</select><button className="toolbar-button" disabled={!currentProject} onClick={() => createNewPage(currentProject)}>New page</button><button className="toolbar-button" disabled={!currentPage} onClick={changePagePath}>Path</button><span className={`save-indicator ${dirty ? 'dirty' : ''}`} data-save-state={dirty ? 'unsaved' : 'saved'}>{dirty ? 'Unsaved changes' : currentPage ? `Saved · v${currentPage.revision}` : 'No page'}</span><button className="toolbar-button" disabled={!history.past.length || preview} onClick={() => navigateHistory('undo')} title="Undo (Ctrl/⌘+Z)">Undo</button><button className="toolbar-button" disabled={!history.future.length || preview} onClick={() => navigateHistory('redo')} title="Redo (Ctrl/⌘+Shift+Z)">Redo</button><button className="toolbar-button" disabled={!selectedId && !selectedRegion || preview} onClick={() => { setSelectedId(null); setSelectedRegion(null); }} title="Clear selection (Escape)">Clear selection</button><button className="toolbar-button" disabled={!dirty || saving || uploading || !currentPage} onClick={save}>{uploading ? 'Uploading…' : saving ? 'Saving…' : 'Save'}</button>{conflict && <button className="toolbar-button" onClick={saveAsCopy}>Save as copy</button>}<button className="toolbar-button" disabled={!currentPage} onClick={reloadPage}>Reload</button><button className="toolbar-button" disabled={!currentPage || preview} onClick={showHistory}>Revisions</button><button className="toolbar-button" disabled={!currentProject || preview || uploading} onClick={() => setShowExport(true)}>Export</button><button className="toolbar-button" disabled={!document} onClick={download}>Download JSON</button><button className="view-button" disabled={!document} onClick={togglePreview}>{preview ? 'Back to editor' : 'Preview page'}</button></div></header>
    {showRevisions && !preview && <div className="revision-popover"><strong>Page revisions</strong><p>Restoring creates a new revision.</p><label>Restore from<select aria-label="Revision to restore" value={chosenRevision} onChange={event => setChosenRevision(event.target.value)}>{revisions.map(item => <option key={item.revision} value={item.revision}>Revision {item.revision}</option>)}</select></label><button onClick={restore} disabled={!chosenRevision}>Restore revision</button></div>}
    {showExport && !preview && <div className="export-backdrop" role="presentation"><section className="export-dialog" role="dialog" aria-label="Export project"><div className="export-heading"><h2>Export project</h2><button aria-label="Close export" onClick={() => setShowExport(false)}>×</button></div><p>Download all saved pages and referenced assets as a source project.</p><label>Target<select aria-label="Export target" value={exportTarget} onChange={event => setExportTarget(event.target.value)}><option value="html">HTML5</option><option value="react">React JavaScript/JSX</option><option value="vue">Vue JavaScript</option></select></label>{dirty ? <p className="export-warning">Save the current page before exporting. Unsaved edits are not included.</p> : !exportReport && !exportError ? <p>Checking saved pages…</p> : exportReport && <><h3>Pages</h3><ul>{exportReport.pages.map(page => <li key={page.id}>{page.path} — {page.name}</li>)}</ul>{exportReport.issues.length ? <><h3>Resolve before download</h3><ul className="export-issues">{exportReport.issues.map((item, index) => <li key={index}>{item.pagePath || 'Project'}{item.nodeId ? ` · ${item.nodeId}` : ''} · {item.property}: {item.message}</li>)}</ul></> : <p className="export-ready">Ready to export {exportReport.pages.length} page(s).</p>}</>}{exportError && <p className="field-error" role="alert">{exportError}</p>}<button className="view-button" disabled={dirty || !exportReport || exportReport.issues.length > 0 || exportBusy} onClick={downloadExport}>{exportBusy ? 'Generating…' : 'Download ZIP'}</button></section></div>}
    <div className={`status-bar ${status.tone}`} role="status">{status.message}</div>
    {error ? <div className="error">Could not load the project: {error}. Start the API and PostgreSQL with <code>npm run dev</code>. <button className="toolbar-button" onClick={() => window.location.reload()}>Retry connection</button></div> : !document ? <div className="loading">{currentProject ? 'No page open. Use New page to start editing.' : auth?.user ? 'Create a project to start editing.' : 'Loading page…'}</div> : preview ? <div className="preview-wrap"><div className="preview-toolbar"><strong>Preview</strong><ViewportSwitch breakpoint={breakpoint} onChange={setBreakpoint} /></div><div className="preview-stage" data-preview-breakpoint={breakpoint} style={{ '--preview-desktop-width': `${previewDesktopWidth}px` }}><PageView document={document} interactive={false} breakpoint={breakpoint} onNavigate={navigateFabPreview} /></div></div> : <Editor document={document} setDocument={commitDocument} selectedId={selectedId} setSelectedId={setSelectedId} selectedRegion={selectedRegion} setSelectedRegion={setSelectedRegion} breakpoint={breakpoint} setBreakpoint={setBreakpoint} onStatus={(message, tone) => setStatus({ message, tone })} onUploadAsset={uploadAsset} assets={assets} />}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
