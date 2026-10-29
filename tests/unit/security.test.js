import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.NODE_ENV = 'test'; process.env.MAIL_TRANSPORT = 'outbox';
process.env.STORAGE_DRIVER = 'local';
process.env.RATE_LIMIT_STORE = 'memory';
process.env.MALWARE_SCAN = 'none';
process.env.JWT_SECRET = 'test-only-secret-'.repeat(4);
process.env.UPLOAD_DIR = await mkdtemp(join(tmpdir(), 'jobboard-unit-'));
const { createApp } = await import('../../src/app.js');
const { envSchema } = await import('../../src/config/env.js');
const { registerSchema } = await import('../../src/schemas/authSchema.js');
const { createJobSchema, updateJobSchema, jobQuerySchema } = await import('../../src/schemas/jobSchema.js');
const { User, Job } = await import('../../src/models/index.js');
const { verifiedExtension, resolveStoredFile, storeFile, removeStoredFile } = await import('../../src/utils/fileStorage.js');
let server, base;
before(async () => { server = createApp().listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise(resolve => server.close(resolve)); await rm(process.env.UPLOAD_DIR, { recursive: true, force: true }); });
async function request(path, options) { const r = await fetch(base + path, options); return { status: r.status, headers: r.headers, body: await r.json() }; }
const signup = { name: 'Candidate', email: ' CANDIDATE@EXAMPLE.COM ', password: 'strong-password123' };
test('health sends security headers and request ID', async () => {
  const r = await request('/health/live'); assert.equal(r.status, 200); assert.ok(r.headers.get('content-security-policy')); assert.ok(r.headers.get('x-request-id')); assert.equal(r.headers.get('x-powered-by'), null);
});
test('readiness fails when MongoDB is disconnected', async () => { assert.equal((await request('/health/ready')).status, 503); });
test('debug endpoint was removed', async () => { assert.equal((await request('/api/test-db')).status, 404); });
test('missing and malformed authentication headers are rejected', async () => {
  for (const Authorization of ['', 'BearerXYZ test', 'Bearer a b', 'Bearer invalid']) assert.equal((await request('/api/users/me', { headers: { Authorization } })).status, 401);
});
test('admin self-registration is rejected before touching database', async () => {
  const r = await request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...signup, role: 'admin' }) }); assert.equal(r.status, 400);
});
test('registration normalizes email and restricts role', () => {
  assert.equal(registerSchema.parse(signup).email, 'candidate@example.com');
  assert.equal(registerSchema.safeParse({ ...signup, role: 'admin' }).success, false);
});
test('employer company name and password byte limit are enforced', () => {
  assert.equal(registerSchema.safeParse({ ...signup, role: 'employer' }).success, false);
  assert.equal(registerSchema.safeParse({ ...signup, password: '😀'.repeat(20) }).success, false);
});
test('mass assignment and empty updates are rejected', () => {
  assert.equal(updateJobSchema.safeParse({}).success, false);
  assert.equal(updateJobSchema.safeParse({ employer_id: randomUUID() }).success, false);
  assert.equal(registerSchema.safeParse({ ...signup, password_hash: 'attacker' }).success, false);
});
test('salary range validation includes zero', () => {
  assert.equal(createJobSchema.safeParse({ title: 'Engineer', description: 'Useful description', salary_min: 100, salary_max: 0 }).success, false);
});
test('query validation retains filters and caps pagination', () => {
  assert.equal(jobQuerySchema.parse({ title: 'engineer', salary_min: '100', sort: 'salary' }).salary_min, 100);
  for (const q of [{ page: ['1','2'] }, { limit: '51' }, { unknown: 'x' }, { title: { $ne: '' } }]) assert.equal(jobQuerySchema.safeParse(q).success, false);
});
test('MongoDB model serialization hides credentials and internal fields', () => {
  const user = new User({ name: 'Candidate', email: 'a@example.com', password_hash: 'sensitive', role: 'candidate' });
  const json = user.toJSON(); assert.ok(json.id); assert.equal(json.password_hash, undefined); assert.equal(json._id, undefined); assert.equal(json.__v, undefined);
});
test('MongoDB model also validates merged salary ranges', async () => {
  const job = new Job({ employer_id: randomUUID(), title: 'Engineer', description: 'Useful description', salary_min: 100, salary_max: 50 });
  await assert.rejects(job.validate(), { name: 'ValidationError' });
});
test('file content is checked instead of trusting MIME', () => {
  assert.throws(() => verifiedExtension({ mimetype: 'image/png', buffer: Buffer.from('fake PNG') }));
  assert.equal(verifiedExtension({ mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.7') }), 'pdf');
});
test('file path traversal and arbitrary bucket access are rejected', () => {
  for (const key of ['../../.env', `${randomUUID()}/../../secret.pdf`, `${randomUUID()}/file.pdf`]) assert.throws(() => resolveStoredFile('resumes', key));
  assert.throws(() => resolveStoredFile('../', `${randomUUID()}/${randomUUID()}.pdf`));
});
test('local PDF storage is private and cleanup removes the exact object', async () => {
  const file = await storeFile({ mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.7') }, 'resumes', randomUUID());
  assert.equal(file.url, null); assert.equal((await readFile(resolveStoredFile('resumes', file.key))).toString(), '%PDF-1.7');
  await removeStoredFile('resumes', file.key); await assert.rejects(readFile(resolveStoredFile('resumes', file.key)), { code: 'ENOENT' });
});
test('untrusted CORS origins are rejected', async () => { assert.equal((await request('/health/live', { headers: { Origin: 'https://evil.test' } })).status, 403); });
test('bad and oversized JSON return safe client errors', async () => {
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
  assert.equal((await request('/api/auth/login', { ...options, body: '{' })).status, 400);
  assert.equal((await request('/api/auth/login', { ...options, body: JSON.stringify({ x: 'x'.repeat(70000) }) })).status, 413);
});
test('rate limiting executes before business routes', async () => {
  const app = createApp({ apiLimit: 1, authLimit: 1 }).listen(0, '127.0.0.1'); await new Promise(resolve => app.once('listening', resolve));
  try { const url = `http://127.0.0.1:${app.address().port}/api/users/me`; assert.equal((await fetch(url)).status, 401); assert.equal((await fetch(url)).status, 429); }
  finally { await new Promise(resolve => app.close(resolve)); }
});
test('production configuration rejects placeholder secrets and HTTP client', () => {
  assert.equal(envSchema.safeParse({ NODE_ENV: 'production', CLIENT_URL: 'http://localhost:3000', JWT_SECRET: 'replace-with-at-least-32-random-characters' }).success, false);
});

test('expired, wrong-algorithm and wrong-audience JWTs are rejected', async () => {
  const jwt = (await import('jsonwebtoken')).default;
  const id = randomUUID();
  for (const options of [{ expiresIn: -1 }, { audience: 'wrong' }, { algorithm: 'HS384' }]) {
    const token = jwt.sign({ id }, process.env.JWT_SECRET, { subject: id, issuer: 'jobboard-api', audience: 'jobboard-client', algorithm: 'HS256', expiresIn: '15m', ...options });
    assert.equal((await request('/api/users/me', { headers: { Authorization: `Bearer ${token}` } })).status, 401);
  }
});

test('production requires SMTP credentials, real sender and secure frontend', () => {
  const config = { MALWARE_SCAN: 'clamav', RATE_LIMIT_STORE: 'mongo', ALLOW_LOCAL_STORAGE_IN_PRODUCTION: 'true', NODE_ENV: 'production', CLIENT_URL: 'https://jobs.example.com', JWT_SECRET: 'a'.repeat(64), MAIL_TRANSPORT: 'smtp', MAIL_FROM: 'noreply@example.com', SMTP_HOST: 'smtp.example.com', SMTP_USER: 'user', SMTP_PASS: 'secret' };
  assert.equal(envSchema.safeParse(config).success, true);
  assert.equal(envSchema.safeParse({ ...config, MAIL_TRANSPORT: 'outbox' }).success, false);
  assert.equal(envSchema.safeParse({ ...config, SMTP_PASS: '' }).success, false);
});
test('refresh rejects JavaScript-provided refresh tokens in request body', async () => {
  const r = await request('/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' }, body: JSON.stringify({ refresh_token: 'not-accepted' }) });
  assert.equal(r.status, 400);
});
test('signup cannot mass-assign email verification or session version', () => {
  for (const extra of [{ email_verified_at: new Date().toISOString() }, { auth_version: 0 }, { password_reset_hash: 'attacker' }]) assert.equal(registerSchema.safeParse({ ...signup, ...extra }).success, false);
});

test('upload capacity rejects excess in-flight uploads and releases slots once', async () => {
  const { EventEmitter } = await import('node:events'); const { createUploadCapacity } = await import('../../src/middleware/uploadCapacity.js');
  const gate = createUploadCapacity(1); const a = new EventEmitter(); let passed = 0;
  gate({}, a, () => passed++);
  const blocked = { set() { return this; }, status(code) { this.code = code; return this; }, json() { return this; } };
  gate({}, blocked, () => passed++); assert.equal(blocked.code, 503); assert.equal(passed, 1);
  a.emit('finish'); a.emit('close'); gate({}, new EventEmitter(), () => passed++); assert.equal(passed, 2);
});

test('OpenAPI describes every mounted route and HTTP method', async () => {
  const r = await request('/api/openapi.json'); assert.equal(r.status, 200); assert.equal(r.body.openapi, '3.1.0');
  const app = createApp(); const prefixes = ['/api/admin','/api/notifications','/api/dashboard','/api/reports','/api/files','/api/auth','/api/jobs','/api/applications','/api/users'];
  const check = (route, base = '') => {
    const path = (base + (base && route.path === '/' ? '' : route.path)).replace(/:([A-Za-z]+)/g, '{$1}');
    for (const method of Object.keys(route.methods)) assert.ok(r.body.paths[path]?.[method], `Missing OpenAPI operation: ${method} ${path}`);
  };
  for (const layer of app._router.stack) {
    if (layer.route) check(layer.route);
    else if (layer.name === 'router') {
      const prefix = prefixes.find(value => layer.regexp.test(value)); assert.ok(prefix);
      for (const child of layer.handle.stack) if (child.route) check(child.route, prefix);
    }
  }
});
