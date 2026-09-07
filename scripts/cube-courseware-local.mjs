import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const output = path.resolve('.tmp/cube-courseware');
fs.mkdirSync(output, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(output, 'preflight.json'), refresh: mode === '--preflight', errorFile: path.join(output, 'database-error.txt') });
if (mode === '--preflight') { console.log(JSON.stringify(observed)); process.exit(0); }
const version = '20260907001600_cube_structure_courseware_content';
const file = `supabase/migrations/${version}.sql`, checksum = textFileSha256(file);
const recorded = sql(`begin read only; select checksum from public.schema_migrations where version='${version}'; commit;`);
if (recorded && recorded !== checksum) throw new Error('CUBE_COURSEWARE_MIGRATION_CHECKSUM_MISMATCH');
const migration = fs.readFileSync(file, 'utf8').replace(/^(?:begin|commit);\s*$/gm, '');
const fingerprint = () => sql("begin read only; select md5(pg_get_functiondef('public.cw_courseware_composition_doc_is_valid(jsonb)'::regprocedure)); commit;");
if (mode === '--check') {
  const before = fingerprint();
  const helperBefore = sql("begin read only; select to_regprocedure('public.cw_cube_structures_tool_is_valid(jsonb)') is null; commit;");
  const assertions = fs.readFileSync('supabase/tests/cube_structure_courseware_assertions.sql', 'utf8').replace(/^(?:begin|rollback);\s*$/gm, '');
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='45s'; ${recorded ? '' : migration}\n${assertions}\nrollback;`);
  if (fingerprint() !== before || sql("begin read only; select to_regprocedure('public.cw_cube_structures_tool_is_valid(jsonb)') is null; commit;") !== helperBefore) throw new Error('CUBE_COURSEWARE_ROLLBACK_FAILED');
  fs.writeFileSync(path.join(output, 'check.json'), JSON.stringify({ checksum, host: observed.host, contract: 'PASS', freeze: 'PASS', rollback: 'PASS' }), 'utf8');
  console.log('Cube courseware database whitelist, saved revisions, frozen publication and transaction rollback: PASS');
} else {
  if (recorded) throw new Error('CUBE_COURSEWARE_MIGRATION_ALREADY_APPLIED');
  const check = JSON.parse(fs.readFileSync(path.join(output, 'check.json'), 'utf8'));
  if (check.checksum !== checksum || check.host !== observed.host) throw new Error('CUBE_COURSEWARE_CHECK_REQUIRED');
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='30s'; ${migration}\ninsert into public.schema_migrations(version,checksum) values('${version}','${checksum}'); commit;`);
  console.log('Local cube courseware content version enabled; no retained fixtures or production writes.');
}
