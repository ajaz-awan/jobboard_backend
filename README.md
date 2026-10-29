# Job Board Backend — v2

Express / MongoDB / Mongoose / Zod. Includes authentication, jobs, applications, admin APIs, moderation, reports, notifications and production adapters. Frontend is a separate project.

## Local setup

Use Node.js 24 (minimum 22.12) and a running MongoDB Server. MongoDB Compass alone is only a viewer. Docker/cloud accounts are not needed for local development.

```bash
npm ci --ignore-scripts
npm run setup
npm run dev
```

`setup` creates `.env` with a random JWT secret and `MONGODB_URI=mongodb://127.0.0.1:27017/jobboard`; it preserves an existing `.env`. The server builds required indexes before listening. Open `http://localhost:5000/health/ready` for `{"success":true}`. Connection failure prevents startup; check your MongoDB service, URI and port.

Already using the earlier MongoDB version? Follow [UPDATE_INSTRUCTIONS.md](UPDATE_INSTRUCTIONS.md), preserving `.env`, `uploads` and your database. No SQL migration or database reset is needed. Existing users and jobs are retained. Existing jobs without moderation metadata remain approved; **new jobs require administrator approval**.

## Features

| Area | Included |
| --- | --- |
| Authentication | Candidate/employer signup, email verification, password recovery/change, short-lived access tokens, rotating HttpOnly refresh cookies, replay detection, logout/all-devices logout, session revocation |
| Job directory | Published available jobs, text/substring search, salary filters/sorting, pagination, work modes, experience levels, skills, deadlines |
| Employer | Own jobs/drafts, revisions, applicant lists, final accept/reject decisions |
| Candidate | Saved jobs, private PDF applications/history/downloads, pending application withdrawal, reports |
| Administration | Account suspension/reactivation, revision-checked job approval/blocking, report review, aggregate dashboard, audit trail |
| Accounts | Own profile and employer logos; no self-service admin privilege assignment |
| Notifications | Private, paginated in-app inbox, unread count and read actions; 90-day retention |
| Storage | Local development files or private S3/S3-compatible storage, authenticated resume streaming, cleanup retries |
| Operations | Encrypted durable email queue/retries, request IDs, safe structured logs, Mongo-backed distributed rate limits, health endpoints, Docker/Compose/reverse-proxy templates |
| Upload security | MIME/signature validation, 5 MB cap, bounded multipart fields, concurrent-upload cap, production ClamAV integration with fail-closed scanner errors |

## API and frontend handoff

The full definition covers every declared route: [docs/openapi.json](docs/openapi.json), also served at `/api/openapi.json`.

- [Frontend handoff](docs/frontend-handoff.md): endpoint groups, payload conventions and integration rules.
- [Authentication](docs/authentication.md): verification/reset screens, cookies, CSRF and sessions.
- [Backend release behavior](docs/backend-release.md): moderation, permissions, dashboards, notifications and data boundaries.
- [Deployment](docs/deployment.md): SMTP, private S3, scanner, shared limits, containers and backups.

IDs remain UUID strings, including MongoDB `_id`s; API responses expose `id`. Do not replace them with ObjectIds. Dates are ISO timestamps. Lists use `page=1&limit=10` with limit <= 50 and page <= 10000. Unknown JSON/query fields are rejected. Passwords require at least 12 characters and at most 72 UTF-8 bytes. Employers need `company_name`.

All business writes require verified email except personal profile edits, pending application withdrawal and notification read actions. Suspended accounts cannot authenticate or refresh. Directory browsing never reveals pending/blocked/expired jobs or jobs from suspended employers. Owners can inspect their drafts through `/api/jobs/mine` and `/api/jobs/:id`.

## First administrator

Create and verify a real account, then a trusted operator on the backend host can grant admin access:

```bash
npm run admin:grant -- --email verified-owner@example.com
```

The script requires a verified active account and invalidates old sessions. Log in again. There is no HTTP admin signup/promotion endpoint. Admin accounts cannot be suspended through HTTP; manage administrator access through trusted database operations. Admin write APIs require a login within 15 minutes, even if an access token has been refreshed.

## Tests and checks

```bash
npm test
npm run test:integration
npm audit --omit=dev
```

Or run `npm run check` for unit + integration suites. `npm run docs:generate` regenerates OpenAPI from current endpoint/input definitions.

Integration tests run disposable real MongoDB processes on random ports and isolated temporary files; the first run downloads a test MongoDB binary. They never use or delete your configured development database. S3 and ClamAV protocol tests use controlled doubles/local test sockets; tests send no external email. Real browser integration, SMTP delivery, bucket/IAM policies, antivirus definitions, container deployment and load testing require the selected infrastructure.

## Configuration defaults

Local defaults: filesystem uploads, email previews in a private outbox, per-process memory limits and no external antivirus daemon. Local previews are not sent to inboxes. Production startup requires SMTP, a real sender, HTTPS frontend, shared Mongo limits and ClamAV. Use private S3 or explicitly opt into a durable local volume. See `.env.production.example` and deployment docs.

Never commit `.env`, uploads or email previews. Keep MongoDB off the public network. Docker runs the API as the unprivileged `node` user. Keep dependencies/images patched and back up both database and stored files.
