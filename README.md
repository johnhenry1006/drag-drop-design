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
