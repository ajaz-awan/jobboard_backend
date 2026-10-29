import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
process.env.NODE_ENV = 'test'; process.env.MAIL_TRANSPORT = 'outbox'; process.env.JWT_SECRET = 'test-only-secret-'.repeat(4);
process.env.STORAGE_DRIVER = 'local'; process.env.RATE_LIMIT_STORE = 'memory'; process.env.MALWARE_SCAN = 'none';
process.env.UPLOAD_DIR = await mkdtemp(join(tmpdir(), 'jobboard-platform-'));
const { createApp } = await import('../../src/app.js');
const { connectDatabase, closeDatabase } = await import('../../src/config/database.js');
const { User, Job, Application, Notification, AuditLog, Report, Session, FileCleanupJob, RateLimitBucket } = await import('../../src/models/index.js');
const { createSession } = await import('../../src/services/sessions.js');
const { MongoRateLimitStore } = await import('../../src/services/rateLimits.js');
const { processNextCleanup } = await import('../../src/services/fileCleanup.js');
let mongo, server, base, users, sessions, job;
const password_hash = await bcrypt.hash('Testing-password123!', 4);
before(async () => {
  mongo = await MongoMemoryServer.create({ instance: { args: process.platform === 'win32' ? [] : ['--nounixsocket'] } });
  await connectDatabase(mongo.getUri('jobboard_platform_test'));
  server = createApp({ apiLimit: 10000, authLimit: 10000 }).listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.models).map(model => model.deleteMany({})));
  users = {}; sessions = {};
  for (const [name, role] of [['admin','admin'], ['employer','employer'], ['candidate','candidate'], ['other','candidate']]) {
    users[name] = await User.create({ name: `Test ${name}`, email: `${name}@example.com`, password_hash, role, email_verified_at: new Date(), company_name: role === 'employer' ? 'Example Inc' : null });
    sessions[name] = await createSession(users[name]);
  }
  job = await Job.create({ title: 'Backend Engineer', description: 'Build production backend services', location: 'Lahore', employer_id: users.employer.id, salary_min: 100, salary_max: 200 });
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await closeDatabase(); if (mongo) await mongo.stop(); await rm(process.env.UPLOAD_DIR, { recursive: true, force: true }); });
async function request(path, { who = 'candidate', method = 'GET', body, form, token = sessions[who].token } = {}) {
  const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: form || (body === undefined ? undefined : JSON.stringify(body)) });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
}
const statusBody = status => ({ status, reason: 'Administrative review' });
async function apply(who = 'candidate') {
  const f = new FormData(); f.set('job_id', job.id); f.set('resume', new Blob(['%PDF-1.7\nexample'], { type: 'application/pdf' }), 'resume.pdf');
  const r = await request('/api/applications', { who, method: 'POST', form: f }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.data;
}
test('candidate and employer cannot access admin APIs', async () => {
  for (const who of ['candidate','employer']) assert.equal((await request('/api/admin/users', { who })).status, 403);
});
test('admin list and dashboard hide password/auth secrets', async () => {
  const r = await request('/api/admin/users', { who: 'admin' }); assert.equal(r.status, 200); assert.equal(r.body.total, 4);
  for (const name of ['password_hash','auth_version','refresh_hash']) assert.equal(JSON.stringify(r.body).includes(name), false);
  assert.equal((await request('/api/admin/dashboard', { who: 'admin' })).body.data.applications, 0);
});
test('suspension revokes sessions, prevents login/refresh and hides employer jobs', async () => {
  assert.equal((await request(`/api/admin/users/${users.employer.id}/status`, { who: 'admin', method: 'PATCH', body: statusBody('suspended') })).status, 200);
  assert.equal((await request('/api/users/me', { who: 'employer' })).status, 401);
  const login = await request('/api/auth/login', { method: 'POST', body: { email: users.employer.email, password: 'Testing-password123!' } }); assert.equal(login.status, 403);
  assert.equal((await request('/api/jobs')).body.total, 0);
  assert.equal((await request('/api/jobs/' + job.id)).status, 404);
  assert.equal(await Session.countDocuments({ user_id: users.employer.id, revoked_at: null }), 0);
  assert.equal(await AuditLog.countDocuments({ action: 'user_status', outcome: 'completed' }), 1);
});
test('reactivation does not resurrect old revoked sessions', async () => {
  await request(`/api/admin/users/${users.candidate.id}/status`, { who: 'admin', method: 'PATCH', body: statusBody('suspended') });
  assert.equal((await request(`/api/admin/users/${users.candidate.id}/status`, { who: 'admin', method: 'PATCH', body: statusBody('active') })).status, 200);
  assert.equal((await request('/api/users/me')).status, 401);
});
test('admin accounts cannot be suspended through HTTP including self', async () => {
  assert.equal((await request(`/api/admin/users/${users.admin.id}/status`, { who: 'admin', method: 'PATCH', body: statusBody('suspended') })).status, 403);
});
test('administrative mutations require a recent login even after token refresh', async () => {
  await Session.collection.updateOne({ _id: sessions.admin.session.id }, { $set: { created_at: new Date(Date.now() - 20 * 60000) } }, { timestamps: false });
  assert.equal((await request(`/api/admin/users/${users.candidate.id}/status`, { who: 'admin', method: 'PATCH', body: statusBody('suspended') })).status, 403);
});
test('new jobs wait for approval and employers cannot self-approve', async () => {
  const r = await request('/api/jobs', { who: 'employer', method: 'POST', body: { title: 'New Engineer', description: 'Build useful software services' } });
  assert.equal(r.status, 201); assert.equal(r.body.job.moderation_status, 'pending');
  assert.equal((await request('/api/jobs')).body.total, 1);
  assert.equal((await request('/api/jobs/' + r.body.job.id)).status, 404);
  assert.equal((await request('/api/jobs/' + r.body.job.id, { who: 'employer' })).status, 200);
  assert.equal((await request('/api/jobs/' + r.body.job.id, { who: 'employer', method: 'PATCH', body: { moderation_status: 'approved' } })).status, 400);
  assert.equal((await request(`/api/admin/jobs/${r.body.job.id}/moderation`, { who: 'admin', method: 'PATCH', body: { ...statusBody('approved'), revision: r.body.job.revision } })).status, 200);
  assert.equal((await request('/api/jobs')).body.total, 2);
});
test('job moderation is revision-checked and content edits resubmit approval', async () => {
  const update = await request('/api/jobs/' + job.id, { who: 'employer', method: 'PATCH', body: { title: 'Changed Engineer Title' } }); assert.equal(update.status, 200);
  assert.equal(update.body.job.moderation_status, 'pending');
  assert.equal((await request(`/api/admin/jobs/${job.id}/moderation`, { who: 'admin', method: 'PATCH', body: { ...statusBody('approved'), revision: 0 } })).status, 409);
  assert.equal(await AuditLog.countDocuments({ outcome: 'failed' }), 1);
  assert.equal((await request(`/api/admin/jobs/${job.id}/moderation`, { who: 'admin', method: 'PATCH', body: { ...statusBody('approved'), revision: update.body.job.revision } })).status, 200);
});
test('audit write failure prevents an administrative mutation', async () => {
  const original = AuditLog.create; AuditLog.create = () => { throw new Error('simulated audit outage'); };
  try { assert.equal((await request(`/api/admin/users/${users.candidate.id}/status`, { who: 'admin', method: 'PATCH', body: statusBody('suspended') })).status, 500); }
  finally { AuditLog.create = original; }
  assert.equal((await User.findById(users.candidate.id)).status, 'active');
});
test('blocked, expired and suspended-owner jobs cannot accept new applications', async () => {
  for (const update of [{ moderation_status: 'blocked' }, { moderation_status: 'approved', expires_at: new Date(Date.now() - 1000) }]) {
    await Job.updateOne({ _id: job.id }, { $set: update });
    assert.equal((await request('/api/jobs')).body.total, 0);
    const f = new FormData(); f.set('job_id', job.id); f.set('resume', new Blob(['%PDF-1.7'], { type: 'application/pdf' }), 'resume.pdf');
    assert.equal((await request('/api/applications', { method: 'POST', form: f })).status, 409);
  }
});
test('text search, work-mode filter and deadlines are supported', async () => {
  await Job.updateOne({ _id: job.id }, { $set: { work_mode: 'remote', experience_level: 'senior', skills: ['Node.js'] } });
  const r = await request('/api/jobs?q=backend&work_mode=remote&experience_level=senior'); assert.equal(r.status, 200); assert.equal(r.body.total, 1);
  assert.equal((await request('/api/jobs', { who: 'employer', method: 'POST', body: { title: 'Expired Job', description: 'Already expired deadline', expires_at: new Date(Date.now() - 1000).toISOString() } })).status, 400);
});
test('reports are unique, scoped to reporter, and reviewed only by admin', async () => {
  const r = await request(`/api/jobs/${job.id}/report`, { method: 'POST', body: { reason: 'misleading', details: 'Review salary information' } }); assert.equal(r.status, 201);
  assert.equal((await request(`/api/jobs/${job.id}/report`, { method: 'POST', body: { reason: 'spam' } })).status, 409);
  assert.equal((await request('/api/reports/my')).body.total, 1); assert.equal((await request('/api/reports/my', { who: 'other' })).body.total, 0);
  assert.equal((await request('/api/admin/reports/' + r.body.data.id, { who: 'admin', method: 'PATCH', body: { status: 'resolved', note: 'Employer supplied supporting information' } })).status, 200);
  assert.equal((await request('/api/admin/reports/' + r.body.data.id, { who: 'admin', method: 'PATCH', body: { status: 'dismissed', note: 'Trying to overwrite review' } })).status, 409);
});
test('application events create private notifications without cross-user access', async () => {
  const application = await apply();
  const employer = await request('/api/notifications', { who: 'employer' }); assert.equal(employer.body.total, 1);
  assert.equal((await request('/api/notifications', { who: 'other' })).body.total, 0);
  assert.equal((await request(`/api/notifications/${employer.body.data[0].id}/read`, { who: 'other', method: 'PATCH' })).status, 404);
  await request(`/api/applications/${application.id}/status`, { who: 'employer', method: 'PATCH', body: { status: 'accepted' } });
  const mine = await request('/api/notifications'); assert.equal(mine.body.total, 1);
  assert.equal((await request('/api/notifications/unread-count')).body.count, 1);
  assert.equal((await request('/api/notifications/read-all', { method: 'PATCH' })).status, 204);
  assert.equal((await request('/api/notifications/unread-count')).body.count, 0);
});
test('candidate can withdraw only own pending application and employer cannot resurrect it', async () => {
  const app = await apply();
  assert.equal((await request(`/api/applications/${app.id}/withdraw`, { who: 'other', method: 'PATCH' })).status, 404);
  const r = await request(`/api/applications/${app.id}/withdraw`, { method: 'PATCH' }); assert.equal(r.status, 200); assert.equal(r.body.data.status, 'withdrawn');
  assert.equal((await request(`/api/applications/${app.id}/status`, { who: 'employer', method: 'PATCH', body: { status: 'accepted' } })).status, 409);
  assert.equal((await request('/api/applications/my?status=withdrawn')).body.total, 1);
});
test('candidate and employer dashboards contain only own counts', async () => {
  await apply(); const mine = await request('/api/dashboard'); assert.equal(mine.body.data.applications[0].total, 1);
  assert.equal((await request('/api/dashboard', { who: 'other' })).body.data.applications.length, 0);
  const employer = await request('/api/dashboard', { who: 'employer' }); assert.equal(employer.body.data.applications[0].total, 1);
});
test('cleanup jobs delete known stale keys idempotently', async () => {
  await FileCleanupJob.create({ bucket: 'logos', key: `${users.employer.id}/${job.id}.png` });
  assert.equal(await processNextCleanup(), true); assert.equal(await FileCleanupJob.countDocuments({}), 0);
});
test('Mongo-backed rate stores share atomic counts across independent instances', async () => {
  const a = new MongoRateLimitStore('test'), b = new MongoRateLimitStore('test'); a.init({ windowMs: 60000 }); b.init({ windowMs: 60000 });
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? a : b).increment('127.0.0.1')));
  assert.deepEqual(results.map(r => r.totalHits).sort((x,y) => x-y), Array.from({ length: 20 }, (_, i) => i+1));
  const entry = await RateLimitBucket.findOne(); assert.equal(entry._id.includes('127.0.0.1'), false);
  await a.decrement('127.0.0.1'); assert.equal((await b.increment('127.0.0.1')).totalHits, 20);
  await a.resetKey('127.0.0.1'); assert.equal((await b.increment('127.0.0.1')).totalHits, 1);
});
test('expired rate buckets reset immediately without waiting for TTL cleanup', async () => {
  const store = new MongoRateLimitStore('expiry'); store.init({ windowMs: 60000 }); await store.increment('key');
  await RateLimitBucket.updateOne({ _id: store.id('key') }, { $set: { reset_at: new Date(Date.now() - 1000), count: 999 } });
  assert.equal((await store.increment('key')).totalHits, 1);
});

test('two API processes share the Mongo rate limit rather than resetting per process', async () => {
  const { env } = await import('../../src/config/env.js'); const previous = env.RATE_LIMIT_STORE; env.RATE_LIMIT_STORE = 'mongo';
  const apps = [createApp({ apiLimit: 1 }), createApp({ apiLimit: 1 })].map(app => app.listen(0, '127.0.0.1'));
  await Promise.all(apps.map(app => new Promise(resolve => app.once('listening', resolve))));
  try {
    assert.equal((await fetch(`http://127.0.0.1:${apps[0].address().port}/api/users/me`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${apps[1].address().port}/api/users/me`)).status, 429);
  } finally { env.RATE_LIMIT_STORE = previous; await Promise.all(apps.map(app => new Promise(resolve => app.close(resolve)))); }
});

test('failed object deletion is queued durably and retried without an external S3 call', async () => {
  const { env } = await import('../../src/config/env.js'); const { objectStore } = await import('../../src/services/objectStorage.js');
  const { removeStoredFile } = await import('../../src/utils/fileStorage.js');
  const previous = env.STORAGE_DRIVER, original = objectStore.client.send; env.STORAGE_DRIVER = 's3';
  objectStore.client.send = async () => { throw new Error('simulated storage outage'); };
  try {
    await removeStoredFile('logos', `${users.employer.id}/${job.id}.png`); assert.equal(await FileCleanupJob.countDocuments({}), 1);
    objectStore.client.send = async () => ({}); assert.equal(await processNextCleanup(), true); assert.equal(await FileCleanupJob.countDocuments({}), 0);
  } finally { env.STORAGE_DRIVER = previous; objectStore.client.send = original; }
});

test('owner can explicitly clear an expired deadline when reopening', async () => {
  await Job.updateOne({ _id: job.id }, { $set: { status: 'closed', expires_at: new Date(Date.now() - 1000) } });
  const r = await request('/api/jobs/' + job.id, { who: 'employer', method: 'PATCH', body: { status: 'open', expires_at: null } });
  assert.equal(r.status, 200); assert.equal(r.body.job.expires_at, null); assert.equal(r.body.job.status, 'open');
});
