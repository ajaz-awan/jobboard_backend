import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
process.env.NODE_ENV = 'test';
process.env.STORAGE_DRIVER = 'local';
process.env.RATE_LIMIT_STORE = 'memory';
process.env.MALWARE_SCAN = 'none';
process.env.JWT_SECRET = 'test-only-secret-'.repeat(4);
process.env.MAIL_TRANSPORT = 'outbox';
process.env.MAIL_OUTBOX_DIR = await mkdtemp(join(tmpdir(), 'jobboard-mail-'));
process.env.UPLOAD_DIR = await mkdtemp(join(tmpdir(), 'jobboard-auth-upload-'));
const { createApp } = await import('../../src/app.js');
const { connectDatabase, closeDatabase } = await import('../../src/config/database.js');
const { User, Session, EmailJob, Job } = await import('../../src/models/index.js');
const { createSession, hashToken, randomToken, refreshCookieName } = await import('../../src/services/sessions.js');
const { processNextMail, mailTransport, enqueueMail } = await import('../../src/services/mail.js');
const { requestAccountEmail } = await import('../../src/services/accountTokens.js');
const { generateToken } = await import('../../src/utils/generateToken.js');
const password = 'Initial-password123!';
const newPassword = 'Replacement-password456!';
const password_hash = await bcrypt.hash(password, 4);
let mongo, server, base, user, session, other, messages;
const originalSend = mailTransport.send;
before(async () => {
  mongo = await MongoMemoryServer.create({ instance: { args: process.platform === 'win32' ? [] : ['--nounixsocket'] } });
  await connectDatabase(mongo.getUri('jobboard_auth_test'));
  server = createApp({ apiLimit: 10000, authLimit: 10000 }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => {
  await Promise.all([User, Session, EmailJob, Job].map(model => model.deleteMany({})));
  user = await User.create({ name: 'Auth Candidate', email: 'candidate@example.com', password_hash, role: 'candidate', email_verified_at: new Date() });
  other = await User.create({ name: 'Other Candidate', email: 'other@example.com', password_hash, role: 'candidate', email_verified_at: new Date() });
  session = await createSession(user, 'Authentication test');
  messages = []; mailTransport.send = async (message, id) => { messages.push({ ...message, id }); };
});
after(async () => {
  mailTransport.send = originalSend;
  if (server) await new Promise(resolve => server.close(resolve)); await closeDatabase(); if (mongo) await mongo.stop();
  await Promise.all([process.env.MAIL_OUTBOX_DIR, process.env.UPLOAD_DIR].map(path => rm(path, { recursive: true, force: true })));
});
async function request(path, { method = 'GET', body, token = session.token, refresh, csrf = true, origin, headers = {} } = {}) {
  const response = await fetch(base + path, { method, headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(refresh ? { Cookie: `${refreshCookieName}=${encodeURIComponent(refresh)}` } : {}),
    ...(csrf ? { 'X-CSRF-Protection': '1' } : {}), ...(origin ? { Origin: origin } : {}), ...headers,
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, headers: response.headers, body: response.status === 204 ? null : await response.json() };
}
function cookieValue(response) {
  const cookie = response.headers.get('set-cookie'); assert.ok(cookie); return decodeURIComponent(cookie.split(';')[0].split('=').slice(1).join('='));
}
async function sendAndGetToken(kind = 'verification') {
  if (kind === 'verification') await User.updateOne({ _id: user.id }, { $set: { email_verified_at: null } });
  await requestAccountEmail(user.email, kind);
  assert.equal(await processNextMail(), true);
  const url = messages.at(-1).text.match(/https?:\/\/[^\s]+/)[0];
  return new URLSearchParams(new URL(url).hash.slice(1)).get('token');
}

test('signup stays pending and cannot log in or receive a session before verification', async () => {
  const r = await request('/api/auth/register', { method: 'POST', token: null, body: { name: 'New Employer', email: 'employer@example.com', password, role: 'employer', company_name: 'Example Co' } });
  assert.equal(r.status, 201); assert.equal(r.body.verification_required, true); assert.equal(r.body.email, 'employer@example.com');
  assert.equal(r.body.token, undefined); assert.equal(r.body.user, undefined); assert.equal(r.headers.get('set-cookie'), null);
  const pending = await User.findOne({ email: 'employer@example.com' });
  assert.equal(pending.email_verified_at, null); assert.equal(await Session.countDocuments({ user_id: pending.id }), 0);
  const login = await request('/api/auth/login', { method: 'POST', token: null, body: { email: pending.email, password } });
  assert.equal(login.status, 403); assert.equal(login.body.token, undefined); assert.equal(login.headers.get('set-cookie'), null);
});
test('email queue encrypts links, stores only token hashes on user and never leaks through profile', async () => {
  await User.updateOne({ _id: user.id }, { $set: { email_verified_at: null } });
  await requestAccountEmail(user.email, 'verification');
  const record = await User.findById(user.id).select('+email_verification_hash');
  const job = await EmailJob.findOne().select('+encrypted_payload'); assert.ok(job.encrypted_payload);
  assert.equal(job.encrypted_payload.includes('candidate@example.com'), false); assert.equal(job.encrypted_payload.includes('verify-email'), false);
  await processNextMail(); const text = messages[0].text, link = text.match(/https?:\/\/[^\s]+/)[0];
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get('token'); assert.equal(record.email_verification_hash, hashToken(token));
  assert.equal((await request('/api/users/me')).status, 403);
  assert.equal(user.toJSON().email_verification_hash, undefined);
  assert.equal((await EmailJob.findById(job.id).select('+encrypted_payload')).encrypted_payload, undefined);
});
test('verification token is single-use and enables writes without a new login', async () => {
  const token = await sendAndGetToken();
  assert.equal((await request('/api/auth/verify-email', { method: 'POST', token: null, body: { token } })).status, 200);
  assert.equal((await request('/api/users/me')).body.data.email_verified, true);
  assert.equal((await request('/api/auth/verify-email', { method: 'POST', body: { token } })).status, 400);
  const job = await Job.create({ title: 'Engineer', description: 'Build quality software', employer_id: other.id });
  assert.equal((await request(`/api/jobs/${job.id}/save`, { method: 'PUT' })).status, 200);
});
test('expired and purpose-swapped verification/reset tokens fail', async () => {
  const verify = await sendAndGetToken();
  assert.equal((await request('/api/auth/reset-password', { method: 'POST', body: { token: verify, password: newPassword } })).status, 400);
  await User.updateOne({ _id: user.id }, { $set: { email_verification_expires: new Date(Date.now() - 1000) } });
  assert.equal((await request('/api/auth/verify-email', { method: 'POST', body: { token: verify } })).status, 400);
  const reset = await sendAndGetToken('reset');
  assert.equal((await request('/api/auth/verify-email', { method: 'POST', body: { token: reset } })).status, 400);
});
test('forgot-password response is generic and resend cooldown prevents inbox flooding', async () => {
  const a = await request('/api/auth/forgot-password', { method: 'POST', body: { email: user.email } });
  const b = await request('/api/auth/forgot-password', { method: 'POST', body: { email: 'missing@example.com' } });
  const c = await request('/api/auth/forgot-password', { method: 'POST', body: { email: user.email } });
  assert.equal(a.status, 200); assert.deepEqual(a.body, b.body); assert.deepEqual(a.body, c.body); assert.equal(await EmailJob.countDocuments({}), 1);
});
test('verification resend is generic and skips already-verified users', async () => {
  await User.updateOne({ _id: user.id }, { $set: { email_verified_at: new Date() } });
  const a = await request('/api/auth/resend-verification', { method: 'POST', body: { email: user.email } });
  const b = await request('/api/auth/resend-verification', { method: 'POST', body: { email: 'missing@example.com' } });
  assert.deepEqual(a.body, b.body); assert.equal(await EmailJob.countDocuments({}), 0);
});
test('email links use configured frontend origin, never request Host', async () => {
  await request('/api/auth/forgot-password', { method: 'POST', body: { email: user.email }, headers: { Host: 'attacker.invalid' } });
  await processNextMail(); assert.ok(messages[0].text.includes('http://localhost:3000/reset-password#token=')); assert.equal(messages[0].text.includes('attacker.invalid'), false);
});
test('refresh rotates secrets with fixed absolute expiry and never returns them in JSON', async () => {
  const expires = session.session.expires_at.toISOString();
  const r = await request('/api/auth/refresh', { method: 'POST', refresh: session.refreshToken });
  assert.equal(r.status, 200); assert.ok(r.body.token); assert.equal(r.body.refreshToken, undefined);
  const value = cookieValue(r); assert.notEqual(value, session.refreshToken);
  assert.equal((await Session.findById(session.session.id)).expires_at.toISOString(), expires);
  assert.equal((await request('/api/users/me', { token: r.body.token })).status, 200);
  const record = await Session.findById(session.session.id).select('+refresh_hash +used_hashes');
  assert.equal(record.refresh_hash, hashToken(value.split('.')[1])); assert.equal(record.used_hashes.length, 1);
});
test('replayed refresh token revokes its family and all its access tokens', async () => {
  const r = await request('/api/auth/refresh', { method: 'POST', refresh: session.refreshToken }); assert.equal(r.status, 200);
  assert.equal((await request('/api/auth/refresh', { method: 'POST', refresh: session.refreshToken })).status, 401);
  assert.equal((await request('/api/users/me', { token: r.body.token })).status, 401);
  assert.equal((await request('/api/auth/refresh', { method: 'POST', refresh: cookieValue(r) })).status, 401);
});
test('guessed refresh secret cannot revoke a legitimate session', async () => {
  assert.equal((await request('/api/auth/refresh', { method: 'POST', refresh: `${session.session.id}.${randomToken()}` })).status, 401);
  assert.equal((await request('/api/users/me')).status, 200);
});
test('expired sessions cannot refresh even if TTL cleanup has not removed them', async () => {
  await Session.updateOne({ _id: session.session.id }, { $set: { expires_at: new Date(Date.now() - 1000) } });
  assert.equal((await request('/api/auth/refresh', { method: 'POST', refresh: session.refreshToken })).status, 401);
  assert.equal((await request('/api/users/me')).status, 401);
});
test('cookie refresh/logout require CSRF header and reject foreign origins', async () => {
  for (const route of ['refresh','logout']) {
    assert.equal((await request(`/api/auth/${route}`, { method: 'POST', refresh: session.refreshToken, csrf: false })).status, 403);
    assert.equal((await request(`/api/auth/${route}`, { method: 'POST', refresh: session.refreshToken, origin: 'https://evil.test' })).status, 403);
  }
  assert.equal((await request('/api/users/me')).status, 200);
});
test('logout is idempotent and immediately invalidates old access and refresh', async () => {
  const r = await request('/api/auth/logout', { method: 'POST', refresh: session.refreshToken }); assert.equal(r.status, 204);
  assert.ok(r.headers.get('set-cookie').includes('Expires=Thu, 01 Jan 1970'));
  assert.equal((await request('/api/users/me')).status, 401);
  assert.equal((await request('/api/auth/refresh', { method: 'POST', refresh: session.refreshToken })).status, 401);
  assert.equal((await request('/api/auth/logout', { method: 'POST', refresh: session.refreshToken })).status, 204);
});
test('logout-all invalidates sessions on every device using a user auth epoch', async () => {
  const second = await createSession(user);
  assert.equal((await request('/api/auth/logout-all', { method: 'POST' })).status, 204);
  assert.equal((await request('/api/users/me', { token: second.token })).status, 401);
  assert.equal((await request('/api/auth/refresh', { method: 'POST', refresh: second.refreshToken })).status, 401);
});
test('session list hides secrets and only exposes sessions owned by caller', async () => {
  await createSession(other);
  const r = await request('/api/auth/sessions'); assert.equal(r.status, 200); assert.equal(r.body.data.length, 1); assert.equal(r.body.data[0].current, true);
  const serialized = JSON.stringify(r.body); for (const key of ['refresh_hash','used_hashes','auth_version']) assert.equal(serialized.includes(key), false);
});
test('session revocation checks ownership and can sign out another own device', async () => {
  const foreign = await createSession(other), second = await createSession(user);
  assert.equal((await request('/api/auth/sessions/' + foreign.session.id, { method: 'DELETE' })).status, 404);
  assert.equal((await request('/api/auth/sessions/' + second.session.id, { method: 'DELETE' })).status, 204);
  assert.equal((await request('/api/users/me', { token: second.token })).status, 401); assert.equal((await request('/api/users/me')).status, 200);
});
test('password reset consumes token, changes password and revokes every old session', async () => {
  const token = await sendAndGetToken('reset');
  const r = await request('/api/auth/reset-password', { method: 'POST', body: { token, password: newPassword } }); assert.equal(r.status, 200);
  assert.equal((await request('/api/users/me')).status, 401);
  assert.equal((await request('/api/auth/refresh', { method: 'POST', refresh: session.refreshToken })).status, 401);
  assert.equal((await request('/api/auth/reset-password', { method: 'POST', body: { token, password: newPassword } })).status, 400);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: user.email, password } })).status, 401);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: user.email, password: newPassword } })).status, 200);
  assert.equal(await EmailJob.countDocuments({ sent_at: null }), 1);
});
test('reset token expiry is checked explicitly and weak passwords are rejected', async () => {
  const token = await sendAndGetToken('reset');
  assert.equal((await request('/api/auth/reset-password', { method: 'POST', body: { token, password: 'short' } })).status, 400);
  await User.updateOne({ _id: user.id }, { $set: { password_reset_expires: new Date(Date.now() - 1000) } });
  assert.equal((await request('/api/auth/reset-password', { method: 'POST', body: { token, password: newPassword } })).status, 400);
  assert.equal((await request('/api/users/me')).status, 200);
});
test('concurrent reset token submissions succeed once', async () => {
  const token = await sendAndGetToken('reset');
  const results = await Promise.all([1,2].map(() => request('/api/auth/reset-password', { method: 'POST', body: { token, password: newPassword } })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
});
test('change-password requires old password, clears outstanding resets and signs out', async () => {
  const reset = await sendAndGetToken('reset');
  assert.equal((await request('/api/auth/change-password', { method: 'POST', body: { current_password: 'wrong', new_password: newPassword } })).status, 401);
  assert.equal((await request('/api/auth/change-password', { method: 'POST', body: { current_password: password, new_password: newPassword } })).status, 200);
  assert.equal((await request('/api/users/me')).status, 401);
  assert.equal((await request('/api/auth/reset-password', { method: 'POST', body: { token: reset, password } })).status, 400);
});
test('legacy access tokens without a session are no longer accepted', async () => {
  const token = generateToken(user.id, user.role); assert.equal((await request('/api/users/me', { token })).status, 401);
});
test('deleted account cannot rotate its refresh token', async () => {
  await User.deleteOne({ _id: user.id }); assert.equal((await request('/api/auth/refresh', { method: 'POST', refresh: session.refreshToken })).status, 401);
});
test('session rotation limit fails closed', async () => {
  await Session.updateOne({ _id: session.session.id }, { $set: { rotations: 1000 } });
  assert.equal((await request('/api/auth/refresh', { method: 'POST', refresh: session.refreshToken })).status, 401);
  assert.equal((await request('/api/users/me')).status, 401);
});
test('CORS allows credentials only for configured frontend', async () => {
  const r = await request('/health/live', { origin: 'http://localhost:3000' });
  assert.equal(r.headers.get('access-control-allow-credentials'), 'true'); assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:3000');
});
test('durable mail job retry does not mark failed delivery as sent', async () => {
  await User.updateOne({ _id: user.id }, { $set: { email_verified_at: null } });
  await requestAccountEmail(user.email, 'verification'); mailTransport.send = async () => { throw new Error('simulated failure'); };
  assert.equal(await processNextMail(), true);
  let job = await EmailJob.findOne().select('+encrypted_payload'); assert.equal(job.sent_at, null); assert.equal(job.attempts, 1); assert.ok(job.encrypted_payload);
  mailTransport.send = async message => messages.push(message);
  await EmailJob.updateOne({ _id: job.id }, { $set: { next_attempt_at: new Date(Date.now() - 1) } });
  assert.equal(await processNextMail(), true); job = await EmailJob.findById(job.id); assert.ok(job.sent_at); assert.equal(messages.length, 1);
});
test('two mail workers do not simultaneously claim the same pending email', async () => {
  await User.updateOne({ _id: user.id }, { $set: { email_verified_at: null } });
  await requestAccountEmail(user.email, 'verification');
  const results = await Promise.all([processNextMail(), processNextMail()]); assert.equal(results.filter(Boolean).length, 1); assert.equal(messages.length, 1);
});
test('local outbox writes email preview without exposing it as an HTTP endpoint', async () => {
  mailTransport.send = originalSend; const job = await enqueueMail({ to: user.email, subject: 'Preview', text: 'Local message' });
  await processNextMail(); const data = JSON.parse(await readFile(join(process.env.MAIL_OUTBOX_DIR, `${job.id}.json`), 'utf8')); assert.equal(data.subject, 'Preview');
  assert.equal((await request('/.mail-outbox/' + job.id + '.json')).status, 404);
});
test('expired mail jobs are not delivered even before TTL deletion', async () => {
  await enqueueMail({ to: user.email, subject: 'Expired', text: 'Ignore' }, new Date(Date.now() - 1000));
  assert.equal(await processNextMail(), false); assert.equal(messages.length, 0);
});

test('simultaneous refresh requests trigger replay revocation instead of two usable tokens', async () => {
  const results = await Promise.all([1,2].map(() => request('/api/auth/refresh', { method: 'POST', refresh: session.refreshToken })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 401]);
  assert.equal((await request('/api/users/me', { token: results.find(r => r.status === 200).body.token })).status, 401);
});
test('password reset invalidates old access even if session cleanup fails', async () => {
  const token = await sendAndGetToken('reset'); const original = Session.updateMany;
  Session.updateMany = () => { throw new Error('simulated cleanup failure'); };
  try { assert.equal((await request('/api/auth/reset-password', { method: 'POST', body: { token, password: newPassword } })).status, 200); }
  finally { Session.updateMany = original; }
  assert.equal((await Session.findById(session.session.id)).revoked_at, null);
  assert.equal((await request('/api/users/me')).status, 401);
  assert.equal((await request('/api/auth/refresh', { method: 'POST', refresh: session.refreshToken })).status, 401);
});
test('failed durable enqueue clears only its own recovery link and permits retry', async () => {
  const original = EmailJob.create; EmailJob.create = () => { throw new Error('simulated queue failure'); };
  try { await assert.rejects(requestAccountEmail(user.email, 'reset')); }
  finally { EmailJob.create = original; }
  const record = await User.findById(user.id).select('+password_reset_hash +reset_sent_at');
  assert.equal(record.password_reset_hash, undefined); assert.equal(record.reset_sent_at, undefined);
  await requestAccountEmail(user.email, 'reset'); assert.equal(await EmailJob.countDocuments({}), 1);
});

async function signupCode() {
  await User.updateOne({ _id: user.id }, { $set: { email_verified_at: null } });
  await requestAccountEmail(user.email, 'verification');
  await processNextMail();
  return messages.at(-1).text.match(/code is: (\d{6})/)[1];
}
const verifyCode = (otp, email = user.email) => request('/api/auth/verify-signup', { method: 'POST', token: null, body: { email, otp } });
test('signup OTP verifies once, creates no session, and then permits login', async () => {
  const code = await signupCode(); const before = await Session.countDocuments({});
  const r = await verifyCode(code); assert.equal(r.status, 200); assert.equal(r.body.token, undefined); assert.equal(r.headers.get('set-cookie'), null);
  assert.equal(await Session.countDocuments({}), before); assert.equal((await verifyCode(code)).status, 400);
  const login = await request('/api/auth/login', { method: 'POST', token: null, body: { email: user.email, password } });
  assert.equal(login.status, 200); assert.ok(login.body.token); assert.ok(login.headers.get('set-cookie').includes('HttpOnly'));
});
test('OTP expiry and 5 failed attempts are enforced on the account', async () => {
  const code = await signupCode();
  for (let i = 1; i <= 5; i++) assert.equal((await verifyCode(String((Number(code) + i) % 1000000).padStart(6, '0'))).status, 400);
  assert.equal((await verifyCode(code)).status, 400);
  assert.equal((await User.findById(user.id).select('+email_otp_attempts')).email_otp_attempts, 5);
  await User.updateOne({ _id: user.id }, { $set: { email_otp_attempts: 0, email_otp_expires: new Date(Date.now() - 1000) } });
  assert.equal((await verifyCode(code)).status, 400); assert.equal((await User.findById(user.id)).email_verified_at, null);
});
test('OTP is email-bound, normalized by validation, and rejects malformed payloads', async () => {
  const code = await signupCode();
  assert.equal((await verifyCode(code, other.email)).status, 400);
  assert.equal((await verifyCode(code, 'missing@example.com')).status, 400);
  for (const otp of ['12345', '1234567', 'abcdef', 123456]) assert.equal((await verifyCode(otp)).status, 400);
  const extra = await request('/api/auth/verify-signup', { method: 'POST', body: { email: user.email, otp: code, role: 'admin' } }); assert.equal(extra.status, 400);
  assert.equal((await verifyCode(code, ' CANDIDATE@EXAMPLE.COM ')).status, 200);
});
test('concurrent correct OTP submissions activate only once', async () => {
  const code = await signupCode();
  const results = await Promise.all([verifyCode(code), verifyCode(code)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
});
test('resend cooldown avoids mail flooding; a fresh challenge resets lockout', async () => {
  const code = await signupCode(); const first = await User.findById(user.id).select('+email_otp_hash');
  await requestAccountEmail(user.email, 'verification'); assert.equal(await EmailJob.countDocuments({}), 1);
  for (let i = 1; i <= 5; i++) await verifyCode(String((Number(code) + i) % 1000000).padStart(6, '0'));
  await User.updateOne({ _id: user.id }, { $set: { verification_sent_at: new Date(Date.now() - 61000) } });
  await requestAccountEmail(user.email, 'verification'); await processNextMail();
  const newCode = messages.at(-1).text.match(/code is: (\d{6})/)[1];
  const fresh = await User.findById(user.id).select('+email_otp_hash +email_otp_attempts');
  assert.equal(fresh.email_otp_attempts, 0);
  if (newCode !== code) { assert.notEqual(fresh.email_otp_hash, first.email_otp_hash); assert.equal((await verifyCode(code)).status, 400); }
  assert.equal((await verifyCode(newCode)).status, 200);
});
test('OTP and verification links invalidate each other and leave no raw code in user JSON', async () => {
  const code = await signupCode(); const mail = messages.at(-1).text;
  const token = new URLSearchParams(new URL(mail.match(/https?:\/\/[^\s]+/)[0]).hash.slice(1)).get('token');
  const record = await User.findById(user.id).select('+email_otp_hash +email_otp_expires +email_otp_attempts');
  assert.notEqual(record.email_otp_hash, hashToken(code));
  for (const field of ['email_otp_hash','email_otp_expires','email_otp_attempts']) assert.equal(record.toJSON()[field], undefined);
  assert.equal((await verifyCode(code)).status, 200);
  assert.equal((await request('/api/auth/verify-email', { method: 'POST', body: { token } })).status, 400);
  await User.updateOne({ _id: user.id }, { $set: { email_verified_at: null, verification_sent_at: new Date(Date.now() - 61000) } });
  const next = await signupCode(); const nextMail = messages.at(-1).text;
  const nextToken = new URLSearchParams(new URL(nextMail.match(/https?:\/\/[^\s]+/)[0]).hash.slice(1)).get('token');
  assert.equal((await request('/api/auth/verify-email', { method: 'POST', body: { token: nextToken } })).status, 200);
  assert.equal((await verifyCode(next)).status, 400);
});
test('old unverified access and refresh sessions cannot bypass activation', async () => {
  await User.updateOne({ _id: user.id }, { $set: { email_verified_at: null } });
  assert.equal((await request('/api/users/me')).status, 403);
  assert.equal((await request('/api/auth/refresh', { method: 'POST', refresh: session.refreshToken })).status, 401);
  const pending = await User.findById(user.id);
  await assert.rejects(createSession(pending), error => error.statusCode === 403);
});
test('queue failure releases the failed OTP challenge and allows resend', async () => {
  await User.updateOne({ _id: user.id }, { $set: { email_verified_at: null } });
  const original = EmailJob.create; EmailJob.create = () => { throw new Error('queue unavailable'); };
  try { await assert.rejects(requestAccountEmail(user.email, 'verification')); }
  finally { EmailJob.create = original; }
  const record = await User.findById(user.id).select('+email_otp_hash +email_otp_expires +verification_sent_at');
  assert.equal(record.email_otp_hash, undefined); assert.equal(record.email_otp_expires, undefined); assert.equal(record.verification_sent_at, undefined);
  await requestAccountEmail(user.email, 'verification'); assert.equal(await EmailJob.countDocuments({}), 1);
});
test('suspended pending accounts cannot verify by OTP or link', async () => {
  const code = await signupCode(); const mail = messages.at(-1).text;
  const token = new URLSearchParams(new URL(mail.match(/https?:\/\/[^\s]+/)[0]).hash.slice(1)).get('token');
  await User.updateOne({ _id: user.id }, { $set: { status: 'suspended' } });
  assert.equal((await verifyCode(code)).status, 400);
  assert.equal((await request('/api/auth/verify-email', { method: 'POST', body: { token } })).status, 400);
});
