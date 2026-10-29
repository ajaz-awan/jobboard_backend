# Deployment and operational setup

## What is included / what needs your accounts

Code includes SMTP delivery, private S3 storage, ClamAV protocol integration, shared Mongo rate limits, worker retries, health endpoints, request logs, a non-root API Dockerfile, Compose wiring and reverse-proxy configuration. It does not contain your provider credentials, DNS/TLS certificates or a running production deployment. No external email, bucket write, container deployment or database change was made on your accounts during development.

Real infrastructure must be configured and tested on staging. S3 tests use controlled SDK doubles, antivirus tests use a local protocol stub, and Mongo integration tests use real disposable MongoDB processes. Docker/Compose files have not been built/launched in this workspace (no Docker daemon is available). Pin deployment images to reviewed version/digests and scan them before production use.

## Development remains simple

Your installed MongoDB Server plus `npm run setup` / `npm run dev` still works. Defaults are local files, private email previews, per-process memory rate limits and no external malware daemon. Do not expose an unauthenticated local MongoDB to the internet. The `.env.production.example` template is separate and never overrides your local `.env` automatically.

## Production configuration

Copy `.env.production.example` to your private `.env.production` and fill the real values. For a Node deployment, inject those variables through your host/secret manager (dotenv loads `.env` by default; it does not automatically load `.env.production`). Never commit real environment files.

Production startup requires:

- HTTPS `CLIENT_URL` and a strong random JWT secret.
- Real SMTP sender/credentials and `MAIL_TRANSPORT=smtp`. Configure provider domain/mailbox verification and SPF/DKIM/DMARC separately. Email verification/reset links must target your actual frontend screens.
- `RATE_LIMIT_STORE=mongo`. API/auth/refresh/report counters are shared across processes, increment atomically and reset using their stored deadline rather than waiting for Mongo TTL cleanup. Counter identifiers hash the limiter key. A shared-store outage fails requests closed.
- `MALWARE_SCAN=clamav`, a private reachable `CLAMAV_HOST:CLAMAV_PORT`, current virus definitions and enough scanner resources. Startup scans an empty stream to verify reachability; uploads are scanned before writes. Scanner protocol errors, detections/timeouts prevent writes. ClamAV's TCP service is not an authenticated public endpoint; isolate it.
- Private S3 storage, or `ALLOW_LOCAL_STORAGE_IN_PRODUCTION=true` with a durable, writable `UPLOAD_DIR` volume. S3 starts with a HeadBucket check; actual Put/Get/Delete/IAM operations still need staging verification.

### Private object storage

Use `STORAGE_DRIVER=s3`, region, bucket and optional compatible endpoint/path style. Prefer an IAM role. If static keys are necessary, set both access/secret keys. Allow only the required bucket/prefix: Head/List bucket for startup, and Get/Put/Delete for `jobboard/resumes/*` and `jobboard/logos/*` (or your configured prefix). Configure Block Public Access/private bucket, encryption at rest, retention/versioning and backups through the provider. The app sets no public ACL; both file types can live in the private bucket because the API serves authorized PDFs/public logo responses.

Uploads use conditional `If-None-Match:*` so immutable keys are not overwritten. An S3-compatible provider must support these operations. Credentials and internal SDK errors are not returned to clients. A same-origin authenticated resume download is streamed through the API; there is no browser-accessible bucket credential or public resume URL.

If moving existing local uploads to S3, preserve the source directory and database, configure the private target and run on a trusted host:

```bash
npm run storage:migrate -- --copy-referenced-local-files
```

The script copies only files referenced by applications/current logo records, verifies signature/size and the configured malware scan, keeps the same keys, and **never deletes local files or changes DB references**. Existing target keys are skipped (not overwritten); verify their contents independently. The summary reports copied/existing/failed counts without printing private file paths. Failed/missing source files require investigation before switching live traffic. Do not assume setting STORAGE_DRIVER copies files automatically.

### Durable local disk alternative

Set the explicit local-production opt-in only when your host provides a durable writable private volume. Container ephemeral filesystems and serverless temporary directories are not durable storage. Back up files and database together. Never mount uploads as a public static directory. S3 and local drivers are alternatives, not a dual-read fallback; perform a reviewed copy before switching drivers.

## Containers and proxy

`deploy/compose.production.yml` wires MongoDB, ClamAV and the API. It exposes only the API on host loopback; Mongo/ClamAV have no published host ports. The Mongo init script creates a separate `readWrite` application user in the jobboard database; the app does not use the root credential. Generate separate long random hex root/application passwords (hex avoids URI-reserved characters). Set all SMTP/S3/frontend/proxy values first.

From the repository root:

```bash
docker compose --env-file .env.production -f deploy/compose.production.yml config --quiet
docker compose --env-file .env.production -f deploy/compose.production.yml up --build -d
```

The configuration command validates wiring without printing resolved secrets. Allow time/disk/RAM for MongoDB and the initial antivirus definitions. Review health checks against the pinned images. The application filesystem is read-only except its uploaded-file volume and temporary mount; the API runs unprivileged with capabilities dropped. Mongo init runs only on a new data volume. Changing env passwords later does not rotate existing Mongo credentials; use trusted database operations. Never delete production volumes to fix a password mismatch.

Use `deploy/nginx.conf.example` on your TLS ingress, replacing the domain/certificate paths. `TRUST_PROXY_HOPS=1` is appropriate only for that exact single trusted proxy path; choose the actual hop count if your platform differs. The example overwrites forwarded client headers. Do not expose the API directly with a proxy-trust configuration that assumes every request passed through your ingress. Keep frontend/API on the same site for SameSite=Lax refresh cookies, or use a same-site reverse proxy.

## Monitoring, backups and recovery

`/health/live` is process liveness; `/health/ready` reflects MongoDB connectivity, not proof every external provider is healthy. Startup separately checks indexes/storage/scanner. Request/error logs contain generated request IDs, route templates, status/duration and safe event names rather than bodies, credentials, tokens or raw URLs. Enable `LOG_REQUESTS=true` outside production when needed; production logs requests automatically.

Monitor email jobs with attempts >=5 and sent_at=null, cleanup jobs with attempts >=5, repeated dependency/scan failures and `audit_completion_pending`/notification failures. Email delivery is at least once; a send/ack crash can duplicate a single-use-link email. Cleanup retries target known stale keys only; they do not sweep arbitrary uploads. Operators can investigate and reset failed retry counters after fixing the cause.

Keep tested MongoDB backups (your provider snapshot mechanism or MongoDB Database Tools), plus S3 versioning/backups or consistent disk snapshots of local uploads. Encrypt backups, restrict access and rehearse restoration into a separate environment. MongoDB data dumps alone do not include stored files. Preserve the JWT secret for decrypting pending queued emails; if rotating it after compromise, revoke sessions, request fresh account links and reconcile old encrypted jobs. Do not restore a backup over production without a reviewed recovery plan.

This template does not create TLS/DNS, scheduler jobs, paid services or monitoring accounts. Frontend/live-provider integration, recovery drills, load testing and independent security review remain launch checks rather than hidden code features promised as already performed.
