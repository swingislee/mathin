import fs from 'node:fs';
import path from 'node:path';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--preflight', '--check', '--apply'].includes(mode)) throw new Error('Use --preflight, --check or --apply');
const increment = process.argv[3] ?? 'prepared';
const increments = {
  prepared: { version: '20260918000100_prepared_tool_scenes', tests: ['prepared_tool_scenes_assertions'] },
  projection: { version: '20260919000100_projection_tool_scene', tests: ['prepared_tool_scenes_assertions', 'projection_tool_scene_assertions'] },
  spaces: { version: '20260919000200_teaching_space_scenes', tests: ['prepared_tool_scenes_assertions', 'projection_tool_scene_assertions', 'teaching_space_scene_assertions'] },
  soma: { version: '20260919000300_soma_cube_tool_scene', tests: ['prepared_tool_scenes_assertions', 'soma_cube_scene_assertions'] },
  'soma-free': { version: '20260920160000_soma_free_rotation_scene', tests: ['prepared_tool_scenes_assertions', 'soma_cube_scene_assertions', 'soma_free_scene_assertions'] },
  'net-tools': { version: '20260921100000_separate_net_tools', tests: ['prepared_tool_scenes_assertions', 'separate_net_tools_assertions'] },
  'net-pyramids': { version: '20260921120000_solid_net_pyramids', tests: ['prepared_tool_scenes_assertions', 'separate_net_tools_assertions', 'solid_net_pyramid_assertions'] },
};
if (!Object.hasOwn(increments, increment)) throw new Error('Unknown Tools increment');
const { version, tests } = increments[increment];
const output = path.resolve(`.tmp/tool-scenes-${increment}`);
fs.mkdirSync(output, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(output, 'preflight.json'), refresh: mode === '--preflight', errorFile: path.join(output, 'database-error.txt') });
if (mode === '--preflight') { console.log(JSON.stringify(observed)); process.exit(0); }
const file = `supabase/migrations/${version}.sql`, checksum = textFileSha256(file);
const assertionsDigest = tests.map(test => textFileSha256(`supabase/tests/${test}.sql`)).join(':');
const recorded = sql(`begin read only; select checksum from public.schema_migrations where version='${version}'; commit;`);
if (recorded && recorded !== checksum) throw new Error('TOOL_SCENES_MIGRATION_CHECKSUM_MISMATCH');
const migration = fs.readFileSync(file, 'utf8').replace(/^(?:begin|commit);\s*$/gm, '');
const fingerprint = () => sql("begin read only; select md5(string_agg(pg_get_functiondef(p.oid), E'\\n' order by p.proname)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname in ('cw_courseware_composition_doc_is_valid','cw_spatial_teaching_tool_is_valid','cw_formal_cube_page_is_valid','cw_manual_composition_doc_is_valid','cube_drafts_account_ready','tool_drafts_account_ready','tool_scene_is_valid','tool_scene_catalog_id','tool_numeric_scene_is_valid','tool_projection_scene_is_valid','tool_cube_rotation_scene_is_valid','tool_net_teaching_scene_is_valid','tool_solid_geometry_scene_is_valid','tool_solid_capacity_scene_is_valid','save_tool_scene_draft') or p.proname like 'tool_space_%' or p.proname like 'tool_soma_%' or p.proname like 'tool_solid_nets_%'); select pg_get_constraintdef(oid) from pg_constraint where conrelid=to_regclass('public.tool_scene_drafts') order by conname; commit;");
const invariant = () => sql("begin read only; select jsonb_build_object('pages',(select count(*) from public.cw_page_docs),'revisions',(select count(*) from public.cw_page_revisions),'releases',(select count(*) from public.cw_lecture_releases),'sessions',(select count(*) from public.class_sessions),'events',(select count(*) from public.session_events)); commit;");
if (mode === '--check') {
  const before = fingerprint(), dataBefore = invariant();
  const assertions = tests.map(test => fs.readFileSync(`supabase/tests/${test}.sql`, 'utf8').replace(/^(?:begin|rollback);\s*$/gm, '')).join('\n');
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='45s'; ${recorded ? '' : migration}\n${assertions}\nrollback;`);
  if (fingerprint() !== before || invariant() !== dataBefore) throw new Error('TOOL_SCENES_ROLLBACK_FAILED');
  fs.writeFileSync(path.join(output, 'check.json'), JSON.stringify({ checksum, assertionsDigest, host: observed.host, checkedAt: new Date().toISOString(), contract: 'PASS', frozenPublication: 'PASS', rollback: 'PASS' }), 'utf8');
  console.log('Tools scene storage, account isolation, version conflicts, courseware freezing and rollback: PASS');
} else {
  if (recorded) throw new Error('TOOL_SCENES_MIGRATION_ALREADY_APPLIED');
  const check = JSON.parse(fs.readFileSync(path.join(output, 'check.json'), 'utf8'));
  if (check.checksum !== checksum || check.assertionsDigest !== assertionsDigest || check.host !== observed.host || check.rollback !== 'PASS' || Date.now() - Date.parse(check.checkedAt) > 3_600_000) throw new Error('TOOL_SCENES_FRESH_CHECK_REQUIRED');
  const before = invariant();
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='30s'; ${migration}\ninsert into public.schema_migrations(version,checksum) values('${version}','${checksum}'); commit;`);
  if (invariant() !== before) throw new Error('TOOL_SCENES_APPLY_DATA_DRIFT');
  console.log('Local Tools scenes enabled; existing drafts, pages, releases, sessions and events unchanged.');
}
