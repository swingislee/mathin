import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

// 一次性初版补齐使用本机既有业务 RPC；生产只读盘点独立执行，本工具无生产通道。
const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const output = path.resolve('.tmp/initial-courseware-4x3');
fs.mkdirSync(output, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(output, 'preflight.json'), refresh: mode === '--preflight', errorFile: path.join(output, 'database-error.txt') });
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const jsonSql = value => `convert_from(decode('${Buffer.from(JSON.stringify(value),'utf8').toString('base64')}','base64'),'utf8')::jsonb`;
const fingerprint = () => sql(`begin read only; select jsonb_build_object(
 'native', (select md5(string_agg(id::text||md5(snapshot::text),',' order by id)) from public.cw_lecture_releases where track='native-16x9'),
 'existingAdapted', (select md5(string_agg(id::text||md5(snapshot::text),',' order by id)) from public.cw_lecture_releases where track='adapted-4x3' and note not like 'initial-4x3-20260908:%'),
 'frozen', (select md5(string_agg(id::text||coalesce(courseware::text,'')||coalesce(courseware_resolved::text,'')||coalesce(courseware_overlay::text,''),',' order by id)) from public.class_sessions where courseware_frozen_at is not null),
 'nativeHeads', (select md5(string_agg(page_doc_id::text||coalesce(current_revision_id::text,'')||coalesce(draft_revision_id::text,''),',' order by page_doc_id)) from public.cw_page_track_heads where track='native-16x9'),
 'storageObjects',(select count(*) from storage.objects)); commit;`);
const targetSql = `select l.id, count(*)::integer pages,
 count(*) filter(where coalesce(a.draft_revision_id,a.current_revision_id) is null)::integer missing,
 count(*) filter(where a.draft_revision_id is not null)::integer drafts,
 bool_and(p.doc_version in ('page-doc-v1','source-runtime-page-v1') or (p.doc_version='courseware-composition-v1' and coalesce(a.draft_revision_id,a.current_revision_id) is not null)) supported,
 (public.resolve_cw_workflow_policy(l.id)).emergency_publish_enabled emergency
 from public.course_lectures l join public.courses c on c.id=l.course_id join public.cw_page_docs p on p.lecture_id=l.id and p.deleted_at is null
 left join public.cw_page_track_heads a on a.page_doc_id=p.id and a.track='adapted-4x3'
 where l.archived_at is null and l.status<>'archived' and c.status='enabled'
 and exists(select 1 from public.cw_lecture_track_heads h where h.lecture_id=l.id and h.track='native-16x9' and h.current_release_id is not null)
 and not exists(select 1 from public.cw_lecture_releases r where r.lecture_id=l.id and r.track='adapted-4x3')
 and exists(select 1 from public.cw_page_docs f where f.lecture_id=l.id and f.deleted_at is null and f.doc_version in ('page-doc-v1','source-runtime-page-v1'))
 group by l.id order by l.id`;
const currentTargets = () => JSON.parse(sql(`begin transaction isolation level repeatable read read only; select coalesce(jsonb_agg(x),'[]'::jsonb) from (${targetSql}) x; commit;`));
const codeHash = createHash('sha256').update([
  'scripts/courseware-initial-4x3-local.mjs', 'src/features/courseware-studio/automatic-adaptation-contract.ts',
  'src/features/courseware-doc/courseware-4x3-strategy.ts', 'src/features/courseware-doc/adapt-4x3.ts',
].map(file => textFileSha256(file)).join(':')).digest('hex');
if (mode === '--preflight') {
  const targets = currentTargets();
  const supported = targets.filter(row => row.supported);
  const plan = { observed, codeHash, targets: supported, excluded: targets.filter(row => !row.supported),
    baseline: fingerprint(), generatedAt: new Date().toISOString() };
  if (supported.some(row => !row.emergency || row.pages > 200)) throw new Error('INITIAL_RELEASE_POLICY_OR_PAGE_LIMIT_BLOCKED');
  fs.writeFileSync(path.join(output,'plan.json'), JSON.stringify(plan), 'utf8');
  console.log(JSON.stringify({ ...observed, lectures: supported.length, pages: supported.reduce((n,row)=>n+row.pages,0), missingPages: supported.reduce((n,row)=>n+row.missing,0), existingDrafts: supported.reduce((n,row)=>n+row.drafts,0), unsupportedLectures: plan.excluded.length }));
  process.exit(0);
}
const plan = JSON.parse(fs.readFileSync(path.join(output,'plan.json'),'utf8'));
if (plan.codeHash !== codeHash || plan.observed.host !== observed.host) throw new Error('INITIAL_RELEASE_PLAN_DRIFT');
const rows = fs.readFileSync('.claude/test-accounts.local.md','utf8').split(/\r?\n/).map(line=>line.split('|').slice(1,-1).map(cell=>cell.replace(/[*_`]/g,'').trim()));
const identity = rows.find(row=>/^管理员\s+admin(?:\s|$)/.test(row[0]??''))?.[1];
if (!identity || !/^[^@'\s]+@[^@'\s]+$/.test(identity)) throw new Error('FIXED_ADMIN_MANIFEST_REQUIRED');
const actor = sql(`begin read only; select p.id from public.profiles p join auth.users u on u.id=p.id where u.email=${q(identity)} and p.role='admin' and p.is_active; commit;`);
if (!/^[a-f0-9-]{36}$/.test(actor)) throw new Error('ACTIVE_FIXED_ADMIN_REQUIRED');
const require = createRequire(import.meta.url);
const viteRequire = createRequire(createRequire(require.resolve('vitest/package.json')).resolve('vite/package.json'));
const { createJiti } = viteRequire('jiti');
const jiti = createJiti(import.meta.url, { alias: { '@': path.resolve('src') }, fsCache: false, moduleCache: false });
const { automaticCourseware43Doc } = await jiti.import(path.resolve('src/features/courseware-studio/automatic-adaptation-contract.ts'));

function lectureDrafts(lectureId) {
  return JSON.parse(sql(`begin transaction isolation level repeatable read read only;
    select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'classification',p.adapt_class,'source',r.id,'doc',r.doc) order by p.page_no),'[]'::jsonb)
    from public.cw_page_docs p join public.cw_page_track_heads n on n.page_doc_id=p.id and n.track='native-16x9'
    join public.cw_page_revisions r on r.id=coalesce(n.draft_revision_id,n.current_revision_id)
    left join public.cw_page_track_heads a on a.page_doc_id=p.id and a.track='adapted-4x3'
    where p.lecture_id=${q(lectureId)}::uuid and p.deleted_at is null and coalesce(a.draft_revision_id,a.current_revision_id) is null; commit;`));
}
function transaction(lectureId, drafts, rollback) {
  const input = drafts.map(row=>({ id: row.id, source: row.source, doc: automaticCourseware43Doc(row.doc,row.classification) }));
  const statement = `begin; set local lock_timeout='5s'; set local statement_timeout='90s';
    set local role authenticated; select set_config('request.jwt.claim.sub',${q(actor)},true);
    do $batch$ declare item jsonb; release_id uuid; begin
      perform 1 from public.course_lectures where id=${q(lectureId)}::uuid for update;
      if exists(select 1 from public.cw_lecture_releases where lecture_id=${q(lectureId)}::uuid and track='adapted-4x3') then return; end if;
      for item in select * from jsonb_array_elements(${jsonSql(input)}) loop
        perform public.create_missing_cw_adapted_draft((item->>'id')::uuid,(item->>'source')::uuid,item->'doc');
      end loop;
      release_id := public.emergency_publish_cw_review(${q(lectureId)}::uuid,'adapted-4x3','Product owner authorized one-time initial 4:3 release backfill; existing edits preserved','initial-4x3-20260908: rule-matched rough version; visual review pending');
      if not exists(select 1 from public.cw_lecture_releases where id=release_id and track='adapted-4x3' and release_no=1) then raise exception 'INITIAL_RELEASE_ASSERTION_FAILED'; end if;
    end $batch$;
    ${rollback ? 'rollback' : 'commit'};`;
  sql(statement);
  return input.length;
}
if (mode === '--check') {
  const sample = plan.targets.find(row=>row.drafts>0) ?? plan.targets[0];
  if (!sample) { console.log('No missing initial releases.'); process.exit(0); }
  const before = fingerprint();
  const revisions = sql('begin read only; select count(*) from public.cw_page_revisions; commit;');
  const generated = transaction(sample.id,lectureDrafts(sample.id),true);
  if (fingerprint() !== before || sql('begin read only; select count(*) from public.cw_page_revisions; commit;') !== revisions) throw new Error('INITIAL_RELEASE_REHEARSAL_RESIDUE');
  fs.writeFileSync(path.join(output,'check.json'),JSON.stringify({codeHash,checkedAt:new Date().toISOString(),rollback:true}), 'utf8');
  console.log(JSON.stringify({samplePages:sample.pages,generated,existingDrafts:sample.drafts,explicitInitialPublication:'PASS',rollback:'PASS'}));
  process.exit(0);
}
const check = JSON.parse(fs.readFileSync(path.join(output,'check.json'),'utf8'));
if (check.codeHash!==codeHash || !check.rollback) throw new Error('INITIAL_RELEASE_CHECK_REQUIRED');

// 先生成可校验的本机数据库备份，成功后才开始业务写入；不清理任何旧备份。
const backup = path.join(output,`before-${new Date().toISOString().replace(/[:.]/g,'-')}.dump`);
const dump = spawn('docker.exe',['--context','desktop-linux','exec','supabase-db','pg_dump','-U','postgres','-d','postgres','--format=custom','--no-owner'],{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
let dumpError=''; dump.stderr.on('data',chunk=>{dumpError+=chunk;});
const dumped = new Promise((resolve,reject)=>{dump.on('error',reject);dump.on('close',code=>code===0?resolve():reject(new Error(`BACKUP_FAILED:${dumpError}`)));});
await Promise.all([pipeline(dump.stdout,fs.createWriteStream(backup,{flags:'wx'})),dumped]);
const hash = createHash('sha256'); for await (const chunk of fs.createReadStream(backup)) hash.update(chunk);
const backupHash = hash.digest('hex');
const toc = spawn('docker.exe',['--context','desktop-linux','exec','-i','supabase-db','pg_restore','--list'],{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
let tocRows=0; toc.stdout.on('data',chunk=>{tocRows+=chunk.toString().split('\n').length-1;}); toc.stderr.resume();
const verified = new Promise((resolve,reject)=>{toc.on('error',reject);toc.on('close',code=>code===0?resolve():reject(new Error('BACKUP_TOC_FAILED')));});
await Promise.all([pipeline(fs.createReadStream(backup),toc.stdin),verified]);
if(tocRows<100)throw new Error('BACKUP_TOC_INCOMPLETE');
fs.writeFileSync(path.join(output,'backup.json'),JSON.stringify({backup,sha256:backupHash,bytes:fs.statSync(backup).size,tocRows,codeHash}), 'utf8');
console.log(JSON.stringify({backup:'verified',bytes:fs.statSync(backup).size,tocRows}));
const allowed = new Set(plan.targets.map(row=>row.id));
const targets = currentTargets().filter(row=>row.supported && allowed.has(row.id));
const before = fingerprint();
let complete=0, generated=0;
const failures=[];
for (const target of targets) {
  try { generated+=transaction(target.id,lectureDrafts(target.id),false); complete+=1; }
  catch(error) { failures.push({lectureId:target.id,reason:String(error.message).slice(0,180)}); break; }
  if (complete%20===0 || complete===targets.length) console.log(JSON.stringify({completedLectures:complete,totalLectures:targets.length,generatedPages:generated}));
}
const preserved = fingerprint()===before;
const remaining=currentTargets();
fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({codeHash,complete,generated,failures,preserved,remaining:remaining.filter(row=>row.supported).length,excluded:remaining.filter(row=>!row.supported).length,finishedAt:new Date().toISOString()}),'utf8');
console.log(JSON.stringify({complete,generated,failures:failures.length,preserved,remaining:remaining.filter(row=>row.supported).length,excluded:remaining.filter(row=>!row.supported).length}));
if(failures.length || !preserved || remaining.some(row=>row.supported))process.exitCode=1;
