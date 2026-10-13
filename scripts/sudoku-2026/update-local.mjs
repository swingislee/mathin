import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openHistoryLocalTarget } from '../lib/history-local-target.mjs';
import { assertNonProductionWriteTarget } from '../lib/r1-write-target-policy.mjs';

/**
 * Replace the 12 imported lectures' pages in the verified local development database with
 * the rebuilt package. Existing pages keep their identity and gain a new editable revision;
 * extra pages are appended and surplus pages soft-deleted. Releases and lessons stay untouched.
 */
const apply = process.argv.includes('--apply'), dir = '.tmp/sudoku-2026';
const manifestPath = 'content/courses/sudoku-2026/开发导入记录.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const pkg = JSON.parse(fs.readFileSync(`${dir}/course-package.json`, 'utf8'));
const previous = JSON.parse(fs.readFileSync(`${dir}/course-package-v1.json`, 'utf8'));
if (!/^[0-9a-f-]{36}$/.test(manifest.familyId) || manifest.lessons.length !== 12) throw Error('INVALID_COURSE_MANIFEST');
const { sql, observed } = openHistoryLocalTarget({ attestationPath: `${dir}/target.json`, refresh: true, errorFile: `${dir}/db-error.txt` });
if (observed.supabaseOrigin !== 'http://127.0.0.1:35421') throw Error('LOCAL_DEVELOPMENT_ONLY');

const readSql = `select jsonb_build_object(
 'pages',(select coalesce(jsonb_agg(jsonb_build_object('pageId',p.id,'lectureId',p.lecture_id,'pageNo',p.page_no,'title',p.title,'track',h.track,'revisionNo',r.revision_no,'doc',r.doc) order by p.lecture_id,p.page_no,h.track),'[]')
  from cw_page_docs p join course_lectures l on l.id=p.lecture_id join courses c on c.id=l.course_id join cw_page_track_heads h on h.page_doc_id=p.id join cw_page_revisions r on r.id=coalesce(h.draft_revision_id,h.current_revision_id)
  where c.family_id='${manifest.familyId}' and p.deleted_at is null),
 'lectures',(select jsonb_agg(jsonb_build_object('id',l.id,'objectives',l.objectives)) from course_lectures l join courses c on c.id=l.course_id where c.family_id='${manifest.familyId}'),
 'releaseHeads',(select coalesce(jsonb_agg(to_jsonb(h) order by h.lecture_id,h.track),'[]') from cw_lecture_track_heads h join course_lectures l on l.id=h.lecture_id join courses c on c.id=l.course_id where c.family_id='${manifest.familyId}'),
 'sessionReferences',(select count(*) from class_sessions s join course_lectures l on l.id=s.lecture_id join courses c on c.id=l.course_id where c.family_id='${manifest.familyId}'));`;
const before = JSON.parse(sql(`begin read only; ${readSql} commit;`));
fs.writeFileSync(`${dir}/update-before.json`, JSON.stringify(before));

// Only overwrite what this task generated. Text may have lost line breaks through the old
// renderer and tiles may have been snapped; anything else is a human edit and stops the update.
// jsonb reorders object keys, so compare with sorted keys.
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const normalize = doc => JSON.stringify(canonical(doc), (key, value) => key === 'transform' ? undefined : key === 'text' && typeof value === 'string' ? value.replace(/\s+/g, '') : value);
const ops = [];
for (const lesson of manifest.lessons) {
  const current = before.pages.filter(p => p.lectureId === lesson.lectureId && p.track === 'native-16x9');
  const tracks = pageId => before.pages.filter(p => p.pageId === pageId);
  const next = pkg.lessons.find(l => l.id === lesson.id).pages, old = previous.lessons.find(l => l.id === lesson.id).pages;
  current.forEach((row, i) => {
    for (const t of tracks(row.pageId)) {
      const known = [old[i]?.doc, next[i]?.doc].filter(Boolean).map(normalize);
      assert(known.includes(normalize(t.doc)), `Page ${lesson.id} #${row.pageNo} (${t.track}) has edits not made by this task; inspect before replacing.`);
    }
  });
  next.forEach((page, i) => {
    const row = current[i];
    if (row) {
      const changed = tracks(row.pageId).some(t => JSON.stringify(canonical(t.doc)) !== JSON.stringify(canonical(page.doc))) || row.title !== page.title;
      if (changed) ops.push({ op: 'update', lectureId: lesson.lectureId, pageId: row.pageId, title: page.title, doc: page.doc });
    } else ops.push({ op: 'create', lectureId: lesson.lectureId, title: page.title, doc: page.doc });
  });
  for (const row of current.slice(next.length)) ops.push({ op: 'delete', lectureId: lesson.lectureId, pageId: row.pageId });
}
const objectives = Object.fromEntries(manifest.lessons.map(l => {
  const built = pkg.lessons.find(x => x.id === l.id);
  return [l.lectureId, `90分钟；${built.goal} 先探索、再归纳、后练习；完整挑战由易到难。教师用书与逐题理由见数独教学2026版资料包。`];
}));
const summary = { target: observed.supabaseOrigin, update: ops.filter(o => o.op === 'update').length, create: ops.filter(o => o.op === 'create').length, delete: ops.filter(o => o.op === 'delete').length, pages: pkg.lessons.reduce((n, l) => n + l.pages.length, 0), sessionReferences: before.sessionReferences, releaseHeads: before.releaseHeads.length };
console.log(JSON.stringify(summary));
if (!apply) process.exit(0);

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z0-9_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]; }));
assertNonProductionWriteTarget({ operation: 'sudoku-2026:update-local', supabaseUrl: observed.supabaseOrigin, environment: env });
const account = fs.readFileSync('.claude/test-accounts.local.md', 'utf8').split(/\r?\n/).find(l => /管理员\s*admin/.test(l));
const email = account?.match(/[\w.+-]+@[\w.-]+/)?.[0];
if (!email) throw Error('FIXED_DEVELOPMENT_ADMIN_REQUIRED');
const actor = sql(`begin read only; select id from auth.users where lower(email)=lower(convert_from(decode('${Buffer.from(email).toString('hex')}','hex'),'UTF8')); commit;`);
if (!/^[0-9a-f-]{36}$/.test(actor)) throw Error('FIXED_DEVELOPMENT_ADMIN_REQUIRED');
const encoded = Buffer.from(JSON.stringify(ops)).toString('base64'), goals = Buffer.from(JSON.stringify(objectives)).toString('base64');
const lectureIds = manifest.lessons.map(l => `'${l.lectureId}'`).join(',');
sql(`begin; set local lock_timeout='5s'; set local statement_timeout='300s';
  select set_config('request.jwt.claim.sub','${actor}',true); select set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',true);
  do $update$ declare item jsonb; v_page uuid; v_after uuid; v_track text; v_base int; begin
    for item in select value from jsonb_array_elements(convert_from(decode('${encoded}','base64'),'UTF8')::jsonb) loop
      if (item->>'lectureId')::uuid not in (${lectureIds}) then raise exception 'LECTURE_SCOPE'; end if;
      if item->>'op' = 'delete' then perform public.soft_delete_cw_page((item->>'pageId')::uuid); continue; end if;
      if item->>'op' = 'create' then
        select id into v_after from cw_page_docs where lecture_id=(item->>'lectureId')::uuid and deleted_at is null order by page_no desc limit 1;
        v_page := public.create_blank_cw_page((item->>'lectureId')::uuid, v_after, item->>'title');
      else
        v_page := (item->>'pageId')::uuid;
        if not exists(select 1 from cw_page_docs where id=v_page and lecture_id=(item->>'lectureId')::uuid and deleted_at is null) then raise exception 'PAGE_SCOPE_CHANGED'; end if;
        if (select title from cw_page_docs where id=v_page) is distinct from item->>'title' then perform public.rename_cw_page(v_page, item->>'title'); end if;
      end if;
      foreach v_track in array array['native-16x9','adapted-4x3'] loop
        select r.revision_no into v_base from cw_page_track_heads h join cw_page_revisions r on r.id=coalesce(h.draft_revision_id,h.current_revision_id) where h.page_doc_id=v_page and h.track=v_track;
        perform * from public.save_cw_manual_composition_page(v_page, v_track, item->'doc', v_base, '数独教学2026版：按校准后的教学逻辑重做');
      end loop;
    end loop;
    update course_lectures l set objectives = g.value from jsonb_each_text(convert_from(decode('${goals}','base64'),'UTF8')::jsonb) g where l.id = g.key::uuid;
  end; $update$; commit;`);

const after = JSON.parse(sql(`begin read only; ${readSql} commit;`));
for (const lesson of manifest.lessons) {
  const rows = after.pages.filter(p => p.lectureId === lesson.lectureId), pages = pkg.lessons.find(l => l.id === lesson.id).pages;
  assert.equal(rows.length, pages.length * 2, `${lesson.id}: page count after update`);
  pages.forEach((page, i) => {
    const own = rows.filter(r => r.pageNo === rows.filter(x => x.track === 'native-16x9')[i].pageNo);
    assert.equal(own.length, 2);
    for (const r of own) { assert.deepEqual(r.doc, page.doc, `${lesson.id} page ${i + 1} ${r.track} differs`); assert.equal(r.title, page.title); }
  });
  lesson.pages = pages.length;
}
assert.deepEqual(after.releaseHeads, before.releaseHeads, 'Release heads must stay unchanged');
assert.equal(after.sessionReferences, before.sessionReferences, 'Classroom references must stay unchanged');
manifest.pages = pkg.lessons.reduce((n, l) => n + l.pages.length, 0);
manifest.packageSha256 = createHash('sha256').update(JSON.stringify(pkg)).digest('hex');
manifest.updatedAt = new Date().toISOString();
manifest.lastUpdate = { ...summary, readbackMatched: true, releaseHeadsUnchanged: true };
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ saved: true, ...summary, readbackMatched: true }));
