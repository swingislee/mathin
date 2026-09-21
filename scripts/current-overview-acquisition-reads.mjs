import fs from 'node:fs';
import assert from 'node:assert/strict';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';

const mode=process.argv[2];
if(!['--check','--apply'].includes(mode)) throw Error('Use --check or --apply');
const root='.tmp/current-overview-acquisition-reads';fs.mkdirSync(root,{recursive:true});
const {sql,observed}=openHistoryLocalTarget({attestationPath:root+'/target.json',refresh:true,errorFile:root+'/error.private.txt'});
console.log(JSON.stringify({host:observed.host,supabaseOrigin:observed.supabaseOrigin,listeners:observed.listeners,ssh:false}));
const version='20260921003000_current_overview_acquisition_sources',migration=`supabase/migrations/${version}.sql`;
const fixture='scripts/sql/current-overview-acquisition-fixtures.sql',checksum=textFileSha256(migration),fixtureChecksum=textFileSha256(fixture);
const applied=sql(`begin read only;select checksum from public.schema_migrations where version='${version}';commit;`);
if(applied&&applied!==checksum) throw Error('MIGRATION_CHECKSUM_CHANGED');
const q=value=>`'${String(value).replaceAll("'","''")}'`;
const claims=role=>{const account=loadFixedAccount(role);if(!account)throw Error('FIXED_ACCOUNT_REQUIRED');return `select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email=${q(account.email)}),'role','authenticated')::text,true) is not null;`;};
const footprint=()=>sql(`begin read only;select jsonb_build_object('records',(select count(*) from public.history_import_records),'ledger',(select count(*) from public.schema_migrations),'function',to_regprocedure('public.list_current_staff_overview_acquisition_sources(text,integer)')::text);commit;`);
if(mode==='--apply'){
  if(applied){console.log(JSON.stringify({alreadyApplied:true}));process.exit(0);}
  const prior=JSON.parse(fs.readFileSync(root+'/check.json','utf8'));
  assert.equal(prior.checksum,checksum);assert.equal(prior.fixtureChecksum,fixtureChecksum);
  sql(`begin;set local lock_timeout='3s';set local statement_timeout='45s';${fs.readFileSync(migration,'utf8')}
    insert into public.schema_migrations(version,checksum) values(${q(version)},${q(checksum)});notify pgrst,'reload schema';commit;`);
  console.log(JSON.stringify({applied:true,checksum}));process.exit(0);
}
const before=footprint();
sql(`begin;set local lock_timeout='3s';set local statement_timeout='45s';
  ${applied?'':fs.readFileSync(migration,'utf8')}
  ${fs.readFileSync(fixture,'utf8')}
  ${claims('admin')} set local role authenticated;
  do $$ declare page jsonb; next_page jsonb; row jsonb; begin
    if not public.is_admin(auth.uid()) then raise exception 'ADMIN_REQUIRED';end if;
    page:=public.list_current_staff_overview_acquisition_sources('zz-acquisition-check-',1000);
    if jsonb_array_length(page->'records')<>1000 or not (page->>'hasMore')::boolean then raise exception 'PAGE_CAP';end if;
    next_page:=public.list_current_staff_overview_acquisition_sources(page->'records'->-1->>'id',1000);
    if jsonb_array_length(next_page->'records')<>3 or (next_page->>'hasMore')::boolean then raise exception 'MERGE_OR_CURSOR';end if;
    if page->>'revision' is distinct from next_page->>'revision' then raise exception 'REVISION';end if;
    select value into row from jsonb_array_elements(next_page->'records') where value->>'id'='zz-acquisition-check-version-current';
    if row is null or row->'source_alias_ids'<>'["zz-acquisition-check-version-current","zz-acquisition-check-version-old"]'::jsonb then raise exception 'VERSION_ALIASES';end if;
    if row->'record_data'->'cells'->1->>'text'<>'2050-01-03' or jsonb_array_length(row->'record_data'->'cells')<>2 then raise exception 'LATEST_FIELDS';end if;
    if not exists(select 1 from jsonb_array_elements(next_page->'records') r where r->>'id'='zz-acquisition-check-unchanged') then raise exception 'UNCHANGED_SOURCE_LOST';end if;
  end;$$;
  reset role;${claims('teacher')} set local role authenticated;
  do $$ declare page jsonb;begin
    if auth.uid() is null or public.is_admin(auth.uid()) then raise exception 'NON_ADMIN_REQUIRED';end if;
    page:=public.list_current_staff_overview_acquisition_sources();
    if page->'records'<>'[]'::jsonb or (page->>'hasMore')::boolean then raise exception 'RLS_CHANGED';end if;
  end;$$;
  reset role;
  do $$ begin
    if has_function_privilege('anon','public.list_current_staff_overview_acquisition_sources(text,integer)','execute')
      or has_function_privilege('service_role','public.list_current_staff_overview_acquisition_sources(text,integer)','execute')
      or exists(select 1 from pg_proc where oid='public.list_current_staff_overview_acquisition_sources(text,integer)'::regprocedure and (prosecdef or provolatile<>'s'))
    then raise exception 'FUNCTION_ACCESS_CHANGED';end if;
  end;$$;rollback;`);
assert.equal(footprint(),before,'ROLLBACK_CHANGED_DATABASE');
const report={checkedAt:new Date().toISOString(),checksum,fixtureChecksum,incrementalMerge:true,unchangedRowsRetained:true,lateOldImportIgnored:true,renamedSourceAccepted:true,unrelatedSourcesExcluded:true,pagination:true,fieldProjection:true,oldAliasesRetained:true,nonAdminRls:true,anonymousAndServiceRoleDenied:true,rollbackUnchanged:true};
fs.writeFileSync(root+'/check.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
