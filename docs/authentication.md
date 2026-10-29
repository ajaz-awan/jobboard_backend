# Authentication lifecycle

## Status and upgrade

This version adds email verification, password recovery/change, server-side sessions, refresh-token rotation/replay detection, logout, logout-all and device/session management. It works with standalone local MongoDB; no hosted database is required.

Existing users/jobs/applications/files remain in the same database/directory. New indexes/collections are created on startup without dropping data. Existing users have `email_verified=false` until they verify their email. Old JWTs do not contain the required session claims and must be replaced by logging in. Do not reset the database or mark all users verified as a shortcut.

When updating an extracted project, stop the old server, back up your folder/database, replace the source/package files, run `npm ci --ignore-scripts`, preserve your `.env` and `uploads` directory, then restart. New email settings have development defaults, so your current `.env` still works. Preserve its existing `JWT_SECRET`.

## Endpoints

All paths below start with `/api/auth`. JSON validation rejects extra fields. Tokens must be sent in JSON, not URL parameters.

| Method / route | Input | Behavior |
| --- | --- | --- |
| POST /register | name, email, password, role?, company_name? | Creates pending account, queues OTP/link, returns email + verification_required; no access token, user, cookie or session |
| POST /login | email, password | Requires verified email; creates server session and returns access token/refresh cookie |
| POST /resend-verification | email | Generic response; queues mail only for eligible unverified account |
| POST /verify-signup | email, otp (6 digits) | Activates pending account once; sign in separately |
| POST /verify-email | token | Consumes unexpired verification link once |
| POST /forgot-password | email | Generic response; queues reset link if eligible |
| POST /reset-password | token, password | Changes password, consumes reset link, invalidates all old sessions; log in again |
| POST /change-password | current_password, new_password | Bearer auth; changes password, clears pending resets and invalidates all sessions |
| POST /refresh | Empty body, refresh cookie, CSRF header | Rotates refresh token and returns new access token |
| POST /logout | Empty body, refresh cookie, CSRF header | Idempotently revokes this cookie's session and clears the cookie |
| POST /logout-all | Empty body, Bearer auth | Signs out every device and clears cookie |
| GET /sessions | Bearer auth | Lists up to 50 own active sessions, newest first; marks current session |
| DELETE /sessions/:id | Bearer auth | Revokes one owned session; ownership is enforced |

Unverified users cannot log in, refresh a session, or access protected routes. Previously issued unverified sessions cannot bypass this gate. Existing verified users retain normal access.

Registration returns `{success:true, email, verification_required:true, message}` and creates no login session. Login/refresh return `user`, `token` and `verification_required`. Sensitive hashes and attempt counters are never returned.

Signup OTPs are six cryptographically random digits, expire after 10 minutes and allow at most five failed attempts per challenge. Stored OTPs use a server-keyed HMAC bound to the normalized email; raw codes appear only in the encrypted mail queue and the delivered email/private local outbox. Resends share the existing 60-second per-account cooldown and reset the challenge's attempt count. IP rate limiting also covers `/verify-signup`. Consumption is atomic: concurrent correct submissions can activate only once. A verification link is included as a compatibility fallback; using either method invalidates both challenges. No session is issued by either verification endpoint: sign in afterwards.


## Email delivery

Local development defaults to `MAIL_TRANSPORT=outbox`. The server worker writes JSON email previews into the private `.mail-outbox` directory. These are local previews, **not delivered messages**. That directory contains sensitive single-use links: keep it private, do not commit/serve/share it, and remove old previews when no longer needed. It is ignored by Git and Docker.

Emails are queued durably in MongoDB as AES-256-GCM encrypted payloads, separate from token hashes stored on users. The encryption key is derived from the server JWT secret using HKDF with a separate purpose label. Rotating the JWT secret invalidates pending queued email payloads; request new links after rotation. Sent payloads are removed from MongoDB, and queue documents expire automatically.

A worker in `server.js` polls once per second, leases one job at a time, retries failures with backoff (up to 5 attempts), and skips expired jobs. SMTP sending runs outside the request handler. Logs contain job IDs/attempt counts, never message bodies or raw tokens. Monitor failed jobs (`attempts >= 5`, `sent_at=null`) and SMTP configuration; users can request a fresh link after cooldown. Delivery is at least once: a crash after SMTP accepts an email but before the database acknowledges it can cause a duplicate email. Links remain single-use.

For real email configure a provider-issued sender and SMTP credentials in `.env`:

```env
MAIL_TRANSPORT=smtp
MAIL_FROM=noreply@your-real-domain.com
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=your-provider-username
SMTP_PASS=your-provider-password
```

Port 465 uses immediate TLS; other ports require STARTTLS. TLS certificate verification remains enabled. Production startup rejects outbox mode, missing SMTP credentials, a `.local` sender, an HTTP frontend or placeholder JWT secrets. A provider mailbox/domain verification and correct SPF/DKIM/DMARC setup are separate deployment tasks. Real delivery has not been tested against your provider; no credentials were supplied.

Verification links expire after 24 hours, reset links after 30 minutes. There is a 60-second per-account/per-kind resend cooldown plus IP rate limiting. Verification and reset tokens are separate cryptographically random 32-byte values, stored only as SHA-256 hashes on the user. Token consumption and password updates are conditional atomic MongoDB updates, so concurrent reuse cannot succeed twice.

Forgot-password/resend endpoints return the same response for unknown/ineligible/known accounts. Lookup paths have a common 200 ms response floor, and SMTP is asynchronous; this reduces timing differences rather than guaranteeing identical latency under all database/network conditions. Signup still reports duplicate emails as 409.

## Frontend integration

The OTP patch includes only the changed frontend auth files. The signup screen asks for the emailed code and returns to login after verification. Login also offers a code/resend form for pending accounts. Email links point to the configured frontend's `/verify-email#token=...` or `/reset-password#token=...`. The fragment avoids placing raw tokens in server request URLs. Build those screens later: read the fragment, remove it from browser history, and POST the token to the backend. GET requests do not consume links, so email scanners do not verify/reset accounts automatically. Password forms should ask for confirmation before submitting.

Keep access JWTs in memory. Browser registration/login/refresh/logout requests must use `credentials: 'include'` so the browser stores/sends the HttpOnly cookie. Do not put refresh tokens into localStorage, frontend JavaScript or response JSON. Do not log tokens.

Example refresh request:

```js
const response = await fetch(`${API_URL}/api/auth/refresh`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'X-CSRF-Protection': '1' },
});
// On success, replace the in-memory access token with response.token.
// On 401, clear client auth state and show login.
```

Refresh/logout require `X-CSRF-Protection: 1`; untrusted Origin headers are rejected. CORS allows credentials only for `CLIENT_URL`. Cookies are host-only, HttpOnly, SameSite=Lax, scoped to `/api/auth`, and Secure in production. Host frontend/API on the same site in production (or use a same-site reverse proxy); arbitrary cross-site deployments do not work with SameSite=Lax. Frontend integration must verify the actual deployed browser cookie flow.

Serialize refresh calls in the frontend. Each refresh can be used once: if a used token is replayed (including parallel duplicate refreshes or a retry after a lost response), the whole session family is revoked. A fabricated secret cannot revoke an existing family. Absolute session expiry defaults to 7 days (`REFRESH_TOKEN_DAYS`, range 1–30); rotation does not extend it. Each family is capped at 1000 rotations to bound history size. Do not auto-retry a failed refresh blindly; log in again if necessary.

## Revocation and boundaries

Each JWT contains a session ID and user auth version. Every protected request checks both the current user and an active unexpired session. Logout/revoking a session therefore blocks its access JWT immediately on subsequent requests. Password reset/change and logout-all atomically increment the user's auth version, invalidating every old access/refresh token even if later session-cleanup writes fail. Concurrent requests already authorized before revocation may finish.

The JWT lifetime defaults to 15 minutes. Session TTL indexes are cleanup only; expiry is always checked explicitly. There is no MFA, passkey flow or admin management UI in this change.

MongoDB account-token updates, queue insertion and session creation are separate documents/operations on a standalone server. A database/process failure can leave an account created without a queued message or leave delivery cleanup pending. Resend/forgot-password are retry paths; queue-write failure clears the matching link/cooldown for retry. This does not claim cross-document transaction guarantees. Keep backups, monitor workers and use a replica-set/transactional outbox design if strict cross-document delivery guarantees are required.

## Verification

Automated tests run against disposable real MongoDB instances and private temporary file directories. They cover token expiry/purpose/single use, verification gates, password reset/change, session/refresh/logout behavior, replay detection, CSRF, CORS, secret masking, mail encryption/retries/leases/outbox and existing job/application features. Tests send no external email. Browser integration, real SMTP delivery, deployment configuration and an independent security review remain separate checks.
