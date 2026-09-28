# drag-drop-design

A JavaScript/JSX foundation for a visual website builder. The editor loads a validated version 1 JSON sample from a Node.js API. Header, Main, and Footer are flexible document regions. The editor has an Elements palette, Layers tree, desktop canvas, and a docked Properties panel. Drag-and-drop and click-to-add update Page JSON through pure tree operations.

## Run locally

Use Node.js 22.12+ and Docker with Compose. From the repository root:

```bash
npm install
docker compose up -d db
npm run dev
```

Open http://127.0.0.1:5173. The API listens at http://127.0.0.1:3001. Check `http://127.0.0.1:3001/api/health/db` for the PostgreSQL connection. Docker maps PostgreSQL to localhost port 15432 to avoid conflicts with existing local servers. Override `DATABASE_URL` and `API_PORT` with environment variables if needed; `apps/api/.env.example` shows the defaults.

```bash
npm test
npm run test:editor
npm run build
```

`npm run test:editor` uses the installed Google Chrome and expects the editor and API from `npm run dev` to be running at ports 5173 and 3001. Set `CHROME_PATH` or `EDITOR_URL` to override those defaults.

The sample page is served from memory. PostgreSQL is configured and the connection can be checked, but there are no project tables or save routes yet.

## Editor controls

Select a region in Layers, then click an Elements item to add it directly to Header, Main, or Footer. Select a container or layout to add inside it; select a leaf to add after it. Drag a palette item onto a region or node on the canvas to place it precisely. Drag existing nodes by the handle in Layers. The top and bottom quarters of a node mean **before** and **after**; its center means **inside** if it accepts children. A blue marker shows the planned insertion; a red outline and status message explain invalid drops. Expand container rows in Layers to select nested content. Properties shows selection breadcrumbs and order buttons. Download JSON saves the current in-memory Page document.

The Elements panel has optional Layout suggestions for each region. The `＋ Layout` action beside a region in Layers opens its suggestions. Header offers navigation and banner, Main offers Hero, two columns, and Gallery, and Footer offers links and contact. A suggestion inserts ordinary nodes at the selection in that region (inside a selected container, after a selected element, or at the end of the region). You can move, edit, restyle, or remove those nodes with the same controls as any other content. Gallery images use embedded SVG image URLs in Page JSON.

Preview page opens a clean page view without Elements, Layers, Properties, selection outlines, or drop targets. Its desktop, tablet, and mobile controls use the same Page JSON and CSS cascade as the canvas. The desktop preview retains the current canvas page width for a direct spacing comparison. Back to editor preserves the document and active viewport.

## Document operations and exports

`@builder/document` exposes immutable `addNode(page, parent, index, node)`, `removeNode(page, id)`, `updateNode(page, id, { props, styles, advancedCss })`, `moveNode(page, id, parent, index)`, and `reorderNode(page, id, index)`. A parent is a region name (`header`, `main`, `footer`) or a container node ID. Indices refer to the final child list and are zero based. `findNode(page, id)` returns `{ node, parentId, region, index }` or `null`; `getAncestors(page, id)` returns ancestor node IDs from outermost to immediate parent. Operations validate the resulting document and leave the input unchanged.

The Properties panel stays beside the canvas on desktop. Select a node to edit its Content, Layout, or Style. The canvas toolbar switches between desktop, tablet, and mobile. Desktop styles form the base; tablet and mobile fields store only overrides. Clear an override to inherit the wider breakpoint. The box model shows margin outside and padding inside. Advanced CSS accepts property/value declarations only. The validator rejects selectors, at-rules, unsupported properties, invalid values, `!important`, and resource loading functions. Accepted declarations are scoped to the selected node. The canvas, preview, and exporters use the same CSS generator and breakpoint cascade (tablet at 900px, mobile at 600px).

Generate the three projects from the same sample JSON:

```bash
npm run export:sample
```

Outputs are in `generated/html`, `generated/react`, and `generated/vue`. Serve `generated/html` with any static server. Run `npm install` and `npm run dev` inside either source project. The generated directories are ignored by Git. Exporters currently support Section, Container, Layout, Navigation, Heading, Text, Image, Button, Link, and the CSS properties listed in `packages/document/src/style-support.js`; an unsupported property fails with its node ID and breakpoint.
