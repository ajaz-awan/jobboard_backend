import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const example = new URL('../.env.example', import.meta.url);
const destination = new URL('../.env', import.meta.url);
const template = await readFile(example, 'utf8');
const contents = template.replace('replace-with-at-least-32-random-characters', randomBytes(48).toString('hex'));
try {
  await writeFile(destination, contents, { flag: 'wx', mode: 0o600 });
  console.log('.env created with a random JWT secret and local MongoDB settings. Start MongoDB Server, then run npm run dev.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('.env already exists and was preserved. Check MONGODB_URI and JWT_SECRET, then run npm run dev.');
}
