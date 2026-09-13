import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight','--check','--apply','--backfill-preview','--backfill-check','--backfill-apply'].includes(mode)) throw new Error('INVALID_MODE');
const root = path.resolve('.tmp/lead-profile-continuation');
fs.mkdirSync(root, { recursive: true });
const write = (name, data) => fs.writeFileSync(path.join(root,name), `${JSON.stringify(data,null,2)}\n`, 'utf8');
const read = name => JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const { sql: query, observed } = openHistoryLocalTarget({attestationPath:path.join(root,'preflight.json'),refresh:mode==='--preflight',errorFile:path.join(root,'database-error.txt')});
const sql = statement => {
  try { return execFileSync('docker.exe',['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],
    {input:statement,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe']}).trim(); }
  catch(error) { fs.writeFileSync(path.join(root,'database-error.txt'),String(error.stderr??error.message),'utf8'); throw new Error('LOCAL_DATABASE_ERROR: inspect .tmp/lead-profile-continuation/database-error.txt'); }
};
const version='20260913000100_lead_profile_continuation', file=`supabase/migrations/${version}.sql`, checksum=textFileSha256(file);
const assertions=['scripts/sql/school-support-inline-intake-assertions.sql','scripts/sql/lead-profile-continuation-assertions.sql'];
const head=query('begin read only;select max(version) from public.schema_migrations;commit;');
if(mode==='--preflight') { console.log(JSON.stringify({host:observed.host,supabaseOrigin:observed.supabaseOrigin,localTargetVerified:true,head})); process.exit(0); }
const applied=query(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
if(applied&&applied!==checksum) throw new Error('APPLIED_MIGRATION_CHANGED');
const {loadFixedAccount}=await import('../e2e/support/fixed-accounts.ts');
const identities=Object.fromEntries(['admin','teacher','student'].map(role=>{
  const account=loadFixedAccount(role);if(!account)throw new Error('FIXED_ACCOUNT_REQUIRED');
  const id=query(`begin read only;select id from auth.users where email='${account.email.replaceAll("'","''")}';commit;`);
  if(!/^[0-9a-f-]{36}$/.test(id))throw new Error('FIXED_ACCOUNT_REQUIRED');return [role,id];
}));
const actorSql=`select set_config('request.jwt.claims','${JSON.stringify({sub:identities.admin,role:'authenticated'})}',true);`;
const manifestQuery=`select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'version',md5(to_jsonb(l)::text),'contacts',c.fingerprint) order by l.id),'[]')
  from public.leads l cross join lateral(select md5(jsonb_agg(jsonb_build_array(c.id,coalesce(r.effective_patch->>'outcome',c.outcome)) order by c.id)::text) as fingerprint
    from public.business_lead_communications c left join lateral(select effective_patch from public.communication_record_revisions
      where source='contact' and event_id=c.id order by revision_no desc limit 1) r on true
    where c.lead_id=l.id and coalesce(r.effective_patch->>'outcome',c.outcome) in ('connected','declined')) c
  where l.student_id is null and l.status not in ('invalid','converted') and c.fingerprint is not null`;
const studentFingerprint=`select md5(coalesce(string_agg(md5(jsonb_build_array(id,name,phone,parent_phone,deleted_at)::text),'' order by id),'')) from public.students`;
if(mode.startsWith('--backfill-')) {
  if(!applied)throw new Error('MIGRATION_REQUIRED');
  const manifest=JSON.parse(query(`begin read only;${manifestQuery};commit;`));
  if(mode==='--backfill-preview') { write('backfill-manifest.json',manifest);console.log(JSON.stringify({localTargetVerified:true,candidates:manifest.length}));process.exit(0); }
  if(JSON.stringify(read('backfill-manifest.json'))!==JSON.stringify(manifest))throw new Error('BACKFILL_PREVIEW_STALE');
  const key={checksum,manifestHash:textFileSha256(path.join(root,'backfill-manifest.json')),studentFingerprint:query(`begin read only;${studentFingerprint};commit;`)};
  if(mode==='--backfill-apply'&&JSON.stringify(read('backfill-check.json').key)!==JSON.stringify(key))throw new Error('BACKFILL_CHECK_REQUIRED');
  const result=sql(`begin;set local lock_timeout='5s';set local statement_timeout='180s';${actorSql}
    create temp table profile_manifest on commit drop as select * from jsonb_to_recordset('${JSON.stringify(manifest)}'::jsonb) as x(id uuid,version text,contacts text);
    select 1 from public.leads l join profile_manifest m on m.id=l.id order by l.id for update of l;
    do $check$ begin
      if (${manifestQuery}) is distinct from '${JSON.stringify(manifest)}'::jsonb or (${studentFingerprint}) is distinct from '${key.studentFingerprint}' then
        raise exception 'BACKFILL_INPUT_CHANGED';end if;
    end $check$;
    create temp table profile_results(result jsonb) on commit drop;
    do $backfill$ declare lead record;begin for lead in select id from profile_manifest order by id loop
      insert into profile_results values(public.ensure_lead_student_profile(lead.id)||jsonb_build_object('leadId',lead.id));
    end loop;end $backfill$;
    select jsonb_build_object('results',(select coalesce(jsonb_agg(result),'[]') from profile_results),
      'summary',(select coalesce(jsonb_object_agg(status,n),'{}') from (select result->>'studentProfileStatus' as status,count(*) n from profile_results group by 1) c));
    ${mode==='--backfill-check'?'rollback;':'commit;'}`);
  const data=JSON.parse(result.split('\n').findLast(line=>line.startsWith('{')&&line.includes('summary')));
  if(mode==='--backfill-check'&&JSON.stringify(JSON.parse(query(`begin read only;${manifestQuery};commit;`)))!==JSON.stringify(manifest))throw new Error('BACKFILL_ROLLBACK_FAILED');
  write(mode==='--backfill-check'?'backfill-check.json':'backfill-applied.json',{key,...data});
  console.log(JSON.stringify({mode,candidates:manifest.length,...data.summary}));process.exit(0);
}
const key={checksum,head,assertions:assertions.map(textFileSha256)};
if(mode==='--apply'&&applied){console.log(JSON.stringify({alreadyApplied:true}));process.exit(0);}
if(mode==='--apply'&&JSON.stringify(read('check.json').key)!==JSON.stringify(key))throw new Error('CHECK_REQUIRED');
const definitions=()=>query(`begin read only;select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),'' order by p.oid)) from pg_proc p
  where p.proname in ('ensure_lead_student_profile','add_school_support_work_item','search_school_support_subjects','business_subject_is_current','resume_history_workflow_subject','read_school_support_profile','update_school_support_profile');commit;`);
const before=definitions();
sql(`begin;set local lock_timeout='5s';set local statement_timeout='90s';
  ${applied?'':fs.readFileSync(file,'utf8')}
  ${Object.entries(identities).map(([role,id])=>`select set_config('manual_entry_test.${role}','${id}',true);`).join('\n')}
  ${mode==='--check'?assertions.map(file=>fs.readFileSync(file,'utf8')).join('\n'):''}
  ${mode==='--check'?'rollback;':`insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');commit;`}`);
if(mode==='--check'&&definitions()!==before)throw new Error('MIGRATION_ROLLBACK_FAILED');
write(mode==='--check'?'check.json':'applied.json',{key,databaseAssertions:'PASS',localTargetVerified:true});
console.log(JSON.stringify({mode,databaseAssertions:'PASS',localTargetVerified:true}));
