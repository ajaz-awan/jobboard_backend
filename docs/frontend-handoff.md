# Frontend integration handoff

Use the OpenAPI definition at `/api/openapi.json` for all 51 method/path contracts. This is a backend API, not an admin UI or frontend.

## Browser authentication

Keep the returned access JWT in memory. Register/login/refresh/logout fetches need `credentials:'include'`. Bearer endpoints use `Authorization: Bearer <token>`. Cookie refresh/logout also require `X-CSRF-Protection: 1`. Serialize refresh calls; duplicate/retried old refresh tokens revoke that session family. On 401 show login. On 403 distinguish verification, role and recent-login messages. Read [authentication.md](authentication.md) before wiring login.

Build `/verify-email` and `/reset-password` screens that read `#token=...`, remove it from the browser history, then POST the token. Email scanners cannot consume links through a GET. Reset asks the user to confirm their new password, then returns to login. An unverified user must complete signup verification before login or protected API access.

## Main route groups

| Group | Key routes |
| --- | --- |
| Auth | `/api/auth/register`, `/login`, `/refresh`, `/logout`, `/logout-all`, `/sessions`, `/verify-email`, `/verify-signup`, `/forgot-password`, `/reset-password`, `/change-password` (all under `/api/auth`) |
| Account | GET/PATCH `/api/users/me`; PATCH `/api/users/me/logo` |
| Directory | GET `/api/jobs`; GET `/api/jobs/:id`; GET `/api/jobs/saved`; PUT/DELETE `/api/jobs/:id/save` |
| Employer | GET `/api/jobs/mine`; POST `/api/jobs`; PATCH/DELETE `/api/jobs/:id`; GET `/api/applications/job/:jobId`; PATCH `/api/applications/:id/status` |
| Candidate | POST `/api/applications`; GET `/api/applications/my`; PATCH `/api/applications/:id/withdraw`; GET `/api/applications/:id/resume` |
| Notifications | GET `/api/notifications`, `/api/notifications/unread-count`; PATCH `/api/notifications/read-all`, `/api/notifications/:id/read` |
| Reports | POST `/api/jobs/:id/report`; GET `/api/reports/my` |
| Own dashboard | GET `/api/dashboard` |
| Admin | GET `/api/admin/dashboard`, `/users`, `/jobs`, `/reports`, `/audit-logs`; PATCH `/api/admin/users/:id/status`, `/jobs/:id/moderation`, `/reports/:id` (under `/api/admin`) |

## Payloads and state

- Registration: `{name,email,password,role,company_name?}`; role candidate/employer. Admins are host-provisioned. Password policy: >=12 characters, <=72 UTF-8 bytes.
- Registration returns `{success,email,verification_required:true,message}` with no user, access token or login cookie. POST `/api/auth/verify-signup` with `{email,otp}` to verify a 6-digit code, then log in. Login and protected routes reject unverified accounts.
- Login: `{email,password}` -> `{success,user,token,verification_required}` + HttpOnly refresh cookie. Profile is `{success,data}`. Do not display internal fields or store refresh cookies in JavaScript.
- Job: title, description, location?, job_type?, salary_min?, salary_max?, status?, work_mode?, experience_level?, skills? (<=20), expires_at? (future ISO/null). Owner create/edit uses strict fields; never send moderation fields, owner ID or revision as job-edit payload.
- New jobs/content edits are pending admin review. Owner dashboard shows moderation state. Public directory shows only published available jobs. For admin approval, send `{status:'approved'|'blocked',reason,revision}` using the current reviewed `job.revision`; on 409 reload/review again.
- Application submission is FormData: `job_id`, optional `cover_letter`, `resume` PDF. Logo FormData field is `logo` (PNG/JPEG/WebP). Do not manually set multipart Content-Type; let the browser set its boundary. Max 5 MB. Retry 503 capacity errors after Retry-After; never retry non-idempotent application submission blindly.
- Employer decisions: `{status:'pending'|'accepted'|'rejected'}`. Final decisions cannot be reversed. Candidate withdrawal is a PATCH with no required body.
- Resume endpoint returns a binary PDF attachment, not a JSON URL. Fetch with Bearer auth, convert to Blob, create a temporary object URL, trigger download, then revoke the object URL. Do not embed the private path in a public image/iframe link. Logos use an API-relative URL and need the API origin prepended if the frontend is another origin.
- Reports: `{reason:'scam'|'spam'|'discrimination'|'misleading'|'other',details?}`. Admin report review: `{status:'resolved'|'dismissed',note}`. Review alone does not block the job.
- Admin account state: `{status:'active'|'suspended',reason}`. Administrative mutations require login within 15 minutes; show a re-login prompt on that 403.
- Notifications use `{success,data,total,page,totalPages,count}`. Scope/expiry is server-enforced. Render notification/report/job text without HTML interpretation.
- UUID IDs remain strings. Dates use ISO. Monetary salary integers follow your product's chosen currency; the backend does not perform currency conversion or payroll calculation.

Job lists return `jobs`; most other paginated lists return `data`, plus pagination metadata. Query `page`, `limit` (<=50); applications support status including withdrawn; notifications `read=all|unread`. Directory supports q/title/location/job_type/work_mode/experience_level/salary_min/sort. `salary_min` filters maximum advertised salary. Directory status cannot expose closed/draft jobs.

All errors include `success:false`, safe `message`, usually `requestId`; validation errors include field `errors`. Health and rate-limit responses can be smaller. Handle 400 validation, 401 login, 403 permission/verification, 404 unavailable, 409 stale/final/duplicate, 413 oversized upload, 415 malware detection, 429 limits and 503 dependency/capacity errors.

Do not treat a successful mocked/local test as a deployed browser integration check. Verify HTTPS, trusted proxy hops, same-site cookie behavior, SMTP links, uploaded files and actual database permissions on staging before launch.

## Public discovery and clearable listing fields

GET `/api/jobs` and GET `/api/jobs/:id` accept anonymous requests for approved, open, unexpired listings owned by an active employer. Supplying a Bearer header still validates the credential. Pending/closed/private owner views need the authenticated owner/admin. Mine, saved jobs, application writes/downloads, profiles and all administrative APIs remain protected.

PATCH job fields `salary_min`, `salary_max`, and `location` accept `null` to remove their stored values. Omission preserves the stored value. Content edits still resubmit moderation.
