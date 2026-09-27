import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const output = path.resolve('.tmp/whiteboard-permission-hotfix');
fs.mkdirSync(output, { recursive: true });
const { sql, docker, observed } = openHistoryLocalTarget({
  attestationPath: path.join(output, 'local-target.json'), refresh: true,
  errorFile: path.join(output, 'local-error.txt'),
});
console.log(JSON.stringify({ host: observed.host, origin: observed.supabaseOrigin, listeners: observed.listeners, ssh: false }));
const version = '20260927000100_whiteboard_version_select';
const file = path.resolve('supabase/migrations', `${version}.sql`);
const testFile = 'supabase/tests/whiteboard_permissions_assertions.sql';
const checksum = textFileSha256(file);
const assertionsChecksum = textFileSha256(testFile);
const migration = fs.readFileSync(file, 'utf8');
const state = () => JSON.parse(sql(`begin isolation level repeatable read read only;
  select jsonb_build_object(
    'versionReadable',has_column_privilege('authenticated','public.whiteboards','version','SELECT'),
    'versionAcl',(select coalesce(attacl::text,'') from pg_attribute where attrelid='public.whiteboards'::regclass and attname='version'),
    'boards',(select md5(coalesce(string_agg(to_jsonb(w)::text,'|' order by id),'')) from public.whiteboards w),
    'members',(select md5(coalesce(string_agg(to_jsonb(m)::text,'|' order by whiteboard_id,user_id),'')) from public.whiteboard_members m),
    'ledger',(select md5(string_agg(to_jsonb(l)::text,'|' order by version)) from public.schema_migrations l),
    'installed',(select checksum from public.schema_migrations where version='${version}'));
  rollback;`));
const before = state();
if (mode === '--preflight') {
  console.log(JSON.stringify({ versionReadable: before.versionReadable, installed: before.installed }));
  process.exit(0);
}
if (before.installed) throw new Error('WHITEBOARD_MIGRATION_ALREADY_INSTALLED');
const checkFile = path.join(output, 'local-check.json');
if (mode === '--check') {
  let reproduced = false;
  try {
    try { sql(fs.readFileSync(testFile, 'utf8')); }
    catch {
      if (!fs.readFileSync(path.join(output, 'local-error.txt'), 'utf8').includes('WHITEBOARD_VERSION_SELECT_REQUIRED')) throw new Error('UNEXPECTED_BASELINE_FAILURE');
      reproduced = true;
    }
    if (!reproduced) throw new Error('MISSING_GRANT_NOT_REPRODUCED');
    const assertions = fs.readFileSync(testFile, 'utf8').replace(/^begin;$/m,
      () => `begin; set local lock_timeout='5s'; set local statement_timeout='30s';\n${migration}`);
    if (!sql(assertions).includes('WHITEBOARD_PERMISSIONS_PASS')) throw new Error('WHITEBOARD_ASSERTIONS_INCOMPLETE');
  } finally {
    if (JSON.stringify(state()) !== JSON.stringify(before)) throw new Error('WHITEBOARD_ROLLBACK_RESIDUAL');
  }
  fs.writeFileSync(checkFile, JSON.stringify({ checksum, assertionsChecksum, before, checkedAt: new Date().toISOString(), systemIdentifier: observed.systemIdentifier, reproduced, rollback: 'PASS' }, null, 2) + '\n');
  console.log('PASS: original failure reproduced; create/read/save/concurrency/role boundaries verified; transaction rollback has zero residual.');
} else {
  const check = JSON.parse(fs.readFileSync(checkFile, 'utf8'));
  if (check.checksum !== checksum || check.assertionsChecksum !== assertionsChecksum || check.systemIdentifier !== observed.systemIdentifier
    || JSON.stringify(check.before) !== JSON.stringify(before) || check.rollback !== 'PASS'
    || Date.now() - Date.parse(check.checkedAt) > 3600000) throw new Error('WHITEBOARD_FRESH_CHECK_REQUIRED');
  fs.writeFileSync(path.join(output, 'local-schema-before.sql'), docker(['exec','supabase-db','pg_dump','-U','postgres','-d','postgres','--schema-only']), 'utf8');
  sql(`begin isolation level serializable; set local lock_timeout='5s'; set local statement_timeout='30s';
    ${migration}
    insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');
    notify pgrst,'reload schema'; commit;`);
  const after = state();
  if (!after.versionReadable || after.installed !== checksum || after.boards !== before.boards || after.members !== before.members) throw new Error('WHITEBOARD_POSTFLIGHT_FAILED');
  fs.writeFileSync(path.join(output, 'local-apply.json'), JSON.stringify({ checksum, appliedAt: new Date().toISOString(), boardsUnchanged: true, membersUnchanged: true, versionReadable: true }, null, 2) + '\n');
  console.log('PASS: verified local database patched; existing whiteboards and members unchanged.');
}
