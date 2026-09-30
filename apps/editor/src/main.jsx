import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DragDropProvider, useDraggable, useDroppable } from '@dnd-kit/react';
import { pointerIntersection } from '@dnd-kit/collision';
import { addNode, findNode, getAncestors, normalizePagePath, regions, registry, removeNode, reorderNode, updateNode, validateDocument } from '@builder/document';
import { applyDrop, placementFromPointer } from './drop.js';
import { createPaletteNode, paletteGroups, searchPaletteItems } from './palette.js';
import { readCollapsedPaletteGroups, writeCollapsedPaletteGroups } from './palette-preferences.js';
import { emptyHistory, recordChange, travel } from './history.js';
import { PageView } from './render.jsx';
import { PropertiesPanel } from './properties.jsx';
import { ProjectManager } from './project-manager.jsx';
import { PageManager, pageTrail } from './page-manager.jsx';
import { insertSuggestion, layoutSuggestions } from './suggestions.js';
import { api, jsonOptions, uploadImage } from './api.js';
import './style.css';

const labelFor = node => node.props.label || node.props.text || node.type;

function PaletteButton({ item, onAdd }) {
  const { ref, isDragging } = useDraggable({ id: `palette:${item.key}`, type: 'palette' });
  return <div className="palette-item" data-palette={item.key} data-dragging={isDragging || undefined} title={`Click to add ${item.label}; drag to place it`}>
    <button ref={ref} type="button" className="palette-item-main" onClick={() => onAdd(item.key)}><span className="palette-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span></button>
    <button type="button" className="palette-add" aria-label={`Add ${item.label}`} onClick={() => onAdd(item.key)}>＋</button>
  </div>;
}

function ElementsPanel({ onAdd, suggestionRegion, onSuggest, onInsertSuggestion }) {
  const [query, setQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState(readCollapsedPaletteGroups);
  const [searchCollapsedGroups, setSearchCollapsedGroups] = useState(() => new Set());
  const searching = Boolean(query.trim());
  const matches = searchPaletteItems(query);
  useEffect(() => { writeCollapsedPaletteGroups(collapsedGroups); }, [collapsedGroups]);
  const toggleGroup = group => {
    const setGroups = searching ? setSearchCollapsedGroups : setCollapsedGroups;
    setGroups(previous => { const next = new Set(previous); if (next.has(group)) next.delete(group); else next.add(group); return next; });
  };
  return <div className="panel-scroll"><div className="panel-heading"><span className="panel-kicker">BUILD</span><h2>Elements</h2><p>Drag onto the canvas or select a target and click to add.</p></div>
    <label className="palette-search"><span>Search elements</span><input type="search" value={query} onChange={event => { setQuery(event.target.value); setSearchCollapsedGroups(new Set()); }} placeholder="Search elements…" /></label>
    {paletteGroups.map(group => {
      const items = matches.filter(item => item.group === group);
      if (searching && !items.length) return null;
      const open = searching ? !searchCollapsedGroups.has(group) : !collapsedGroups.has(group);
      const listId = `palette-group-${group.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      return <section className="palette-group" key={group}><h3><button type="button" className="palette-disclosure" aria-expanded={open} aria-controls={listId} onClick={() => toggleGroup(group)}><span className="palette-chevron" aria-hidden="true">▸</span><span>{group}</span><span className="palette-count" aria-hidden="true">{items.length}</span></button></h3><div id={listId} hidden={!open}>{items.map(item => <div key={item.key}><PaletteButton item={item} onAdd={onAdd} />{registry[item.key]?.exportNote && <p className="palette-support">HTML5, React, Vue · {registry[item.key].exportNote}</p>}</div>)}</div></section>;
    })}
    {searching && matches.length === 0 && <p className="palette-no-results" role="status">No elements match “{query.trim()}”. Try an element name or another keyword.</p>}
    {!searching && <section className="suggestion-panel" aria-label="Layout suggestions"><h3>Layout suggestions</h3><p>Optional starting points. Every inserted node stays editable.</p><div className="suggestion-regions">{regions.map(region => <button key={region} className={suggestionRegion === region ? 'active' : ''} onClick={() => onSuggest(region)}>{region}</button>)}</div>
      {layoutSuggestions.filter(item => item.region === suggestionRegion).map(item => <button className="suggestion-item" key={item.key} onClick={() => onInsertSuggestion(item.key, suggestionRegion)}><strong>{item.label}</strong><span>{item.description}</span></button>)}
    </section>}
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

function Editor({ document, pages, projectName, setDocument, selectedId, setSelectedId, selectedRegion, setSelectedRegion, breakpoint, setBreakpoint, onStatus, onUploadAsset, assets }) {
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
      <main className="canvas-area"><div className="canvas-toolbar"><div><span className="canvas-dot" /> Canvas <span className="canvas-size">{breakpoint === 'desktop' ? 'Fluid desktop' : breakpoint === 'tablet' ? '768px tablet' : '390px mobile'}</span></div><ViewportSwitch breakpoint={breakpoint} onChange={setBreakpoint} /></div><div className="canvas-scroll"><PageView document={document} pages={pages} selectedId={selectedId} onSelect={select} dropTarget={dropTarget} breakpoint={breakpoint} /></div></main>
      <aside className="sidebar properties"><PropertiesPanel document={document} pages={pages} projectName={projectName} selectedId={selectedId} selectedRegion={selectedRegion} breakpoint={breakpoint} onSelect={select} onSelectRegion={selectRegion} onChange={change} onReorder={reorder} onRemove={remove} onUploadAsset={onUploadAsset} assets={assets} /></aside>
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
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [projectManagerBusy, setProjectManagerBusy] = useState(false);
  const [projectManagerError, setProjectManagerError] = useState('');
  const projectOpenToken = useRef(0);
  const [pages, setPages] = useState([]);
  const [showPageManager, setShowPageManager] = useState(false);
  const [pageManagerError, setPageManagerError] = useState('');
  const [pageManagerBusy, setPageManagerBusy] = useState(false);
  const [navigationBusy, setNavigationBusy] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const navigationResolve = useRef(null);
  const [assets, setAssets] = useState([]);
  const [currentProject, setCurrentProject] = useState(null);
  const [currentPage, setCurrentPage] = useState(null);
  const currentPageRef = useRef(null);
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
  const refreshPages = async projectId => { const available = (await api(`/projects/${projectId}/pages`)).pages; setPages(available); return available; };
  const confirmNavigation = () => {
    if (!dirty) return Promise.resolve(true);
    return new Promise(resolve => { navigationResolve.current = resolve; setPendingNavigation(true); });
  };
  const settleNavigation = async choice => {
    if (choice === 'save') {
      const saved = await save();
      if (!saved) return;
    }
    if (choice === 'discard') replaceDocument(savedDocument);
    const resolve = navigationResolve.current;
    navigationResolve.current = null; setPendingNavigation(null);
    resolve?.(choice !== 'cancel');
  };

  const activatePage = page => {
    const next = validateDocument(page.document);
    replaceDocument(next); setSavedDocument(next); currentPageRef.current = page; setCurrentPage(page);
    setConflict(false);
    window.localStorage.setItem('builder:lastProjectId', page.projectId);
    window.localStorage.setItem('builder:lastPageId', page.id);
    setSelectedId(null); setSelectedRegion(null); setShowRevisions(false);
    setShowExport(false);
    setStatus({ message: `${page.name} opened at revision ${page.revision}`, tone: 'success' });
  };
  const openProject = async project => {
    if (!project) throw new Error('Project is no longer available');
    const token = ++projectOpenToken.current;
    const [{ pages: available }, { assets: storedAssets }] = await Promise.all([api(`/projects/${project.id}/pages`), api(`/projects/${project.id}/assets`)]);
    if (token !== projectOpenToken.current) return;
    if (available.length) {
      const preferred = available.find(page => page.id === window.localStorage.getItem('builder:lastPageId')) || available[0];
      const loaded = (await api(`/pages/${preferred.id}`)).page;
      if (token !== projectOpenToken.current) return;
      if (loaded.projectId !== project.id) throw new Error('Selected page belongs to another project');
      setCurrentProject(project); setPages(available); setAssets(storedAssets); activatePage(loaded);
    }
    else {
      setCurrentProject(project); setPages([]); setAssets(storedAssets);
      replaceDocument(null); setSavedDocument(null); currentPageRef.current = null; setCurrentPage(null);
      window.localStorage.setItem('builder:lastProjectId', project.id);
      window.localStorage.removeItem('builder:lastPageId');
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
    replaceDocument(null); setCurrentProject(null); currentPageRef.current = null; setCurrentPage(null); setProjects([]); setPages([]); setAssets([]);
    setAuth({ enabled: true, user: null });
  };
  const save = async () => {
    if (!document || !currentPage || saving || uploadingRef.current) return false;
    const snapshot = document;
    setSaving(true);
    try {
      const page = (await api(`/pages/${currentPage.id}`, jsonOptions('PUT', { expectedRevision: currentPage.revision, document: snapshot }))).page;
      currentPageRef.current = page; setCurrentPage(page); setSavedDocument(snapshot);
      setConflict(false);
      setPages(previous => previous.map(item => item.id === page.id ? { ...item, revision: page.revision, updatedAt: page.updatedAt } : item));
      setStatus({ message: `Saved revision ${page.revision}`, tone: 'success' });
      return documentRef.current === snapshot;
    } catch (cause) {
      if (cause.status === 409) setConflict(true);
      setStatus({ message: cause.status === 409 ? `Version conflict: server is at revision ${cause.currentRevision}. Your edits remain local; reload the page or save as copy.` : `Save failed: ${cause.message}`, tone: 'error' });
      return false;
    } finally { setSaving(false); }
  };
  const reloadPage = async () => {
    if (!currentPage || (dirty && !window.confirm('Discard unsaved changes and reload this page?'))) return;
    try { activatePage((await api(`/pages/${currentPage.id}`)).page); }
    catch (cause) { setStatus({ message: `Reload failed: ${cause.message}`, tone: 'error' }); }
  };
  const chooseProject = async id => {
    if (id === currentProject?.id) return true;
    if (!await confirmNavigation()) return false;
    setNavigationBusy(true); setStatus({ message: 'Opening project…', tone: 'info' });
    try { await openProject(projects.find(project => project.id === id)); return true; }
    catch (cause) { setStatus({ message: `Open project failed: ${cause.message}`, tone: 'error' }); setProjectManagerError(cause.message); return false; }
    finally { setNavigationBusy(false); }
  };
  const refreshProjects = async () => { const available = (await api('/projects')).projects; setProjects(available); return available; };
  const openProjectManager = async () => {
    setProjectManagerError(''); setShowProjectManager(true);
    try { await refreshProjects(); }
    catch (cause) { setProjectManagerError(`Could not load projects: ${cause.message}`); }
  };
  const choosePage = async id => {
    if (id === currentPage?.id) return true;
    if (!await confirmNavigation()) return false;
    setNavigationBusy(true); setStatus({ message: 'Opening page…', tone: 'info' });
    try { const page = (await api(`/pages/${id}`)).page; if (page.projectId !== currentProject?.id) throw new Error('Page belongs to another project'); activatePage(page); return true; }
    catch (cause) { setStatus({ message: `Open page failed: ${cause.message}`, tone: 'error' }); }
    finally { setNavigationBusy(false); }
    return false;
  };
  const navigateFabPreview = async href => {
    const path = href.split(/[?#]/, 1)[0];
    const target = pages.find(page => page.path === path);
    if (target) {
      if (await choosePage(target.id) && href.includes('#')) {
        const anchor = href.slice(href.indexOf('#') + 1);
        requestAnimationFrame(() => requestAnimationFrame(() => window.document.getElementById(anchor)?.scrollIntoView()));
      }
    }
    else setStatus({ message: `No page exists at ${path}`, tone: 'error' });
  };
  const blankPage = name => ({ schemaVersion: 1, id: `page_${crypto.randomUUID().replaceAll('-', '')}`, type: 'Page', props: { title: name }, styles: { desktop: {}, tablet: {}, mobile: {} }, regions: { header: [], main: [], footer: [] } });
  const createNewPage = async (project, skipDirtyCheck = false, parentPageId = null) => {
    if (!skipDirtyCheck && !await confirmNavigation()) return false;
    const name = window.prompt('Page name', 'New page');
    if (name === null) return false;
    const segment = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page';
    const parent = pages.find(page => page.id === parentPageId);
    const suggestedPath = parent ? `${parent.path === '/' ? '' : parent.path}/${segment}` : !skipDirtyCheck && pages.length ? `/${segment}` : '/';
    const requestedPath = window.prompt('Page path', suggestedPath);
    if (requestedPath === null) return false;
    try {
      const path = normalizePagePath(requestedPath);
      const page = (await api(`/projects/${project.id}/pages`, jsonOptions('POST', { name, path, parentPageId, document: blankPage(name) }))).page;
      await refreshPages(project.id); activatePage(page); return true;
    } catch (cause) { setStatus({ message: `Create page failed: ${cause.message}`, tone: 'error' }); setPageManagerError(cause.message); return false; }
  };
  const changePagePath = async () => {
    const requested = window.prompt('Page path', currentPage.path);
    if (requested === null) return;
    try {
      const path = normalizePagePath(requested);
      if (path === currentPage.path) return;
      if (!window.confirm(`Change route from ${currentPage.path} to ${path}? Current internal links will be updated.`)) return;
      if (!await confirmNavigation()) return;
      const page = (await api(`/pages/${currentPage.id}`, jsonOptions('PATCH', { expectedRevision: currentPageRef.current.revision, path }))).page;
      await refreshPages(currentProject.id); activatePage(page);
      setStatus({ message: `Page path saved as ${path}`, tone: 'success' });
    } catch (cause) { setStatus({ message: `Path update failed: ${cause.message}`, tone: 'error' }); setPageManagerError(cause.message); }
  };
  const runPageMutation = async (action, message) => {
    if (!await confirmNavigation()) return false;
    setPageManagerBusy(true); setPageManagerError('');
    try {
      await action();
      const available = await refreshPages(currentProject.id);
      const selected = available.find(page => page.id === currentPageRef.current?.id) || available[0];
      if (selected) activatePage((await api(`/pages/${selected.id}`)).page);
      else { replaceDocument(null); setSavedDocument(null); currentPageRef.current = null; setCurrentPage(null); window.localStorage.removeItem('builder:lastPageId'); }
      setStatus({ message, tone: 'success' });
      return true;
    } catch (cause) {
      const linked = cause.references?.map(item => `${pages.find(page => page.id === item.pageId)?.name || item.pageId} (${item.href})`).join(', ');
      const explanation = cause.status === 409 ? `Conflict: ${cause.message}${linked ? `: ${linked}` : ''}. Reload the page list and review the change.` : cause.message;
      setPageManagerError(explanation); setStatus({ message: explanation, tone: 'error' });
      if (cause.status === 409) await refreshPages(currentProject.id).catch(() => {});
      return false;
    } finally { setPageManagerBusy(false); }
  };
  const changeManagedPage = (page, values) => runPageMutation(async () => {
    const path = normalizePagePath(values.path);
    const revision = page.id === currentPageRef.current?.id ? currentPageRef.current.revision : page.revision;
    await api(`/pages/${page.id}`, jsonOptions('PATCH', { ...values, path, expectedRevision: revision }));
  }, `Updated ${values.name}`);
  const moveManagedPage = (page, parentPageId, index) => runPageMutation(async () => {
    const revision = page.id === currentPageRef.current?.id ? currentPageRef.current.revision : page.revision;
    await api(`/pages/${page.id}/move`, jsonOptions('POST', { expectedRevision: revision, parentPageId, index }));
  }, `Moved ${page.name}`);
  const deleteManagedPage = (page, mode, destinationParentPageId, confirmedPageIds) => runPageMutation(async () => {
    const revision = page.id === currentPageRef.current?.id ? currentPageRef.current.revision : page.revision;
    await api(`/pages/${page.id}`, jsonOptions('DELETE', { expectedRevision: revision, mode, destinationParentPageId, confirmedPageIds }));
  }, `Deleted ${page.name}`);
  const createNewProject = async requestedName => {
    if (!await confirmNavigation()) return false;
    const name = typeof requestedName === 'string' ? requestedName : window.prompt('Project name', 'New project');
    if (name === null) return false;
    setProjectManagerBusy(true); setProjectManagerError('');
    try {
      const project = (await api('/projects', jsonOptions('POST', { name }))).project;
      ++projectOpenToken.current;
      setProjects(previous => [...previous, project]); setCurrentProject(project); setPages([]); setAssets([]); replaceDocument(null); setSavedDocument(null); currentPageRef.current = null; setCurrentPage(null);
      window.localStorage.setItem('builder:lastProjectId', project.id);
      window.localStorage.removeItem('builder:lastPageId');
      await createNewPage(project, true);
      await refreshProjects();
      return true;
    } catch (cause) { setStatus({ message: `Create project failed: ${cause.message}`, tone: 'error' }); setProjectManagerError(cause.message); return false; }
    finally { setProjectManagerBusy(false); }
  };
  const renameProject = async (project, name) => {
    setProjectManagerBusy(true); setProjectManagerError('');
    try {
      const updated = (await api(`/projects/${project.id}`, jsonOptions('PATCH', { name, expectedVersion: project.version }))).project;
      setProjects(previous => previous.map(item => item.id === updated.id ? updated : item));
      if (currentProject?.id === updated.id) setCurrentProject(updated);
      setStatus({ message: `Renamed project to ${updated.name}`, tone: 'success' });
      return true;
    } catch (cause) { setProjectManagerError(cause.message); await refreshProjects().catch(() => {}); return false; }
    finally { setProjectManagerBusy(false); }
  };
  const removeProject = async (project, confirmation) => {
    if (dirty && currentProject?.id === project.id) { setProjectManagerError('Save or discard unsaved page edits before deleting this project.'); return false; }
    setProjectManagerBusy(true); setProjectManagerError('');
    try {
      await api(`/projects/${project.id}`, jsonOptions('DELETE', { name: confirmation, expectedVersion: project.version, expectedCounts: { pageCount: project.pageCount, revisionCount: project.revisionCount, assetCount: project.assetCount } }));
      const remaining = await refreshProjects();
      if (currentProject?.id === project.id) {
        const next = remaining[0];
        if (next) await openProject(next);
        else { ++projectOpenToken.current; replaceDocument(null); setSavedDocument(null); setCurrentProject(null); currentPageRef.current = null; setCurrentPage(null); setPages([]); setAssets([]); window.localStorage.removeItem('builder:lastProjectId'); window.localStorage.removeItem('builder:lastPageId'); }
      }
      setStatus({ message: `Deleted project ${project.name}`, tone: 'success' });
      return true;
    } catch (cause) { setProjectManagerError(cause.message); await refreshProjects().catch(() => {}); return false; }
    finally { setProjectManagerBusy(false); }
  };
  const saveAsCopy = async () => {
    const name = window.prompt('Name for a copy of this page', `${currentPage.name} copy`);
    if (name === null) return;
    const requestedPath = window.prompt('Path for the copy', `/copy-${Date.now().toString(36)}`);
    if (requestedPath === null) return;
    try {
      const path = normalizePagePath(requestedPath);
      const page = (await api(`/projects/${currentProject.id}/pages`, jsonOptions('POST', { name, path, document }))).page;
      await refreshPages(currentProject.id); activatePage(page);
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
      <div className="header-actions"><select aria-label="Project" value={currentProject?.id || ''} onChange={event => chooseProject(event.target.value)} disabled={!projects.length}>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select><button className="toolbar-button" onClick={openProjectManager}>Projects</button><button className="toolbar-button" onClick={() => createNewProject()}>New project</button><select aria-label="Page" value={currentPage?.id || ''} onChange={event => choosePage(event.target.value)} disabled={!pages.length}>{pages.map(page => <option key={page.id} value={page.id}>{pageTrail(page, pages).map(item => item.name).join(' > ')} · {page.path}</option>)}</select><button className="toolbar-button" disabled={!currentProject} onClick={() => { setPageManagerError(''); setShowPageManager(true); }}>Pages</button><button className="toolbar-button" disabled={!currentProject} onClick={() => createNewPage(currentProject)}>New page</button><button className="toolbar-button" disabled={!currentPage} onClick={() => createNewPage(currentProject, false, currentPage.id)}>New child</button><button className="toolbar-button" disabled={!currentPage} onClick={changePagePath}>Path</button><span className={`save-indicator ${dirty ? 'dirty' : ''}`} data-save-state={dirty ? 'unsaved' : 'saved'}>{dirty ? 'Unsaved changes' : currentPage ? `Saved · v${currentPage.revision}` : 'No page'}</span><button className="toolbar-button" disabled={!history.past.length || preview} onClick={() => navigateHistory('undo')} title="Undo (Ctrl/⌘+Z)">Undo</button><button className="toolbar-button" disabled={!history.future.length || preview} onClick={() => navigateHistory('redo')} title="Redo (Ctrl/⌘+Shift+Z)">Redo</button><button className="toolbar-button" disabled={!selectedId && !selectedRegion || preview} onClick={() => { setSelectedId(null); setSelectedRegion(null); }} title="Clear selection (Escape)">Clear selection</button><button className="toolbar-button" disabled={!dirty || saving || uploading || !currentPage} onClick={save}>{uploading ? 'Uploading…' : saving ? 'Saving…' : 'Save'}</button>{conflict && <button className="toolbar-button" onClick={saveAsCopy}>Save as copy</button>}<button className="toolbar-button" disabled={!currentPage} onClick={reloadPage}>Reload</button><button className="toolbar-button" disabled={!currentPage || preview} onClick={showHistory}>Revisions</button><button className="toolbar-button" disabled={!currentProject || preview || uploading} onClick={() => setShowExport(true)}>Export</button><button className="toolbar-button" disabled={!document} onClick={download}>Download JSON</button><button className="view-button" disabled={!document} onClick={togglePreview}>{preview ? 'Back to editor' : 'Preview page'}</button></div></header>
    {showProjectManager && <ProjectManager projects={projects} currentProjectId={currentProject?.id} onClose={() => setShowProjectManager(false)} onCreate={createNewProject} onOpen={async id => { if (await chooseProject(id)) setShowProjectManager(false); }} onRename={renameProject} onDelete={removeProject} busy={projectManagerBusy} error={projectManagerError} />}
    {showPageManager && currentProject && <PageManager pages={pages} currentPageId={currentPage?.id} dirty={dirty} busy={pageManagerBusy || navigationBusy} error={pageManagerError} onClose={() => setShowPageManager(false)} onSelect={choosePage} onCreate={parentId => createNewPage(currentProject, false, parentId)} onChange={changeManagedPage} onMove={moveManagedPage} onDelete={deleteManagedPage} onInspectReferences={async (page, mode) => api(`/pages/${page.id}/references?mode=${mode}`)} />}
    {pendingNavigation && <div className="project-manager-backdrop"><section className="navigation-dialog" role="dialog" aria-modal="true" aria-label="Unsaved changes" onKeyDown={event => { if (event.key === 'Escape') settleNavigation('cancel'); }}><h2>Unsaved changes</h2><p>Save your page before continuing, discard its edits, or stay here.</p><div><button autoFocus disabled={saving || uploading} onClick={() => settleNavigation('save')}>Save and continue</button><button disabled={saving} onClick={() => settleNavigation('discard')}>Discard changes</button><button onClick={() => settleNavigation('cancel')}>Cancel</button></div></section></div>}
    {showRevisions && !preview && <div className="revision-popover"><strong>Page revisions</strong><p>Restoring creates a new revision.</p><label>Restore from<select aria-label="Revision to restore" value={chosenRevision} onChange={event => setChosenRevision(event.target.value)}>{revisions.map(item => <option key={item.revision} value={item.revision}>Revision {item.revision}</option>)}</select></label><button onClick={restore} disabled={!chosenRevision}>Restore revision</button></div>}
    {showExport && !preview && <div className="export-backdrop" role="presentation"><section className="export-dialog" role="dialog" aria-label="Export project"><div className="export-heading"><h2>Export project</h2><button aria-label="Close export" onClick={() => setShowExport(false)}>×</button></div><p>Download all saved pages and referenced assets as a source project.</p><label>Target<select aria-label="Export target" value={exportTarget} onChange={event => setExportTarget(event.target.value)}><option value="html">HTML5</option><option value="react">React JavaScript/JSX</option><option value="vue">Vue JavaScript</option></select></label>{dirty ? <p className="export-warning">Save the current page before exporting. Unsaved edits are not included.</p> : !exportReport && !exportError ? <p>Checking saved pages…</p> : exportReport && <><h3>Pages</h3><ul>{exportReport.pages.map(page => <li key={page.id}>{page.path} — {page.name}</li>)}</ul>{exportReport.issues.length ? <><h3>Resolve before download</h3><ul className="export-issues">{exportReport.issues.map((item, index) => <li key={index}>{item.pagePath || 'Project'}{item.nodeId ? ` · ${item.nodeId}` : ''} · {item.property}: {item.message}</li>)}</ul></> : <p className="export-ready">Ready to export {exportReport.pages.length} page(s).</p>}</>}{exportError && <p className="field-error" role="alert">{exportError}</p>}<button className="view-button" disabled={dirty || !exportReport || exportReport.issues.length > 0 || exportBusy} onClick={downloadExport}>{exportBusy ? 'Generating…' : 'Download ZIP'}</button></section></div>}
    <div className={`status-bar ${status.tone}`} role="status">{currentPage && <span className="current-page-trail">{pageTrail(pages.find(page => page.id === currentPage.id) || currentPage, pages).map(item => item.name).join(' > ')} · level {pages.find(page => page.id === currentPage.id)?.level ?? 0} · {currentPage.path}</span>}<span>{status.message}</span></div>
    {error ? <div className="error">Could not load the project: {error}. Start the API and PostgreSQL with <code>npm run dev</code>. <button className="toolbar-button" onClick={() => window.location.reload()}>Retry connection</button></div> : !document ? <div className="loading">{currentProject ? 'No page open. Use New page to start editing.' : auth?.user ? 'Create a project to start editing.' : 'Loading page…'}</div> : preview ? <div className="preview-wrap"><div className="preview-toolbar"><strong>Preview</strong><ViewportSwitch breakpoint={breakpoint} onChange={setBreakpoint} /></div><div className="preview-stage" data-preview-breakpoint={breakpoint} style={{ '--preview-desktop-width': `${previewDesktopWidth}px` }}><PageView document={document} pages={pages} interactive={false} breakpoint={breakpoint} onNavigate={navigateFabPreview} /></div></div> : <Editor document={document} pages={pages} projectName={currentProject?.name || "Project"} setDocument={commitDocument} selectedId={selectedId} setSelectedId={setSelectedId} selectedRegion={selectedRegion} setSelectedRegion={setSelectedRegion} breakpoint={breakpoint} setBreakpoint={setBreakpoint} onStatus={(message, tone) => setStatus({ message, tone })} onUploadAsset={uploadAsset} assets={assets} />}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
