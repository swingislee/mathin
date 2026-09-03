import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const COURSEWARE_WORKSPACE_CANDIDATE_MIGRATIONS = [
  "20260831000100_courseware_page_rename.sql",
  "20260901000100_courseware_adapted_draft_bootstrap.sql",
  "20260902000100_courseware_admin_object_capability.sql",
  "20260902000500_courseware_legacy_publish_retirement.sql",
  "20260902000900_courseware_source_runtime_drafts.sql",
  "20260903000700_courseware_page_insertions.sql",
];

export function normalizeSql(value) {
  return value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\s+$/, "") + "\n";
}

export function stripMigrationTransaction(value) {
  return normalizeSql(value)
    .split("\n")
    .filter((line) => !["begin;", "commit;"].includes(line.trim().toLowerCase()))
    .join("\n");
}

export function loadCandidateMigrations(repositoryRoot) {
  return COURSEWARE_WORKSPACE_CANDIDATE_MIGRATIONS.map((name) => {
    const file = path.join(repositoryRoot, "supabase", "migrations", name);
    const sql = normalizeSql(readFileSync(file, "utf8"));
    return {
      name,
      version: name.slice(0, 14),
      sha256: createHash("sha256").update(sql).digest("hex"),
      sql,
    };
  });
}

const snapshotExpression = String.raw`jsonb_build_object(
  'pageDocs', (select count(*) from public.cw_page_docs),
  'pageRevisions', (select count(*) from public.cw_page_revisions),
  'trackHeads', (select count(*) from public.cw_page_track_heads),
  'assetBindings', (select count(*) from public.cw_page_asset_bindings),
  'assetObjects', (select count(*) from public.cw_asset_objects),
  'sharedAssets', (select count(*) from public.cw_shared_assets),
  'assetRevisions', (select count(*) from public.cw_asset_revisions),
  'assetVariantHeads', (select count(*) from public.cw_asset_variant_heads),
  'releases', (select count(*) from public.cw_lecture_releases),
  'frozenSessions', (select count(*) from public.class_sessions where deleted_at is null and courseware_frozen_at is not null),
  'migrationRows', (select count(*) from public.schema_migrations),
  'constraint', coalesce((
    select md5(pg_get_constraintdef(oid, true)) from pg_constraint
    where conrelid = 'public.cw_page_revisions'::regclass and conname = 'cw_page_revisions_doc_check'
  ), 'missing'),
  'functions', coalesce((
    select jsonb_object_agg(signature, definition_hash order by signature)
    from (
      select proc.oid::regprocedure::text signature, md5(pg_get_functiondef(proc.oid)) definition_hash
      from pg_proc proc
      where proc.oid = any(array[
        to_regprocedure('public.resolve_cw_lecture_capability_for(uuid,uuid,text,timestamptz)'),
        to_regprocedure('public.rename_cw_page(uuid,text)'),
        to_regprocedure('public.save_cw_track_page_draft(uuid,text,jsonb,integer,text)'),
        to_regprocedure('public.save_cw_source_runtime_page_draft(uuid,text,jsonb,integer,text)'),
        to_regprocedure('public.cw_source_runtime_page_doc_is_valid(jsonb)'),
        to_regprocedure('public.cw_source_runtime_payload_patch_is_valid(jsonb,jsonb)'),
        to_regprocedure('public.register_cw_page_inserted_asset(uuid,text,text,text,text,bigint,integer,integer,text,text,text,text)'),
        to_regprocedure('public.cw_source_runtime_mathin_editor_is_valid(jsonb)'),
        to_regprocedure('public.cw_source_runtime_inserted_node_is_valid(jsonb)'),
        to_regprocedure('public.publish_cw_adapt_releases(uuid[],text)'),
        to_regprocedure('public.publish_cw_adapt_releases_pre_sml0_impl(uuid[],text)'),
        to_regprocedure('public.publish_cw_track_release(uuid,text,text)'),
        to_regprocedure('public.publish_cw_track_release_pre_sml0_impl(uuid,text,text)')
      ]::regprocedure[])
    ) function_hashes
  ), '{}'::jsonb)
)`;

export function buildLocalRehearsalSql(migrations) {
  const bodies = migrations.map((migration) => (
    `\n-- candidate migration: ${migration.name}\n${stripMigrationTransaction(migration.sql)}`
  )).join("\n");
  return String.raw`
create temp table courseware_workspace_rc_baseline(snapshot jsonb) on commit preserve rows;
insert into courseware_workspace_rc_baseline values (${snapshotExpression});

begin;
${bodies}
do $$
begin
  if to_regprocedure('public.rename_cw_page(uuid,text)') is null
     or to_regprocedure('public.resolve_cw_lecture_capability_for(uuid,uuid,text,timestamptz)') is null
     or to_regprocedure('public.save_cw_track_page_draft(uuid,text,jsonb,integer,text)') is null
     or to_regprocedure('public.save_cw_source_runtime_page_draft(uuid,text,jsonb,integer,text)') is null
     or to_regprocedure('public.cw_source_runtime_page_doc_is_valid(jsonb)') is null
     or to_regprocedure('public.cw_source_runtime_payload_patch_is_valid(jsonb,jsonb)') is null
     or to_regprocedure('public.register_cw_page_inserted_asset(uuid,text,text,text,text,bigint,integer,integer,text,text,text,text)') is null
     or to_regprocedure('public.cw_source_runtime_inserted_node_is_valid(jsonb)') is null then
    raise exception 'COURSEWARE_WORKSPACE_CANDIDATE_FUNCTION_MISSING';
  end if;
  if to_regprocedure('public.publish_cw_adapt_releases(uuid[],text)') is not null
     or to_regprocedure('public.publish_cw_track_release(uuid,text,text)') is not null then
    raise exception 'COURSEWARE_WORKSPACE_LEGACY_PUBLISH_STILL_PRESENT';
  end if;
end;
$$;
rollback;

do $$
declare
  before_snapshot jsonb;
  after_snapshot jsonb := ${snapshotExpression};
begin
  select snapshot into before_snapshot from courseware_workspace_rc_baseline;
  if before_snapshot is distinct from after_snapshot then
    raise exception 'COURSEWARE_WORKSPACE_REHEARSAL_ROLLBACK_DRIFT';
  end if;
end;
$$;

select jsonb_build_object(
  'schemaVersion', 'mathin-courseware-workspace-candidate-rehearsal-v1',
  'rehearsalPassed', true,
  'rollbackRestoredBaseline', true,
  'migrationCount', ${migrations.length},
  'databaseFingerprint', public.r1_current_database_fingerprint()
);
`;
}
