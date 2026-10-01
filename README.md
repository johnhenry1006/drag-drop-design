# drag-drop-design

A JavaScript/JSX foundation for a visual website builder. The editor opens version 1 Page JSON from a Node.js API backed by PostgreSQL. Header, Main, and Footer are flexible document regions. The editor has an Elements palette, Layers tree, desktop canvas, and a docked Properties panel. Drag-and-drop and click-to-add update Page JSON through pure tree operations.

## Run locally

Use Node.js 22.12+ and Docker with Compose. From the repository root:

```bash
npm install
docker compose up -d db s3-ninja
cp apps/api/.env.example apps/api/.env.local
# Fill the local S3 Ninja credentials shown at http://localhost:9444/ui
set -a
. apps/api/.env.local
set +a
node scripts/create-test-bucket.js
npm run db:migrate -w @builder/api
npm run dev
```

Open http://127.0.0.1:5173. The API listens at http://127.0.0.1:3001. Check `http://127.0.0.1:3001/api/health/ready` for PostgreSQL and S3 readiness. Docker maps PostgreSQL to localhost port 15432. S3 Ninja's host endpoint and UI are at `http://localhost:9444`; another container in this Compose network uses `http://s3-ninja:9000`. Use the host endpoint in `.env.local` because `npm run dev` runs the API on the host. These emulator credentials stay server-side; the bucket and S3 Ninja UI/API are for local development, never a public production endpoint. The ignored `.env.local` holds your actual local values; `.env.example` has no keys.

S3 Ninja writes to the named `builder_s3_data` volume. Upload an image, record its `/api/assets/{id}/content` URL, run `docker compose restart s3-ninja`, then reload the page or fetch that URL again to confirm identical bytes. A normal container restart preserves the volume; `docker compose down -v` removes named volumes and their data. If port 9444 is occupied, start Compose with `S3_NINJA_PORT=19444 docker compose up -d db s3-ninja` and set `S3_ENDPOINT=http://127.0.0.1:19444` in your ignored env file. If an API container joins this Compose network, give it `S3_ENDPOINT=http://s3-ninja:9000` instead. Do not run `assets:backfill` merely to start S3 Ninja: existing database assets remain readable without moving their bytes.

```bash
npm test
npm run test:api
npm run test:editor
npm run build
npm run verify:exports
```

`npm run test:api` uses the local PostgreSQL database and removes the test projects it creates. `npm run test:editor` uses the installed Google Chrome, the same database, and the editor and API from `npm run dev` at ports 5173 and 3001. Set `CHROME_PATH` or `EDITOR_URL` to override the browser defaults. The API also runs the idempotent schema migration at startup.

`npm run verify:exports` requires the running editor and API. It creates a temporary two-page project, downloads and unzips HTML5, React JSX, and Vue ZIPs into ignored `generated/verification/`, builds and serves all three, compares content and computed spacing with Preview at desktop and mobile viewports, checks bundled image rendering and `/about` navigation, then removes its temporary database project.

### System reference templates

`npm run db:migrate -w @builder/api` and API startup apply additive migrations and initialize the system template project. `npm run db:seed` is an explicit repeatable initialization command. Both create missing known fixtures in a transaction and leave existing sample documents, revisions, hierarchy, and assets unchanged. Migration 007 adds unique `systemKey`/`sampleKey` and `fixtureVersion` metadata, plus database guards for protected projects, pages, and assets. The two current fixtures are the original Northstar page and a responsive showcase with a bundled PNG. The showcase uses flexible Header/Main/Footer regions, nested containers, breakpoint styles, and supported elements. Its image is stored under a stable asset ID and bundled into HTML5, React, and Vue exports.

Signed-in users can view and export the ownerless system project; local open-access mode can do the same. The editor shows it as view only. Normal API updates, moves, restores, page/subtree/bulk deletion, project deletion, and asset changes cannot alter the canonical fixtures. Ordinary user projects keep their existing CRUD flow. Fixture keys come from server code and database metadata, not page names or client payloads. Existing databases with a recorded, previously removed sample are left unchanged rather than having their unknown history rewritten; inspect backups before any manual recovery.

Open **Projects → Sample templates** to preview a canonical page or choose **Use this template**. The system project's **Pages** manager also shows each sample with a read-only badge and the same actions. Choose an editable destination project, select one or more sample pages, and enter a name and URL path for each copy. The copy opens in the normal editor and can be renamed, moved, saved, exported, and deleted. Each copy receives new page, node, and referenced asset IDs; bundled assets are copied into the destination project's asset ownership. The originals and their revisions stay untouched. The API routes are `GET /api/templates` and `POST /api/projects/:projectId/templates/copy` with `{ "pages": [{ "samplePageId", "name", "path" }] }`. Local-account users can copy only into projects they own.

When selected samples link to one another, select the complete set in the copy dialog. The server remaps page-ID and literal URL links, including node anchors, to the new pages and reports links to omitted samples. The copy is rejected atomically if a sample-owned asset is missing or a destination path collides. Links to other local routes are kept only when the destination project already has that route. Current fixtures use supported HTML5, React, and Vue elements and styles; external image URLs in future fixtures would remain external rather than becoming bundled assets. Copying requires an existing editable project and supports up to 20 pages per operation.

Routine startup does not apply content revisions to existing fixtures. To deliberately revise a fixture, review the new Page JSON and assets, increment its fixture version in `apps/api/src/system-samples.js`, and ship a separate, reviewed data migration that locks the system project, uses `SET LOCAL builder.sample_maintenance='on'` inside one transaction, writes a new page revision, and verifies referenced assets and exports. Back up the database first. Older API builds reject schema version 7, so rollback requires a compatible API build or restoration from a pre-migration backup; do not drop the protection metadata while retaining system templates.

### Migrate older local image bytes

Pages and revisions keep stable `/api/assets/{id}/content` references; moving bytes does not edit Page JSON. With the local S3 environment loaded as above, inspect and copy older PostgreSQL `bytea` assets:

```bash
npm run assets:backfill -w @builder/api -- --dry-run
npm run assets:backfill -w @builder/api -- --migrate
npm run assets:backfill -w @builder/api -- --verify
```

The dry-run validates source checksums and reports pending, dual-backed, and object-only counts without writing. Migration is resumable: it uploads each object, checks its bytes, records bucket/key, then reads through the API storage path. Rerunning it skips completed assets and verifies them again. **Original PostgreSQL bytes remain present.** If `pending` is zero, no migration is needed. For a local rollback, run `npm run assets:backfill -w @builder/api -- --rollback` with the same S3 bucket configuration. It validates retained database bytes and switches dual-backed rows for that bucket back to database reads; object-only uploads are untouched. Rerun `--migrate` after correcting the problem. Back up PostgreSQL and the S3 Ninja volume before any later cleanup, and do not use `docker compose down -v` on data you need.

PostgreSQL stores projects, pages, immutable page revisions, account sessions, and asset metadata. New local uploads use S3 Ninja when `ASSET_STORE=s3`; older database-byte assets remain readable and are not changed by this setup. PostgreSQL records the bucket, opaque object key, checksum, and other metadata for new objects. Production requires a private S3-compatible object store. Page documents are versioned JSONB and are validated with `@builder/document` before create, update, or restore. The API initializes system reference templates once. Page saves use an expected revision and return HTTP 409 when another save has won; restoring an old revision creates a new current revision.

S3 Ninja is a **local test emulator**. Production requires a separately validated durable self-hosted S3-compatible service with tested backup and restore, private access controls, and an operations owner. This setup does not publish S3 Ninja or select a paid cloud service.

The toolbar creates and opens projects and pages, marks unsaved changes, saves, reloads, and restores revisions. **Projects** opens a searchable management list with page counts, last activity, access information, rename, and deletion. Deletion requires the project name and shows the affected page, revision, and asset counts. **Pages** opens a searchable hierarchy with expand/collapse, level, URL, and draft/saved state. It provides rename, slug/path edit, child creation, move/order, and explicit subtree-delete or child-reparent choices. **New page** creates a root; **New child** uses the selected page as parent. Switching projects or pages with unsaved edits offers Save, Discard, or Cancel. It remembers the last opened page in this browser. A conflicting save keeps local edits and offers **Save as copy**. An Image node's Content tab uploads validated PNG, JPEG, GIF, or WebP files up to 10 MB, or reuses an asset already in the project. Each upload gets a stable `/api/assets/{id}/content` URL; removing a node never deletes its asset. Asset bytes remain available to Preview after reload and restoration.

Each page has a stored full path such as `/` or `/about`. Pages also have a nullable same-project parent, a sibling slug, and a sibling order. Existing pages were migrated as roots; level is the number of ancestors. Moving a page or editing its slug does not change its URL. Button, Link, and link-action FAB properties can select a page in the current project by stable page ID, with an optional anchor. Preview and each export resolve that ID to the page's current path. Existing literal URLs, external URLs, and hash links stay literal; changing a path atomically rewrites current literal internal URLs while historical revisions remain unchanged. Missing or cross-project page IDs are rejected on save and reported before export. The Pages manager lists inbound references before deletion and requires them to be fixed; page hierarchy never changes because of a link. Paths stay unique within a project and slugs stay unique among siblings. The New page and Path controls still create or change the stored path. **Export** checks every saved page, node, CSS property, link, and asset for the selected target. It shows exact unsupported items before enabling Download ZIP. Save unsaved edits first. ZIPs contain all saved pages, referenced uploaded assets, desktop/tablet/mobile CSS, and a target-specific README. HTML5 uses directory index files and relative links. React and Vue use client-side History API routing; production hosts need a fallback to `index.html` for nested paths. The generated projects include `dev`, `build`, and `preview` package scripts.

Exports read each distinct referenced asset through the server storage adapter and bundle it in the ZIP. A missing or corrupt referenced asset fails export with its ID; unreferenced assets are not fetched. The resulting projects serve bundled images from their own `assets/` directory and need no S3 Ninja or editor API connection. External image URLs intentionally remain external and still require their original hosts; local-service and editor-API image URLs are rejected.

API routes include `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`, `GET/POST /api/projects/:id/pages`, `GET/PUT/PATCH/DELETE /api/pages/:id`, `POST /api/pages/:id/move`, `GET /api/pages/:id/references?mode=subtree|reparent`, `GET /api/pages/:id/revisions`, `GET /api/pages/:id/revisions/:revision`, `POST /api/pages/:id/restore`, `GET/POST /api/projects/:id/assets`, `GET /api/assets/:id`, `GET /api/assets/:id/content`, plus `GET /api/projects/:id/exports/:target/check` and `GET /api/projects/:id/exports/:target.zip`. Page creation accepts `parentPageId` and `slug`; page move accepts `parentPageId`, final sibling `index`, and `expectedRevision`. Page deletion requires `expectedRevision`, an explicit `mode` (`subtree` or `reparent`), and the exact `confirmedPageIds`; `reparent` also requires `destinationParentPageId` (or `null` for root). It rejects deletion while surviving pages link to removed paths. Project rename requires `expectedVersion`; project deletion requires its exact name, version, and displayed counts. It deletes database dependents in one transaction and queues unshared S3 objects for retryable cleanup. Account routes are `GET /api/auth/me`, `POST /api/auth/login`, and `POST /api/auth/logout`. Local development defaults to open access; production requires local-account sessions and owner-scoped API access. There is no standalone asset deletion endpoint. Exported ZIPs bundle referenced uploaded images; external image URLs still depend on their hosts.

## Editor controls

Select a region in Layers, then click an Elements item to add it directly to Header, Main, or Footer. Select a container or layout to add inside it; select a leaf to add after it. Drag a palette item onto a region or node on the canvas to place it precisely. Drag existing nodes by the handle in Layers. The top and bottom quarters of a node mean **before** and **after**; its center means **inside** if it accepts children. A blue marker shows the planned insertion; a red outline and status message explain invalid drops. Expand container rows in Layers to select nested content. Properties shows selection breadcrumbs and order buttons. **Save** writes Page JSON to PostgreSQL; **Download JSON** makes a local copy.

The Elements panel has optional Layout suggestions for each region. The `＋ Layout` action beside a region in Layers opens its suggestions. Header offers navigation and banner, Main offers Hero, two columns, and Gallery, and Footer offers links and contact. A suggestion inserts ordinary nodes at the selection in that region (inside a selected container, after a selected element, or at the end of the region). You can move, edit, restyle, or remove those nodes with the same controls as any other content. Gallery images use embedded SVG image URLs in Page JSON.

Preview page opens a clean page view without Elements, Layers, Properties, selection outlines, or drop targets. Its desktop, tablet, and mobile controls use the same Page JSON, asset URLs, and CSS cascade as the canvas. The desktop preview retains the current canvas page width for a direct spacing comparison. Back to editor preserves the document and active viewport.

## Document operations and exports

`@builder/document` exposes immutable `addNode(page, parent, index, node)`, `removeNode(page, id)`, `updateNode(page, id, { props, styles, advancedCss })`, `moveNode(page, id, parent, index)`, and `reorderNode(page, id, index)`. A parent is a region name (`header`, `main`, `footer`) or a container node ID. Indices refer to the final child list and are zero based. `findNode(page, id)` returns `{ node, parentId, region, index }` or `null`; `getAncestors(page, id)` returns ancestor node IDs from outermost to immediate parent. Operations validate the resulting document and leave the input unchanged.

The Properties panel stays beside the canvas on desktop. Select a node to edit its Content, Layout, or Style. The canvas toolbar switches between desktop, tablet, and mobile. Desktop styles form the base; tablet and mobile fields store only overrides. Clear an override to inherit the wider breakpoint. The box model shows margin outside and padding inside. Advanced CSS accepts property/value declarations only. The validator rejects selectors, at-rules, unsupported properties, invalid values, `!important`, and resource loading functions. Accepted declarations are scoped to the selected node. The canvas, preview, and exporters use the same CSS generator and breakpoint cascade (tablet at 900px, mobile at 600px).

Generate the three projects from the same sample JSON:

```bash
npm run export:sample
```

Outputs are in `generated/html`, `generated/react`, and `generated/vue`. Serve `generated/html` with any static server. Run `npm install` and `npm run dev` inside either source project. The generated directories are ignored by Git. Exporters currently support Section, Container, Layout, Navigation, Heading, Text, Image, Button, Link, and the CSS properties listed in `packages/document/src/style-support.js`; an unsupported property fails with its node ID and breakpoint.

## Deployment preparation

See [deploy/README.md](deploy/README.md) for the deployment preparation report and [deploy/RUNBOOK.md](deploy/RUNBOOK.md) for the operator sequence, required inputs, migrations, backup/restore, verification, and release gate. The repository includes production API and static editor images plus an example Compose file; no deployment is performed by the verification commands.
