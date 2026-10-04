import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const output = path.resolve('.tmp/blank-courseware');
fs.mkdirSync(output, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(output, 'preflight.json'), refresh: mode === '--preflight', errorFile: path.join(output, 'database-error.txt') });
if (mode === '--preflight') { console.log(JSON.stringify(observed)); process.exit(0); }
const version = '20260908003000_restore_blank_courseware_pages';
const file = `supabase/migrations/${version}.sql`, checksum = textFileSha256(file);
const recorded = sql(`begin read only; select checksum from public.schema_migrations where version='${version}'; commit;`);
if (recorded && recorded !== checksum) throw new Error('BLANK_PAGE_MIGRATION_CHECKSUM_MISMATCH');
const migration = fs.readFileSync(file, 'utf8').replace(/^(?:begin|commit);\s*$/gm, '');
const fingerprint = () => sql("begin read only; select coalesce(md5(string_agg(pg_get_functiondef(p.oid), E'\\n' order by p.proname)), 'absent') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_blank_cw_page','cw_manual_composition_doc_is_valid','save_cw_manual_composition_page'); commit;");
const invariant = () => sql("begin read only; select jsonb_build_object('pages',(select count(*) from public.cw_page_docs),'revisions',(select count(*) from public.cw_page_revisions),'bindings',(select count(*) from public.cw_page_asset_bindings),'objects',(select count(*) from public.cw_asset_objects),'releases',(select count(*) from public.cw_lecture_releases),'sessions',(select count(*) from public.class_sessions),'fixtures',(select count(*) from public.courses where title='__BLANK_PAGE_TRANSACTION__')); commit;");
if (mode === '--check') {
  const before = fingerprint(), dataBefore = invariant();
  const rows = fs.readFileSync('.claude/test-accounts.local.md', 'utf8').split(/\r?\n/)
    .map(line => line.split('|').slice(1, -1).map(cell => cell.replace(/[*_`]/g, '').trim()));
  const identities = Object.entries({ admin: /^管理员\s+admin(?:\s|$)/, student: /^学生\s+student(?:\s|$)/, researcher: /^教研\s+staff\/research(?:\s|$)/ })
    .map(([role, pattern]) => {
      const cells = rows.find(row => pattern.test(row[0] ?? ''));
      if (!cells || !/^[^@'\s]+@[^@'\s]+$/.test(cells[1] ?? '')) throw new Error('FIXED_ROLE_MANIFEST_REQUIRED');
      return `select set_config('mathin.assertion.${role}',coalesce((select id::text from auth.users where email='${cells[1]}'),''),true);`;
    }).join('\n');
  const assertions = fs.readFileSync('supabase/tests/blank_courseware_assertions.sql', 'utf8').replace(/^(?:begin|rollback);\s*$/gm, '');
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='45s'; ${recorded ? '' : migration}\n${identities}\n${assertions}\nrollback;`);
  if (fingerprint() !== before || invariant() !== dataBefore) throw new Error('BLANK_PAGE_ROLLBACK_FAILED');
  fs.writeFileSync(path.join(output, 'check.json'), JSON.stringify({ checksum, host: observed.host, checkedAt: new Date().toISOString(), creation: 'PASS', permissions: 'PASS', bindings: 'PASS', trackIsolation: 'PASS', frozenPublication: 'PASS', rollback: 'PASS' }), 'utf8');
  console.log('Blank page creation, page-local bindings, permissions, track/release isolation and rollback: PASS');
} else {
  if (recorded) throw new Error('BLANK_PAGE_MIGRATION_ALREADY_APPLIED');
  const check = JSON.parse(fs.readFileSync(path.join(output, 'check.json'), 'utf8'));
  if (check.checksum !== checksum || check.host !== observed.host || check.rollback !== 'PASS') throw new Error('BLANK_PAGE_CHECK_REQUIRED');
  const before = invariant();
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='30s'; ${migration}\ninsert into public.schema_migrations(version,checksum) values('${version}','${checksum}'); commit;`);
  if (invariant() !== before) throw new Error('BLANK_PAGE_APPLY_DATA_DRIFT');
  console.log('Local blank-page creation restored; existing courseware, bindings and releases unchanged. No retained fixtures.');
}
