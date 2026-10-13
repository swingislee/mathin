import fs from 'node:fs';
import {openHistoryLocalTarget} from '../lib/history-local-target.mjs';
import {assertNonProductionWriteTarget} from '../lib/r1-write-target-policy.mjs';
import {textFileSha256} from '../lib/text-hash.mjs';
if(process.argv[2]!=='--apply') throw Error('USE_APPLY');
const manifestFile='content/courses/sudoku-2026/开发导入记录.json';
const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
const ids=Object.values(manifest.courses);
if(ids.length!==3 || ![manifest.familyId,...ids].every(id=>/^[0-9a-f-]{36}$/.test(id))) throw Error('INVALID_COURSE_MANIFEST');
const {sql,observed}=openHistoryLocalTarget({attestationPath:'.tmp/sudoku-2026/target.json',refresh:true,errorFile:'.tmp/sudoku-2026/db-error.txt'});
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>/^[A-Z0-9_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
assertNonProductionWriteTarget({operation:'sudoku-2026:year-round',supabaseUrl:observed.supabaseOrigin,environment:env});
if(observed.supabaseOrigin!=='http://127.0.0.1:35421') throw Error('LOCAL_DEVELOPMENT_ONLY');
const row=fs.readFileSync('.claude/test-accounts.local.md','utf8').split(/\r?\n/).find(l=>/管理员\s*admin/.test(l));
const email=row?.match(/[\w.+-]+@[\w.-]+/)?.[0];
if(!email) throw Error('FIXED_DEVELOPMENT_ADMIN_REQUIRED');
const actor=sql(`begin read only; select id from auth.users where lower(email)=lower(convert_from(decode('${Buffer.from(email).toString('hex')}','hex'),'UTF8')); commit;`);
if(!/^[0-9a-f-]{36}$/.test(actor)) throw Error('FIXED_DEVELOPMENT_ADMIN_REQUIRED');
const selected=ids.map(id=>`'${id}'`).join(',');
const before=JSON.parse(sql(`begin read only; select jsonb_build_object('count',(select count(*) from courses c join course_families f on f.id=c.family_id where c.id in (${selected}) and f.id='${manifest.familyId}' and f.title='数独教学' and f.edition='2026版'),'otherTerms',(select md5(coalesce(jsonb_agg(jsonb_build_array(id,term) order by id)::text,'')) from courses where id not in (${selected}))); commit;`));
if(before.count!==3) throw Error('COURSE_SCOPE_MISMATCH');
const version='20261013162000_course_year_round',file=`supabase/migrations/${version}.sql`,checksum=textFileSha256(file);
const recorded=sql(`begin read only; select checksum from schema_migrations where version='${version}'; commit;`);
if(recorded && recorded!==checksum) throw Error('MIGRATION_CHECKSUM_MISMATCH');
const migration=recorded?'':fs.readFileSync(file,'utf8').replace(/^begin;\r?$/m,'').replace(/^commit;\r?$/m,'');
sql(`begin; set local lock_timeout='5s'; set local statement_timeout='60s';
${migration}
select set_config('request.jwt.claim.sub','${actor}',true);
do $check$
declare detail jsonb; season int; n int;
begin
  if not public.has_perm(auth.uid(),'course.manage') then raise exception 'FORBIDDEN'; end if;
  update public.courses set year_round=true,term=null where id in (${selected}) and family_id='${manifest.familyId}';
  get diagnostics n=row_count;
  if n<>3 then raise exception 'COURSE_SCOPE_MISMATCH'; end if;
  detail:=public.get_course_family_detail('${manifest.familyId}');
  if exists(select 1 from jsonb_array_elements(detail->'variants') v where v->>'yearRound' is distinct from 'true' or v->>'courseSeason' is not null) then raise exception 'YEAR_ROUND_READBACK_MISMATCH'; end if;
  if not exists(select 1 from public.list_course_families('all','{"yearRound":"true","q":"数独教学"}',1) f where f.id='${manifest.familyId}') then raise exception 'YEAR_ROUND_FILTER_MISMATCH'; end if;
  for season in 1..4 loop
    if not exists(select 1 from public.list_course_families('all',jsonb_build_object('q','数独教学','courseSeason',season::text),1) f where f.id='${manifest.familyId}') then raise exception 'YEAR_ROUND_SEASON_FILTER_MISMATCH'; end if;
  end loop;
  begin
    update courses set year_round=false where id='${ids[0]}';
    raise exception 'SEASON_REQUIRED_CHECK_MISSING';
  exception when check_violation then null; end;
  begin
    update courses set term=3 where id='${ids[0]}';
    raise exception 'YEAR_ROUND_EXCLUSIVITY_CHECK_MISSING';
  exception when check_violation then null; end;
  if (select md5(coalesce(jsonb_agg(jsonb_build_array(id,term) order by id)::text,'')) from courses where id not in (${selected})) is distinct from '${before.otherTerms}' then raise exception 'UNRELATED_COURSE_CHANGED'; end if;
end;
$check$;
${recorded?'':`insert into public.schema_migrations(version,checksum) values('${version}','${checksum}');`}
commit;`);
manifest.yearRound=true;manifest.courseSeason=null;
fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({success:true,changedCourses:3,yearRound:true,season:null,otherCourseTermsUnchanged:true,seasonRequiredAndExclusiveChecks:true}));
