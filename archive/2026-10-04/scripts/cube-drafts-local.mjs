import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const output = path.resolve('.tmp/cube-account-drafts');
fs.mkdirSync(output, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(output, 'preflight.json'), refresh: mode === '--preflight', errorFile: path.join(output, 'database-error.txt') });
if (mode === '--preflight') { console.log(JSON.stringify(observed)); process.exit(0); }
const migrations = ['20260907001400_cube_structure_account_drafts', '20260907001500_cube_draft_conflict_response'].map(version => {
  const file = `supabase/migrations/${version}.sql`, checksum = textFileSha256(file);
  const recorded = sql(`begin read only; select checksum from public.schema_migrations where version='${version}'; commit;`);
  if (recorded && recorded !== checksum) throw new Error('CUBE_DRAFT_MIGRATION_CHECKSUM_MISMATCH');
  return { version, file, checksum, recorded };
});
const pending = migrations.filter(item => !item.recorded);
const checksums = migrations.map(item => item.checksum).join(':');
const fingerprint = () => sql("begin read only; select coalesce(md5(pg_get_functiondef(to_regprocedure('public.save_cube_structure_draft(uuid,text,jsonb,integer)'))),'missing'); commit;");
if (mode === '--check') {
  const before = fingerprint();
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='30s';
    ${pending.map(item => fs.readFileSync(item.file, 'utf8')).join('\n')}
    ${fs.readFileSync('scripts/sql/cube-drafts-assertions.sql', 'utf8')}
    rollback;`);
  const remaining = sql(`begin read only; select to_regclass('public.cube_structure_drafts') is null; commit;`);
  if ((!migrations[0].recorded && remaining !== 't') || fingerprint() !== before) throw new Error('CUBE_DRAFT_ROLLBACK_FAILED');
  fs.writeFileSync(path.join(output, 'check.json'), JSON.stringify({ checksums, host: observed.host, rls: 'PASS', revision: 'PASS', rollback: 'PASS' }), 'utf8');
  console.log('Cube draft owner isolation, denied direct writes, revision conflict and transaction rollback: PASS');
} else {
  if (!pending.length) throw new Error('CUBE_DRAFT_MIGRATION_ALREADY_APPLIED');
  const check = JSON.parse(fs.readFileSync(path.join(output, 'check.json'), 'utf8'));
  if (check.checksums !== checksums || check.host !== observed.host) throw new Error('CUBE_DRAFT_CHECK_REQUIRED');
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='30s';
    ${pending.map(item => `${fs.readFileSync(item.file, 'utf8')}\ninsert into public.schema_migrations(version,checksum) values('${item.version}','${item.checksum}');`).join('\n')}
    notify pgrst, 'reload schema'; commit;`);
  console.log('Local cube draft schema applied; no persistent draft fixtures or production writes.');
}
