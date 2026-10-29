import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.RATE_LIMIT_STORE = 'memory'; process.env.NODE_ENV = 'test'; process.env.MAIL_TRANSPORT = 'outbox'; process.env.JWT_SECRET = 'test-only-secret-'.repeat(4);
process.env.STORAGE_DRIVER = 's3'; process.env.S3_BUCKET = 'jobboard-private-test'; process.env.S3_ACCESS_KEY_ID = 'test'; process.env.S3_SECRET_ACCESS_KEY = 'test-only'; process.env.MALWARE_SCAN = 'none';
const { objectStore } = await import('../../src/services/objectStorage.js');
const { storeFile, deleteStoredFile, initializeStorage } = await import('../../src/utils/fileStorage.js');
const original = objectStore.client.send; let calls;
beforeEach(() => { calls = []; objectStore.client.send = async command => { calls.push(command); return {}; }; });
after(() => { objectStore.client.send = original; objectStore.client.destroy(); });
test('S3 uploads use private keys and verified Content-Type without a public ACL', async () => {
  const userId = randomUUID(); const result = await storeFile({ buffer: Buffer.from('%PDF-1.7'), mimetype: 'application/pdf' }, 'resumes', userId);
  assert.ok(result.key.startsWith(userId + '/')); assert.equal(result.url, null);
  const input = calls[0].input; assert.equal(calls[0].constructor.name, 'PutObjectCommand'); assert.equal(input.Bucket, 'jobboard-private-test');
  assert.ok(input.Key.startsWith('jobboard/resumes/' + userId)); assert.equal(input.ContentType, 'application/pdf'); assert.equal(input.ACL, undefined); assert.equal(input.IfNoneMatch, '*');
});
test('S3 startup verifies bucket access without exposing credentials', async () => {
  await initializeStorage(); assert.equal(calls[0].constructor.name, 'HeadBucketCommand');
});
test('unsafe keys never reach S3', async () => {
  await assert.rejects(deleteStoredFile('resumes', '../../.env')); assert.equal(calls.length, 0);
});
test('S3 outages fail closed with a safe service error', async () => {
  objectStore.client.send = async () => { throw new Error('credential secret internal detail'); };
  await assert.rejects(storeFile({ buffer: Buffer.from('%PDF-1.7'), mimetype: 'application/pdf' }, 'resumes', randomUUID()), error => error.statusCode === 503 && !error.message.includes('secret'));
});
test('deleting a missing S3 key is idempotent', async () => {
  objectStore.client.send = async () => { const e = new Error('missing'); e.name = 'NoSuchKey'; throw e; };
  await deleteStoredFile('logos', `${randomUUID()}/${randomUUID()}.png`);
});

test('private S3 objects stream through the API with MIME and attachment protections', async () => {
  const { Readable } = await import('node:stream'); const { createApp } = await import('../../src/app.js');
  objectStore.client.send = async command => { assert.equal(command.constructor.name, 'GetObjectCommand'); return { Body: Readable.from(Buffer.from('test image bytes')), ContentType: 'text/html' }; };
  const server = createApp().listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/files/logos/${randomUUID()}/${randomUUID()}.png`);
    assert.equal(r.status, 200); assert.ok(r.headers.get('content-type').includes('image/png')); assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(await r.text(), 'test image bytes');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('conditional object conflict cannot overwrite an existing file', async () => {
  objectStore.client.send = async command => { assert.equal(command.input.IfNoneMatch, '*'); const error = new Error('exists'); error.$metadata = { httpStatusCode: 412 }; throw error; };
  await assert.rejects(storeFile({ buffer: Buffer.from('%PDF-1.7'), mimetype: 'application/pdf' }, 'resumes', randomUUID()), error => error.statusCode === 409);
});
