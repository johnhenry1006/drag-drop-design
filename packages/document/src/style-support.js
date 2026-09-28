export const supportedStyles = new Set([
  'alignItems', 'alignSelf', 'backgroundColor', 'border', 'borderColor', 'borderRadius', 'borderStyle', 'borderWidth', 'boxShadow',
  'color', 'columnGap', 'display', 'flex', 'flexBasis', 'flexDirection', 'flexGrow', 'flexShrink', 'flexWrap',
  'fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'gap', 'gridColumn', 'gridRow', 'gridTemplateColumns',
  'gridTemplateRows', 'height', 'justifyContent', 'justifyItems', 'letterSpacing', 'lineHeight', 'margin',
  'marginBottom', 'marginLeft', 'marginRight', 'marginTop', 'maxHeight', 'maxWidth', 'minHeight', 'minWidth',
  'objectFit', 'opacity', 'padding', 'paddingBottom', 'paddingLeft', 'paddingRight', 'paddingTop',
  'rowGap', 'textAlign', 'textDecoration', 'textTransform', 'width'
]);

export const cssName = name => name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
export const styleName = name => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
