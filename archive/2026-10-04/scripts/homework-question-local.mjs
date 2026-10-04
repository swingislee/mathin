import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';
const mode=process.argv[2];
if(!['--preflight','--check','--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const output=path.resolve('.tmp/homework-questions');fs.mkdirSync(output,{recursive:true});
const {sql,observed}=openHistoryLocalTarget({attestationPath:path.join(output,'preflight.json'),refresh:mode==='--preflight',errorFile:path.join(output,'database-error.txt')});
if(mode==='--preflight'){console.log(JSON.stringify(observed));process.exit(0);}
const version='20260915005000_assignment_question_records';const file=`supabase/migrations/${version}.sql`;const checksum=textFileSha256(file);
const recorded=sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
if(recorded&&recorded!==checksum)throw new Error('MIGRATION_CHECKSUM_MISMATCH');
const migration=recorded?'':fs.readFileSync(file,'utf8');
if(mode==='--check'){
  const accounts=JSON.parse(sql("begin read only;select jsonb_object_agg(case email when 'test-admin@mathin.local' then 'admin' when 'test-teacher@mathin.local' then 'teacher' when 'test-principal@mathin.local' then 'supervisor' when 'test-student@mathin.local' then 'outsider' end,id) from auth.users where email in ('test-admin@mathin.local','test-teacher@mathin.local','test-principal@mathin.local','test-student@mathin.local');commit;"));
  if(!['admin','teacher','supervisor','outsider'].every(key=>/^[0-9a-f-]{36}$/.test(accounts[key])))throw new Error('FIXED_ACCOUNTS_REQUIRED');
  const settings=Object.entries(accounts).map(([key,id])=>`select set_config('teaching.test.${key}','${id}',true);`).join('\n');
  const setup=fs.readFileSync('scripts/sql/teaching-records-assertions.sql','utf8').split('set local role authenticated;')[0];
  sql(`begin;set local lock_timeout='5s';set local statement_timeout='30s';${migration}\n${settings}\n${setup}\n${fs.readFileSync('scripts/sql/homework-question-assertions.sql','utf8')}\nrollback;`);
  if(!recorded&&sql("begin read only;select to_regclass('public.assignment_questions') is null;commit;")!=='t')throw new Error('ROLLBACK_FAILED');
  fs.writeFileSync(path.join(output,'check.json'),JSON.stringify({checksum,host:observed.host}),'utf8');
  console.log('Homework roster without accounts, six statuses, atomic writes, conflict/undo history and role/RLS checks: PASS');
}else{
  if(recorded)throw new Error('ALREADY_APPLIED');
  const check=JSON.parse(fs.readFileSync(path.join(output,'check.json'),'utf8'));
  if(check.checksum!==checksum||check.host!==observed.host)throw new Error('MATCHING_CHECK_REQUIRED');
  sql(`begin;set local lock_timeout='5s';set local statement_timeout='30s';${migration}\ninsert into public.schema_migrations(version,checksum) values('${version}','${checksum}');notify pgrst,'reload schema';commit;`);
  console.log('Local homework question migration applied.');
}
