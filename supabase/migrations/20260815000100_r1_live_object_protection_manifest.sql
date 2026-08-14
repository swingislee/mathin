-- R1-Live Gate 1/3：正式身份/业务对象保护 manifest 与 testdata purge 三重门。
--
-- 本迁移只建立 fail-closed 合同，不写入、猜测或激活任何环境的 manifest：
--   1. PostgreSQL system identifier 的 SHA-256 必须等于 manifest 目标指纹；
--   2. protected 条目保存正式身份、业务根及 release/snapshot/object hash；
--   3. purge_allowed 条目明确列出允许清理的测试根、显示名和预期影响计数。
--
-- 任一 manifest 缺失、目标不符、条目 hash/数量漂移、实际影响计数漂移，或删除闭包
-- 命中 protected 条目时，purge_test_* 都在写入前停止。purpose='test'、软删除状态、
-- 名称确认和既有引用检查继续保留，作为额外而非替代保护。

-- ---------------------------------------------------------------------------
-- 1. Manifest header + explicit object entries.
-- ---------------------------------------------------------------------------

create table public.r1_object_protection_manifests (
  id uuid primary key default gen_random_uuid(),
  environment text not null
    check (environment in ('production', 'isolated-production-snapshot', 'release-candidate', 'test')),
  database_fingerprint text not null check (database_fingerprint ~ '^[0-9a-f]{64}$'),
  artifact_sha256 text not null check (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  entries_sha256 text not null check (entries_sha256 ~ '^[0-9a-f]{64}$'),
  protected_entry_count integer not null check (protected_entry_count > 0),
  purge_entry_count integer not null default 0 check (purge_entry_count >= 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  approved_by uuid references public.profiles(id) on delete restrict,
  approval_reference text check (approval_reference is null or length(trim(approval_reference)) between 1 and 200),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  activated_at timestamptz,
  retired_at timestamptz,
  check (
    (status = 'draft' and activated_at is null and retired_at is null)
    or (status = 'active' and activated_at is not null and retired_at is null)
    or (status = 'retired' and activated_at is not null and retired_at is not null)
  )
);

create unique index r1_object_protection_manifests_one_active_target_idx
  on public.r1_object_protection_manifests (database_fingerprint)
  where status = 'active';

create table public.r1_object_protection_entries (
  manifest_id uuid not null references public.r1_object_protection_manifests(id) on delete cascade,
  classification text not null check (classification in ('protected', 'purge_allowed')),
  object_type text not null check (object_type in (
    'auth_user', 'profile', 'staff_role_member',
    'student', 'student_guardian',
    'classroom', 'classroom_member', 'classroom_staff_assignment',
    'enrollment', 'class_session', 'session_attendance',
    'assignment', 'learning_result', 'notification', 'work_item', 'order',
    'course_family', 'course_catalog_version', 'course', 'course_lecture',
    'cw_lecture_release', 'session_courseware_snapshot',
    'cw_page_revision', 'cw_asset_revision', 'cw_asset_object', 'storage_object'
  )),
  object_key text not null check (
    length(object_key) between 1 and 500
    and object_key !~ '[[:cntrl:]]'
  ),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  expected_label text check (expected_label is null or length(trim(expected_label)) between 1 and 200),
  expected_counts jsonb not null default '{}'::jsonb check (
    jsonb_typeof(expected_counts) = 'object'
    and octet_length(expected_counts::text) <= 4096
  ),
  metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(metadata) = 'object'
    and octet_length(metadata::text) <= 16384
  ),
  primary key (manifest_id, object_type, object_key),
  check (
    object_type in (
      'staff_role_member', 'student_guardian', 'classroom_member',
      'classroom_staff_assignment', 'session_attendance', 'storage_object'
    )
    or object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  check (
    classification = 'protected'
    or (
      object_type in ('classroom', 'course_family')
      and expected_label is not null
      and expected_counts <> '{}'::jsonb
    )
  ),
  check (
    classification <> 'protected'
    or object_type not in (
      'cw_lecture_release', 'session_courseware_snapshot',
      'cw_asset_object', 'storage_object'
    )
    or content_sha256 is not null
  )
);

alter table public.r1_object_protection_manifests enable row level security;
alter table public.r1_object_protection_entries enable row level security;

-- Manifest 只允许经受评审的 migration/运维连接写入。业务账号连 SELECT 都不开放，
-- 防止正式 UUID 清单通过 API 变成新的枚举面。
revoke all on table public.r1_object_protection_manifests from public, anon, authenticated, service_role;
revoke all on table public.r1_object_protection_entries from public, anon, authenticated, service_role;

comment on table public.r1_object_protection_manifests is
  'R1-Live target-bound immutable manifest header. No row is seeded or activated by schema migrations.';
comment on table public.r1_object_protection_entries is
  'Explicit protected-live and purge-allowed object keys. UUID objects use lowercase UUID text; composite keys use parent UUID/child UUID[/qualifier]; Storage uses bucket/path.';

-- ---------------------------------------------------------------------------
-- 2. Target identity and canonical entry-set hash.
-- ---------------------------------------------------------------------------

create or replace function public.r1_current_database_fingerprint()
returns text
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select encode(
    extensions.digest(convert_to(control_row.system_identifier::text, 'UTF8'), 'sha256'),
    'hex'
  )
  from pg_catalog.pg_control_system() control_row
$$;

create or replace function public.r1_object_protection_entries_sha256(p_manifest_id uuid)
returns text
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select encode(
    extensions.digest(
      convert_to(
        coalesce(string_agg(
          jsonb_build_object(
            'classification', entry_row.classification,
            'contentSha256', entry_row.content_sha256,
            'expectedCounts', entry_row.expected_counts,
            'expectedLabel', entry_row.expected_label,
            'metadata', entry_row.metadata,
            'objectKey', entry_row.object_key,
            'objectType', entry_row.object_type
          )::text,
          E'\n' order by entry_row.classification, entry_row.object_type, entry_row.object_key
        ), ''),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from public.r1_object_protection_entries entry_row
  where entry_row.manifest_id = p_manifest_id
$$;

revoke all on function public.r1_current_database_fingerprint() from public, anon, authenticated, service_role;
revoke all on function public.r1_object_protection_entries_sha256(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Draft-only entry edits; activation validates target, counts, identity
--    completeness and entry-set hash. Active content is immutable.
-- ---------------------------------------------------------------------------

create or replace function public.guard_r1_object_protection_entry_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_status text;
  target_status text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select status into source_status
      from public.r1_object_protection_manifests
     where id = old.manifest_id;
    if source_status is distinct from 'draft' then
      raise exception 'PROTECTION_MANIFEST_IMMUTABLE';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select status into target_status
      from public.r1_object_protection_manifests
     where id = new.manifest_id;
    if target_status is distinct from 'draft' then
      raise exception 'PROTECTION_MANIFEST_IMMUTABLE';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger r1_object_protection_entries_draft_only
  before insert or update or delete on public.r1_object_protection_entries
  for each row execute function public.guard_r1_object_protection_entry_write();

create or replace function public.guard_r1_object_protection_manifest_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actual_protected integer;
  actual_purge integer;
  actual_entries_sha256 text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.activated_at is not null or new.retired_at is not null then
      raise exception 'PROTECTION_MANIFEST_DRAFT_REQUIRED';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'PROTECTION_MANIFEST_IMMUTABLE'; end if;
    return old;
  end if;

  if new.id is distinct from old.id then raise exception 'PROTECTION_MANIFEST_IMMUTABLE'; end if;

  if old.status = 'retired' then
    raise exception 'PROTECTION_MANIFEST_IMMUTABLE';
  end if;

  if old.status = 'active' then
    if new.status <> 'retired'
       or new.environment is distinct from old.environment
       or new.database_fingerprint is distinct from old.database_fingerprint
       or new.artifact_sha256 is distinct from old.artifact_sha256
       or new.entries_sha256 is distinct from old.entries_sha256
       or new.protected_entry_count is distinct from old.protected_entry_count
       or new.purge_entry_count is distinct from old.purge_entry_count
       or new.created_by is distinct from old.created_by
       or new.approved_by is distinct from old.approved_by
       or new.approval_reference is distinct from old.approval_reference
       or new.created_at is distinct from old.created_at
       or new.approved_at is distinct from old.approved_at
       or new.activated_at is distinct from old.activated_at then
      raise exception 'PROTECTION_MANIFEST_IMMUTABLE';
    end if;
    new.retired_at := now();
    return new;
  end if;

  if new.status = 'draft' then
    new.activated_at := null;
    new.retired_at := null;
    return new;
  end if;
  if new.status <> 'active' then raise exception 'PROTECTION_MANIFEST_INVALID_TRANSITION'; end if;
  if new.approved_by is null or new.approved_at is null or nullif(trim(new.approval_reference), '') is null then
    raise exception 'PROTECTION_MANIFEST_APPROVAL_REQUIRED';
  end if;
  if new.database_fingerprint <> public.r1_current_database_fingerprint() then
    raise exception 'PROTECTION_MANIFEST_TARGET_MISMATCH';
  end if;

  select
    count(*) filter (where classification = 'protected')::integer,
    count(*) filter (where classification = 'purge_allowed')::integer
    into actual_protected, actual_purge
    from public.r1_object_protection_entries
   where manifest_id = new.id;
  actual_entries_sha256 := public.r1_object_protection_entries_sha256(new.id);

  if actual_protected <> new.protected_entry_count or actual_purge <> new.purge_entry_count then
    raise exception 'PROTECTION_MANIFEST_COUNT_MISMATCH';
  end if;
  if actual_entries_sha256 <> new.entries_sha256 then
    raise exception 'PROTECTION_MANIFEST_HASH_MISMATCH';
  end if;
  if (
    select count(*)
      from public.r1_object_protection_entries entry_row
     where entry_row.manifest_id = new.id
       and entry_row.classification = 'protected'
       and entry_row.object_type = 'auth_user'
       and entry_row.metadata ->> 'role' = 'admin'
       and entry_row.metadata ->> 'status' = 'active'
  ) <> 1 then
    raise exception 'PROTECTION_MANIFEST_ADMIN_INVARIANT';
  end if;
  if (
    select count(*)
      from public.profiles profile_row
     where profile_row.role = 'admin'
       and profile_row.is_active
       and profile_row.account_status = 'active'
  ) <> 1 or not exists (
    select 1
      from public.r1_object_protection_entries entry_row
      join public.profiles profile_row on profile_row.id = entry_row.object_key::uuid
     where entry_row.manifest_id = new.id
       and entry_row.classification = 'protected'
       and entry_row.object_type = 'auth_user'
       and entry_row.metadata ->> 'role' = 'admin'
       and entry_row.metadata ->> 'status' = 'active'
       and nullif(trim(entry_row.metadata ->> 'recoveryOwnerRef'), '') is not null
       and profile_row.role = 'admin'
       and profile_row.is_active
       and profile_row.account_status = 'active'
  ) then
    raise exception 'PROTECTION_MANIFEST_ADMIN_INVARIANT';
  end if;
  if exists (
    select 1
      from public.r1_object_protection_entries identity_row
     where identity_row.manifest_id = new.id
       and identity_row.classification = 'protected'
       and identity_row.object_type = 'auth_user'
       and (
         coalesce(identity_row.metadata ->> 'role', '') not in ('admin', 'staff', 'student', 'parent')
         or coalesce(identity_row.metadata ->> 'status', '') not in ('active', 'inactive')
         or not exists (
           select 1
             from auth.users auth_row
             join public.profiles actual_profile on actual_profile.id = auth_row.id
            where auth_row.id = identity_row.object_key::uuid
              and actual_profile.role = identity_row.metadata ->> 'role'
              and (
                (
                  identity_row.metadata ->> 'status' = 'active'
                  and actual_profile.is_active
                  and actual_profile.account_status = 'active'
                )
                or (
                  identity_row.metadata ->> 'status' = 'inactive'
                  and (not actual_profile.is_active or actual_profile.account_status <> 'active')
                )
              )
         )
         or not exists (
           select 1
             from public.r1_object_protection_entries profile_row
            where profile_row.manifest_id = identity_row.manifest_id
              and profile_row.classification = 'protected'
              and profile_row.object_type = 'profile'
              and profile_row.object_key = identity_row.object_key
         )
       )
  ) then
    raise exception 'PROTECTION_MANIFEST_IDENTITY_INCOMPLETE';
  end if;

  new.activated_at := now();
  new.retired_at := null;
  return new;
end;
$$;

create trigger r1_object_protection_manifest_guard
  before insert or update or delete on public.r1_object_protection_manifests
  for each row execute function public.guard_r1_object_protection_manifest_write();

revoke all on function public.guard_r1_object_protection_entry_write() from public, anon, authenticated, service_role;
revoke all on function public.guard_r1_object_protection_manifest_write() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Runtime resolver and exact purge footprints.
-- ---------------------------------------------------------------------------

create or replace function public.r1_resolve_object_protection_manifest(p_required boolean)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_fingerprint text := public.r1_current_database_fingerprint();
  manifest_row public.r1_object_protection_manifests%rowtype;
  actual_protected integer;
  actual_purge integer;
begin
  select * into manifest_row
    from public.r1_object_protection_manifests
   where status = 'active' and database_fingerprint = current_fingerprint
   for share;

  if not found then
    if not p_required then return null; end if;
    if exists (select 1 from public.r1_object_protection_manifests where status = 'active') then
      raise exception 'PROTECTION_MANIFEST_TARGET_MISMATCH';
    end if;
    raise exception 'PROTECTION_MANIFEST_REQUIRED';
  end if;

  select
    count(*) filter (where classification = 'protected')::integer,
    count(*) filter (where classification = 'purge_allowed')::integer
    into actual_protected, actual_purge
    from public.r1_object_protection_entries
   where manifest_id = manifest_row.id;
  if actual_protected <> manifest_row.protected_entry_count
     or actual_purge <> manifest_row.purge_entry_count then
    if p_required then raise exception 'PROTECTION_MANIFEST_COUNT_MISMATCH'; end if;
    return null;
  end if;
  if public.r1_object_protection_entries_sha256(manifest_row.id) <> manifest_row.entries_sha256 then
    if p_required then raise exception 'PROTECTION_MANIFEST_HASH_MISMATCH'; end if;
    return null;
  end if;
  return manifest_row.id;
end;
$$;

create or replace function public.r1_classroom_purge_footprint(p_classroom_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'attendance', (
      select count(*) from public.session_attendance attendance_row
      join public.class_sessions session_row on session_row.id = attendance_row.session_id
      where session_row.classroom_id = p_classroom_id
    ),
    'classroom_members', (select count(*) from public.classroom_members where classroom_id = p_classroom_id),
    'enrollments', (select count(*) from public.enrollments where classroom_id = p_classroom_id),
    'orders', (select count(*) from public.orders where classroom_id = p_classroom_id),
    'sessions', (select count(*) from public.class_sessions where classroom_id = p_classroom_id),
    'staff_assignments', (select count(*) from public.classroom_staff_assignments where classroom_id = p_classroom_id),
    'students', (select count(distinct student_id) from public.enrollments where classroom_id = p_classroom_id)
  )
$$;

create or replace function public.r1_course_family_purge_footprint(p_family_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'catalog_versions', (select count(*) from public.course_catalog_versions where family_id = p_family_id),
    'courses', (select count(*) from public.courses where family_id = p_family_id),
    'lectures', (
      select count(*) from public.course_lectures lecture_row
      join public.courses course_row on course_row.id = lecture_row.course_id
      where course_row.family_id = p_family_id
    ),
    'page_docs', (
      select count(*) from public.cw_page_docs page_row
      join public.course_lectures lecture_row on lecture_row.id = page_row.lecture_id
      join public.courses course_row on course_row.id = lecture_row.course_id
      where course_row.family_id = p_family_id
    ),
    'page_revisions', (
      select count(*) from public.cw_page_revisions revision_row
      join public.cw_page_docs page_row on page_row.id = revision_row.page_doc_id
      join public.course_lectures lecture_row on lecture_row.id = page_row.lecture_id
      join public.courses course_row on course_row.id = lecture_row.course_id
      where course_row.family_id = p_family_id
    ),
    'releases', (
      select count(*) from public.cw_lecture_releases release_row
      join public.course_lectures lecture_row on lecture_row.id = release_row.lecture_id
      join public.courses course_row on course_row.id = lecture_row.course_id
      where course_row.family_id = p_family_id
    )
  )
$$;

create or replace function public.r1_classroom_purge_has_protected_object(
  p_manifest_id uuid,
  p_classroom_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.r1_object_protection_entries entry_row
     where entry_row.manifest_id = p_manifest_id
       and entry_row.classification = 'protected'
       and (
         (entry_row.object_type = 'classroom' and entry_row.object_key = p_classroom_id::text)
         or (entry_row.object_type = 'class_session' and entry_row.object_key in (
           select session_row.id::text from public.class_sessions session_row
           where session_row.classroom_id = p_classroom_id
         ))
         or (entry_row.object_type = 'student' and entry_row.object_key in (
           select enrollment_row.student_id::text from public.enrollments enrollment_row
           where enrollment_row.classroom_id = p_classroom_id
         ))
         or (entry_row.object_type = 'enrollment' and entry_row.object_key in (
           select enrollment_row.id::text from public.enrollments enrollment_row
           where enrollment_row.classroom_id = p_classroom_id
         ))
         or (entry_row.object_type = 'classroom_member' and entry_row.object_key in (
           select member_row.classroom_id::text || '/' || member_row.user_id::text
             from public.classroom_members member_row
            where member_row.classroom_id = p_classroom_id
         ))
         or (entry_row.object_type = 'classroom_staff_assignment' and entry_row.object_key in (
           select assignment_row.classroom_id::text || '/' || assignment_row.user_id::text || '/' || assignment_row.responsibility
             from public.classroom_staff_assignments assignment_row
            where assignment_row.classroom_id = p_classroom_id
         ))
         or (entry_row.object_type = 'session_attendance' and entry_row.object_key in (
           select attendance_row.session_id::text || '/' || attendance_row.student_id::text
             from public.session_attendance attendance_row
             join public.class_sessions session_row on session_row.id = attendance_row.session_id
            where session_row.classroom_id = p_classroom_id
         ))
         or (entry_row.object_type = 'assignment' and entry_row.object_key in (
           select assignment_row.id::text
             from public.assignments assignment_row
             join public.class_sessions session_row on session_row.id = assignment_row.session_id
            where session_row.classroom_id = p_classroom_id
         ))
         or (entry_row.object_type = 'learning_result' and entry_row.object_key in (
           select result_row.id::text
             from public.learning_result_heads result_row
             join public.class_sessions session_row on session_row.id = result_row.session_id
            where session_row.classroom_id = p_classroom_id
         ))
         or (entry_row.object_type = 'cw_lecture_release' and entry_row.object_key in (
           select preparation_row.source_release_id::text
             from public.session_preparations preparation_row
             join public.class_sessions session_row on session_row.id = preparation_row.session_id
            where session_row.classroom_id = p_classroom_id
              and preparation_row.source_release_id is not null
         ))
         or (entry_row.object_type = 'session_courseware_snapshot' and entry_row.object_key in (
           select session_row.id::text from public.class_sessions session_row
           where session_row.classroom_id = p_classroom_id
         ))
       )
  )
$$;

create or replace function public.r1_course_family_purge_has_protected_object(
  p_manifest_id uuid,
  p_family_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.r1_object_protection_entries entry_row
     where entry_row.manifest_id = p_manifest_id
       and entry_row.classification = 'protected'
       and (
         (entry_row.object_type = 'course_family' and entry_row.object_key = p_family_id::text)
         or (entry_row.object_type = 'course_catalog_version' and entry_row.object_key in (
           select version_row.id::text from public.course_catalog_versions version_row
           where version_row.family_id = p_family_id
         ))
         or (entry_row.object_type = 'course' and entry_row.object_key in (
           select course_row.id::text from public.courses course_row
           where course_row.family_id = p_family_id
         ))
         or (entry_row.object_type = 'course_lecture' and entry_row.object_key in (
           select lecture_row.id::text
             from public.course_lectures lecture_row
             join public.courses course_row on course_row.id = lecture_row.course_id
            where course_row.family_id = p_family_id
         ))
         or (entry_row.object_type = 'cw_lecture_release' and entry_row.object_key in (
           select release_row.id::text
             from public.cw_lecture_releases release_row
             join public.course_lectures lecture_row on lecture_row.id = release_row.lecture_id
             join public.courses course_row on course_row.id = lecture_row.course_id
            where course_row.family_id = p_family_id
         ))
         or (entry_row.object_type = 'cw_page_revision' and entry_row.object_key in (
           select revision_row.id::text
             from public.cw_page_revisions revision_row
             join public.cw_page_docs page_row on page_row.id = revision_row.page_doc_id
             join public.course_lectures lecture_row on lecture_row.id = page_row.lecture_id
             join public.courses course_row on course_row.id = lecture_row.course_id
            where course_row.family_id = p_family_id
         ))
       )
  )
$$;

revoke all on function public.r1_resolve_object_protection_manifest(boolean) from public, anon, authenticated, service_role;
revoke all on function public.r1_classroom_purge_footprint(uuid) from public, anon, authenticated, service_role;
revoke all on function public.r1_course_family_purge_footprint(uuid) from public, anon, authenticated, service_role;
revoke all on function public.r1_classroom_purge_has_protected_object(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.r1_course_family_purge_has_protected_object(uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Candidate lists return zero rows when the target has no valid active
--    manifest. They never infer permission from purpose/name alone.
-- ---------------------------------------------------------------------------

create or replace function public.list_purgeable_course_families()
returns table(
  id uuid,
  title text,
  publisher text,
  variant_count integer,
  lecture_count integer,
  release_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  v_manifest_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'testdata.purge') then raise exception 'FORBIDDEN'; end if;
  v_manifest_id := public.r1_resolve_object_protection_manifest(false);
  if v_manifest_id is null then return; end if;

  return query
  select
    family_row.id,
    family_row.title,
    family_row.publisher,
    (select count(*)::integer from public.courses course_row where course_row.family_id = family_row.id),
    (select count(*)::integer from public.course_lectures lecture_row join public.courses course_row on course_row.id = lecture_row.course_id where course_row.family_id = family_row.id),
    (select count(*)::integer from public.cw_lecture_releases release_row join public.course_lectures lecture_row on lecture_row.id = release_row.lecture_id join public.courses course_row on course_row.id = lecture_row.course_id where course_row.family_id = family_row.id)
  from public.course_families family_row
  join public.r1_object_protection_entries entry_row
    on entry_row.manifest_id = v_manifest_id
   and entry_row.classification = 'purge_allowed'
   and entry_row.object_type = 'course_family'
   and entry_row.object_key = family_row.id::text
   and entry_row.expected_label = family_row.title
   and entry_row.expected_counts = public.r1_course_family_purge_footprint(family_row.id)
  where family_row.purpose = 'test'
    and not public.r1_course_family_purge_has_protected_object(v_manifest_id, family_row.id)
    and not exists (select 1 from public.courses course_row where course_row.family_id = family_row.id and course_row.trashed_at is null)
    and not exists (select 1 from public.classrooms classroom_row join public.courses course_row on course_row.id = classroom_row.course_id where course_row.family_id = family_row.id)
    and not exists (select 1 from public.class_sessions session_row join public.course_lectures lecture_row on lecture_row.id = session_row.lecture_id join public.courses course_row on course_row.id = lecture_row.course_id where course_row.family_id = family_row.id)
  order by family_row.title;
end;
$$;

create or replace function public.list_purgeable_classrooms()
returns table(
  id uuid,
  name text,
  enrollment_count integer,
  session_count integer,
  order_count integer,
  trashed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  v_manifest_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'testdata.purge') then raise exception 'FORBIDDEN'; end if;
  v_manifest_id := public.r1_resolve_object_protection_manifest(false);
  if v_manifest_id is null then return; end if;

  return query
  select
    classroom_row.id,
    classroom_row.name,
    (select count(*)::integer from public.enrollments enrollment_row where enrollment_row.classroom_id = classroom_row.id),
    (select count(*)::integer from public.class_sessions session_row where session_row.classroom_id = classroom_row.id),
    (select count(*)::integer from public.orders order_row where order_row.classroom_id = classroom_row.id),
    classroom_row.trashed_at
  from public.classrooms classroom_row
  join public.r1_object_protection_entries entry_row
    on entry_row.manifest_id = v_manifest_id
   and entry_row.classification = 'purge_allowed'
   and entry_row.object_type = 'classroom'
   and entry_row.object_key = classroom_row.id::text
   and entry_row.expected_label = classroom_row.name
   and entry_row.expected_counts = public.r1_classroom_purge_footprint(classroom_row.id)
  where classroom_row.purpose = 'test'
    and classroom_row.trashed_at is not null
    and not public.r1_classroom_purge_has_protected_object(v_manifest_id, classroom_row.id)
    and not exists (select 1 from public.orders order_row where order_row.classroom_id = classroom_row.id)
  order by classroom_row.name;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Permanent purge reads target + protected + purge_allowed manifest state
--    inside the same transaction before emitting an event or deleting rows.
-- ---------------------------------------------------------------------------

create or replace function public.purge_test_course_family(
  p_family_id uuid,
  p_confirm_name text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  family_row public.course_families%rowtype;
  v_manifest_id uuid;
  manifest_row public.r1_object_protection_manifests%rowtype;
  manifest_label text;
  manifest_counts jsonb;
  actual_counts jsonb;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'testdata.purge') then raise exception 'FORBIDDEN'; end if;

  select * into family_row from public.course_families where id = p_family_id for update;
  if not found then raise exception 'COURSE_FAMILY_NOT_FOUND'; end if;
  v_manifest_id := public.r1_resolve_object_protection_manifest(true);
  select * into manifest_row from public.r1_object_protection_manifests manifest_header where manifest_header.id = v_manifest_id;

  select expected_label, expected_counts into manifest_label, manifest_counts
    from public.r1_object_protection_entries entry_row
   where entry_row.manifest_id = v_manifest_id
     and entry_row.classification = 'purge_allowed'
     and entry_row.object_type = 'course_family'
     and entry_row.object_key = p_family_id::text;
  if not found then raise exception 'PURGE_MANIFEST_TARGET_NOT_ALLOWED'; end if;
  if family_row.purpose <> 'test' then raise exception 'PRODUCTION_DATA_PROTECTED'; end if;
  if manifest_label <> family_row.title then raise exception 'PURGE_MANIFEST_LABEL_MISMATCH'; end if;
  if p_confirm_name is null or p_confirm_name <> family_row.title then raise exception 'NAME_MISMATCH'; end if;

  actual_counts := public.r1_course_family_purge_footprint(p_family_id);
  if manifest_counts <> actual_counts then raise exception 'PURGE_MANIFEST_COUNT_MISMATCH'; end if;
  if public.r1_course_family_purge_has_protected_object(v_manifest_id, p_family_id) then
    raise exception 'PROTECTED_OBJECT_IN_PURGE_SET';
  end if;
  if exists (select 1 from public.courses course_row where course_row.family_id = p_family_id and course_row.trashed_at is null) then
    raise exception 'VARIANT_NOT_TRASHED';
  end if;
  if exists (select 1 from public.classrooms classroom_row join public.courses course_row on course_row.id = classroom_row.course_id where course_row.family_id = p_family_id)
     or exists (select 1 from public.class_sessions session_row join public.course_lectures lecture_row on lecture_row.id = session_row.lecture_id join public.courses course_row on course_row.id = lecture_row.course_id where course_row.family_id = p_family_id)
     or exists (select 1 from public.session_preparations preparation_row join public.cw_lecture_releases release_row on release_row.id = preparation_row.source_release_id join public.course_lectures lecture_row on lecture_row.id = release_row.lecture_id join public.courses course_row on course_row.id = lecture_row.course_id where course_row.family_id = p_family_id) then
    raise exception 'COURSE_IN_USE';
  end if;
  if exists (
    select 1 from public.cw_replacement_items replacement_row
    join public.courses course_row on course_row.id = replacement_row.course_id
    where course_row.family_id = p_family_id
  ) then
    raise exception 'COURSE_HAS_REPLACEMENT_HISTORY';
  end if;

  perform public.emit_domain_event(
    'course_family.lifecycle.purged',
    'course_family',
    p_family_id,
    jsonb_build_object(
      'title', family_row.title,
      'manifestId', v_manifest_id,
      'manifestArtifactSha256', manifest_row.artifact_sha256,
      'databaseFingerprint', manifest_row.database_fingerprint,
      'expectedCounts', manifest_counts
    ),
    null,
    null
  );

  delete from public.courses where family_id = p_family_id;
  delete from public.course_catalog_versions where family_id = p_family_id;
  delete from public.course_families where id = p_family_id;
end;
$$;

create or replace function public.purge_test_classroom(
  p_classroom_id uuid,
  p_confirm_name text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  classroom_row public.classrooms%rowtype;
  v_manifest_id uuid;
  manifest_row public.r1_object_protection_manifests%rowtype;
  manifest_label text;
  manifest_counts jsonb;
  actual_counts jsonb;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'testdata.purge') then raise exception 'FORBIDDEN'; end if;

  select * into classroom_row from public.classrooms where id = p_classroom_id for update;
  if not found then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  v_manifest_id := public.r1_resolve_object_protection_manifest(true);
  select * into manifest_row from public.r1_object_protection_manifests manifest_header where manifest_header.id = v_manifest_id;

  select expected_label, expected_counts into manifest_label, manifest_counts
    from public.r1_object_protection_entries entry_row
   where entry_row.manifest_id = v_manifest_id
     and entry_row.classification = 'purge_allowed'
     and entry_row.object_type = 'classroom'
     and entry_row.object_key = p_classroom_id::text;
  if not found then raise exception 'PURGE_MANIFEST_TARGET_NOT_ALLOWED'; end if;
  if classroom_row.purpose <> 'test' then raise exception 'PRODUCTION_DATA_PROTECTED'; end if;
  if classroom_row.trashed_at is null then raise exception 'CLASSROOM_NOT_TRASHED'; end if;
  if manifest_label <> classroom_row.name then raise exception 'PURGE_MANIFEST_LABEL_MISMATCH'; end if;
  if p_confirm_name is null or p_confirm_name <> classroom_row.name then raise exception 'NAME_MISMATCH'; end if;

  actual_counts := public.r1_classroom_purge_footprint(p_classroom_id);
  if manifest_counts <> actual_counts then raise exception 'PURGE_MANIFEST_COUNT_MISMATCH'; end if;
  if public.r1_classroom_purge_has_protected_object(v_manifest_id, p_classroom_id) then
    raise exception 'PROTECTED_OBJECT_IN_PURGE_SET';
  end if;
  if exists (select 1 from public.orders order_row where order_row.classroom_id = p_classroom_id) then
    raise exception 'CLASSROOM_HAS_HISTORY';
  end if;

  perform public.emit_domain_event(
    'classroom.lifecycle.purged',
    'classroom',
    p_classroom_id,
    jsonb_build_object(
      'name', classroom_row.name,
      'manifestId', v_manifest_id,
      'manifestArtifactSha256', manifest_row.artifact_sha256,
      'databaseFingerprint', manifest_row.database_fingerprint,
      'expectedCounts', manifest_counts
    ),
    null,
    null
  );

  delete from public.classrooms where id = p_classroom_id;
end;
$$;

revoke all on function public.list_purgeable_course_families() from public, anon, authenticated, service_role;
revoke all on function public.list_purgeable_classrooms() from public, anon, authenticated, service_role;
revoke all on function public.purge_test_course_family(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.purge_test_classroom(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.list_purgeable_course_families() to authenticated;
grant execute on function public.list_purgeable_classrooms() to authenticated;
grant execute on function public.purge_test_course_family(uuid, text) to authenticated;
grant execute on function public.purge_test_classroom(uuid, text) to authenticated;

comment on function public.purge_test_course_family(uuid, text) is
  'Fail-closed permanent purge: current database fingerprint + active immutable manifest + explicit test allowlist + protected closure veto + exact impact counts.';
comment on function public.purge_test_classroom(uuid, text) is
  'Fail-closed permanent purge: current database fingerprint + active immutable manifest + explicit test allowlist + protected closure veto + exact impact counts.';
