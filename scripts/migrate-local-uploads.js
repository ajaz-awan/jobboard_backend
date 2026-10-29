import { readFile } from 'node:fs/promises';
import { env } from '../src/config/env.js';
import { connectDatabase, closeDatabase } from '../src/config/database.js';
import { Application, User } from '../src/models/index.js';
import { initializeStorage, resolveStoredFile, verifiedExtension } from '../src/utils/fileStorage.js';
import { putObject } from '../src/services/objectStorage.js';
import { scanUpload } from '../src/services/malwareScan.js';
if (!process.argv.includes('--copy-referenced-local-files') || env.STORAGE_DRIVER !== 's3') {
  console.error('Set STORAGE_DRIVER=s3 and run: npm run storage:migrate -- --copy-referenced-local-files'); process.exit(1);
}
const totals = { copied: 0, existing: 0, failed: 0 };
async function copy(bucket, key) {
  try {
    const buffer = await readFile(resolveStoredFile(bucket, key));
    if (buffer.length > 5 * 1024 * 1024) throw new Error('Too large');
    const extension = key.split('.').pop().toLowerCase();
    const mimetype = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[extension];
    if (verifiedExtension({ buffer, mimetype }) !== extension) throw new Error('Invalid file');
    await scanUpload(buffer); await putObject(bucket, key, { buffer, mimetype }); totals.copied++;
  } catch (error) { if (error.statusCode === 409) totals.existing++; else totals.failed++; }
}
try {
  await connectDatabase(); await initializeStorage();
  for await (const application of Application.find().select('+resume_path').cursor()) await copy('resumes', application.resume_path);
  for await (const user of User.find({ logo_url: { $ne: null } }).select('logo_url').cursor()) {
    if (user.logo_url?.startsWith('/api/files/logos/')) await copy('logos', user.logo_url.slice('/api/files/logos/'.length));
  }
  console.log(JSON.stringify({ event: 'storage_copy_completed', ...totals }));
  if (totals.failed) process.exitCode = 1;
} catch { console.error('Storage copy failed. Check database, source directory, private bucket and scanner.'); process.exitCode = 1; }
finally { await closeDatabase(); }
