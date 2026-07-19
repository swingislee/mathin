-- P4H-2：课程/讲次/班级/课次的受控生命周期入口。
-- 所有状态变化都经 SECURITY DEFINER RPC 完成；业务表继续不提供物理删除路径。

-- ---------------------------------------------------------------------------
-- 课程与讲次
-- ---------------------------------------------------------------------------

create or replace function public.transition_course_status(
  p_course_id uuid,
  p_target text
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  course_row public.courses%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'course.manage') then raise exception 'FORBIDDEN'; end if;
  if p_target not in ('draft', 'enabled', 'disabled') then raise exception 'INVALID_TRANSITION'; end if;

  select * into course_row from public.courses where id = p_course_id for update;
  if not found then raise exception 'COURSE_NOT_FOUND'; end if;
  if course_row.trashed_at is not null then raise exception 'COURSE_TRASHED'; end if;

  update public.courses set status = p_target where id = p_course_id;
  perform public.emit_domain_event(
    'course.lifecycle.transition', 'course', p_course_id,
    jsonb_build_object('from', course_row.status, 'to', p_target), null, null
  );
end;
$$;

create or replace function public.trash_course(p_course_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  course_row public.courses%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'course.manage') then raise exception 'FORBIDDEN'; end if;

  select * into course_row from public.courses where id = p_course_id for update;
  if not found then raise exception 'COURSE_NOT_FOUND'; end if;
  if course_row.trashed_at is not null then raise exception 'COURSE_TRASHED'; end if;
  if course_row.status <> 'draft' and course_row.purpose <> 'test' then
    raise exception 'INVALID_TRANSITION';
  end if;
  if exists (select 1 from public.classrooms where course_id = p_course_id)
     or exists (
       select 1 from public.class_sessions session_row
       join public.course_lectures lecture_row on lecture_row.id = session_row.lecture_id
       where lecture_row.course_id = p_course_id
     )
     or exists (
       select 1 from public.cw_lecture_releases release_row
       join public.course_lectures lecture_row on lecture_row.id = release_row.lecture_id
       where lecture_row.course_id = p_course_id
     ) then
    raise exception 'COURSE_IN_USE';
  end if;

  update public.courses
     set trashed_at = now(), trashed_by = uid
   where id = p_course_id;
  perform public.emit_domain_event(
    'course.lifecycle.trashed', 'course', p_course_id,
    jsonb_build_object('previousStatus', course_row.status), null, null
  );
end;
$$;

create or replace function public.restore_course(p_course_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  course_row public.courses%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'course.manage') then raise exception 'FORBIDDEN'; end if;

  select * into course_row from public.courses where id = p_course_id for update;
  if not found then raise exception 'COURSE_NOT_FOUND'; end if;
  if course_row.trashed_at is null then raise exception 'INVALID_TRANSITION'; end if;

  update public.courses
     set trashed_at = null, trashed_by = null, status = 'draft'
   where id = p_course_id;
  perform public.emit_domain_event(
    'course.lifecycle.restored', 'course', p_course_id,
    jsonb_build_object('restoredStatus', 'draft'), null, null
  );
end;
$$;

create or replace function public.get_course_lifecycle_impact(p_course_id uuid)
returns table(
  lecture_count integer,
  release_count integer,
  classroom_count integer,
  session_count integer,
  object_count integer
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'course.view') then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.courses where id = p_course_id) then
    raise exception 'COURSE_NOT_FOUND';
  end if;

  return query
  select
    (select count(*)::integer from public.course_lectures where course_id = p_course_id),
    (
      select count(*)::integer
        from public.cw_lecture_releases release_row
        join public.course_lectures lecture_row on lecture_row.id = release_row.lecture_id
       where lecture_row.course_id = p_course_id
    ),
    (select count(*)::integer from public.classrooms where course_id = p_course_id),
    (
      select count(distinct session_row.id)::integer
        from public.class_sessions session_row
        left join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
        left join public.course_lectures lecture_row on lecture_row.id = session_row.lecture_id
       where classroom_row.course_id = p_course_id or lecture_row.course_id = p_course_id
    ),
    (
      select count(distinct object_row.id)::integer
        from public.course_lectures lecture_row
        join public.cw_page_docs page_row on page_row.lecture_id = lecture_row.id
        join public.cw_page_asset_bindings binding_row on binding_row.page_doc_id = page_row.id
        join public.cw_shared_assets asset_row on asset_row.id = binding_row.shared_asset_id
        join public.cw_asset_revisions revision_row
          on revision_row.id = coalesce(binding_row.pinned_revision_id, asset_row.published_revision_id)
        join public.cw_asset_objects object_row on object_row.id = revision_row.object_id
       where lecture_row.course_id = p_course_id
    );
end;
$$;

create or replace function public.archive_lecture(p_lecture_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  lecture_row public.course_lectures%rowtype;
  course_row public.courses%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'course.manage') then raise exception 'FORBIDDEN'; end if;

  select * into lecture_row from public.course_lectures where id = p_lecture_id for update;
  if not found then raise exception 'LECTURE_NOT_FOUND'; end if;
  select * into course_row from public.courses where id = lecture_row.course_id for update;
  if course_row.trashed_at is not null then raise exception 'COURSE_TRASHED'; end if;
  if lecture_row.status = 'archived' then raise exception 'LECTURE_ARCHIVED'; end if;

  update public.course_lectures
     set status = 'archived', archived_at = now(), archived_by = uid
   where id = p_lecture_id;
  perform public.emit_domain_event(
    'lecture.lifecycle.archived', 'course_lecture', p_lecture_id,
    jsonb_build_object('courseId', lecture_row.course_id, 'previousStatus', lecture_row.status), null, null
  );
end;
$$;

create or replace function public.restore_lecture(p_lecture_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  lecture_row public.course_lectures%rowtype;
  course_row public.courses%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'course.manage') then raise exception 'FORBIDDEN'; end if;

  select * into lecture_row from public.course_lectures where id = p_lecture_id for update;
  if not found then raise exception 'LECTURE_NOT_FOUND'; end if;
  select * into course_row from public.courses where id = lecture_row.course_id for update;
  if course_row.trashed_at is not null then raise exception 'COURSE_TRASHED'; end if;
  if lecture_row.status <> 'archived' then raise exception 'INVALID_TRANSITION'; end if;

  update public.course_lectures
     set status = 'active', archived_at = null, archived_by = null
   where id = p_lecture_id;
  perform public.emit_domain_event(
    'lecture.lifecycle.restored', 'course_lecture', p_lecture_id,
    jsonb_build_object('courseId', lecture_row.course_id, 'restoredStatus', 'active'), null, null
  );
end;
$$;

create or replace function public.get_lecture_lifecycle_impact(p_lecture_id uuid)
returns table(
  page_count integer,
  release_count integer,
  classroom_count integer,
  session_count integer,
  object_count integer
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'course.view') then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.course_lectures where id = p_lecture_id) then
    raise exception 'LECTURE_NOT_FOUND';
  end if;

  return query
  select
    (select count(*)::integer from public.cw_page_docs where lecture_id = p_lecture_id),
    (select count(*)::integer from public.cw_lecture_releases where lecture_id = p_lecture_id),
    (
      select count(distinct session_row.classroom_id)::integer
        from public.class_sessions session_row
       where session_row.lecture_id = p_lecture_id
    ),
    (select count(*)::integer from public.class_sessions where lecture_id = p_lecture_id),
    (
      select count(distinct object_row.id)::integer
        from public.cw_page_docs page_row
        join public.cw_page_asset_bindings binding_row on binding_row.page_doc_id = page_row.id
        join public.cw_shared_assets asset_row on asset_row.id = binding_row.shared_asset_id
        join public.cw_asset_revisions revision_row
          on revision_row.id = coalesce(binding_row.pinned_revision_id, asset_row.published_revision_id)
        join public.cw_asset_objects object_row on object_row.id = revision_row.object_id
       where page_row.lecture_id = p_lecture_id
    );
end;
$$;

create or replace function public.save_teaching_plan(
  p_course_id uuid,
  p_base_updated_at timestamptz,
  p_lectures jsonb
)
returns timestamptz
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  course_row public.courses%rowtype;
  input_count integer;
  existing_count integer;
  next_no integer;
  saved_at timestamptz;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'course.manage') then raise exception 'FORBIDDEN'; end if;
  if p_base_updated_at is null
     or jsonb_typeof(p_lectures) <> 'array'
     or jsonb_array_length(p_lectures) > 500 then
    raise exception 'INVALID_TEACHING_PLAN';
  end if;

  select * into course_row from public.courses where id = p_course_id for update;
  if not found then raise exception 'COURSE_NOT_FOUND'; end if;
  if course_row.trashed_at is not null then raise exception 'COURSE_TRASHED'; end if;
  if course_row.updated_at is distinct from p_base_updated_at then raise exception 'STALE_WRITE'; end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_lectures) as item(id text, name text, objectives text)
     where item.id is null
        or item.id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or item.name is null
        or length(btrim(item.name)) = 0
        or length(btrim(item.name)) > 100
        or item.objectives is null
        or length(item.objectives) > 2000
  ) then
    raise exception 'INVALID_TEACHING_PLAN';
  end if;

  select count(*)::integer, count(distinct item.id)::integer
    into input_count, existing_count
    from jsonb_to_recordset(p_lectures) as item(id text, name text, objectives text);
  if input_count <> existing_count then raise exception 'INVALID_TEACHING_PLAN'; end if;
  if input_count > 32767 then raise exception 'INVALID_TEACHING_PLAN'; end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_lectures) as item(id text, name text, objectives text)
      join public.course_lectures lecture_row on lecture_row.id = item.id::uuid
     where lecture_row.course_id <> p_course_id
  ) then
    raise exception 'LECTURE_NOT_IN_VARIANT';
  end if;
  if exists (
    select 1
      from public.course_lectures lecture_row
     where lecture_row.course_id = p_course_id
       and not exists (
         select 1
           from jsonb_to_recordset(p_lectures) as item(id text, name text, objectives text)
          where item.id::uuid = lecture_row.id
       )
  ) then
    raise exception 'LECTURE_DELETE_DISABLED';
  end if;

  -- 先将既有序号翻为负数，避免 unique(course_id,no) 在重排中逐行碰撞。
  update public.course_lectures set no = -no where course_id = p_course_id;
  select coalesce(max(abs(no)), 0) into next_no
    from public.course_lectures where course_id = p_course_id;

  update public.course_lectures lecture_row
     set name = btrim(item.name), objectives = item.objectives
    from jsonb_to_recordset(p_lectures) as item(id text, name text, objectives text)
   where lecture_row.id = item.id::uuid
     and lecture_row.course_id = p_course_id;

  insert into public.course_lectures (id, course_id, no, name, objectives, status)
  select item.id::uuid,
         p_course_id,
         (next_no + item.ordinality)::smallint,
         btrim(item.name),
         item.objectives,
         'draft'
    from jsonb_to_recordset(p_lectures) with ordinality as item(id text, name text, objectives text, ordinality bigint)
   where not exists (select 1 from public.course_lectures lecture_row where lecture_row.id = item.id::uuid);

  update public.course_lectures lecture_row
     set no = item.ordinality::smallint
    from jsonb_to_recordset(p_lectures) with ordinality as item(id text, name text, objectives text, ordinality bigint)
   where lecture_row.id = item.id::uuid
     and lecture_row.course_id = p_course_id;

  update public.courses set updated_at = now() where id = p_course_id returning updated_at into saved_at;
  perform public.emit_domain_event(
    'course.teaching_plan.saved', 'course', p_course_id,
    jsonb_build_object('lectureCount', input_count), null, null
  );
  return saved_at;
end;
$$;

-- 旧 RPC 保留签名以返回明确迁移错误，杜绝绕过 archive_lecture 的物理删除。
create or replace function public.delete_course_lecture(p_lecture_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'LECTURE_DELETE_DISABLED';
end;
$$;

-- ---------------------------------------------------------------------------
-- 班级、责任关系与课次
-- ---------------------------------------------------------------------------

create or replace function public.transition_classroom_status(
  p_classroom_id uuid,
  p_target text
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  classroom_row public.classrooms%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'class.manage') then raise exception 'FORBIDDEN'; end if;
  if p_target not in ('planning', 'active', 'completed') then raise exception 'INVALID_TRANSITION'; end if;

  select * into classroom_row from public.classrooms where id = p_classroom_id for update;
  if not found then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  if not public.can_manage_classroom(p_classroom_id, uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if classroom_row.trashed_at is not null then raise exception 'INVALID_TRANSITION'; end if;
  if classroom_row.operational_status = p_target then return; end if;
  if not (
    (classroom_row.operational_status = 'planning' and p_target in ('active', 'completed'))
    or (classroom_row.operational_status = 'active' and p_target = 'completed')
  ) then
    raise exception 'INVALID_TRANSITION';
  end if;

  if p_target = 'active' and classroom_row.purpose = 'production' and (
    classroom_row.course_id is null
    or not exists (
      select 1 from public.courses course_row
       where course_row.id = classroom_row.course_id
         and course_row.status = 'enabled'
         and course_row.trashed_at is null
    )
    or exists (
      select 1
        from public.class_sessions session_row
        left join public.course_lectures lecture_row on lecture_row.id = session_row.lecture_id
       where session_row.classroom_id = p_classroom_id
         and session_row.deleted_at is null
         and (
           session_row.lecture_id is null
           or lecture_row.status <> 'active'
           or lecture_row.current_release_id is null
         )
    )
  ) then
    raise exception 'CLASSROOM_PREP_INCOMPLETE';
  end if;

  update public.classrooms set operational_status = p_target where id = p_classroom_id;
  perform public.emit_domain_event(
    'classroom.lifecycle.transition', 'classroom', p_classroom_id,
    jsonb_build_object('from', classroom_row.operational_status, 'to', p_target), null, null
  );
end;
$$;

create or replace function public.archive_classroom(
  p_classroom_id uuid,
  p_archived boolean
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  classroom_row public.classrooms%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'class.manage') then raise exception 'FORBIDDEN'; end if;
  select * into classroom_row from public.classrooms where id = p_classroom_id for update;
  if not found then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  if not public.can_manage_classroom(p_classroom_id, uid) then raise exception 'FORBIDDEN_SCOPE'; end if;

  update public.classrooms set archived_at = case when p_archived then now() else null end where id = p_classroom_id;
  perform public.emit_domain_event(
    case when p_archived then 'classroom.lifecycle.archived' else 'classroom.lifecycle.unarchived' end,
    'classroom', p_classroom_id, jsonb_build_object('archived', p_archived), null, null
  );
end;
$$;

create or replace function public.trash_classroom(p_classroom_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  classroom_row public.classrooms%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'class.manage') then raise exception 'FORBIDDEN'; end if;
  select * into classroom_row from public.classrooms where id = p_classroom_id for update;
  if not found then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  if not public.can_manage_classroom(p_classroom_id, uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if classroom_row.trashed_at is not null then raise exception 'INVALID_TRANSITION'; end if;
  if exists (select 1 from public.enrollments where classroom_id = p_classroom_id and status = 'active') then
    raise exception 'CLASSROOM_HAS_ACTIVE_ENROLLMENTS';
  end if;
  if exists (select 1 from public.orders where classroom_id = p_classroom_id) then
    raise exception 'CLASSROOM_HAS_HISTORY';
  end if;
  if exists (
    select 1 from public.class_sessions
     where classroom_id = p_classroom_id
       and (started_at is not null or ended_at is not null or voided_at is not null)
  ) then
    raise exception 'CLASSROOM_HAS_HISTORY';
  end if;

  update public.classrooms set trashed_at = now(), trashed_by = uid where id = p_classroom_id;
  perform public.emit_domain_event('classroom.lifecycle.trashed', 'classroom', p_classroom_id, '{}'::jsonb, null, null);
end;
$$;

create or replace function public.restore_classroom(p_classroom_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  classroom_row public.classrooms%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'class.manage') then raise exception 'FORBIDDEN'; end if;
  select * into classroom_row from public.classrooms where id = p_classroom_id for update;
  if not found then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  if not public.can_manage_classroom(p_classroom_id, uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if classroom_row.trashed_at is null then raise exception 'INVALID_TRANSITION'; end if;

  update public.classrooms
     set trashed_at = null, trashed_by = null, operational_status = 'planning'
   where id = p_classroom_id;
  perform public.emit_domain_event(
    'classroom.lifecycle.restored', 'classroom', p_classroom_id,
    jsonb_build_object('restoredStatus', 'planning'), null, null
  );
end;
$$;

create or replace function public.assign_classroom_staff(
  p_classroom_id uuid,
  p_user_id uuid,
  p_responsibility text
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  classroom_row public.classrooms%rowtype;
  previous_primary uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'class.manage') then raise exception 'FORBIDDEN'; end if;
  if p_responsibility not in ('primary_teacher', 'assistant_teacher', 'learning_support') then
    raise exception 'INVALID_STAFF';
  end if;
  select * into classroom_row from public.classrooms where id = p_classroom_id for update;
  if not found then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  if not public.can_manage_classroom(p_classroom_id, uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if not exists (
    select 1 from public.profiles
     where id = p_user_id and is_active and role in ('staff', 'admin')
  ) then raise exception 'INVALID_STAFF'; end if;

  if p_responsibility = 'primary_teacher' then
    select user_id into previous_primary
      from public.classroom_staff_assignments
     where classroom_id = p_classroom_id and responsibility = 'primary_teacher'
     for update;
    if previous_primary is not null and previous_primary <> p_user_id then
      delete from public.classroom_staff_assignments
       where classroom_id = p_classroom_id
         and user_id = previous_primary
         and responsibility = 'primary_teacher';
      insert into public.classroom_staff_assignments (classroom_id, user_id, responsibility, created_by)
      values (p_classroom_id, previous_primary, 'assistant_teacher', uid)
      on conflict (classroom_id, user_id, responsibility) do nothing;
    end if;
    insert into public.classroom_staff_assignments (classroom_id, user_id, responsibility, created_by)
    values (p_classroom_id, p_user_id, 'primary_teacher', uid)
    on conflict (classroom_id, user_id, responsibility) do nothing;
    update public.classrooms set owner_id = p_user_id where id = p_classroom_id;
    insert into public.classroom_members (classroom_id, user_id, role)
    values (p_classroom_id, p_user_id, 'teacher')
    on conflict (classroom_id, user_id) do update set role = 'teacher';
  elsif p_responsibility = 'assistant_teacher' then
    insert into public.classroom_staff_assignments (classroom_id, user_id, responsibility, created_by)
    values (p_classroom_id, p_user_id, 'assistant_teacher', uid)
    on conflict (classroom_id, user_id, responsibility) do nothing;
    insert into public.classroom_members (classroom_id, user_id, role)
    values (p_classroom_id, p_user_id, 'teacher')
    on conflict (classroom_id, user_id) do update set role = 'teacher';
  else
    insert into public.classroom_staff_assignments (classroom_id, user_id, responsibility, created_by)
    values (p_classroom_id, p_user_id, 'learning_support', uid)
    on conflict (classroom_id, user_id, responsibility) do nothing;
  end if;

  perform public.emit_domain_event(
    'classroom.staff.assigned', 'classroom', p_classroom_id,
    jsonb_build_object('userId', p_user_id, 'responsibility', p_responsibility), p_user_id, null
  );
end;
$$;

create or replace function public.remove_classroom_staff(
  p_classroom_id uuid,
  p_user_id uuid,
  p_responsibility text
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  classroom_row public.classrooms%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'class.manage') then raise exception 'FORBIDDEN'; end if;
  if p_responsibility not in ('primary_teacher', 'assistant_teacher', 'learning_support') then
    raise exception 'INVALID_STAFF';
  end if;
  select * into classroom_row from public.classrooms where id = p_classroom_id for update;
  if not found then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  if not public.can_manage_classroom(p_classroom_id, uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if p_responsibility = 'primary_teacher' then
    raise exception 'PRIMARY_REPLACEMENT_REQUIRED';
  end if;

  delete from public.classroom_staff_assignments
   where classroom_id = p_classroom_id
     and user_id = p_user_id
     and responsibility = p_responsibility;
  if not found then raise exception 'ASSIGNMENT_NOT_FOUND'; end if;

  if p_responsibility = 'assistant_teacher'
     and not exists (
       select 1 from public.classroom_staff_assignments
        where classroom_id = p_classroom_id
          and user_id = p_user_id
          and responsibility in ('primary_teacher', 'assistant_teacher')
     ) then
    delete from public.classroom_members
     where classroom_id = p_classroom_id and user_id = p_user_id and role = 'teacher';
  end if;

  perform public.emit_domain_event(
    'classroom.staff.removed', 'classroom', p_classroom_id,
    jsonb_build_object('userId', p_user_id, 'responsibility', p_responsibility), p_user_id, null
  );
end;
$$;

create or replace function public.cancel_session(
  p_session_id uuid,
  p_reason text default ''
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  session_row public.class_sessions%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'class.manage') then raise exception 'FORBIDDEN'; end if;
  select * into session_row from public.class_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_manage_classroom(session_row.classroom_id, uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if session_row.started_at is not null or session_row.ended_at is not null then raise exception 'SESSION_ALREADY_STARTED'; end if;
  if session_row.deleted_at is not null then raise exception 'SESSION_NOT_CANCELLED'; end if;

  update public.class_sessions
     set deleted_at = now(), cancelled_by = uid, cancel_reason = left(btrim(coalesce(p_reason, '')), 1000)
   where id = p_session_id;
  perform public.emit_domain_event(
    'session.lifecycle.cancelled', 'class_session', p_session_id,
    jsonb_build_object('reason', left(btrim(coalesce(p_reason, '')), 1000)), null, null
  );
end;
$$;

create or replace function public.restore_session(p_session_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  session_row public.class_sessions%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'class.manage') then raise exception 'FORBIDDEN'; end if;
  select * into session_row from public.class_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_manage_classroom(session_row.classroom_id, uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if session_row.started_at is not null or session_row.ended_at is not null then raise exception 'SESSION_ALREADY_STARTED'; end if;
  if session_row.deleted_at is null or session_row.cancelled_by is null then raise exception 'SESSION_NOT_CANCELLED'; end if;

  update public.class_sessions
     set deleted_at = null, cancelled_by = null, cancel_reason = ''
   where id = p_session_id;
  perform public.emit_domain_event('session.lifecycle.restored', 'class_session', p_session_id, '{}'::jsonb, null, null);
end;
$$;

create or replace function public.void_session(
  p_session_id uuid,
  p_reason text default ''
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  session_row public.class_sessions%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'session.void') then raise exception 'FORBIDDEN'; end if;
  select * into session_row from public.class_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_manage_classroom(session_row.classroom_id, uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if session_row.ended_at is null then raise exception 'SESSION_NOT_ENDED'; end if;
  if session_row.voided_at is not null then raise exception 'SESSION_ALREADY_VOIDED'; end if;

  update public.class_sessions
     set voided_at = now(), voided_by = uid, void_reason = left(btrim(coalesce(p_reason, '')), 1000)
   where id = p_session_id;
  perform public.emit_domain_event(
    'session.lifecycle.voided', 'class_session', p_session_id,
    jsonb_build_object('reason', left(btrim(coalesce(p_reason, '')), 1000)), null, null
  );
end;
$$;

-- 生命周期字段不再通过旧的表级更新路径写入；取消/恢复课次只能经过 RPC。
revoke update (status, trashed_at, trashed_by) on public.courses from authenticated;
revoke update (deleted_at) on public.class_sessions from authenticated;

revoke all on function public.transition_course_status(uuid, text) from public, anon, authenticated;
revoke all on function public.trash_course(uuid) from public, anon, authenticated;
revoke all on function public.restore_course(uuid) from public, anon, authenticated;
revoke all on function public.get_course_lifecycle_impact(uuid) from public, anon, authenticated;
revoke all on function public.archive_lecture(uuid) from public, anon, authenticated;
revoke all on function public.restore_lecture(uuid) from public, anon, authenticated;
revoke all on function public.get_lecture_lifecycle_impact(uuid) from public, anon, authenticated;
revoke all on function public.save_teaching_plan(uuid, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.delete_course_lecture(uuid) from public, anon, authenticated;
revoke all on function public.transition_classroom_status(uuid, text) from public, anon, authenticated;
revoke all on function public.archive_classroom(uuid, boolean) from public, anon, authenticated;
revoke all on function public.trash_classroom(uuid) from public, anon, authenticated;
revoke all on function public.restore_classroom(uuid) from public, anon, authenticated;
revoke all on function public.assign_classroom_staff(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.remove_classroom_staff(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.cancel_session(uuid, text) from public, anon, authenticated;
revoke all on function public.restore_session(uuid) from public, anon, authenticated;
revoke all on function public.void_session(uuid, text) from public, anon, authenticated;

grant execute on function public.transition_course_status(uuid, text) to authenticated;
grant execute on function public.trash_course(uuid) to authenticated;
grant execute on function public.restore_course(uuid) to authenticated;
grant execute on function public.get_course_lifecycle_impact(uuid) to authenticated;
grant execute on function public.archive_lecture(uuid) to authenticated;
grant execute on function public.restore_lecture(uuid) to authenticated;
grant execute on function public.get_lecture_lifecycle_impact(uuid) to authenticated;
grant execute on function public.save_teaching_plan(uuid, timestamptz, jsonb) to authenticated;
grant execute on function public.delete_course_lecture(uuid) to authenticated;
grant execute on function public.transition_classroom_status(uuid, text) to authenticated;
grant execute on function public.archive_classroom(uuid, boolean) to authenticated;
grant execute on function public.trash_classroom(uuid) to authenticated;
grant execute on function public.restore_classroom(uuid) to authenticated;
grant execute on function public.assign_classroom_staff(uuid, uuid, text) to authenticated;
grant execute on function public.remove_classroom_staff(uuid, uuid, text) to authenticated;
grant execute on function public.cancel_session(uuid, text) to authenticated;
grant execute on function public.restore_session(uuid) to authenticated;
grant execute on function public.void_session(uuid, text) to authenticated;
