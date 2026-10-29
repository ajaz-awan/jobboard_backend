# Release behavior and operational boundaries

## Access and account state

Signup permits candidate/employer only. Authentication reads the current user role/status/auth version and active server session on every protected request. Suspending a non-admin account increments its auth version and revokes its sessions. Reactivation does not restore old sessions; the user must log in again. Suspension immediately hides its jobs from the directory via an owner lookup and prevents applications/bookmarks.

Verified administrators have `/api/admin` APIs. Administrator mutation requires an original login less than 15 minutes old; refresh does not extend this window. Other admins and self cannot be suspended through these APIs, preventing accidental loss of all administrative access. Provision administrators with the trusted host CLI, not signup. The CLI does not expose passwords or generate a public default admin.

An audit attempt must be persisted before an administrative mutation proceeds. A failed initial audit write prevents the action. Completion/failure is then recorded; if a completion write fails after the action committed, the persisted attempt remains and an operator-visible `audit_completion_pending` event identifies it. Audit records cannot be edited/deleted via HTTP, but this is not tamper-proof against database administrators. Retention/archival is an operator policy; audit rows are not automatically expired.

## Job publication

New jobs start `moderation_status=pending`. Legacy jobs created by earlier MongoDB releases without moderation metadata remain approved to avoid silently removing existing listings. An admin lists/reviews jobs then submits `{status:'approved'|'blocked', reason, revision}`. The revision is conditional: if content changed since review, approval returns 409 and the admin must reload/review again.

Employer content edits resubmit approval; open/closed status-only changes do not change moderation. A blocked job cannot bypass review by reopening. `expires_at` is optional and must be a future ISO timestamp when set; an expired job cannot be reopened without extending/clearing its deadline. Explicit `null` clears a deadline. Deleting jobs is a soft deletion, preserving application history and authorized resumes.

`GET /api/jobs` is the directory of open, approved, non-expired, non-deleted jobs whose owner exists and is not suspended. Use `/api/jobs/mine` for employer drafts/closed jobs, and `/api/admin/jobs` for review. An owner/admin may inspect a draft through its ID; other users get 404. Directory `status` remains accepted for compatibility but cannot expose closed/draft listings.

`q` uses MongoDB's indexed text search over title/description/location. `title` and `location` use escaped literal case-insensitive substring filters. Work mode, experience, job type, salary threshold and sorting are supported. Exact counts and bounded offset pagination are implemented; substring search/deep offsets can still be expensive. Aggregations/reads are capped at 5 seconds. This has not been benchmarked against your production volume.

Existing bookmarks can retain the context of jobs that later become unavailable; opening/applying rechecks visibility. Applicant records and private downloads remain accessible to the applicant and job's owning employer, even after a job is soft-deleted.

## Application lifecycle

Candidate: pending -> withdrawn. Owning employer: pending -> accepted/rejected, or an idempotent same-status request. Final accepted/rejected/withdrawn decisions cannot be reversed. Withdrawal is own/pending only and keeps the application history. Unique candidate/job index prevents duplicate applications and reapplication to the same job after withdrawal.

Application submission checks availability before upload and again after insert. If the job closed, expired, was blocked/deleted, or its owner was suspended during upload, the operation compensates by removing its newly inserted application/file. Standalone MongoDB does not make those documents and storage writes one transaction. Process/database failure can leave reconciliation work; strict cross-document guarantees require a replica set/transactional design and reconciliation. Do not treat compensation as a transaction guarantee.

## Notifications, reports and dashboards

In-app notifications are scoped to the authenticated user. Application submission/decision/withdrawal, job moderation, account status and report review create notifications with deduplication keys. They contain plain text and resource IDs, not resume paths/passwords/tokens. Notifications expire after 90 days; expiry is filtered before asynchronous Mongo TTL deletion. Notification writes are best-effort after the primary action; a notification failure does not roll back a decision. Render all stored text as text in the frontend.

Verified candidates can report a published job for scam/spam/discrimination/misleading/other, once per candidate/job. Reports are private to the reporter and administrators. Admins resolve/dismiss an open report; separate moderation APIs approve/block the job. Reviewing a report alone does not hide a job. Internal review notes are not returned to ordinary reporters.

Candidate/employer dashboards aggregate only the caller's applications/jobs/bookmarks/unread notifications. Admin dashboard aggregates system counts. No public user-list or statistics endpoint exposes private account data.

## File and process safety

Uploads have a 5 MB limit, one file per request, bounded fields and a per-process in-flight upload cap (default 8; excess requests receive 503 + Retry-After). Signature checks reject obvious MIME spoofing. Production requires a reachable ClamAV scanner before startup and before each storage write; a scanner error/time-out rejects the file. ClamAV signatures are not perfect protection: keep definitions current and consider CDR/quarantine requirements for your use case. PDF/image parsing is not a full content-disarm pipeline.

Resumes are never a static public path. Local/S3 downloads go through the same authenticated ownership checks; S3 bodies are streamed rather than loading the whole download into memory. Logos are public through a constrained API path. S3 metadata cannot turn a logo into an HTML response: content type comes from its validated extension and Helmet adds nosniff. S3 uploads use conditional creation and no public ACL.

Replaced logos and known failed-upload objects are removed immediately; failed deletion schedules a durable retry. Cleanup jobs retry five times and remain visible for operator review after exhaustion. This is targeted cleanup, not an automatic sweep/delete of all files that appear unreferenced. No production user data is purged by the release.

## Explicit limits

This release completes the defined job-board backend scope, not every possible future feature. MFA/passkeys, payments, CV parsing/AI matching, full-text-search infrastructure beyond MongoDB, an admin frontend and a legal data-retention workflow are not included. The frontend and live infrastructure integration are separate work. No security score or absence of unknown vulnerabilities is guaranteed by automated tests or a dependency audit.
