import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';
import { mergeGeneratedDatabaseTypes } from './lib/scoped-database-types.mjs';
import { DIGEST_PREFIX, migrationsDigest } from './lib/migrations-digest.mjs';

const mode = process.argv[2] ?? 'preflight';
if (!['preflight', 'check', 'apply', 'types'].includes(mode)) throw new Error('INVALID_MODE');
const privateDir = path.resolve('.tmp/session-postpone');
fs.mkdirSync(privateDir, { recursive: true });
const target = openHistoryLocalTarget({
  attestationPath: path.join(privateDir, 'target.json'), refresh: true,
  errorFile: path.join(privateDir, 'database-error.log'),
});
console.log(JSON.stringify({ mode, ...target.observed }));
if (mode !== 'preflight') {
  const version = '20261003020000_session_schedule_postpone';
  const file = `supabase/migrations/${version}.sql`;
  const checksum = textFileSha256(file);
  const recorded = target.sql(`begin read only; select checksum from public.schema_migrations where version='${version}'; commit;`);
  if (recorded && recorded !== checksum) throw new Error('APPLIED_MIGRATION_CHECKSUM_MISMATCH');
  const body = recorded ? '' : fs.readFileSync(file, 'utf8').replace(/^begin;\s*$/m, '').replace(/^commit;\s*$/m, '');
  const assertionsFile = 'scripts/sql/session-postpone-assertions.sql';
  const receipt = path.join(privateDir, 'checked.json');
  const contract = `${checksum}:${textFileSha256(assertionsFile)}`;
  if (mode === 'check') {
    const fingerprint = () => target.sql("begin read only; select md5(coalesce(string_agg(pg_get_functiondef(p.oid),'|' order by p.oid),'')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.proname like '%session_schedule_postpone'; commit;");
    const before = fingerprint();
    target.sql("begin; set local lock_timeout='5s'; set local statement_timeout='45s';\n" + body
      + '\n' + fs.readFileSync(assertionsFile, 'utf8') + '\nrollback;');
    if (fingerprint() !== before) throw new Error('ROLLBACK_FAILED');
    fs.writeFileSync(receipt, JSON.stringify({ contract, checkedAt: new Date().toISOString() }), 'utf8');
    console.log('PASS: scope, history, dates, stale preview, closed days, audit, and rollback assertions');
  } else if (mode === 'apply') {
    if (recorded) throw new Error('MIGRATION_ALREADY_APPLIED');
    if (JSON.parse(fs.readFileSync(receipt, 'utf8')).contract !== contract) throw new Error('MATCHING_CHECK_REQUIRED');
    target.sql("begin; set local lock_timeout='5s';\n" + body
      + `\ninsert into public.schema_migrations(version,checksum) values('${version}','${checksum}');`
      + "\nnotify pgrst, 'reload schema'; commit;");
    console.log('APPLIED: two additive local RPCs; existing schedules unchanged');
  } else {
    if (!recorded) throw new Error('MATCHING_LOCAL_MIGRATION_REQUIRED');
    const generated = target.docker(['exec', 'supabase-meta', 'node', '--input-type=module', '-e',
      'const r=await fetch("http://127.0.0.1:8080/generators/typescript?included_schemas=public"); if(!r.ok) process.exit(1); process.stdout.write(await r.text());']);
    const typeFile = 'src/lib/database.types.ts';
    const output = mergeGeneratedDatabaseTypes(fs.readFileSync(typeFile, 'utf8'), generated, {
      Functions: ['preview_session_schedule_postpone', 'apply_session_schedule_postpone'],
    }).replace(new RegExp('^' + DIGEST_PREFIX + '.*$', 'm'), DIGEST_PREFIX + migrationsDigest());
    fs.writeFileSync(typeFile, output, 'utf8');
    console.log('Merged database-generated types for two RPCs');
  }
}
