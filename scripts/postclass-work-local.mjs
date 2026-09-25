import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const [mode, scope = 'learning'] = process.argv.slice(2);
if (!['--preflight', '--check', '--apply'].includes(mode) || !['learning', 'homework', 'interactive'].includes(scope)) throw new Error('Use --preflight|--check|--apply learning|homework|interactive');
const output = path.resolve(`.tmp/postclass-${scope}`);
fs.mkdirSync(output, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(output, 'preflight.json'), refresh: mode === '--preflight', errorFile: path.join(output, 'database-error.txt') });
if (mode === '--preflight') { console.log(JSON.stringify(observed)); process.exit(0); }
const versions = scope === 'learning' ? ['20260924010000_postclass_learning_amendments'] : scope === 'homework' ? ['20260924011000_homework_templates', '20260925000100_homework_group_labels'] : ['20260925002000_interactive_homework_questions', '20260925002100_microcourse_question_groups'];
const migrations = versions.map(version => {
  const file = `supabase/migrations/${version}.sql`, checksum = textFileSha256(file);
  const recorded = sql(`begin read only; select checksum from public.schema_migrations where version='${version}'; commit;`);
  if (recorded && recorded !== checksum) throw new Error('MIGRATION_CHECKSUM_MISMATCH');
  return { version, checksum, recorded, source: fs.readFileSync(file, 'utf8') };
});
const checksum = migrations.map(row => `${row.version}:${row.checksum}`).join('|');
const pending = migrations.filter(row => !row.recorded);
const migration = pending.map(row => row.source).join('\n');
if (mode === '--check') {
  const fingerprint = () => sql("begin read only; select md5(string_agg(pg_get_functiondef(oid),'|' order by oid)) from pg_proc where pronamespace='public'::regnamespace and prokind='f'; commit;");
  const before = fingerprint();
  const accounts = JSON.parse(sql("begin read only; select jsonb_object_agg(case email when 'test-admin@mathin.local' then 'admin' when 'test-teacher@mathin.local' then 'teacher' when 'test-principal@mathin.local' then 'supervisor' when 'test-student@mathin.local' then 'outsider' end,id) from auth.users where email in ('test-admin@mathin.local','test-teacher@mathin.local','test-principal@mathin.local','test-student@mathin.local'); commit;"));
  if (!['admin', 'teacher', 'supervisor', 'outsider'].every(key => /^[0-9a-f-]{36}$/.test(accounts[key]))) throw new Error('FIXED_ACCOUNTS_REQUIRED');
  const settings = Object.entries(accounts).map(([key, id]) => `select set_config('teaching.test.${key}','${id}',true);`).join('\n');
  const setup = fs.readFileSync('scripts/sql/teaching-records-assertions.sql', 'utf8').split('set local role authenticated;')[0];
  const homeworkSetup = scope === 'interactive' ? fs.readFileSync('scripts/sql/postclass-homework-assertions.sql', 'utf8') : '';
  const contentFixtures = scope === 'interactive' ? `select set_config('interactive.test.fixtures','${JSON.stringify(JSON.parse(fs.readFileSync('scripts/sql/fixtures/interactive-homework.json', 'utf8'))).replaceAll("'", "''")}',true);` : '';
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='30s'; ${migration}\n${settings}\n${setup}\n${homeworkSetup}\n${contentFixtures}\n${fs.readFileSync(`scripts/sql/postclass-${scope}-assertions.sql`, 'utf8')}\nrollback;`);
  if (fingerprint() !== before) throw new Error('ROLLBACK_FAILED');
  fs.writeFileSync(path.join(output, 'check.json'), JSON.stringify({ checksum, host: observed.host }), 'utf8');
  console.log(`${scope}: persistence, conflicts, scope, history and transactional rollback PASS`);
} else {
  if (!pending.length) { console.log('Already applied with matching checksum.'); process.exit(0); }
  const check = JSON.parse(fs.readFileSync(path.join(output, 'check.json'), 'utf8'));
  if (check.checksum !== checksum || check.host !== observed.host) throw new Error('MATCHING_CHECK_REQUIRED');
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='30s'; ${migration}\n${pending.map(row => `insert into public.schema_migrations(version,checksum) values('${row.version}','${row.checksum}');`).join('\n')} notify pgrst,'reload schema'; commit;`);
  console.log(`Local ${scope} migration applied.`);
}
