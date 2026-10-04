import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';
import { assertNonProductionWriteTarget } from './lib/r1-write-target-policy.mjs';

// 从持有3130及私有配置的主checkout调用，源码读取本脚本所属的集成工作树。
const mode = process.argv[2], polygons = process.argv.includes('--with-polygons'), circle = process.argv.includes('--with-circle'), folding = process.argv.includes('--with-folding'), curves = process.argv.includes('--with-curves'), perimeter = process.argv.includes('--with-perimeter'), rolling = process.argv.includes('--with-rolling');
if (!['--preflight', '--check', '--apply'].includes(mode) || process.argv.slice(3).some(arg => !['--with-polygons', '--with-circle', '--with-folding', '--with-curves', '--with-perimeter', '--with-rolling'].includes(arg))) throw new Error('Use --preflight, --check or --apply [--with-polygons] [--with-circle] [--with-folding] [--with-curves] [--with-perimeter] [--with-rolling]');
if (folding && !circle) throw new Error('Folding dispatch requires --with-circle');
if (curves && !folding) throw new Error('Curves dispatch requires --with-folding');
if (perimeter && !curves) throw new Error('Perimeter dispatch requires --with-curves');
if (rolling && !perimeter) throw new Error('Rolling dispatch requires --with-perimeter');
const sourceRoot = fileURLToPath(new URL('../', import.meta.url)), output = path.resolve('.tmp/plane-foundation-local');
fs.mkdirSync(output, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(output, 'target.json'), refresh: mode === '--preflight', errorFile: path.join(output, 'database-error.txt') });
assertNonProductionWriteTarget({ operation: 'plane-foundation-local', supabaseUrl: observed.supabaseOrigin,
  environment: { MATHIN_WRITE_TARGET_ENVIRONMENT: 'development', MATHIN_WRITE_ALLOWED_SUPABASE_ORIGIN: observed.supabaseOrigin } });
if (mode === '--preflight') { console.log('Confirmed isolated local host, actual origin, listener ownership, Docker network and database identity.'); process.exit(0); }
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const versions = ['20261004030000_tool_plane_lines', '20261004030100_tool_plane_area_lessons', '20261004030200_tool_plane_routes', '20261004030300_tool_plane_foundation_catalog',
  ...(polygons ? ['20261004030400_tool_plane_polygon_workbench', '20261004030500_tool_plane_polygon_catalog'] : []), '20261004030600_tool_plane_foundation_titles',
  ...(circle ? ['20261004030700_tool_plane_circle_dissection', '20261004030800_tool_plane_circle_dissection_catalog'] : []),
  ...(folding ? ['20261004031000_tool_plane_paper_layers', '20261004031100_tool_plane_paper_layers_catalog'] : []),
  ...(curves ? ['20261004031200_tool_plane_overlap_curves', '20261004031300_tool_plane_overlap_curves_catalog'] : []),
  ...(perimeter ? ['20261004031400_tool_plane_perimeter_boundary', '20261004031500_tool_plane_perimeter_boundary_catalog'] : []),
  ...(rolling ? ['20261004031600_tool_plane_rolling_workbench', '20261004031700_tool_plane_rolling_catalog'] : [])];
const migrations = versions.map(version => {
  const file = path.join(sourceRoot, 'supabase/migrations', `${version}.sql`), digest = textFileSha256(file);
  const recorded = sql(`begin read only; select checksum from public.schema_migrations where version=${literal(version)}; commit;`);
  if (recorded && recorded !== digest) throw new Error('PLANE_FOUNDATION_LEDGER_MISMATCH');
  return { version, digest, recorded, source: fs.readFileSync(file, 'utf8').replace(/^\s*(?:begin|commit);\s*$/gm, '') };
});
const pending = migrations.filter(entry => !entry.recorded), migration = pending.map(entry => entry.source).join('\n');
if (mode === '--apply' && !pending.length) { console.log('The exact requested migrations are already installed; no changes made.'); process.exit(0); }
const snapshot = () => sql(`begin read only;
  select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),'|' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f';
  select jsonb_build_object('drafts',(select count(*) from public.tool_scene_drafts),'identities',(select count(*) from auth.users),
    'pages',(select count(*) from public.cw_page_docs),'revisions',(select count(*) from public.cw_page_revisions),
    'releases',(select count(*) from public.cw_lecture_releases),'sessions',(select count(*) from public.class_sessions),'events',(select count(*) from public.session_events)); commit;`);
const before = snapshot(), require = createRequire(import.meta.url), testRequire = createRequire(require.resolve('vitest'));
const { createServer } = await import(pathToFileURL(testRequire.resolve('vite')).href);
const runner = await createServer({ root: sourceRoot, configFile: false, resolve: { alias: { '@': path.join(sourceRoot, 'src') } }, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const cases = [];
try {
  const model = await runner.ssrLoadModule('/src/features/tools/plane-lines/model.ts');
  const wrap = (label, initial, accepted = true) => ({ label: `lines-${label}`, accepted, scene: { toolId: 'plane-geometry', contentVersion: 'plane-geometry-lesson-v2', payload: { title: 'Lines and angles', initial } } });
  cases.push(wrap('default', model.createLinesState()), wrap('empty', model.emptyLinesState()));
  let mixed = model.emptyLinesState();
  for (let kind = 0; kind < 7; kind++) { mixed = model.addLineMaterial(mixed, kind); cases.push(wrap(`kind-${kind}`, structuredClone(mixed))); }
  while (mixed.params.count < 16) mixed = model.addLineMaterial(mixed, 0);
  cases.push(wrap('capacity', mixed));
  for (const radius of [1, 10]) for (const angle of [-177, -115, 45, 60, 135]) {
    const protractor = model.addLineMaterial(model.emptyLinesState(), 4);
    cases.push(wrap(`radius-${radius}-angle-${angle}`, model.setLineField(model.setLineField(protractor, 'length', radius), 'orientation', angle)));
  }
  const initial = model.createLinesState();
  for (const [label, change] of [
    ['extra', s => { s.params.extra = 1; }], ['fractional-kind', s => { s.params['kind.0'] = .5; }],
    ['bad-count', s => { s.params.count = 17; }], ['bad-active', s => { s.params.active = 2; }],
    ['bad-phase', s => { s.phase = .5; }], ['bad-flag', s => { s.flags.foot = 1; }],
    ['orphan', s => { s.points['a.99'] = { x: 1, y: 1 }; }], ['degenerate', s => { s.points['b.0'] = s.points['a.0']; }],
  ]) { const bad = structuredClone(initial); change(bad); cases.push(wrap(label, bad, false)); }
  for (const [file, factory] of [['plane-area-lessons-cases', 'planeAreaLessonCases'], ['plane-routes-cases', 'planeRoutesCases'],
    ...(polygons ? [['plane-polygons-open-cases', 'planePolygonWorkbenchCases']] : []),
    ...(circle ? [['plane-circle-dissection-cases', 'planeCircleDissectionCases'], ['plane-network-cases', 'planeNetworkCases']] : []),
    ...(folding ? [['plane-paper-layers-cases', 'planePaperLayersCases'], ['plane-construction-motion-cases', 'planeConstructionMotionCases']] : []),
    ...(curves ? [['plane-overlap-curves-cases', 'planeOverlapCurvesCases']] : []),
    ...(perimeter ? [['plane-perimeter-boundary-cases', 'planePerimeterBoundaryCases']] : []),
    ...(rolling ? [['plane-rolling-cases', 'planeRollingCases']] : [])]) {
    cases.push(...(await runner.ssrLoadModule(`/tests/fixtures/${file}.ts`))[factory]());
  }
  for (const version of ['plane-geometry-lesson-v2', 'plane-area-lesson-v3']) {
    const original = cases.find(entry => entry.accepted && entry.scene.contentVersion === version);
    for (const [title, accepted, suffix] of [['\t　\n', false, 'whitespace'], ['😀'.repeat(40), true, '80-units'], ['😀'.repeat(41), false, '82-units'], ['\uFEFF　Prepared\t\n', true, 'trim']]) {
      const entry = structuredClone(original); entry.label = `${version}-title-${suffix}`; entry.accepted = accepted; entry.scene.payload.title = title; cases.push(entry);
    }
  }
  const { toolSceneSchema } = await runner.ssrLoadModule('/src/features/tools/scenes/contract.ts');
  for (const entry of cases) if (toolSceneSchema.safeParse(entry.scene).success !== entry.accepted) throw new Error(`PLANE_FOUNDATION_TS_CASE_${entry.label}`);
} finally { await runner.close(); }
const fixtureText = JSON.stringify(cases), fixtureDigest = createHash('sha256').update(fixtureText).digest('hex');
const checkedMigrations = migrations.map(({ version, digest }) => ({ version, digest })), checkedPath = path.join(output, `checked${polygons ? '-polygons' : ''}${circle ? '-circle' : ''}${folding ? '-folding' : ''}${curves ? '-curves' : ''}${perimeter ? '-perimeter' : ''}${rolling ? '-rolling' : ''}.json`);
if (mode === '--check') {
  const newVersions = ['plane-geometry-lesson-v2', 'plane-area-lesson-v3', 'plane-grid-path-lesson-v2', 'plane-reflection-path-lesson-v2', ...(polygons ? ['plane-polygons-lesson-v2'] : []), ...(circle ? ['plane-circle-area-lesson-v2'] : []), ...(folding ? ['plane-folding-lesson-v3', 'plane-motion-lesson-v2'] : []), ...(curves ? ['plane-overlap-lesson-v4'] : []), ...(perimeter ? ['plane-perimeter-lesson-v3'] : []), ...(rolling ? ['plane-rolling-lesson-v2'] : [])];
  const scenes = newVersions.map(version => {
    const entry = cases.find(item => item.accepted && item.scene.contentVersion === version); if (!entry) throw new Error('PLANE_FOUNDATION_SAVE_CASE_MISSING'); return entry.scene;
  });
  const manifest = fs.readFileSync('.claude/test-accounts.local.md', 'utf8');
  const emails = [...new Set((manifest.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).map(value => value.toLowerCase()))];
  if (!emails.length || emails.length > 50) throw new Error('FIXED_ACCOUNT_MANIFEST_INVALID');
  const candidates = sql(`begin read only; select p.id from public.profiles p join auth.users u on u.id=p.id where p.is_active and p.account_status='active' and not p.password_change_required and lower(u.email) in (${emails.map(literal).join(',')}) order by (p.display_name='测试-教师') desc nulls last,p.id; commit;`).split(/\r?\n/);
  if (candidates.some(id => !/^[a-f0-9-]{36}$/.test(id))) throw new Error('FIXED_DEVELOPMENT_ACCOUNT_REQUIRED');
  let owner;
  for (const candidate of candidates) {
    const ready = sql(`begin read only; do $context$ begin perform set_config('request.jwt.claim.sub',${literal(candidate)},true); perform set_config('request.jwt.claim.role','authenticated',true); end $context$; set local role authenticated; select public.tool_drafts_account_ready(); rollback;`);
    if (ready === 't') { owner = candidate; break; }
  }
  if (!owner) throw new Error('FIXED_DEVELOPMENT_ACCOUNT_REQUIRED');
  const legacy = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'supabase/tests/planar_tool_scene_assertions.sql'), 'utf8').split('$fixtures$')[1]);
  const helpers = ['tool_plane_lines', 'tool_plane_area_lessons', 'tool_plane_routes', ...(polygons ? ['tool_plane_polygon_workbench'] : []), ...(circle ? ['tool_plane_circle_dissection'] : []), ...(folding ? ['tool_plane_paper_layers'] : []), ...(curves ? ['tool_plane_overlap_curves'] : []), ...(perimeter ? ['tool_plane_perimeter_boundary'] : []), ...(rolling ? ['tool_plane_rolling_workbench'] : [])].flatMap(name => ['state', 'scene'].map(suffix => `public.${name}_${suffix}_is_valid(jsonb)`));
  if (folding) helpers.push('public.tool_plane_paper_layers_polygon_is_valid(jsonb)', 'public.tool_plane_paper_layers_fold(jsonb,jsonb,jsonb,integer)');
  if (curves) helpers.push('public.tool_plane_overlap_curves_region_is_valid(jsonb)');
  helpers.push('public.tool_plane_area_lessons_point(double precision,double precision)',
    'public.tool_plane_area_lessons_rectangle(double precision,double precision,double precision,double precision)',
    'public.tool_plane_area_lessons_clip_x(jsonb,double precision,integer)',
    'public.tool_plane_area_lessons_polygons(integer,double precision,double precision,double precision,double precision,double precision,double precision,integer,integer,integer)');
  const assertions = `do $test$ declare entry jsonb; scene jsonb; saved public.tool_scene_drafts; draft_id uuid; proc regprocedure; begin
    for entry in select value from jsonb_array_elements(${literal(fixtureText)}::jsonb) loop
      if public.tool_scene_is_valid(entry->'scene') is distinct from (entry->>'accepted')::boolean then raise exception 'PLANE_FOUNDATION_PARITY_%',entry->>'label'; end if;
    end loop;
    for entry in select value from jsonb_array_elements(${literal(JSON.stringify(legacy))}::jsonb) loop
      if public.tool_scene_is_valid(entry) is not true then raise exception 'PLANE_FOUNDATION_OLD_SCENE_REJECTED'; end if;
    end loop;
    foreach proc in array array[${helpers.map(name => `${literal(name)}::regprocedure`).join(',')}] loop
      if has_function_privilege('anon',proc,'execute') or has_function_privilege('authenticated',proc,'execute') or has_function_privilege('service_role',proc,'execute') then raise exception 'PLANE_FOUNDATION_HELPER_EXPOSED'; end if;
    end loop;
    for scene in select value from jsonb_array_elements(${literal(JSON.stringify(scenes))}::jsonb) loop
      if public.tool_scene_catalog_id(scene) is distinct from scene->>'toolId' then raise exception 'PLANE_FOUNDATION_CATALOG_MISMATCH'; end if;
      perform set_config('request.jwt.claim.sub',${literal(owner)},true); perform set_config('request.jwt.claim.role','authenticated',true); execute 'set local role authenticated';
      draft_id:=gen_random_uuid(); saved:=public.save_tool_scene_draft(draft_id,scene,0);
      if saved.scene is distinct from scene or saved.revision<>1 or saved.catalog_id<>scene->>'toolId'
        or (select drafts.scene from public.tool_scene_drafts drafts where drafts.id=draft_id) is distinct from scene then raise exception 'PLANE_FOUNDATION_SAVE_ROUNDTRIP'; end if;
      scene:=jsonb_set(scene,'{payload,title}','"Updated prepared material"'); saved:=public.save_tool_scene_draft(draft_id,scene,1);
      if saved.scene is distinct from scene or saved.revision<>2 then raise exception 'PLANE_FOUNDATION_UPDATE_ROUNDTRIP'; end if;
      execute 'reset role';
    end loop;
  end $test$;`;
  try { sql(`begin; set local statement_timeout='60s';\n${migration}\n${assertions}\nrollback;`); }
  finally { if (snapshot() !== before) throw new Error('PLANE_FOUNDATION_ROLLBACK_MISMATCH'); }
  fs.writeFileSync(checkedPath, JSON.stringify({ migrations: checkedMigrations, fixtureDigest, before, checkedAt: new Date().toISOString() }), 'utf8');
  console.log(`Passed ${cases.length} TS/SQL cases, ${legacy.length} original scenes, ${scenes.length} save/read/update flows and private-helper ACLs; rollback left functions and protected counts unchanged.`);
} else {
  const checked = JSON.parse(fs.readFileSync(checkedPath, 'utf8'));
  if (JSON.stringify(checked.migrations) !== JSON.stringify(checkedMigrations) || checked.fixtureDigest !== fixtureDigest || checked.before !== before
    || Date.now() - Date.parse(checked.checkedAt) > 3_600_000) throw new Error('PLANE_FOUNDATION_EXACT_CHECK_REQUIRED');
  sql(`begin; set local statement_timeout='60s';\n${migration}\n${pending.map(entry => `insert into public.schema_migrations(version,checksum) values (${literal(entry.version)},${literal(entry.digest)});`).join('\n')}\ncommit;`);
  if (snapshot().split('\n').at(-1) !== before.split('\n').at(-1)) throw new Error('PLANE_FOUNDATION_PROTECTED_COUNTS_CHANGED');
  for (const entry of migrations) if (sql(`begin read only; select checksum from public.schema_migrations where version=${literal(entry.version)}; commit;`) !== entry.digest) throw new Error('PLANE_FOUNDATION_INSTALLED_LEDGER_MISMATCH');
  console.log('Installed only the checked migrations with matching local ledgers; protected counts unchanged.');
}
