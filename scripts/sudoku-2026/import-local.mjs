import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {openHistoryLocalTarget} from '../lib/history-local-target.mjs';
import {assertNonProductionWriteTarget} from '../lib/r1-write-target-policy.mjs';
import {textFileSha256} from '../lib/text-hash.mjs';

if(process.argv[2]!=='--apply') throw Error('Use --apply to import this new course into the verified local development database.');
const dir='.tmp/sudoku-2026'; fs.mkdirSync(dir,{recursive:true});
const {sql,observed}=openHistoryLocalTarget({attestationPath:`${dir}/target.json`,refresh:true,errorFile:`${dir}/db-error.txt`});
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>/^[A-Z0-9_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
assertNonProductionWriteTarget({operation:'sudoku-2026:import-local',supabaseUrl:observed.supabaseOrigin,environment:env});
if(observed.supabaseOrigin!=='http://127.0.0.1:35421') throw Error('LOCAL_DEVELOPMENT_ONLY');
const account=fs.readFileSync('.claude/test-accounts.local.md','utf8').split(/\r?\n/).find(l=>/管理员\s*admin/.test(l));
const email=account?.match(/[\w.+-]+@[\w.-]+/)?.[0];
if(!email) throw Error('FIXED_DEVELOPMENT_ADMIN_REQUIRED');
// A restored development database may have different UUIDs. Resolve the fixed
// private account by email, then require its existing permissions below.
const actor=sql(`begin read only; select u.id from auth.users u join public.profiles p on p.id=u.id where lower(u.email)=lower(convert_from(decode('${Buffer.from(email).toString('hex')}','hex'),'UTF8')); commit;`);
if(!/^[0-9a-f-]{36}$/.test(actor)) throw Error('FIXED_DEVELOPMENT_ADMIN_REQUIRED');
const identity=`select set_config('request.jwt.claim.sub','${actor}',true); select set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',true);`;
const permission=sql(`begin read only; ${identity} select public.has_perm(auth.uid(),'course.manage') and public.has_perm(auth.uid(),'courseware.page.edit'); commit;`).split('\n').at(-1);
if(permission!=='t') throw Error('DEVELOPMENT_ADMIN_PERMISSION_REQUIRED');
const existing=sql(`begin read only; select count(*) from public.course_families where title='数独教学' and publisher='Math.ing' and edition='2026版'; commit;`);
if(existing!=='0') throw Error('COURSE_ALREADY_EXISTS: inspect its existing identity; do not import a duplicate.');
const pkg=JSON.parse(fs.readFileSync(`${dir}/course-package.json`,'utf8'));
if(pkg.lessons.length!==12 || pkg.lessons.reduce((n,l)=>n+l.pages.length,0)!==239 || pkg.nativeAudit.length!==182) throw Error('COURSE_PACKAGE_INCOMPLETE');
const versions=['20261013160000_formal_courseware_sudoku_games','20261013161000_course_grade_ranges','20261013162000_course_year_round'].map(version=>{
 const file=`supabase/migrations/${version}.sql`,checksum=textFileSha256(file), recorded=sql(`begin read only; select checksum from public.schema_migrations where version='${version}'; commit;`);
 if(recorded && recorded!==checksum) throw Error('MIGRATION_CHECKSUM_MISMATCH');
 return {version,file,checksum,recorded};
});
const pending=versions.filter(v=>!v.recorded),migration=pending.map(v=>fs.readFileSync(v.file,'utf8').replace(/^begin;\r?$/m,'').replace(/^commit;\r?$/m,'')).join('\n');
const encoded=Buffer.from(JSON.stringify(pkg)).toString('base64');
console.log(JSON.stringify({target:observed.supabaseOrigin,newFamilies:1,newVariants:3,newLectures:12,newPages:239,pendingMigrations:pending.map(v=>v.version)}));
// The transaction contains only this course's creation and its additive contracts.
// It uses the same capability-checked authoring RPCs as the editor for every page.
const result=sql(`begin;
set local lock_timeout='5s'; set local statement_timeout='120s';
${migration}
${identity}
create temp table sudoku_import_result(result jsonb) on commit drop;
do $import$
declare pkg jsonb:=convert_from(decode('${encoded}','base64'),'UTF8')::jsonb;
  family uuid; catalog uuid; course uuid; lecture uuid; page uuid;
  lesson jsonb; page_data jsonb; level_name text; grade_start smallint;
  courses jsonb:='{}'; lessons jsonb:='[]'; count_pages int:=0; detail jsonb;
begin
  if exists(select 1 from public.course_families where title='数独教学' and publisher='Math.ing' and edition='2026版') then raise exception 'COURSE_ALREADY_EXISTS'; end if;
  family:=public.create_course_family('数独教学','Math.ing','小学','逻辑思维','2026版','初阶四宫（1–2年级）、中阶六宫（3–4年级）、高阶九宫（5–6年级），各四讲，每讲90分钟。探索、归纳、练习；含原生变形数独与摩天楼。','production',auth.uid());
  select id into catalog from public.course_catalog_versions where family_id=family and is_current;
  if catalog is null then
    insert into public.course_catalog_versions(family_id,slug,title,edition_year,is_current,status,created_by)
    values(family,'2026','2026版',2026,true,'enabled',auth.uid()) returning id into catalog;
  else
    update public.course_catalog_versions set slug='2026',title='2026版',edition_year=2026 where id=catalog and family_id=family;
  end if;
  for lesson in select value from jsonb_array_elements(pkg->'lessons') loop
    level_name:=lesson->>'level'; grade_start:=case level_name when '初阶' then 1 when '中阶' then 3 else 5 end;
    if not courses ? level_name then
      course:=public.create_course_variant(family,level_name||'（'||grade_start||'–'||(grade_start+1)||'年级）·'||(lesson->>'n')||'宫数独','SUDOKU2026-'||left(lesson->>'id',1),grade_start,3::smallint,level_name,'draft',catalog);
      update public.courses set grade_end=grade_start+1,year_round=true,term=null where id=course and family_id=family;
      courses:=courses||jsonb_build_object(level_name,course);
    else course:=(courses->>level_name)::uuid;
    end if;
    lecture:=public.create_course_lecture(course,lesson->>'title','90分钟；'||(lesson->>'focus')||'。先探索、再归纳、后练习；3道课堂完整题、4道课后题。教师用书与逐题方法依据见数独教学2026版资料包。');
    for page_data in select value from jsonb_array_elements(lesson->'pages') loop
      if public.cw_manual_composition_doc_is_valid(page_data->'doc') is not true then raise exception 'INVALID_COURSE_PAGE: %',page_data->>'title'; end if;
      page:=public.create_blank_cw_page(lecture,null,page_data->>'title');
      perform * from public.save_cw_manual_composition_page(page,'native-16x9',page_data->'doc',1,'数独教学2026版初始课程');
      perform * from public.save_cw_manual_composition_page(page,'adapted-4x3',page_data->'doc',1,'数独教学2026版初始课程');
      count_pages:=count_pages+1;
    end loop;
    lessons:=lessons||jsonb_build_array(jsonb_build_object('id',lesson->>'id','title',lesson->>'title','lectureId',lecture,'courseId',course,'pages',jsonb_array_length(lesson->'pages')));
  end loop;
  detail:=public.get_course_family_detail(family);
  if jsonb_array_length(detail->'variants')<>3 or count_pages<>239 then raise exception 'COURSE_IMPORT_COUNT_MISMATCH'; end if;
  if exists(select 1 from jsonb_array_elements(detail->'variants') v where (v->>'gradeEnd')::int is distinct from (v->>'grade')::int+1) then raise exception 'GRADE_RANGE_READBACK_MISMATCH'; end if;
  for grade_start in 1..6 loop
    if not exists(select 1 from public.list_course_families('all',jsonb_build_object('q','数独教学','grade',grade_start::text),1) f where f.id=family) then raise exception 'GRADE_RANGE_FILTER_MISMATCH'; end if;
  end loop;
  insert into sudoku_import_result values(jsonb_build_object('familyId',family,'catalogVersionId',catalog,'courses',courses,'lessons',lessons,'pages',count_pages,'status','editable-draft'));
end;
$import$;
${pending.map(v=>`insert into public.schema_migrations(version,checksum) values('${v.version}','${v.checksum}');`).join('\n')}
select result from sudoku_import_result;
commit;`);
const receipt=JSON.parse(result.split('\n').filter(l=>l.startsWith('{')&&l.includes('familyId')).at(-1));
receipt.developmentUrl=`http://192.168.5.213:3130/zh/dashboard/courses/${receipt.familyId}`;
for(const l of receipt.lessons) l.developmentUrl=`http://192.168.5.213:3130/zh/dashboard/courseware/lectures/${l.lectureId}?workspace=courseware&canvas=adapted-4x3&track=adapted-4x3`;
receipt.packageSha256=createHash('sha256').update(JSON.stringify(pkg)).digest('hex');
receipt.importedAt=new Date().toISOString();
receipt.courseSeason=null;
receipt.yearRound=true;
fs.writeFileSync('content/courses/sudoku-2026/开发导入记录.json',JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({success:true,familyId:receipt.familyId,lectures:receipt.lessons.length,pages:receipt.pages,url:receipt.developmentUrl}));
