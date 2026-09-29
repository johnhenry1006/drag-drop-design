export const emptyHistory = () => ({ past: [], future: [] });

export function recordChange(history, current, next) {
  if (JSON.stringify(current) === JSON.stringify(next)) return history;
  return { past: [...history.past.slice(-99), current], future: [] };
}

export function travel(history, current, direction) {
  const source = direction === 'undo' ? history.past : history.future;
  if (!source.length) return null;
  const next = source.at(-1);
  return direction === 'undo'
    ? { document: next, history: { past: source.slice(0, -1), future: [...history.future, current] } }
    : { document: next, history: { past: [...history.past, current], future: source.slice(0, -1) } };
}
