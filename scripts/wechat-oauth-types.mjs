import fs from 'node:fs';
import crypto from 'node:crypto';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { DIGEST_PREFIX, migrationsDigest } from './lib/migrations-digest.mjs';
import { normalizeNewlines, textFileSha256 } from './lib/text-hash.mjs';
import { mergeGeneratedDatabaseTypes } from './lib/scoped-database-types.mjs';

const version = '20260925001000_wechat_oauth_tickets';
const root = '.tmp/wechat-oauth-local';
fs.mkdirSync(root, { recursive: true });
const { sql, docker } = openHistoryLocalTarget({ attestationPath: `${root}/preflight.json`, refresh: true, errorFile: `${root}/database-error.txt` });
const checksum = textFileSha256(`supabase/migrations/${version}.sql`);
if (sql(`begin read only; select checksum from public.schema_migrations where version='${version}'; rollback;`) !== checksum) throw new Error('WECHAT_MIGRATION_REQUIRED');
const current = normalizeNewlines(fs.readFileSync('src/lib/database.types.ts', 'utf8'));
const previous = crypto.createHash('sha256');
for (const file of fs.readdirSync('supabase/migrations').filter(name => name.endsWith('.sql') && name !== `${version}.sql`).sort()) {
  previous.update(file).update(normalizeNewlines(fs.readFileSync(`supabase/migrations/${file}`, 'utf8')));
}
const digest = migrationsDigest();
const recorded = current.split('\n').find(line => line.startsWith(DIGEST_PREFIX))?.slice(DIGEST_PREFIX.length).trim();
if (![digest, previous.digest('hex')].includes(recorded)) throw new Error('UNRELATED_DATABASE_TYPES_STALE');
const generated = docker(['exec','supabase-meta','node','--input-type=module','-e',
  'const r=await fetch("http://127.0.0.1:8080/generators/typescript?included_schemas=public"); if(!r.ok) process.exit(1); process.stdout.write(await r.text());']);
fs.writeFileSync(`${root}/types-generated.ts`, generated + '\n', 'utf8');
const scopes = {
  Tables: ['wechat_binding_audits','wechat_oauth_rate_limits','wechat_oauth_tickets','wechat_profile_snapshots'],
  Functions: ['allow_wechat_oauth_attempt','consume_wechat_oauth_ticket','find_wechat_auth_user','prune_wechat_oauth_tickets'],
};
const output = mergeGeneratedDatabaseTypes(current, generated, scopes)
  .replace(new RegExp(`^${DIGEST_PREFIX}.*$`, 'm'), DIGEST_PREFIX + digest);
fs.writeFileSync('src/lib/database.types.ts', output, 'utf8');
fs.writeFileSync(`${root}/types.json`, JSON.stringify({ checksum, digest, scopes, generatedHash: textFileSha256(`${root}/types-generated.ts`), outputHash: textFileSha256('src/lib/database.types.ts') }, null, 2) + '\n', 'utf8');
console.log('Merged four database-generated WeChat tables and four RPCs; unrelated definitions preserved.');
