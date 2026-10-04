import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

// 从持有私有配置和集成服务的主 checkout 调用；源码可位于已登记 worker。
const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve('.tmp/plane-strips-local');
fs.mkdirSync(output, { recursive: true });
const { sql } = openHistoryLocalTarget({ attestationPath: path.join(output, 'target.json'), refresh: mode === '--preflight', errorFile: path.join(output, 'database-error.txt') });
if (mode === '--preflight') { console.log('Confirmed isolated local host, Supabase origin, listener owners, Docker network and database fingerprint.'); process.exit(0); }
const version = '20261004010000_tool_plane_strips', migrationPath = path.join(sourceRoot, `supabase/migrations/${version}.sql`);
const digest = textFileSha256(migrationPath);
const recorded = sql(`begin read only; select checksum from public.schema_migrations where version='${version}'; commit;`);
if (recorded && recorded !== digest) throw new Error('PLANE_STRIPS_LEDGER_CHECKSUM_MISMATCH');
const migration = recorded ? '' : fs.readFileSync(migrationPath, 'utf8').replace(/^\s*(?:begin|commit);\s*$/gm, '');
const snapshot = () => sql(`begin read only;
  select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''), '|' order by p.oid))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f';
  select jsonb_build_object('drafts',(select count(*) from public.tool_scene_drafts),'identities',(select count(*) from auth.users),
    'pages',(select count(*) from public.cw_page_docs),'revisions',(select count(*) from public.cw_page_revisions),
    'releases',(select count(*) from public.cw_lecture_releases),'sessions',(select count(*) from public.class_sessions),
    'events',(select count(*) from public.session_events)); commit;`);
const before = snapshot(), checkedPath = path.join(output, 'checked.json');

if (mode === '--check') {
  const require = createRequire(import.meta.url), testRequire = createRequire(require.resolve('vitest'));
  const { createServer } = await import(pathToFileURL(testRequire.resolve('vite')).href);
  // 复用测试依赖加载真实 TS fixture；middlewareMode 不开 HTTP 监听，读取后立即关闭。
  const runner = await createServer({ root: sourceRoot, configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  let cases;
  try {
    const { planeStripsCases } = await runner.ssrLoadModule('/tests/fixtures/plane-strips-cases.ts');
    const { planeInteriorCases } = await runner.ssrLoadModule('/tests/fixtures/plane-interior-cases.ts');
    cases = [...planeStripsCases(), ...planeInteriorCases()];
  } finally { await runner.close(); }
  const scene = cases.find(entry => entry.label === 'visible' && entry.scene.contentVersion === 'plane-area-relations-lesson-v4').scene;
  const fixtureText = JSON.stringify(cases), fixtureDigest = createHash('sha256').update(fixtureText).digest('hex');
  const fixedAccounts = fs.readFileSync('.claude/test-accounts.local.md', 'utf8');
  const emails = [...new Set((fixedAccounts.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).map(value => value.toLowerCase()))];
  if (!emails.length || emails.length > 50) throw new Error('FIXED_ACCOUNT_MANIFEST_INVALID');
  const owner = sql(`begin read only; select p.id from public.profiles p join auth.users u on u.id=p.id where p.display_name='测试-教师'
    and p.is_active and lower(u.email) in (${emails.map(email => `'${email.replaceAll("'", "''")}'`).join(',')}) limit 1; commit;`);
  if (!/^[a-f0-9-]{36}$/.test(owner)) throw new Error('FIXED_DEVELOPMENT_TEACHER_REQUIRED');
  const legacy = ['planar_tool_scene_assertions', 'tool_plane_deep', 'tool_plane_cover_match'].map(name => {
    const parts = fs.readFileSync(path.join(sourceRoot, `supabase/tests/${name}.sql`), 'utf8').split('$fixtures$');
    if (parts.length < 3) throw new Error('LEGACY_FIXTURE_FORMAT_CHANGED');
    return JSON.parse(parts[1]);
  }).flat();
  const assertions = `do $test$ declare entry jsonb; proc regprocedure; scene jsonb:=$scene$${JSON.stringify(scene)}$scene$::jsonb;
    changed jsonb; saved public.tool_scene_drafts; draft_id uuid; begin
    for entry in select value from jsonb_array_elements($cases$${fixtureText}$cases$::jsonb) loop
      if public.tool_scene_is_valid(entry->'scene') is distinct from (entry->>'accepted')::boolean then raise exception 'STRIPS_PARITY_%',entry->>'label'; end if;
    end loop;
    for entry in select value from jsonb_array_elements($legacy$${JSON.stringify(legacy)}$legacy$::jsonb) loop
      if public.tool_scene_is_valid(entry) is not true then raise exception 'STRIPS_PREVIOUS_SCENE_REJECTED'; end if;
    end loop;
    foreach changed in array array[scene||'{"extra":true}',jsonb_set(scene,'{payload,extra}','true'),jsonb_set(scene,'{payload,title}','""'),
      jsonb_set(scene,'{payload,initial,params,stripCount.1}','"16"'),jsonb_set(scene,'{payload,initial,flags,strips.1}','1')] loop
      if public.tool_scene_is_valid(changed) is not false then raise exception 'STRIPS_BAD_ENVELOPE_OR_TYPE_ACCEPTED'; end if;
    end loop;
    foreach proc in array array['public.tool_plane_strips_state_is_valid(jsonb)'::regprocedure,'public.tool_plane_strips_scene_is_valid(jsonb)'::regprocedure] loop
      if has_function_privilege('anon',proc,'execute') or has_function_privilege('authenticated',proc,'execute') or has_function_privilege('service_role',proc,'execute') then raise exception 'STRIPS_HELPER_EXPOSED'; end if;
    end loop;
    if public.tool_scene_catalog_id(scene) is distinct from 'plane-area-relations' then raise exception 'STRIPS_CATALOG_MISMATCH'; end if;
    perform set_config('request.jwt.claim.sub','${owner}',true); perform set_config('request.jwt.claim.role','authenticated',true);
    execute 'set local role authenticated';
    draft_id:=gen_random_uuid(); saved:=public.save_tool_scene_draft(draft_id,scene,0);
    if saved.scene is distinct from scene or saved.revision<>1 or saved.catalog_id<>'plane-area-relations'
      or (select drafts.scene from public.tool_scene_drafts drafts where drafts.id=draft_id) is distinct from scene then raise exception 'STRIPS_SAVE_ROUNDTRIP'; end if;
    scene:=jsonb_set(scene,'{payload,initial,params,stripCount.1}','32'); saved:=public.save_tool_scene_draft(draft_id,scene,1);
    if saved.scene is distinct from scene or saved.revision<>2
      or (select drafts.scene from public.tool_scene_drafts drafts where drafts.id=draft_id) is distinct from scene then raise exception 'STRIPS_UPDATE_ROUNDTRIP'; end if;
    execute 'reset role'; end $test$;`;
  try { sql(`begin; set local statement_timeout='45s';\n${migration}\n${assertions}\nrollback;`); }
  finally { if (snapshot() !== before) throw new Error('STRIPS_ROLLBACK_FINGERPRINT_OR_COUNTS_MISMATCH'); }
  fs.writeFileSync(checkedPath, JSON.stringify({ version, digest, fixtureDigest, before, checkedAt: new Date().toISOString() }), 'utf8');
  console.log(`Passed ${cases.length} TS/SQL fixtures, ${legacy.length} previous scenes, typed-envelope rejection, private-helper ACLs and authenticated save/read/update; rollback fingerprint and protected counts unchanged.`);
} else {
  if (recorded) { console.log('The exact strip migration is already installed; no changes made.'); process.exit(0); }
  const checked = JSON.parse(fs.readFileSync(checkedPath, 'utf8'));
  if (checked.version !== version || checked.digest !== digest || checked.before !== before || Date.now() - Date.parse(checked.checkedAt) > 3_600_000) throw new Error('STRIPS_EXACT_CHECK_REQUIRED');
  sql(`begin; set local statement_timeout='45s';\n${migration}\ninsert into public.schema_migrations(version,checksum) values ('${version}','${digest}'); commit;`);
  if (snapshot().split('\n').at(-1) !== before.split('\n').at(-1)) throw new Error('STRIPS_INSTALL_PROTECTED_COUNTS_CHANGED');
  if (sql(`begin read only; select checksum from public.schema_migrations where version='${version}'; commit;`) !== digest) throw new Error('STRIPS_INSTALL_LEDGER_MISMATCH');
  console.log('Installed the checked strip helpers and dispatcher with a matching local ledger; protected counts unchanged.');
}
