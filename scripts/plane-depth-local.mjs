import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

// 从持有私有配置及 3130 服务的主 checkout 调用；源码可位于登记的集成工作树。
const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve('.tmp/plane-depth-local');
fs.mkdirSync(output, { recursive: true });
const { sql } = openHistoryLocalTarget({ attestationPath: path.join(output, 'target.json'), refresh: mode === '--preflight', errorFile: path.join(output, 'database-error.txt') });
if (mode === '--preflight') {
  console.log('Confirmed isolated local host, actual Supabase origin, listener owners, Docker network and database fingerprint.');
  process.exit(0);
}
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const versions = ['20261004020000_tool_plane_overlap_concave', '20261004020100_tool_plane_cell_coverage', '20261004020200_tool_plane_depth_catalog'];
const migrations = versions.map(version => {
  const filename = path.join(sourceRoot, `supabase/migrations/${version}.sql`), digest = textFileSha256(filename);
  const recorded = sql(`begin read only; select checksum from public.schema_migrations where version=${literal(version)}; commit;`);
  if (recorded && recorded !== digest) throw new Error('PLANE_DEPTH_LEDGER_CHECKSUM_MISMATCH');
  return { version, digest, recorded, source: fs.readFileSync(filename, 'utf8').replace(/^\s*(?:begin|commit);\s*$/gm, '') };
});
const pending = migrations.filter(entry => !entry.recorded), migration = pending.map(entry => entry.source).join('\n');
if (mode === '--apply' && !pending.length) { console.log('The exact planar-depth migrations are already installed; no changes made.'); process.exit(0); }
const snapshot = () => sql(`begin read only;
  select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''), '|' order by p.oid))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f';
  select jsonb_build_object('drafts',(select count(*) from public.tool_scene_drafts),'identities',(select count(*) from auth.users),
    'pages',(select count(*) from public.cw_page_docs),'revisions',(select count(*) from public.cw_page_revisions),
    'releases',(select count(*) from public.cw_lecture_releases),'sessions',(select count(*) from public.class_sessions),
    'events',(select count(*) from public.session_events)); commit;`);
const before = snapshot(), checkedPath = path.join(output, 'checked.json');
const require = createRequire(import.meta.url), testRequire = createRequire(require.resolve('vitest'));
const { createServer } = await import(pathToFileURL(testRequire.resolve('vite')).href);
// 复用锁定的测试依赖加载真实 TS fixtures；middlewareMode 不启动 HTTP 监听。
const runner = await createServer({ root: sourceRoot, configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
let cases;
try {
  const specifications = [
    ['plane-overlap-concave-cases', 'planeOverlapConcaveCases'], ['plane-cell-coverage-cases', 'planeCellCoverageCases'],
    ['plane-strips-cases', 'planeStripsCases'], ['plane-interior-cases', 'planeInteriorCases'],
  ];
  cases = [];
  for (const [file, factory] of specifications) cases.push(...(await runner.ssrLoadModule(`/tests/fixtures/${file}.ts`))[factory]());
  const perimeter = await runner.ssrLoadModule('/src/features/tools/plane-perimeter/model.ts');
  const vertex = await runner.ssrLoadModule('/src/features/tools/plane-perimeter/vertex-model.ts');
  const polygon = perimeter.createPerimeterGeometry(perimeter.createPerimeterState(), 'polygon', [
    { x: 100, y: 100 }, { x: 330, y: 130 }, { x: 350, y: 330 }, { x: 215, y: 240 }, { x: 95, y: 300 },
  ]);
  if (!polygon) throw new Error('PLANE_DEPTH_VERTEX_FIXTURE_MISSING');
  const point = polygon.points[`vertex.${polygon.params.active}.2`];
  for (const invariant of ['area', 'perimeter']) {
    const endpoint = vertex.movePerimeterVertex(polygon, invariant, 2, { x: point.x + 40, y: point.y + 15 });
    if (endpoint === polygon) throw new Error('PLANE_DEPTH_VERTEX_FIXTURE_UNCHANGED');
    cases.push({ label: `vertex-${invariant}`, accepted: true, scene: {
      toolId: 'plane-perimeter', contentVersion: 'plane-perimeter-lesson-v2', payload: { title: 'Single-vertex fixed quantity', initial: endpoint },
    } });
  }
} finally { await runner.close(); }
const fixtureText = JSON.stringify(cases), fixtureDigest = createHash('sha256').update(fixtureText).digest('hex');
const checkedMigrations = migrations.map(({ version, digest }) => ({ version, digest }));

if (mode === '--check') {
  const scenes = ['plane-overlap-lesson-v3', 'plane-area-relations-lesson-v5'].map(version => {
    const entry = cases.find(value => value.accepted && value.label === 'visible' && value.scene.contentVersion === version);
    if (!entry) throw new Error('PLANE_DEPTH_SAVE_FIXTURE_MISSING');
    return entry.scene;
  });
  scenes.push(cases.find(entry => entry.accepted && entry.label === 'vertex-perimeter').scene);
  const fixedAccounts = fs.readFileSync('.claude/test-accounts.local.md', 'utf8');
  const emails = [...new Set((fixedAccounts.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).map(value => value.toLowerCase()))];
  if (!emails.length || emails.length > 50) throw new Error('FIXED_ACCOUNT_MANIFEST_INVALID');
  const candidates = sql(`begin read only; select p.id from public.profiles p join auth.users u on u.id=p.id
    where p.is_active and p.account_status='active' and not p.password_change_required
      and lower(u.email) in (${emails.map(literal).join(',')})
    order by (p.display_name='测试-教师') desc nulls last, p.id; commit;`).split(/\r?\n/);
  if (candidates.some(id => !/^[a-f0-9-]{36}$/.test(id))) throw new Error('FIXED_DEVELOPMENT_ACCOUNTS_REQUIRED');
  const owners = [];
  // 条款查询只允许本人或授权支持人员读取；在固定账号自己的只读身份上下文核对真实保存前置条件。
  for (const candidate of candidates) {
    const ready = sql(`begin read only; do $context$ begin
      perform set_config('request.jwt.claim.sub',${literal(candidate)},true);
      perform set_config('request.jwt.claim.role','authenticated',true); end $context$;
      set local role authenticated; select public.tool_drafts_account_ready(); rollback;`);
    if (ready === 't') owners.push(candidate);
    if (owners.length === 2) break;
  }
  if (owners.length !== 2) throw new Error('FIXED_DEVELOPMENT_ACCOUNTS_REQUIRED');
  const legacy = ['planar_tool_scene_assertions', 'tool_plane_deep', 'tool_plane_cover_match'].flatMap(name => {
    const parts = fs.readFileSync(path.join(sourceRoot, `supabase/tests/${name}.sql`), 'utf8').split('$fixtures$');
    if (parts.length < 3) throw new Error('LEGACY_FIXTURE_FORMAT_CHANGED');
    return JSON.parse(parts[1]);
  });
  const assertions = `do $test$ declare entry jsonb; proc regprocedure; scene jsonb; changed jsonb;
    saved public.tool_scene_drafts; draft_id uuid; refused boolean; begin
    for entry in select value from jsonb_array_elements(${literal(fixtureText)}::jsonb) loop
      if public.tool_scene_is_valid(entry->'scene') is distinct from (entry->>'accepted')::boolean then raise exception 'PLANE_DEPTH_PARITY_%',entry->>'label'; end if;
    end loop;
    for entry in select value from jsonb_array_elements(${literal(JSON.stringify(legacy))}::jsonb) loop
      if public.tool_scene_is_valid(entry) is not true then raise exception 'PLANE_DEPTH_PREVIOUS_SCENE_REJECTED'; end if;
    end loop;
    foreach proc in array array['public.tool_plane_overlap_concave_state_is_valid(jsonb)'::regprocedure,
      'public.tool_plane_overlap_concave_scene_is_valid(jsonb)'::regprocedure,'public.tool_plane_cell_coverage_state_is_valid(jsonb)'::regprocedure,
      'public.tool_plane_cell_coverage_scene_is_valid(jsonb)'::regprocedure] loop
      if has_function_privilege('anon',proc,'execute') or has_function_privilege('authenticated',proc,'execute') or has_function_privilege('service_role',proc,'execute') then raise exception 'PLANE_DEPTH_HELPER_EXPOSED'; end if;
    end loop;
    for scene in select value from jsonb_array_elements(${literal(JSON.stringify(scenes))}::jsonb) loop
      if public.tool_scene_catalog_id(scene) is distinct from scene->>'toolId' then raise exception 'PLANE_DEPTH_CATALOG_MISMATCH'; end if;
      foreach changed in array array[scene||'{"extra":true}',jsonb_set(scene,'{payload,extra}','true'),jsonb_set(scene,'{payload,title}','""'),
        jsonb_set(scene,'{payload,initial,params,active}','"1"'),jsonb_set(scene,'{payload,initial,flags,grid}','1'),
        jsonb_set(scene,'{payload,initial,extra}','true')] loop
        if public.tool_scene_is_valid(changed) is not false then raise exception 'PLANE_DEPTH_BAD_ENVELOPE_OR_TYPE_ACCEPTED'; end if;
      end loop;
      perform set_config('request.jwt.claim.sub',${literal(owners[0])},true); perform set_config('request.jwt.claim.role','authenticated',true);
      execute 'set local role authenticated';
      draft_id:=gen_random_uuid(); saved:=public.save_tool_scene_draft(draft_id,scene,0);
      if saved.scene is distinct from scene or saved.revision<>1 or saved.catalog_id<>scene->>'toolId'
        or (select drafts.scene from public.tool_scene_drafts drafts where drafts.id=draft_id) is distinct from scene then raise exception 'PLANE_DEPTH_SAVE_ROUNDTRIP'; end if;
      changed:=jsonb_set(scene,'{payload,title}','"Updated prepared geometry"'); saved:=public.save_tool_scene_draft(draft_id,changed,1);
      if saved.scene is distinct from changed or saved.revision<>2
        or (select drafts.scene from public.tool_scene_drafts drafts where drafts.id=draft_id) is distinct from changed then raise exception 'PLANE_DEPTH_UPDATE_ROUNDTRIP'; end if;
      refused:=false;
      begin perform public.save_tool_scene_draft(draft_id,scene,1); exception when sqlstate 'P0001' then refused:=true; end;
      if not refused then raise exception 'PLANE_DEPTH_STALE_REVISION_ACCEPTED'; end if;
      perform set_config('request.jwt.claim.sub',${literal(owners[1])},true);
      if exists(select 1 from public.tool_scene_drafts where id=draft_id) then raise exception 'PLANE_DEPTH_FOREIGN_DRAFT_VISIBLE'; end if;
      refused:=false;
      begin perform public.save_tool_scene_draft(draft_id,scene,2); exception when sqlstate 'P0002' or sqlstate '42501' then refused:=true; end;
      if not refused then raise exception 'PLANE_DEPTH_FOREIGN_UPDATE_ACCEPTED'; end if;
      execute 'reset role';
      perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claim.role','anon',true);
      execute 'set local role anon'; refused:=false;
      begin perform public.save_tool_scene_draft(draft_id,scene,0); exception when sqlstate '42501' then refused:=true; end;
      if not refused then raise exception 'PLANE_DEPTH_ANONYMOUS_SAVE_ACCEPTED'; end if;
      execute 'reset role';
    end loop;
    end $test$;`;
  try { sql(`begin; set local statement_timeout='60s';\n${migration}\n${assertions}\nrollback;`); }
  finally { if (snapshot() !== before) throw new Error('PLANE_DEPTH_ROLLBACK_FINGERPRINT_OR_COUNTS_MISMATCH'); }
  fs.writeFileSync(checkedPath, JSON.stringify({ migrations: checkedMigrations, fixtureDigest, before, checkedAt: new Date().toISOString() }), 'utf8');
  console.log(`Passed ${cases.length} TS/SQL cases, ${legacy.length} previous scenes, strict envelopes, private-helper ACLs, ${scenes.length} authenticated save/read/update flows, stale/foreign/anonymous refusals; rollback fingerprint and protected counts unchanged.`);
} else {
  const checked = JSON.parse(fs.readFileSync(checkedPath, 'utf8'));
  if (JSON.stringify(checked.migrations) !== JSON.stringify(checkedMigrations) || checked.fixtureDigest !== fixtureDigest
    || checked.before !== before || Date.now() - Date.parse(checked.checkedAt) > 3_600_000) throw new Error('PLANE_DEPTH_EXACT_CHECK_REQUIRED');
  sql(`begin; set local statement_timeout='60s';\n${migration}\n${pending.map(entry => `insert into public.schema_migrations(version,checksum) values (${literal(entry.version)},${literal(entry.digest)});`).join('\n')}\ncommit;`);
  if (snapshot().split('\n').at(-1) !== before.split('\n').at(-1)) throw new Error('PLANE_DEPTH_INSTALL_PROTECTED_COUNTS_CHANGED');
  for (const entry of migrations) if (sql(`begin read only; select checksum from public.schema_migrations where version=${literal(entry.version)}; commit;`) !== entry.digest) throw new Error('PLANE_DEPTH_INSTALL_LEDGER_MISMATCH');
  console.log('Installed exactly the checked helpers and version dispatcher with matching local ledgers; protected counts unchanged.');
}
