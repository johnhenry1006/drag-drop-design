export const paletteGroupsStorageKey = 'builder:palette-groups:v1';

export function readCollapsedPaletteGroups(storage) {
  try {
    const saved = JSON.parse((storage || window.localStorage).getItem(paletteGroupsStorageKey));
    if (!Array.isArray(saved?.collapsed)) return new Set();
    return new Set(saved.collapsed.filter(group => typeof group === 'string' && group.length > 0 && group.length <= 120));
  } catch { return new Set(); }
}

export function writeCollapsedPaletteGroups(groups, storage) {
  try {
    (storage || window.localStorage).setItem(paletteGroupsStorageKey, JSON.stringify({ collapsed: [...groups] }));
    return true;
  } catch { return false; }
}
