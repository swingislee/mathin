import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openHistoryLocalTarget} from '../lib/history-local-target.mjs';
import {assertNonProductionWriteTarget} from '../lib/r1-write-target-policy.mjs';

const apply=process.argv.includes('--apply'), dir='.tmp/sudoku-2026';
const manifest=JSON.parse(fs.readFileSync('content/courses/sudoku-2026/开发导入记录.json','utf8'));
const bank=JSON.parse(fs.readFileSync('content/courses/sudoku-2026/bank.json','utf8'));
const pkg=JSON.parse(fs.readFileSync(`${dir}/course-package.json`,'utf8'));
const b4=manifest.lessons.find(l=>l.id==='B4');
if(![manifest.familyId,b4?.lectureId].every(id=>/^[0-9a-f-]{36}$/.test(id))) throw Error('INVALID_COURSE_MANIFEST');
const {sql,observed}=openHistoryLocalTarget({attestationPath:`${dir}/target.json`,refresh:true,errorFile:`${dir}/db-error.txt`});
if(observed.supabaseOrigin!=='http://127.0.0.1:35421') throw Error('LOCAL_DEVELOPMENT_ONLY');
const readSql=`select jsonb_build_object(
 'pages',(select jsonb_agg(jsonb_build_object('pageId',p.id,'lectureId',p.lecture_id,'pageNo',p.page_no,'title',p.title,'track',h.track,'revisionNo',r.revision_no,'doc',r.doc) order by p.lecture_id,p.page_no,h.track)
  from cw_page_docs p join course_lectures l on l.id=p.lecture_id join courses c on c.id=l.course_id join cw_page_track_heads h on h.page_doc_id=p.id join cw_page_revisions r on r.id=coalesce(h.draft_revision_id,h.current_revision_id)
  where c.family_id='${manifest.familyId}' and p.deleted_at is null),
 'releaseHeads',(select coalesce(jsonb_agg(to_jsonb(h) order by h.lecture_id,h.track),'[]') from cw_lecture_track_heads h join course_lectures l on l.id=h.lecture_id join courses c on c.id=l.course_id where c.family_id='${manifest.familyId}'),
 'sessionReferences',(select count(*) from class_sessions s join course_lectures l on l.id=s.lecture_id join courses c on c.id=l.course_id where c.family_id='${manifest.familyId}')
);`;
const before=JSON.parse(sql(`begin read only; ${readSql} commit;`));
fs.writeFileSync(`${dir}/towers-before.json`,JSON.stringify(before));
assert.equal(before.pages.length,478,'Expected both draft tracks for 239 pages');
// The user asked to check all actual course questions, not only the export file.
let checkedQuestions=0;
for(const row of before.pages) {
  const lesson=manifest.lessons.find(l=>l.lectureId===row.lectureId);
  assert(lesson,'Unexpected lecture');
  const source=pkg.lessons.find(l=>l.id===lesson.id).pages[row.pageNo-1];
  const games=row.doc.layout.blocks.filter(b=>b.type==='game');
  if(source.puzzleId) {
    assert.equal(games.length,1,'Puzzle page must contain its native Sudoku');
    const expected=source.doc.layout.blocks.find(b=>b.type==='game').game;
    assert.equal(games[0].game.gameId,'sudoku');
    assert.equal(games[0].game.contentVersion,expected.contentVersion);
    assert.deepEqual(games[0].game.payload,expected.payload,`Saved puzzle differs from the audited bank: ${source.puzzleId} ${row.track}`);
    checkedQuestions++;
  } else {
    assert(games.every(b=>b.game.gameId==='sudoku'&&b.game.payload.goal?.kind==='teacher-led'),`Unlisted question on ${lesson.id} page ${row.pageNo}`);
  }
}
assert.equal(checkedQuestions,bank.puzzles.length*2,'Every audited puzzle must appear once per track');
const patches=[];
for(const row of before.pages.filter(p=>p.lectureId===b4.lectureId)) {
  const source=pkg.lessons.find(l=>l.id==='B4').pages[row.pageNo-1];
  if(source.kind!=='manipulative') continue;
  const doc=structuredClone(row.doc);
  const current=doc.layout.blocks.find(b=>b.id==='towers'&&b.type==='tool');
  const expected=source.doc.layout.blocks.find(b=>b.id==='towers'&&b.type==='tool');
  assert(current?.tool.toolId==='spatial-lab'&&expected,'Tower tool not found');
  assert.equal(current.tool.payload.history.operations.length,0,'Keep newly edited teaching recordings for review');
  const original=current.tool.payload.history.initial, styled=expected.tool.payload.history.initial;
  assert.deepEqual(original.cubes.map(c=>({id:c.id,position:c.position})),styled.cubes.map(c=>({id:c.id,position:c.position})),'Tower arrangement was edited; inspect before changing it');
  const colorsById=new Map(styled.cubes.map(c=>[c.id,c.color]));
  original.cubes=original.cubes.map(c=>({...c,color:colorsById.get(c.id)}));
  original.axesVisible=false; original.hiddenEdgesVisible=false;
  current.tool.payload.toolbar=[...new Set([...current.tool.payload.toolbar,...expected.tool.payload.toolbar])];
  const prompt=doc.overlay.nodes.find(n=>n.id==='prompt');
  // Replace only the generated observation instructions, preserving other edits.
  if(prompt?.content.kind==='text'&&prompt.content.text.includes('转到一端，降低视角；')) {
    prompt.content=source.doc.overlay.nodes.find(n=>n.id==='prompt').content;
  }
  if(JSON.stringify(doc)!==JSON.stringify(row.doc)) patches.push({...row,doc});
}
assert.equal(before.pages.filter(p=>p.lectureId===b4.lectureId&&pkg.lessons.find(l=>l.id==='B4').pages[p.pageNo-1]?.kind==='manipulative').length,4,'Expected two tower pages in both tracks');
const summary={target:observed.supabaseOrigin,pagesToUpdate:new Set(patches.map(p=>p.pageId)).size,tracksToUpdate:patches.length,auditedPuzzleInstancesMatched:checkedQuestions,sessionReferences:before.sessionReferences};
console.log(JSON.stringify(summary));
if(apply&&patches.length) {
  const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>/^[A-Z0-9_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
  assertNonProductionWriteTarget({operation:'sudoku-2026:update-towers-local',supabaseUrl:observed.supabaseOrigin,environment:env});
  const account=fs.readFileSync('.claude/test-accounts.local.md','utf8').split(/\r?\n/).find(l=>/管理员\s*admin/.test(l));
  const email=account?.match(/[\w.+-]+@[\w.-]+/)?.[0];
  if(!email) throw Error('FIXED_DEVELOPMENT_ADMIN_REQUIRED');
  const actor=sql(`begin read only; select id from auth.users where lower(email)=lower(convert_from(decode('${Buffer.from(email).toString('hex')}','hex'),'UTF8')); commit;`);
  if(!/^[0-9a-f-]{36}$/.test(actor)) throw Error('FIXED_DEVELOPMENT_ADMIN_REQUIRED');
  const encoded=Buffer.from(JSON.stringify(patches)).toString('base64');
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='30s';
    set local request.jwt.claim.sub='${actor}';
    do $update$ declare item jsonb; begin
      for item in select value from jsonb_array_elements(convert_from(decode('${encoded}','base64'),'UTF8')::jsonb) loop
        if not exists(select 1 from cw_page_docs p where p.id=(item->>'pageId')::uuid and p.lecture_id='${b4.lectureId}' and p.deleted_at is null) then raise exception 'PAGE_SCOPE_CHANGED'; end if;
        perform * from public.save_cw_manual_composition_page((item->>'pageId')::uuid,item->>'track',item->'doc',(item->>'revisionNo')::int,'摩天楼：四栋楼独立配色，补齐视图控制');
      end loop;
    end; $update$; commit;`);
  const after=JSON.parse(sql(`begin read only; ${readSql} commit;`));
  for(const row of after.pages) {
    const previous=before.pages.find(p=>p.pageId===row.pageId&&p.track===row.track);
    const changed=patches.find(p=>p.pageId===row.pageId&&p.track===row.track);
    assert.deepEqual(row.doc,(changed??previous).doc,'Saved page differs from intended update');
    if(changed) assert(row.revisionNo>previous.revisionNo,'Expected a new editable revision');
  }
  assert.deepEqual(after.releaseHeads,before.releaseHeads,'Release heads must stay unchanged');
  assert.equal(after.sessionReferences,before.sessionReferences,'Classroom references must stay unchanged');
  const receipt={...summary,checkedAt:new Date().toISOString(),bankSha256:createHash('sha256').update(fs.readFileSync('content/courses/sudoku-2026/bank.json')).digest('hex'),
    updatedPages:patches.map(p=>({pageId:p.pageId,pageNo:p.pageNo,track:p.track})),readbackMatched:true,releaseHeadsUnchanged:true};
  fs.writeFileSync('content/courses/sudoku-2026/摩天楼更新记录.json',JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({saved:true,pages:summary.pagesToUpdate,tracks:patches.length,readbackMatched:true,releaseHeadsUnchanged:true}));
}
