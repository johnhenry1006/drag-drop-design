export const linkNode = node => node?.type === 'Button' || node?.type === 'Link' || (node?.type === 'Floating Action Button' && node.props.action === 'link');

export function resolveLinkHref(node, pages) {
  if (!linkNode(node)) return null;
  const targetPageId = node.props.targetPageId;
  if (!targetPageId) return node.props.href;
  const page = pages.find(item => item.id === targetPageId);
  return page ? `${page.path}${node.props.anchor ? `#${node.props.anchor}` : ''}` : null;
}
