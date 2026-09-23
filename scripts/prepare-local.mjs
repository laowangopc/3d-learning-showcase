import { runtimeUrl } from './runtime-paths.mjs';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
const root = runtimeUrl('');
await mkdir(new URL('secrets/', root), { recursive: true });
try { await access(new URL('.env', root)); }
catch { await writeFile(new URL('.env', root), `DATABASE_PASSWORD=${randomBytes(32).toString('hex')}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); }
try { await access(new URL('secrets/accounts.json', root)); }
catch {
  await writeFile(new URL('secrets/accounts.json', root), JSON.stringify({
    admin: { username: 'curator', email: 'curator@localhost.invalid', level: 'admin', password: randomBytes(24).toString('base64url') },
    teacher: { username: 'teacher', email: 'teacher@localhost.invalid', level: 'create', password: randomBytes(24).toString('base64url') },
    visitor: { username: 'learner', email: 'learner@localhost.invalid', level: 'use', password: randomBytes(24).toString('base64url') }
  }, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}
try { await access(new URL('secrets/setup-key.txt', root)); }
catch { await writeFile(new URL('secrets/setup-key.txt', root), `${randomBytes(32).toString('base64url')}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); }
console.log('Local credentials prepared in secrets/accounts.json; existing values preserved.');
