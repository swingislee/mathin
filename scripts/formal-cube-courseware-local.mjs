import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const output = path.resolve('.tmp/formal-cube');
fs.mkdirSync(output, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(output, 'preflight.json'), refresh: mode === '--preflight', errorFile: path.join(output, 'database-error.txt') });
if (mode === '--preflight') { console.log(JSON.stringify(observed)); process.exit(0); }
const version = '20260908002000_formal_cube_courseware_pages';
const file = `supabase/migrations/${version}.sql`, checksum = textFileSha256(file);
const recorded = sql(`begin read only; select checksum from public.schema_migrations where version='${version}'; commit;`);
if (recorded && recorded !== checksum) throw new Error('FORMAL_CUBE_MIGRATION_CHECKSUM_MISMATCH');
const migration = fs.readFileSync(file, 'utf8').replace(/^(?:begin|commit);\s*$/gm, '');
const fingerprint = () => sql("begin read only; select coalesce(md5(string_agg(pg_get_functiondef(p.oid), E'\\n' order by p.proname)), 'absent') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('cw_formal_cube_page_is_valid','create_cw_formal_cube_page','save_cw_formal_cube_page'); commit;");
const invariant = () => sql("begin read only; select jsonb_build_object('pages',(select count(*) from public.cw_page_docs),'revisions',(select count(*) from public.cw_page_revisions),'releases',(select count(*) from public.cw_lecture_releases),'cubePages',(select count(*) from public.cw_page_docs where source_courseware_id='mathin-formal-cube'),'fixtures',(select count(*) from public.courses where title='__FORMAL_CUBE_TRANSACTION__')); commit;");
if (mode === '--check') {
  const before = fingerprint(), dataBefore = invariant();
  const assertions = fs.readFileSync('supabase/tests/formal_cube_courseware_assertions.sql', 'utf8').replace(/^(?:begin|rollback);\s*$/gm, '');
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='45s'; ${recorded ? '' : migration}\n${assertions}\nrollback;`);
  if (fingerprint() !== before || invariant() !== dataBefore) throw new Error('FORMAL_CUBE_ROLLBACK_FAILED');
  fs.writeFileSync(path.join(output, 'check.json'), JSON.stringify({ checksum, host: observed.host, checkedAt: new Date().toISOString(), contract: 'PASS', permissions: 'PASS', trackIsolation: 'PASS', frozenPublication: 'PASS', rollback: 'PASS' }), 'utf8');
  console.log('Formal cube page permissions, revisions, track isolation, review/release and transaction rollback: PASS');
} else {
  if (recorded) throw new Error('FORMAL_CUBE_MIGRATION_ALREADY_APPLIED');
  const check = JSON.parse(fs.readFileSync(path.join(output, 'check.json'), 'utf8'));
  if (check.checksum !== checksum || check.host !== observed.host || check.rollback !== 'PASS') throw new Error('FORMAL_CUBE_CHECK_REQUIRED');
  const before = invariant();
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='30s'; ${migration}\ninsert into public.schema_migrations(version,checksum) values('${version}','${checksum}'); commit;`);
  if (invariant() !== before) throw new Error('FORMAL_CUBE_APPLY_DATA_DRIFT');
  console.log('Local formal cube functions enabled; existing courseware, releases and snapshots unchanged. No retained fixtures.');
}
