\set ON_ERROR_STOP on
-- R1-Live Gate 1/3: target-bound protected manifest and fail-closed test purge.
-- All synthetic writes run inside this transaction and are rolled back.
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
\if :{?admin_id}
\else
  \echo R1-Live manifest fixture missing: admin
  select 1 / 0;
\endif
\if :{?teacher_id}
\else
  \echo R1-Live manifest fixture missing: teacher
  select 1 / 0;
\endif

do $$
declare
  failures text[] := '{}';
  fingerprint text;
begin
  if to_regclass('public.r1_object_protection_manifests') is null
     or to_regclass('public.r1_object_protection_entries') is null then
    failures := array_append(failures, 'manifest tables missing');
  end if;
  if has_table_privilege('authenticated', 'public.r1_object_protection_manifests', 'SELECT')
     or has_table_privilege('authenticated', 'public.r1_object_protection_manifests', 'INSERT')
     or has_table_privilege('authenticated', 'public.r1_object_protection_entries', 'SELECT')
     or has_table_privilege('authenticated', 'public.r1_object_protection_entries', 'UPDATE')
     or has_table_privilege('service_role', 'public.r1_object_protection_manifests', 'SELECT')
     or has_table_privilege('service_role', 'public.r1_object_protection_entries', 'INSERT') then
    failures := array_append(failures, 'manifest tables exposed to API roles');
  end if;
  if has_function_privilege('authenticated', 'public.r1_current_database_fingerprint()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.r1_resolve_object_protection_manifest(boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.r1_object_protection_entries_sha256(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.r1_current_database_fingerprint()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.r1_resolve_object_protection_manifest(boolean)', 'EXECUTE') then
    failures := array_append(failures, 'internal manifest helpers exposed');
  end if;
  if not has_function_privilege('authenticated', 'public.purge_test_classroom(uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.purge_test_course_family(uuid,text)', 'EXECUTE') then
    failures := array_append(failures, 'guarded purge RPC unavailable');
  end if;
  fingerprint := public.r1_current_database_fingerprint();
  if fingerprint !~ '^[0-9a-f]{64}$' then
    failures := array_append(failures, 'database fingerprint is not sha256');
  end if;
  if cardinality(failures) > 0 then
    raise exception 'R1-Live manifest structure assertions failed: %', array_to_string(failures, ', ');
  end if;
end
$$;

-- A trashed test object is still non-purgeable when no active manifest exists.
insert into public.classrooms (owner_id, name, invite_code, purpose, operational_status, trashed_at)
values (
  :'teacher_id', '__R1_LIVE_MANIFEST_ALLOWED__',
  'RM' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  'test', 'completed', now()
)
returning id as allowed_classroom_id \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
do $$
declare target_id uuid;
begin
  select id into target_id from public.classrooms where name = '__R1_LIVE_MANIFEST_ALLOWED__';
  begin
    perform public.purge_test_classroom(target_id, '__R1_LIVE_MANIFEST_ALLOWED__');
    raise exception 'R1_LIVE_PURGE_WITHOUT_MANIFEST_ACCEPTED';
  exception when others then
    if SQLERRM <> 'PROTECTION_MANIFEST_REQUIRED' then raise; end if;
  end;
  if not exists (select 1 from public.classrooms where id = target_id) then
    raise exception 'R1_LIVE_FAIL_CLOSED_PURGE_DELETED_ROW';
  end if;
  if (select count(*) from public.list_purgeable_classrooms()) <> 0 then
    raise exception 'R1_LIVE_UNMANIFESTED_CANDIDATE_LISTED';
  end if;
end
$$;
reset role;

-- Build a valid manifest for the current ephemeral database. It contains one
-- protected admin auth/profile pair and one explicit test classroom root.
insert into public.r1_object_protection_manifests (
  environment, database_fingerprint, artifact_sha256, entries_sha256,
  protected_entry_count, purge_entry_count, created_by
)
values (
  'test', public.r1_current_database_fingerprint(), repeat('a', 64), repeat('0', 64),
  2, 1, :'admin_id'
)
returning id as allowed_manifest_id \gset

insert into public.r1_object_protection_entries (
  manifest_id, classification, object_type, object_key, metadata
)
values
  (
    :'allowed_manifest_id', 'protected', 'auth_user', :'admin_id',
    jsonb_build_object('role', 'admin', 'status', 'active', 'recoveryOwnerRef', 'ci-r1-owner')
  ),
  (
    :'allowed_manifest_id', 'protected', 'profile', :'admin_id',
    jsonb_build_object('role', 'admin', 'status', 'active')
  );

insert into public.r1_object_protection_entries (
  manifest_id, classification, object_type, object_key, expected_label, expected_counts
)
values (
  :'allowed_manifest_id', 'purge_allowed', 'classroom', :'allowed_classroom_id',
  '__R1_LIVE_MANIFEST_ALLOWED__', public.r1_classroom_purge_footprint(:'allowed_classroom_id')
);

update public.r1_object_protection_manifests
   set entries_sha256 = public.r1_object_protection_entries_sha256(id)
 where id = :'allowed_manifest_id';
update public.r1_object_protection_manifests
   set status = 'active', approved_by = :'admin_id', approved_at = now(),
       approval_reference = 'ci-transaction-only'
 where id = :'allowed_manifest_id';

-- Candidate preview is allowlist-only and exact-count drift blocks deletion.
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select (select count(*) from public.list_purgeable_classrooms() where id = :'allowed_classroom_id') = 1
  as r1_manifested_candidate_visible \gset
\if :r1_manifested_candidate_visible
\else
  \echo R1-Live manifested candidate was not listed
  select 1 / 0;
\endif
reset role;

insert into public.class_sessions (classroom_id, title)
values (:'allowed_classroom_id', '__R1_LIVE_COUNT_DRIFT__')
returning id as drift_session_id \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
do $$
declare target_id uuid;
begin
  select id into target_id from public.classrooms where name = '__R1_LIVE_MANIFEST_ALLOWED__';
  begin
    perform public.purge_test_classroom(target_id, '__R1_LIVE_MANIFEST_ALLOWED__');
    raise exception 'R1_LIVE_COUNT_DRIFT_PURGE_ACCEPTED';
  exception when others then
    if SQLERRM <> 'PURGE_MANIFEST_COUNT_MISMATCH' then raise; end if;
  end;
  if not exists (select 1 from public.classrooms where id = target_id) then
    raise exception 'R1_LIVE_COUNT_DRIFT_LEFT_DELETE';
  end if;
end
$$;
reset role;
delete from public.class_sessions where id = :'drift_session_id';

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.purge_test_classroom(:'allowed_classroom_id', '__R1_LIVE_MANIFEST_ALLOWED__');
select not exists (select 1 from public.classrooms where id = :'allowed_classroom_id')
  as r1_manifested_purge_completed \gset
\if :r1_manifested_purge_completed
\else
  \echo R1-Live exact manifested purge did not complete
  select 1 / 0;
\endif
reset role;

-- Active entries are immutable, and a protected descendant vetoes an otherwise
-- exact purge-allowed root.
do $$
begin
  begin
    update public.r1_object_protection_entries
       set metadata = jsonb_build_object('changed', true)
     where manifest_id = (
       select id from public.r1_object_protection_manifests where artifact_sha256 = repeat('a', 64)
     ) and object_type = 'profile';
    raise exception 'R1_LIVE_ACTIVE_MANIFEST_MUTATION_ACCEPTED';
  exception when others then
    if SQLERRM <> 'PROTECTION_MANIFEST_IMMUTABLE' then raise; end if;
  end;
end
$$;
update public.r1_object_protection_manifests set status = 'retired' where id = :'allowed_manifest_id';

insert into public.classrooms (owner_id, name, invite_code, purpose, operational_status, trashed_at)
values (
  :'teacher_id', '__R1_LIVE_MANIFEST_PROTECTED__',
  'RP' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  'test', 'completed', now()
)
returning id as protected_classroom_id \gset
insert into public.class_sessions (classroom_id, title)
values (:'protected_classroom_id', '__R1_LIVE_PROTECTED_SESSION__')
returning id as protected_session_id \gset

insert into public.r1_object_protection_manifests (
  environment, database_fingerprint, artifact_sha256, entries_sha256,
  protected_entry_count, purge_entry_count, created_by
)
values (
  'test', public.r1_current_database_fingerprint(), repeat('b', 64), repeat('0', 64),
  3, 1, :'admin_id'
)
returning id as protected_manifest_id \gset

insert into public.r1_object_protection_entries (
  manifest_id, classification, object_type, object_key, metadata
)
values
  (
    :'protected_manifest_id', 'protected', 'auth_user', :'admin_id',
    jsonb_build_object('role', 'admin', 'status', 'active', 'recoveryOwnerRef', 'ci-r1-owner')
  ),
  (
    :'protected_manifest_id', 'protected', 'profile', :'admin_id',
    jsonb_build_object('role', 'admin', 'status', 'active')
  ),
  (
    :'protected_manifest_id', 'protected', 'class_session', :'protected_session_id',
    '{}'::jsonb
  );
insert into public.r1_object_protection_entries (
  manifest_id, classification, object_type, object_key, expected_label, expected_counts
)
values (
  :'protected_manifest_id', 'purge_allowed', 'classroom', :'protected_classroom_id',
  '__R1_LIVE_MANIFEST_PROTECTED__', public.r1_classroom_purge_footprint(:'protected_classroom_id')
);
update public.r1_object_protection_manifests
   set entries_sha256 = public.r1_object_protection_entries_sha256(id)
 where id = :'protected_manifest_id';
update public.r1_object_protection_manifests
   set status = 'active', approved_by = :'admin_id', approved_at = now(),
       approval_reference = 'ci-protected-descendant'
 where id = :'protected_manifest_id';

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
do $$
declare target_id uuid;
begin
  select id into target_id from public.classrooms where name = '__R1_LIVE_MANIFEST_PROTECTED__';
  begin
    perform public.purge_test_classroom(target_id, '__R1_LIVE_MANIFEST_PROTECTED__');
    raise exception 'R1_LIVE_PROTECTED_DESCENDANT_PURGE_ACCEPTED';
  exception when others then
    if SQLERRM <> 'PROTECTED_OBJECT_IN_PURGE_SET' then raise; end if;
  end;
  if not exists (select 1 from public.classrooms where id = target_id) then
    raise exception 'R1_LIVE_PROTECTED_DESCENDANT_DELETED';
  end if;
end
$$;
reset role;
update public.r1_object_protection_manifests set status = 'retired' where id = :'protected_manifest_id';

-- Activation rejects a second declared active admin even when both identities
-- are paired with protected profile entries.
insert into public.r1_object_protection_manifests (
  environment, database_fingerprint, artifact_sha256, entries_sha256,
  protected_entry_count, purge_entry_count, created_by,
  approved_by, approved_at, approval_reference
)
values (
  'test', public.r1_current_database_fingerprint(), repeat('e', 64), repeat('0', 64),
  4, 0, :'admin_id', :'admin_id', now(), 'ci-duplicate-admin'
)
returning id as duplicate_admin_manifest_id \gset
insert into public.r1_object_protection_entries (manifest_id, classification, object_type, object_key, metadata)
values
  (:'duplicate_admin_manifest_id', 'protected', 'auth_user', :'admin_id', jsonb_build_object('role', 'admin', 'status', 'active', 'recoveryOwnerRef', 'ci-r1-owner')),
  (:'duplicate_admin_manifest_id', 'protected', 'profile', :'admin_id', jsonb_build_object('role', 'admin', 'status', 'active')),
  (:'duplicate_admin_manifest_id', 'protected', 'auth_user', :'teacher_id', jsonb_build_object('role', 'admin', 'status', 'active', 'recoveryOwnerRef', 'ci-r1-second-owner')),
  (:'duplicate_admin_manifest_id', 'protected', 'profile', :'teacher_id', jsonb_build_object('role', 'admin', 'status', 'active'));
update public.r1_object_protection_manifests
   set entries_sha256 = public.r1_object_protection_entries_sha256(id)
 where id = :'duplicate_admin_manifest_id';
do $$
begin
  begin
    update public.r1_object_protection_manifests set status = 'active'
     where artifact_sha256 = repeat('e', 64);
    raise exception 'R1_LIVE_DUPLICATE_ADMIN_MANIFEST_ACTIVATED';
  exception when others then
    if SQLERRM <> 'PROTECTION_MANIFEST_ADMIN_INVARIANT' then raise; end if;
  end;
end
$$;

-- Activation rejects both a copied manifest for another database and a
-- mismatched canonical entries hash.
insert into public.r1_object_protection_manifests (
  environment, database_fingerprint, artifact_sha256, entries_sha256,
  protected_entry_count, purge_entry_count, created_by,
  approved_by, approved_at, approval_reference
)
values (
  'test', repeat('f', 64), repeat('c', 64), repeat('0', 64),
  2, 0, :'admin_id', :'admin_id', now(), 'ci-wrong-target'
)
returning id as wrong_target_manifest_id \gset
insert into public.r1_object_protection_entries (manifest_id, classification, object_type, object_key, metadata)
values
  (:'wrong_target_manifest_id', 'protected', 'auth_user', :'admin_id', jsonb_build_object('role', 'admin', 'status', 'active', 'recoveryOwnerRef', 'ci-r1-owner')),
  (:'wrong_target_manifest_id', 'protected', 'profile', :'admin_id', jsonb_build_object('role', 'admin', 'status', 'active'));
update public.r1_object_protection_manifests
   set entries_sha256 = public.r1_object_protection_entries_sha256(id)
 where id = :'wrong_target_manifest_id';
do $$
begin
  begin
    update public.r1_object_protection_manifests set status = 'active'
     where artifact_sha256 = repeat('c', 64);
    raise exception 'R1_LIVE_WRONG_TARGET_MANIFEST_ACTIVATED';
  exception when others then
    if SQLERRM <> 'PROTECTION_MANIFEST_TARGET_MISMATCH' then raise; end if;
  end;
end
$$;

insert into public.r1_object_protection_manifests (
  environment, database_fingerprint, artifact_sha256, entries_sha256,
  protected_entry_count, purge_entry_count, created_by,
  approved_by, approved_at, approval_reference
)
values (
  'test', public.r1_current_database_fingerprint(), repeat('d', 64), repeat('9', 64),
  2, 0, :'admin_id', :'admin_id', now(), 'ci-wrong-hash'
)
returning id as wrong_hash_manifest_id \gset
insert into public.r1_object_protection_entries (manifest_id, classification, object_type, object_key, metadata)
values
  (:'wrong_hash_manifest_id', 'protected', 'auth_user', :'admin_id', jsonb_build_object('role', 'admin', 'status', 'active', 'recoveryOwnerRef', 'ci-r1-owner')),
  (:'wrong_hash_manifest_id', 'protected', 'profile', :'admin_id', jsonb_build_object('role', 'admin', 'status', 'active'));
do $$
begin
  begin
    update public.r1_object_protection_manifests set status = 'active'
     where artifact_sha256 = repeat('d', 64);
    raise exception 'R1_LIVE_WRONG_HASH_MANIFEST_ACTIVATED';
  exception when others then
    if SQLERRM <> 'PROTECTION_MANIFEST_HASH_MISMATCH' then raise; end if;
  end;
end
$$;

rollback;
