# Project instructions

## Product and language

- Build a visual, drag-and-drop website builder that persists a versioned JSON document, previews pages, and exports HTML5, React, and Vue source projects.
- Use JavaScript and JSX only. Do not add TypeScript, `.ts` or `.tsx` files, type or interface declarations, or TypeScript configuration. Do not migrate existing code to TypeScript.

## Document and editing model

- Header, Main, and Footer are flexible regions. Each accepts elements, containers, and layouts directly in any order; containers may nest in every region.
- Layout presets are optional suggestions. They must not lock the nodes created from them. A region's semantic role determines its exported HTML tag, not what users can edit within it.
- Persist a document schema version and stable, unique node IDs. Persist only JSON data: never functions, React components, or DOM nodes.
- Make the editor, preview, and exporters consume the same document model. Do not scrape the editor DOM or produce React or Vue by replacing strings in HTML.
- Define each element's defaults, editable properties, child rules, renderer, and export support in an element registry.
- Store CSS on individual nodes and breakpoints. Validate Advanced CSS and scope it to the selected node.
- Make tree operations prevent cycles, duplicate IDs, and invalid HTML structures while allowing every otherwise valid placement and nesting pattern.

## Delivery and verification

- Implement changes in small, reviewable increments. After each change, run relevant checks and report changed files, commands run, results, and remaining limitations.
- Add meaningful tests for risky behavior, including tree moves, responsive CSS, and exported projects. Avoid tests that merely mirror the implementation.

## Sample page preservation

- Do not delete, replace, blank out, or hide existing sample pages or their required assets as part of feature work or cleanup unless the user explicitly requests that removal. Keep their stable page IDs, project ownership, hierarchy, content, styles, and internal links. A generic instruction to refactor, add CRUD, remove unused code, or build production is not authorization to remove sample pages. This applies to developer actions and automatic scripts.
- Canonical system sample pages and their owning system project are reference templates. Application users, including ordinary admins, cannot delete, archive, move, or edit them through normal CRUD. Protect them using server-controlled sample keys and metadata, never page titles. Fixture maintenance is an explicit, reviewed operation separate from routine startup; startup must not reset stored sample content or revisions.
