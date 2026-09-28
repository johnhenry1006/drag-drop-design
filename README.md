# drag-drop-design

A JavaScript/JSX foundation for a visual website builder. The editor loads a validated version 1 JSON sample from a Node.js API. Header, Main, and Footer are editable document regions; the current UI supports selecting nodes and editing their text properties. Drag-and-drop, project CRUD, asset management, and source exporters are future increments.

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
npm run build
```

The sample page is served from memory. PostgreSQL is configured and the connection can be checked, but there are no project tables or save routes yet.

## Document operations and exports

`@builder/document` exposes immutable `addNode(page, parent, index, node)`, `removeNode(page, id)`, `updateNode(page, id, { props, styles })`, `moveNode(page, id, parent, index)`, and `reorderNode(page, id, index)`. A parent is a region name (`header`, `main`, `footer`) or a container node ID. Indices refer to the final child list and are zero based. `findNode(page, id)` returns `{ node, parentId, region, index }` or `null`; `getAncestors(page, id)` returns ancestor node IDs from outermost to immediate parent. Operations validate the resulting document and leave the input unchanged.

Generate the three projects from the same sample JSON:

```bash
npm run export:sample
```

Outputs are in `generated/html`, `generated/react`, and `generated/vue`. Serve `generated/html` with any static server. Run `npm install` and `npm run dev` inside either source project. The generated directories are ignored by Git. Exporters currently support Section, Container, Layout, Heading, Text, Image, Button, and the basic CSS properties listed in `packages/exporters/src/index.js`; an unsupported property fails with its node ID and breakpoint.
