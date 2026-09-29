# Deployment runbook

Status: **staging deployment is blocked pending infrastructure selection and authorization**. This is a provider-neutral, single-host Docker Compose procedure, not a provider-specific infrastructure plan. Do not use the example hostname or credentials as real values. Do not change production DNS or publish production without separate authorization.

## Record the target before running commands

| Item | Required decision or value |
| --- | --- |
| Host | Provider, region, host name, SSH/deployment identity, container registry or image transfer method, and one API replica initially |
| HTTPS | Staging FQDN, DNS owner, TLS certificate/renewal owner, trusted ingress that forwards that host to `127.0.0.1:8080` |
| Database | PostgreSQL 17+ provider, private endpoint, TLS policy/CA, database and least-privilege role, connection limit and backup owner |
| Assets | S3-compatible provider, private bucket, region, optional endpoint, API identity/credentials, versioning and offsite backup owner |
| Secrets | Named secret manager and injection method for `DATABASE_URL`, object-store credentials if needed, and bootstrap account password |
| Operations | Account recovery owner, backup retention/RPO/RTO, log/alert destination, staging deployment approval |

No actual provider, region, domain, database endpoint, bucket, secret manager, or deployment credentials are recorded in this repository. The included Compose file is the selected **packaging pattern**, not a hosting-provider selection. Do not add provider-specific infrastructure code until the provider and resource identifiers are supplied.

## Provision infrastructure

1. Provision a host with Docker Engine and Compose v2. Restrict inbound traffic to HTTPS ingress and approved administration access. Compose binds web to loopback and does not publish the API. Give the host outbound access to the private database and object service.
2. Provision PostgreSQL 17+ on a private endpoint. Require TLS, size the connection limit for `DB_POOL_MAX` times the API replica count plus maintenance connections, and enable encrypted offsite backups. Verify a restore to an isolated database before launch.
3. Create a private, versioned S3-compatible bucket. Block public access. Grant the API identity only the object permissions needed for new `assets/` keys, any existing `projects/` keys, and the bucket health check. Verify anonymous reads fail. Enable offsite object backups; versioning alone is not a backup.
4. Configure the staging FQDN and TLS ingress. Forward that host's `/` and `/api/` to the loopback web listener. Preserve the original `Host` and client IP; do not expose port 3001. Limit request bodies to 11 MB or slightly above, and set a request timeout compatible with the 30-second API limit. Only set `TRUST_PROXY=true` if the ingress is trusted and overwrites forwarded headers.
5. Configure central collection of JSON stdout logs, 5xx and 429 rates, API readiness failures, database errors, object-store errors, disk space, and backup job failures. Name an on-call owner. The in-process limiter assumes one API replica; add a shared ingress limiter before scaling beyond one.

## Environment and secrets

Copy [`deploy/.env.production.example`](.env.production.example) to repository-root `.env.production` **on the target host only** after fetching values from the selected secret manager. Restrict it to the deployment account (`chmod 600 .env.production`), keep it out of backups and image contexts, and remove it when the deployment is retired. The file is Git-ignored and Docker-ignored. This file delivery is a Compose adapter; the real secret-management service and rotation procedure must still be chosen. Avoid passing secret values in shell command arguments or CI logs.

| Variable | Meaning |
| --- | --- |
| `PUBLIC_ORIGIN` | Exact `https://` staging origin, with no path or trailing slash; used for write-origin checks |
| `DATABASE_URL` | PostgreSQL URL for the least-privilege role, with TLS required and credentials from the secret manager |
| `DB_POOL_MAX` | Per-API connection pool maximum; default 10 |
| `S3_BUCKET`, `S3_REGION` | Private asset bucket and its region |
| `S3_ENDPOINT` | Private-compatible endpoint if needed; leave empty for AWS S3 |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Both only when workload identity is unavailable; rotate through the secret manager |
| `WEB_PORT` | Optional host loopback port, default 8080; set in the Compose interpolation environment or a root `.env`, not only in `.env.production` |

Compose sets `NODE_ENV=production`, `AUTH_MODE=local`, `ASSET_STORE=s3`, and `API_HOST=0.0.0.0`. `BUILDER_USER_EMAIL` and `BUILDER_USER_PASSWORD` are temporary bootstrap inputs, never committed or kept in `.env.production`. The password must have at least 12 characters. Check that the environment contains no placeholders before continuing. Do not print `docker compose config` without `--no-env-resolution`: it can expose secrets.

## Build, migrate, and start

Run from the repository root. Pin the release to a reviewed commit and record its hash and image digests. The current Compose file builds on the host; keep source and `.env.production` readable only to the deployment account.

```bash
npm ci
npm run lint
npm test
npm run test:api
npm run test:editor
npm run build
docker compose -f deploy/compose.production.yaml config --no-env-resolution --quiet
docker compose -f deploy/compose.production.yaml build api web migrate
```

Before changing an existing deployment, stop writes or schedule downtime, back up **both** database and bucket as one recovery set, and record the current image digests. The SQL migrations are additive, versioned in `schema_migrations`, and guarded by a PostgreSQL advisory lock. Run the one-shot job before starting the API. A nonzero exit is a stop condition; inspect logs and restore if needed. API startup also checks/reruns migrations idempotently, so a rolling deployment without migration coordination is not supported by this procedure.

```bash
docker compose -f deploy/compose.production.yaml --profile ops run --rm migrate
docker compose -f deploy/compose.production.yaml up -d api web
docker compose -f deploy/compose.production.yaml ps
```

For a database upgraded from bytea assets, run `docker compose -f deploy/compose.production.yaml run --rm api npm run assets:backfill -w @builder/api` after migration and before reopening writes. It verifies source and read-back checksums, records bucket/key, retains the original database bytes, and can resume; verify `SELECT count(*) FROM assets WHERE object_key IS NULL` is zero. Decide on a separate verified cleanup of duplicate bytes later. For a new database, fetch temporary `BUILDER_USER_EMAIL` and `BUILDER_USER_PASSWORD` into the protected operator environment, then run `docker compose -f deploy/compose.production.yaml run --rm -e BUILDER_USER_EMAIL -e BUILDER_USER_PASSWORD api npm run user:create -w @builder/api`. Clear those variables immediately after use. Do not leave bootstrap values in the persistent service environment. Record the recovery owner before creating real users.

## Health and post-deploy smoke

From the host, `curl -fsS http://127.0.0.1:8080/healthz` must return `ok`; `curl -fsS http://127.0.0.1:8080/api/health/ready` must return `{"ok":true}`. Repeat over the staging HTTPS FQDN and inspect TLS, response headers, and Secure/HttpOnly/SameSite session cookies. A ready result checks PostgreSQL and the object-store bucket, but does not prove backup or access policy. Check that direct public access to API port 3001, database, and bucket is denied.

Using a staging account in the browser: sign in; create a project and blank page; add a node directly to Main and nest Containers; upload a PNG; save, reload, and reopen; verify the image and page revision; preview; download HTML, React, and Vue ZIPs; unpack each ZIP and run its documented build; verify bundled asset bytes. Check a second account cannot read the first account's project, page, revision, asset, or export. Confirm 4xx errors are useful and that readiness, 5xx/429, log delivery, and backup alerts reach the owner. Record URL, commit, image digests, migration versions, test results, and any failure in the release record.

## Backup, restore, rollback

Set retention and RPO/RTO with the owner. Pause writes so database and bucket form one recovery point. Record UTC time, application commit/image digests, `SELECT version FROM schema_migrations ORDER BY version`, database backup ID, bucket version/snapshot ID, and checksum/restore results. Store encrypted backups offsite. A database dump alone omits uploaded image bytes.

For a protected operator workstation with PostgreSQL tools, use `pg_dump --format=custom --file=builder-YYYYMMDD.dump "$DATABASE_URL"` to create a logical backup. Prefer the provider's managed snapshot for large databases. Restore to an **isolated** database with `pg_restore --clean --if-exists --no-owner --dbname="$RESTORE_DATABASE_URL" builder-YYYYMMDD.dump`; restore matching bucket object versions or snapshot before opening writes. Do not point a restored database at a live bucket. Test readiness, revisions, image retrieval, and all three exports on the isolated stack. Never edit `schema_migrations` to force a downgrade.

For an application-only failure with no schema/data incompatibility, return to the recorded previous image digests and verify readiness plus smoke. If a migration or asset change breaks compatibility, stop writes and restore the paired database and bucket recovery set to a separate environment, then cut traffic only after verification. Escalate if a clean recovery set or tested restore is unavailable.

## Release gate

No-go until the target identifiers and secret manager are chosen, a staged restore succeeds, migrations and authenticated browser/export smoke pass on the actual staging services, TLS/IAM/private-network checks pass, and monitoring/backup owners accept the release. Staging deployment also requires explicit authorization and usable deployment credentials. Production publication and DNS changes require separate explicit authorization.

Known safeguards still open: no password reset, MFA, invitation, asset deletion/reconciliation, or full image decode/re-encode/malware scan. React/Vue exported projects require history fallback at their eventual host. Review these against the intended users before production launch.
