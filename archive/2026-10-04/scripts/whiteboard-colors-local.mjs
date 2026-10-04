import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--check', '--apply'].includes(mode)) throw new Error('Use --check or --apply');
const output = path.resolve('.tmp/whiteboard-colors');
fs.mkdirSync(output, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(output, 'target.json'),
  refresh: true, errorFile: path.join(output, 'database-error.txt') });
const version = '20260920120000_whiteboard_custom_colors';
const file = path.resolve('supabase/migrations', `${version}.sql`);
const checksum = textFileSha256(file);
const migration = fs.readFileSync(file, 'utf8').replace(/^begin;\s*/i, '').replace(/\s*commit;\s*$/i, '');
const assertions = fs.readFileSync('supabase/tests/whiteboard_custom_color_assertions.sql', 'utf8');
const assertionsChecksum = textFileSha256('supabase/tests/whiteboard_custom_color_assertions.sql');
const installed = sql(`begin read only; select checksum from public.schema_migrations where version='${version}'; rollback;`);
if (installed) throw new Error(installed === checksum ? 'COLOR_MIGRATION_ALREADY_INSTALLED' : 'COLOR_MIGRATION_CHECKSUM_MISMATCH');
const fingerprint = () => sql(`begin read only; select md5(pg_get_functiondef(oid)||coalesce(proacl::text,''))
  from pg_proc where oid='public.validate_courseware_annotation_content(jsonb)'::regprocedure; rollback;`);
const before = fingerprint();
const checkFile = path.join(output, 'check.json');

if (mode === '--check') {
  let result;
  try {
    result = sql(`begin; set local lock_timeout='5s'; set local statement_timeout='30s';
      ${migration}\n${assertions}\nrollback;`);
  } finally {
    if (fingerprint() !== before) throw new Error('COLOR_VALIDATOR_ROLLBACK_FAILED');
  }
  fs.writeFileSync(checkFile, JSON.stringify({ checksum, assertionsChecksum, before, host: observed.host,
    checkedAt: new Date().toISOString(), validation: 'PASS', rollback: 'PASS' }, null, 2) + '\n');
  console.log(result);
  console.log('Local color/pressure validation and permission checks passed; function replacement rolled back.');
} else {
  const check = JSON.parse(fs.readFileSync(checkFile, 'utf8'));
  if (check.checksum !== checksum || check.assertionsChecksum !== assertionsChecksum || check.before !== before
    || check.host !== observed.host || check.rollback !== 'PASS') throw new Error('COLOR_MIGRATION_CHECK_REQUIRED');
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='30s'; ${migration}\n${assertions}
    insert into public.schema_migrations(version,checksum) values('${version}','${checksum}'); commit;`);
  fs.writeFileSync(path.join(output, 'apply.json'), JSON.stringify({ checksum, host: observed.host,
    appliedAt: new Date().toISOString(), validation: 'PASS' }, null, 2) + '\n');
  console.log('Custom color validator installed on verified local development database; no business rows changed.');
}
