import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
process.env.NODE_ENV = 'test'; process.env.MAIL_TRANSPORT = 'outbox';
process.env.STORAGE_DRIVER = 'local';
process.env.RATE_LIMIT_STORE = 'memory';
process.env.MALWARE_SCAN = 'none';
process.env.JWT_SECRET = 'test-only-secret-'.repeat(4);
process.env.UPLOAD_DIR = await mkdtemp(join(tmpdir(), 'jobboard-integration-'));
const { createApp } = await import('../../src/app.js');
const { connectDatabase, closeDatabase } = await import('../../src/config/database.js');
const { User, Job, Application, SavedJob, Session, EmailJob } = await import('../../src/models/index.js');
const { createSession } = await import('../../src/services/sessions.js');
const { generateToken } = await import('../../src/utils/generateToken.js');
const { removeStoredFile } = await import('../../src/utils/fileStorage.js');
const ids = {
  candidate: '11111111-1111-4111-8111-111111111111', employer: '22222222-2222-4222-8222-222222222222',
  stranger: '33333333-3333-4333-8333-333333333333', employer2: '44444444-4444-4444-8444-444444444444',
};
let mongo, server, base, job, sessions;
const password = 'strong-password123';
const password_hash = await bcrypt.hash(password, 4);
before(async () => {
  mongo = await MongoMemoryServer.create({ instance: { args: process.platform === "win32" ? [] : ["--nounixsocket"] } });
  await connectDatabase(mongo.getUri('jobboard_integration_test'));
  server = createApp({ apiLimit: 1000, authLimit: 1000 }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => {
  await Promise.all([User, Job, Application, SavedJob, Session, EmailJob].map(model => model.deleteMany({})));
  await User.create(Object.entries(ids).map(([name, id]) => ({ _id: id, name: `Test ${name}`, email: `${name}@example.com`, password_hash,
    email_verified_at: new Date(), role: name.startsWith('employer') ? 'employer' : 'candidate', company_name: name.startsWith('employer') ? 'Example Inc' : null })));
  sessions = {};
  for (const [name, id] of Object.entries(ids)) sessions[name] = await createSession(await User.findById(id).select('+auth_version'));
  job = await Job.create({ title: 'Backend Engineer', description: 'Build professional backend services', employer_id: ids.employer,
    location: 'Lahore', salary_min: 100, salary_max: 200 });
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve)); await closeDatabase(); if (mongo) await mongo.stop();
  await rm(process.env.UPLOAD_DIR, { recursive: true, force: true });
});
function auth(who = 'candidate') { return { Authorization: `Bearer ${generateToken(ids[who], 'admin', { sessionId: sessions[who].session.id, authVersion: 0 })}` }; }
async function request(path, { who = 'candidate', method = 'GET', body, form, headers = {} } = {}) {
  const r = await fetch(base + path, { method, headers: { ...auth(who), ...(!form && body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: form || (body !== undefined ? JSON.stringify(body) : undefined) });
  return { status: r.status, headers: r.headers, body: r.status === 204 ? null : r.headers.get('content-type')?.includes('application/json') ? await r.json() : await r.text() };
}
function form(content = '%PDF-1.7\nexample') {
  const f = new FormData(); f.set('job_id', job.id); f.set('cover_letter', 'Interested in this job');
  f.set('resume', new Blob([content], { type: 'application/pdf' }), 'resume.pdf'); return f;
}
async function apply() { const r = await request('/api/applications', { method: 'POST', form: form() }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.data; }

test('readiness reports connected MongoDB', async () => { assert.equal((await request('/health/ready')).status, 200); });
test('register and login use real MongoDB while keeping hashes private', async () => {
  const r = await request('/api/auth/register', { method: 'POST', body: { name: 'New Candidate', email: ' NEW@example.com ', password } });
  assert.equal(r.status, 201); assert.equal(r.body.token, undefined); assert.equal(r.body.user, undefined);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: 'new@example.com', password } })).status, 403);
  // Verification itself is covered by authentication.test.js.
  await User.updateOne({ email: 'new@example.com' }, { $set: { email_verified_at: new Date() } });
  assert.ok((await User.findOne({ email: 'new@example.com' }).select('+password_hash')).password_hash.startsWith('$2'));
  const login = await request('/api/auth/login', { method: 'POST', body: { email: 'new@example.com', password } });
  assert.equal(login.status, 200); assert.equal(login.body.user.password_hash, undefined);
  const token = jwt.verify(login.body.token, process.env.JWT_SECRET, { issuer: 'jobboard-api', audience: 'jobboard-client', algorithms: ['HS256'] });
  assert.equal(token.exp - token.iat, 900);
});
test('wrong credentials return 401', async () => {
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: 'candidate@example.com', password: 'wrong' } })).status, 401);
});
test('duplicate email registration returns conflict', async () => {
  const r = await request('/api/auth/register', { method: 'POST', body: { name: 'Duplicate', email: 'CANDIDATE@example.com', password } }); assert.equal(r.status, 409);
});
test('NoSQL operator injection is rejected by Zod', async () => {
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: { $ne: null }, password } })).status, 400);
});
test('database role overrides stale admin token claim', async () => {
  assert.equal((await request('/api/jobs', { method: 'POST', body: { title: 'Attacker', description: 'Malicious job content' } })).status, 403);
});
test('deleted user cannot use a valid old token', async () => {
  await User.deleteOne({ _id: ids.candidate }); assert.equal((await request('/api/users/me')).status, 401);
});
test('employer can create job and browse own jobs', async () => {
  const r = await request('/api/jobs', { who: 'employer', method: 'POST', body: { title: 'Frontend Engineer', description: 'Build accessible interfaces', salary_min: 0, salary_max: 100 } });
  assert.equal(r.status, 201); assert.equal(r.body.job.employer_id, ids.employer);
  const mine = await request('/api/jobs/mine', { who: 'employer' }); assert.equal(mine.body.total, 2);
});
test('filters, salary ordering and pagination work against database', async () => {
  const r = await request('/api/jobs?title=engineer&location=Lahore&salary_min=150&sort=salary&page=1&limit=5');
  assert.equal(r.status, 200); assert.equal(r.body.total, 1); assert.equal(r.body.jobs[0].id, job.id);
});
test('search treats regular expression characters as literal text', async () => {
  const r = await request('/api/jobs?title=' + encodeURIComponent('.*')); assert.equal(r.status, 200); assert.equal(r.body.total, 0);
});
test('candidate cannot browse or read closed jobs', async () => {
  job.status = 'closed'; await job.save();
  assert.equal((await request('/api/jobs?status=closed')).body.total, 0);
  assert.equal((await request('/api/jobs/' + job.id)).status, 404);
});
test('employer cannot edit or delete another employer job', async () => {
  assert.equal((await request('/api/jobs/' + job.id, { who: 'employer2', method: 'PATCH', body: { title: 'Unauthorized edit' } })).status, 403);
  assert.equal((await request('/api/jobs/' + job.id, { who: 'employer2', method: 'DELETE' })).status, 403);
});
test('partial patches cannot invert the stored salary range', async () => {
  assert.equal((await request('/api/jobs/' + job.id, { who: 'employer', method: 'PATCH', body: { salary_min: 300 } })).status, 400);
});
test('optimistic concurrency rejects competing job edits', async () => {
  const a = await Job.findById(job.id), b = await Job.findById(job.id);
  a.title = 'First update'; b.title = 'Second update'; await a.save(); await assert.rejects(b.save(), { name: 'VersionError' });
});
test('profile edits work without permitting role escalation', async () => {
  assert.equal((await request('/api/users/me', { method: 'PATCH', body: { role: 'admin' } })).status, 400);
  const r = await request('/api/users/me', { method: 'PATCH', body: { name: 'Updated Candidate' } }); assert.equal(r.status, 200); assert.equal(r.body.data.name, 'Updated Candidate');
});
test('saved job put/delete operations are idempotent and scoped', async () => {
  for (let i = 0; i < 2; i++) assert.equal((await request('/api/jobs/' + job.id + '/save', { method: 'PUT' })).status, 200);
  assert.equal(await SavedJob.countDocuments({}), 1);
  assert.equal((await request('/api/jobs/saved')).body.total, 1);
  assert.equal((await request('/api/jobs/saved', { who: 'stranger' })).body.total, 0);
  assert.equal((await request('/api/jobs/' + job.id + '/save', { method: 'DELETE' })).status, 204);
});
test('real PDF application is saved privately and appears in joined lists', async () => {
  const data = await apply(); assert.equal(data.resume_path, undefined); assert.equal(data.resume_url, undefined);
  const mine = await request('/api/applications/my'); assert.equal(mine.body.total, 1); assert.equal(mine.body.data[0].jobs.title, job.title);
  const employer = await request('/api/applications/job/' + job.id, { who: 'employer' });
  assert.equal(employer.body.data[0].users.email, 'candidate@example.com'); assert.equal(employer.body.data[0].users.password_hash, undefined);
});
test('duplicate application is blocked and database uniqueness is enforced', async () => {
  await apply(); assert.equal((await request('/api/applications', { method: 'POST', form: form() })).status, 409);
  await assert.rejects(Application.create({ job_id: job.id, candidate_id: ids.candidate, resume_path: `${ids.candidate}/duplicate.pdf` }), e => e.code === 11000);
  assert.equal(await Application.countDocuments({}), 1);
});
test('spoofed PDF is rejected before a file or application is created', async () => {
  assert.equal((await request('/api/applications', { method: 'POST', form: form('<script>not PDF</script>') })).status, 400);
  assert.equal(await Application.countDocuments({}), 0);
});
test('resume download requires login and ownership on every request', async () => {
  const application = await apply(); const path = '/api/applications/' + application.id + '/resume';
  assert.equal((await fetch(base + path)).status, 401);
  assert.equal((await request(path, { who: 'stranger' })).status, 403);
  assert.equal((await request(path, { who: 'employer2' })).status, 403);
  for (const who of ['candidate', 'employer']) { const r = await request(path, { who }); assert.equal(r.status, 200); assert.ok(r.body.startsWith('%PDF-')); assert.ok(r.headers.get('content-disposition').includes('attachment')); }
});
test('private files are never served as static public URLs', async () => {
  const application = await apply(); const record = await Application.findById(application.id).select('+resume_path');
  assert.equal((await request('/uploads/resumes/' + record.resume_path)).status, 404);
  assert.equal((await request('/api/files/resumes/' + record.resume_path)).status, 404);
});
test('missing local resume returns safe 404', async () => {
  const application = await apply(); const record = await Application.findById(application.id).select('+resume_path'); await removeStoredFile('resumes', record.resume_path);
  assert.equal((await request('/api/applications/' + application.id + '/resume')).status, 404);
});
test('only owning employer can decide applications and decisions are final', async () => {
  const data = await apply(); const path = '/api/applications/' + data.id + '/status';
  assert.equal((await request(path, { who: 'employer2', method: 'PATCH', body: { status: 'accepted' } })).status, 403);
  assert.equal((await request(path, { who: 'employer', method: 'PATCH', body: { status: 'accepted' } })).status, 200);
  assert.equal((await request(path, { who: 'employer', method: 'PATCH', body: { status: 'rejected' } })).status, 409);
});
test('concurrent decisions cannot overwrite a final decision', async () => {
  const data = await apply(); const path = '/api/applications/' + data.id + '/status';
  const results = await Promise.all(['accepted', 'rejected'].map(status => request(path, { who: 'employer', method: 'PATCH', body: { status } })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
});
test('soft deletion hides jobs while preserving application history and resume access', async () => {
  const app = await apply(); assert.equal((await request('/api/jobs/' + job.id, { who: 'employer', method: 'DELETE' })).status, 200);
  assert.equal((await request('/api/jobs')).body.total, 0);
  assert.equal((await request('/api/jobs/' + job.id)).status, 404);
  assert.equal((await request('/api/applications/my')).body.total, 1);
  assert.equal((await request('/api/applications/' + app.id + '/resume', { who: 'employer' })).status, 200);
});
test('logo upload returns a public URL while guarding file type', async () => {
  const f = new FormData(); f.set('logo', new Blob([Buffer.from([137,80,78,71,13,10,26,10,0])], { type: 'image/png' }), 'logo.png');
  const r = await request('/api/users/me/logo', { who: 'employer', method: 'PATCH', form: f }); assert.equal(r.status, 200);
  const image = await fetch(base + r.body.data.logo_url); assert.equal(image.status, 200); assert.ok(image.headers.get('content-type').includes('image/png'));
});

test('concurrent duplicate applications retain just one private file', async () => {
  const { readdir } = await import('node:fs/promises');
  const folder = join(process.env.UPLOAD_DIR, 'resumes', ids.candidate);
  const before = new Set(await readdir(folder).catch(() => []));
  const responses = await Promise.all([1, 2].map(() => request('/api/applications', { method: 'POST', form: form() })));
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
  assert.equal(await Application.countDocuments({}), 1);
  assert.equal((await readdir(folder)).filter(name => !before.has(name)).length, 1);
});
test('job closure during upload compensates by deleting its application and file', async () => {
  const { readdir } = await import('node:fs/promises');
  const folder = join(process.env.UPLOAD_DIR, 'resumes', ids.candidate);
  const before = new Set(await readdir(folder).catch(() => []));
  const original = Job.exists;
  Job.exists = async function (filter) {
    if (filter._id === job.id && filter.status === 'open') { await Job.updateOne({ _id: job.id }, { $set: { status: 'closed' } }); return null; }
    return original.call(this, filter);
  };
  try { assert.equal((await request('/api/applications', { method: 'POST', form: form() })).status, 409); }
  finally { Job.exists = original; }
  assert.equal(await Application.countDocuments({}), 0);
  assert.equal((await readdir(folder)).filter(name => !before.has(name)).length, 0);
});
test('oversized multipart resume returns 413', async () => {
  const content = '%PDF-' + 'x'.repeat(5 * 1024 * 1024);
  const r = await request('/api/applications', { method: 'POST', form: form(content) });
  assert.equal(r.status, 413); assert.equal(await Application.countDocuments({}), 0);
});

test('guests can browse approved jobs but private routes and writes still require authentication', async () => {
  const anon = async (path, method = 'GET') => {
    const r = await fetch(base + path, { method }); return { status: r.status, body: await r.json() };
  };
  const directory = await anon('/api/jobs'); assert.equal(directory.status, 200); assert.equal(directory.body.jobs[0].id, job.id);
  assert.equal((await anon('/api/jobs/' + job.id)).status, 200);
  for (const path of ['/api/jobs/mine', '/api/jobs/saved', '/api/users/me']) assert.equal((await anon(path)).status, 401);
  for (const [path, method] of [['/api/jobs','POST'], [`/api/jobs/${job.id}/save`,'PUT'], ['/api/applications','POST']]) assert.equal((await anon(path, method)).status, 401);
  const serialized = JSON.stringify(directory.body);
  for (const key of ['password_hash','email_otp_hash','auth_version','moderation_reason']) assert.equal(serialized.includes(key), false);
});
test('anonymous job reads never reveal pending, closed, expired or suspended-owner listings', async () => {
  for (const change of [{ moderation_status: 'pending' }, { moderation_status: 'blocked' }, { status: 'closed' }, { expires_at: new Date(Date.now() - 1000) }]) {
    await Job.updateOne({ _id: job.id }, { $set: { moderation_status: 'approved', status: 'open', expires_at: null, ...change } });
    assert.equal((await fetch(base + '/api/jobs/' + job.id)).status, 404);
    assert.equal((await (await fetch(base + '/api/jobs')).json()).total, 0);
  }
  await Job.updateOne({ _id: job.id }, { $set: { moderation_status: 'approved', status: 'open', expires_at: null } });
  await User.updateOne({ _id: ids.employer }, { $set: { status: 'suspended' } });
  assert.equal((await fetch(base + '/api/jobs/' + job.id)).status, 404);
});
test('public reads still reject invalid supplied credentials rather than silently downgrading them', async () => {
  for (const authorization of ['Bearer invalid', 'BearerXYZ invalid']) {
    assert.equal((await fetch(base + '/api/jobs', { headers: { Authorization: authorization } })).status, 401);
    assert.equal((await fetch(base + '/api/jobs/' + job.id, { headers: { Authorization: authorization } })).status, 401);
  }
});
test('owner can clear advertised salaries and location without keeping stale values', async () => {
  const r = await request('/api/jobs/' + job.id, { who: 'employer', method: 'PATCH', body: { salary_min: null, salary_max: null, location: null } });
  assert.equal(r.status, 200); assert.equal(r.body.job.salary_min, null); assert.equal(r.body.job.salary_max, null); assert.equal(r.body.job.location, null);
  assert.equal(r.body.job.moderation_status, 'pending');
  const forbidden = await request('/api/jobs/' + job.id, { who: 'candidate', method: 'PATCH', body: { salary_min: null } }); assert.equal(forbidden.status, 403);
});
