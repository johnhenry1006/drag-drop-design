# Deployment preparation (no deployment performed)

For the exact operator sequence, required infrastructure inputs, migrations, backup/rollback, and staging smoke checks, use [RUNBOOK.md](RUNBOOK.md). No hosting provider, real domain, database or bucket resource, or secret-management service has been selected in this repository. The Compose file is provider-neutral and does not provision those resources.

## Intended topology and decisions

Serve the built editor and `/api` from one HTTPS origin. The Nginx web container serves static files and proxies API requests to a private Fastify container. Use a private PostgreSQL 17+ database and a private S3-compatible bucket. TLS terminates at a trusted ingress in front of the web container; the included Compose file binds web only to localhost. Keep the API, database, and bucket off the public network. The S3 bucket must block public access, allow only the API identity to read/write its `projects/` prefix, and have versioning and offsite backup enabled. Prefer provider workload identity to static S3 keys.

Decide before launch: hosting provider and region, DNS/TLS ingress, managed PostgreSQL and S3 provider, account provisioning and recovery owner, backup retention/RPO/RTO, and whether one API instance is enough. The in-process rate limiter is suitable only for one API instance; multiple instances require a shared limiter at the ingress or service layer. Password reset, MFA, account invitation, and asset deletion are not implemented.

## Build and configure

Requirements: Node.js 22.12+ for local commands, Docker/Compose for the example images, PostgreSQL 17+, private S3-compatible bucket, DNS and HTTPS ingress, and credentials supplied outside Git. The API must be able to reach PostgreSQL and S3. Supply a PostgreSQL connection string with TLS enabled for managed hosting. Never publish database, S3, or API ports directly.

1. Copy `deploy/.env.production.example` to repository-root `.env.production` and replace all placeholders. The file is Git-ignored. Use a secret manager in a hosted platform. `PUBLIC_ORIGIN` must be the exact HTTPS editor origin. The API fails startup unless `AUTH_MODE=local`, `ASSET_STORE=s3`, `DATABASE_URL`, and HTTPS `PUBLIC_ORIGIN` are set in production.
2. Create the private S3 bucket and grant the API identity `GetObject`, `PutObject`, and `DeleteObject` only as required, plus `HeadBucket`. Do not grant public reads. If migrating an existing database, back up PostgreSQL and the current asset bytes first.
3. Build images with `docker compose -f deploy/compose.production.yaml build`. Review image and dependency scan results. The Compose example runs only web and API; provision PostgreSQL, object storage, and TLS ingress separately.
4. Run the versioned, advisory-lock-protected migrations with `npm run db:migrate -w @builder/api` using the production environment, or allow API startup to run them. They are additive and recorded in `schema_migrations`. Take a database backup before upgrading; do not roll back schema versions by editing the tracking table.
5. For databases upgraded from bytea assets, run `npm run assets:backfill -w @builder/api` with `ASSET_STORE=s3`. The command verifies each stored checksum, uploads the object, and clears the database bytea after recording its object key. It can be rerun after interruption. Confirm `SELECT count(*) FROM assets WHERE object_key IS NULL` is zero before production cutover.
6. Provision an initial account with `BUILDER_USER_EMAIL` and `BUILDER_USER_PASSWORD` supplied from a secret manager or protected shell environment, then `npm run user:create -w @builder/api`. The password must be at least 12 characters. Remove those temporary variables after the command. Projects belong to the account that created them. Existing unowned sample projects stay hidden in authenticated mode.
7. Place an HTTPS ingress in front of the web container. Forward only the intended host. Allow a maximum request body of at least 11 MB at the ingress; Fastify limits JSON to 2 MB and uploads to 10 MB. The included Nginx applies a restrictive CSP, frame denial, no-sniff, and related headers. API cookies are Secure, HttpOnly, and SameSite=Strict in production.
8. Check `GET /api/health` for liveness and `GET /api/health/ready` for PostgreSQL and S3 readiness. Alert on 503, sustained 5xx/429 responses, database pool errors, and object-store failures. Fastify logs structured JSON to stdout. Collect logs centrally and set retention and redaction rules.

## Backup and restore

Back up the database and object bucket as one recovery set while writes are paused. Record the schema version, application image digest, bucket version/snapshot, and UTC timestamp. Store the set encrypted and offsite, and test restoration on an isolated staging stack before changing production. A database-only backup does not contain new uploaded image bytes.

Example PostgreSQL commands (using protected environment credentials):

```bash
pg_dump --format=custom --file=builder-YYYYMMDD.dump "$DATABASE_URL"
createdb builder_restore
pg_restore --clean --if-exists --no-owner --dbname="$RESTORE_DATABASE_URL" builder-YYYYMMDD.dump
```

Use the object provider's versioned snapshot or backup tool for the bucket at the same paused-write point. For S3-compatible storage, an operator can copy with `aws s3 sync s3://SOURCE_BUCKET s3://RESTORE_BUCKET` using an appropriately scoped profile and endpoint. Restore objects before reopening the API. Run migrations only if the restored image version requires them; then check `/api/health/ready`, sample asset checksums, page revisions, and a full export on the isolated stack. Repoint the application only after those checks pass.

## Verification and release gate

Run `npm run lint`, `npm test`, `npm run test:api`, `npm run test:editor`, `npm run build`, the authenticated S3 browser smoke test, and build both production images. CI runs these checks with an S3-compatible test service. The authenticated smoke test signs in, creates a blank page, uploads an image, nests nodes, saves/reopens, previews, and builds HTML5, React, and Vue ZIP exports.

**Go/no-go checklist** (all boxes must be checked for the actual provider):

- [ ] HTTPS origin and same-origin `/api` routing verified, including Secure session cookies and CSP.
- [ ] Private S3 bucket policy and API identity permissions reviewed; no anonymous object reads.
- [ ] PostgreSQL TLS, least-privilege account, migration backup, and connection limits verified.
- [ ] Initial account provisioned; account recovery owner and credential rotation documented.
- [ ] Offsite database and object backups enabled; an isolated restore passes asset and export checks.
- [ ] Readiness/5xx/429/object-store alerts and log retention configured.
- [ ] CI passes on the release commit; authenticated smoke passes against the selected infrastructure.
- [ ] If more than one API replica is planned, a shared ingress/service rate limiter is enabled.

**No-go** if any box is unchecked or a critical check fails. The local production-image smoke proves functionality but does not prove the target provider's backup, IAM, TLS, or monitoring configuration.

## Remaining safeguards

Uploads verify image signatures, headers, dimensions, file size, and media type, but do not fully decode/re-encode images or scan for malware. Use provider-side malware scanning if required by policy. Deleting a project directly in SQL can leave orphaned S3 objects; establish an object lifecycle/reconciliation job before bulk deletion. Sessions live in PostgreSQL and expire after seven days; there is no password reset or MFA workflow. ZIP export is capped at 100 pages and 100 MB of stored assets. The application rate limiter is in process, so use a gateway-wide limiter for distributed deployments.
