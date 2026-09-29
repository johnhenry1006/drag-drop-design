import { useMemo, useState } from 'react';

export function pageTrail(page, pages) {
  const byId = new Map(pages.map(item => [item.id, item]));
  const trail = [];
  const seen = new Set();
  for (let item = page; item && !seen.has(item.id); item = byId.get(item.parentPageId)) {
    seen.add(item.id); trail.unshift(item);
  }
  return trail;
}

export function PageManager({ pages, currentPageId, dirty, busy, error, onClose, onSelect, onCreate, onChange, onMove, onDelete }) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState(new Set());
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [path, setPath] = useState('');
  const [moving, setMoving] = useState(null);
  const [parentId, setParentId] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [mode, setMode] = useState('subtree');
  const [destination, setDestination] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const children = useMemo(() => {
    const groups = new Map();
    for (const page of pages) { const key = page.parentPageId || ''; groups.set(key, [...(groups.get(key) || []), page]); }
    return groups;
  }, [pages]);
  const descendants = id => {
    const result = new Set([id]);
    const visit = parent => { for (const child of children.get(parent) || []) { result.add(child.id); visit(child.id); } };
    visit(id); return result;
  };
  const query = search.trim().toLocaleLowerCase();
  const matching = new Set();
  if (query) for (const page of pages) if (`${page.name} ${page.slug} ${page.path}`.toLocaleLowerCase().includes(query)) for (const ancestor of pageTrail(page, pages)) matching.add(ancestor.id);
  const visible = pages.filter(page => {
    if (query) return matching.has(page.id);
    return pageTrail(page, pages).slice(0, -1).every(ancestor => !collapsed.has(ancestor.id));
  });
  const setEdit = page => { setEditing(page.id); setName(page.name); setSlug(page.slug); setPath(page.path); setMoving(null); setDeleting(null); };
  const setMove = page => { setMoving(page.id); setParentId(page.parentPageId || ''); setEditing(null); setDeleting(null); };
  const setDelete = page => { setDeleting(page.id); setMode('subtree'); setDestination(''); setConfirmation(''); setEditing(null); setMoving(null); };
  const focusRow = (event, offset) => {
    const rows = [...event.currentTarget.closest('[role="tree"]').querySelectorAll('[data-page-select]')];
    const index = rows.indexOf(event.currentTarget);
    rows[Math.max(0, Math.min(rows.length - 1, index + offset))]?.focus();
  };
  const toggle = id => setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const keepFocus = event => {
    if (event.key === 'Escape') { onClose(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')];
    if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
  };
  const renderPage = page => {
    const childCount = (children.get(page.id) || []).length;
    const trail = pageTrail(page, pages).map(item => item.name).join(' > ');
    const subtree = descendants(page.id);
    const destinations = pages.filter(candidate => !subtree.has(candidate.id));
    const siblingCount = (children.get(parentId) || []).filter(item => item.id !== page.id).length;
    return <li key={page.id} role="treeitem" aria-level={page.level + 1} aria-selected={page.id === currentPageId} className={page.id === currentPageId ? 'active' : ''}>
      <div className="page-tree-row" style={{ '--page-depth': page.level }}>
        {childCount ? <button type="button" className="page-tree-toggle" aria-label={`${collapsed.has(page.id) && !query ? 'Expand' : 'Collapse'} ${page.name}`} aria-expanded={query || !collapsed.has(page.id)} onClick={() => toggle(page.id)}>{collapsed.has(page.id) && !query ? '▸' : '▾'}</button> : <span className="page-tree-spacer" />}
        <button type="button" data-page-select disabled={busy} aria-current={page.id === currentPageId ? 'page' : undefined} onClick={() => onSelect(page.id)} onKeyDown={event => {
          if (event.key === 'ArrowDown') { event.preventDefault(); focusRow(event, 1); }
          if (event.key === 'ArrowUp') { event.preventDefault(); focusRow(event, -1); }
          if (event.key === 'Home') { event.preventDefault(); focusRow(event, -pages.length); }
          if (event.key === 'End') { event.preventDefault(); focusRow(event, pages.length); }
          if (event.key === 'ArrowLeft' && childCount && !collapsed.has(page.id)) { event.preventDefault(); toggle(page.id); }
          if (event.key === 'ArrowRight' && childCount && collapsed.has(page.id)) { event.preventDefault(); toggle(page.id); }
        }}><strong>{page.name}</strong><small>{trail} · level {page.level} · {page.path}{page.id === currentPageId ? dirty ? ' · Draft' : ' · Saved' : ''}</small></button>
      </div>
      <div className="page-tree-actions"><button disabled={busy} onClick={() => onCreate(page.id)}>Create child</button><button disabled={busy} onClick={() => setEdit(page)}>Rename / path</button><button disabled={busy} onClick={() => setMove(page)}>Move / order</button><button disabled={busy} onClick={() => setDelete(page)}>Delete</button></div>
      {editing === page.id && <form className="page-manager-form" onSubmit={async event => { event.preventDefault(); if (await onChange(page, { name, slug, path })) setEditing(null); }}><label>Name<input value={name} onChange={event => setName(event.target.value)} required maxLength={120} /></label><label>Sibling slug<input value={slug} onChange={event => setSlug(event.target.value)} required pattern="[a-z0-9]+(-[a-z0-9]+)*" /></label><label>URL path<input value={path} onChange={event => setPath(event.target.value)} required /></label>{path !== page.path && <p>Route change: {page.path} → {path}. Current internal links will be updated.</p>}<button disabled={busy}>Apply changes</button><button type="button" onClick={() => setEditing(null)}>Cancel</button></form>}
      {moving === page.id && <form className="page-manager-form" onSubmit={async event => { event.preventDefault(); if (await onMove(page, parentId || null, Number(event.currentTarget.elements.position.value))) setMoving(null); }}><label>Parent<select value={parentId} onChange={event => { setParentId(event.target.value); event.currentTarget.form.elements.position.value = '0'; }}><option value="">Root</option>{destinations.map(candidate => <option key={candidate.id} value={candidate.id}>{pageTrail(candidate, pages).map(item => item.name).join(' > ')}</option>)}</select></label><label>Position among siblings (0–{siblingCount})<input name="position" type="number" min="0" max={siblingCount} step="1" defaultValue={page.sortOrder} required /></label><p>Moving keeps this page and its descendants at their current URLs.</p><button disabled={busy}>Move page</button><button type="button" onClick={() => setMoving(null)}>Cancel</button></form>}
      {deleting === page.id && <div className="page-manager-form"><p>Delete “{page.name}”? Choose what happens to its {subtree.size - 1} descendant page(s). {mode === 'subtree' ? `This deletes ${subtree.size} pages and ${pages.filter(item => subtree.has(item.id)).reduce((count, item) => count + item.revision, 0)} revisions.` : `This deletes one page and its ${page.revision} revisions; direct children move to the selected parent.`} Project assets stay in the project. Pages linking to a deleted route must be fixed first.</p><label>Delete policy<select value={mode} onChange={event => setMode(event.target.value)}><option value="subtree">Delete page and entire subtree ({subtree.size} pages)</option><option value="reparent">Delete page and move its direct children</option></select></label>{mode === 'reparent' && <label>Move children under<select value={destination} onChange={event => setDestination(event.target.value)}><option value="">Root</option>{destinations.map(candidate => <option key={candidate.id} value={candidate.id}>{pageTrail(candidate, pages).map(item => item.name).join(' > ')}</option>)}</select></label>}<label>Type page name to confirm<input value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label><button className="danger" disabled={busy || confirmation !== page.name} onClick={async () => { if (await onDelete(page, mode, destination || null, mode === 'subtree' ? [...subtree] : [page.id])) setDeleting(null); }}>Confirm deletion</button><button onClick={() => setDeleting(null)}>Cancel</button></div>}
    </li>;
  };
  return <div className="project-manager-backdrop"><section className="project-manager page-manager" role="dialog" aria-modal="true" aria-label="Manage pages" onKeyDown={keepFocus}><div className="project-manager-heading"><div><h2>Pages</h2><p>Select a page or manage its place in this project.</p></div><button aria-label="Close pages" onClick={onClose}>×</button></div>{error && <p role="alert" className="field-error">{error}</p>}{busy && <p role="status">Updating pages…</p>}<div className="page-manager-top"><label>Search pages<input type="search" autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, slug, or URL" /></label><button disabled={busy} onClick={() => onCreate(null)}>Create root page</button></div>{!pages.length ? <p className="project-manager-empty">No pages yet. Create a root page to start.</p> : !visible.length ? <p className="project-manager-empty">No pages match “{search}”.</p> : <ul className="page-tree" role="tree" aria-label="Page hierarchy">{visible.map(renderPage)}</ul>}</section></div>;
}
