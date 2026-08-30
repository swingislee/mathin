begin;

-- DEV-TMC-4 Phase 5: bounded preview reads, non-destructive duplicate
-- reconciliation, branch maintainer assignment, and rollout indexes.

create index teacher_microcourse_catalog_courses_family_updated_idx
  on public.teacher_microcourse_catalog_courses(course_family_id, updated_at desc, course_id)
  where duplicate_of_course_id is null and archived_at is null;
create index course_lectures_microcourse_active_idx
  on public.course_lectures(course_id, no, id)
  where archived_at is null;
create index teacher_microcourse_course_scenes_course_idx
  on public.teacher_microcourse_course_scenes(course_id, scene_id);
create index teacher_microcourse_course_grades_course_idx
  on public.teacher_microcourse_course_grades(course_id, grade_id);
create index teacher_microcourse_course_terms_course_idx
  on public.teacher_microcourse_course_terms(course_id, term_id);

create function public.get_teacher_microcourse_quick_preview(p_course_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); result jsonb;
begin
  if uid is null or not public.can_read_teacher_microcourse_catalog_course(p_course_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  select jsonb_build_object(
    'courseId', course_row.id,
    'updatedAt', course_row.updated_at,
    'branchCount', (
      select count(*) from public.teacher_microcourse_maintenance_branches branch
      where branch.course_id = course_row.id and branch.status = 'active'
    ),
    'lectures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', lecture.id, 'no', lecture.no, 'name', lecture.name,
        'objectives', lecture.objectives, 'status', lecture.status,
        'currentReleaseId', lecture.current_release_id,
        'releaseNo', release.release_no,
        'pageCount', case when release.id is null then 0 else jsonb_array_length(release.courseware_pages) end,
        'cacheKey', coalesce(lecture.current_release_id::text, 'draft:' || lecture.id::text)
      ) order by lecture.no, lecture.id)
      from public.course_lectures lecture
      left join public.cw_lecture_releases release on release.id = lecture.current_release_id
      where lecture.course_id = course_row.id and lecture.archived_at is null
    ), '[]'::jsonb)
  ) into result
  from public.courses course_row where course_row.id = p_course_id;
  if result is null then raise exception 'COURSE_NOT_FOUND'; end if;
  return result;
end;
$$;

create function public.get_teacher_microcourse_branch_members(p_course_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); family_id uuid; can_manage boolean;
begin
  if uid is null or not public.can_read_teacher_microcourse_catalog_course(p_course_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  select registry.course_family_id into family_id
  from public.teacher_microcourse_catalog_courses registry
  where registry.course_id = p_course_id and registry.duplicate_of_course_id is null;
  can_manage := public.is_admin(uid) or (
    public.has_perm(uid, 'subject.microcourse.maintainer.assign')
    and exists (
      select 1 from public.teacher_microcourse_subject_managers manager
      where manager.course_family_id = family_id and manager.user_id = uid
    )
  );
  return jsonb_build_object(
    'canManage', can_manage,
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'branchId', branch.id, 'ownerId', branch.owner_id,
        'collaboratorIds', coalesce((
          select jsonb_agg(collaborator.user_id order by collaborator.user_id)
          from public.teacher_microcourse_branch_collaborators collaborator
          where collaborator.branch_id = branch.id and collaborator.user_id <> branch.owner_id
        ), '[]'::jsonb)
      ) order by branch.created_at, branch.id)
      from public.teacher_microcourse_maintenance_branches branch
      where branch.course_id = p_course_id and branch.status = 'active'
    ), '[]'::jsonb)
  );
end;
$$;

create function public.set_teacher_microcourse_branch_members(
  p_branch_id uuid,
  p_owner_id uuid,
  p_collaborator_ids uuid[] default '{}'
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); branch_row public.teacher_microcourse_maintenance_branches%rowtype;
  family_id uuid;
begin
  if cardinality(coalesce(p_collaborator_ids, '{}')) > 100
     or cardinality(coalesce(p_collaborator_ids, '{}')) <>
        (select count(distinct id) from unnest(coalesce(p_collaborator_ids, '{}')) requested(id)) then
    raise exception 'INVALID_COLLABORATORS';
  end if;
  select * into branch_row from public.teacher_microcourse_maintenance_branches
  where id = p_branch_id and status = 'active' for update;
  if not found then raise exception 'BRANCH_NOT_FOUND'; end if;
  select registry.course_family_id into family_id
  from public.teacher_microcourse_catalog_courses registry where registry.course_id = branch_row.course_id;
  if uid is null or not (
    public.is_admin(uid)
    or (
      public.has_perm(uid, 'subject.microcourse.maintainer.assign')
      and exists (
        select 1 from public.teacher_microcourse_subject_managers manager
        where manager.course_family_id = family_id and manager.user_id = uid
      )
    )
  ) then raise exception 'FORBIDDEN'; end if;
  if not public.is_staff(p_owner_id)
     or exists (
       select 1 from unnest(coalesce(p_collaborator_ids, '{}')) requested(id)
       where not public.is_staff(requested.id)
     ) then raise exception 'INVALID_COLLABORATORS'; end if;
  if exists (
    select 1 from public.teacher_microcourse_maintenance_branches other
    where other.course_id = branch_row.course_id and other.owner_id = p_owner_id
      and other.status = 'active' and other.id <> branch_row.id
  ) then raise exception 'MAINTAINER_HAS_BRANCH'; end if;
  update public.teacher_microcourse_maintenance_branches
  set owner_id = p_owner_id, updated_at = now() where id = branch_row.id;
  delete from public.teacher_microcourse_branch_collaborators
  where branch_id = branch_row.id;
  insert into public.teacher_microcourse_branch_collaborators(branch_id, user_id, role, added_by)
  values (branch_row.id, p_owner_id, 'owner', uid);
  insert into public.teacher_microcourse_branch_collaborators(branch_id, user_id, role, added_by)
  select branch_row.id, requested.id, 'editor', uid
  from (select distinct unnest(coalesce(p_collaborator_ids, '{}')) id) requested
  where requested.id <> p_owner_id;
  perform public.emit_domain_event(
    'teacher_microcourse.branch_members_updated', 'teacher_microcourse_branch', branch_row.id,
    jsonb_build_object('ownerId', p_owner_id, 'collaboratorIds', coalesce(p_collaborator_ids, '{}')), null, null
  );
end;
$$;

create or replace function public.list_teacher_microcourse_duplicate_report(p_course_family_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); can_manage boolean;
begin
  can_manage := public.is_admin(uid) or (
    public.has_perm(uid, 'subject.microcourse.maintainer.assign')
    and exists (
      select 1 from public.teacher_microcourse_subject_managers manager
      where manager.course_family_id = p_course_family_id and manager.user_id = uid
    )
  );
  if not can_manage then return jsonb_build_object('canManage', false, 'groups', '[]'::jsonb); end if;
  return jsonb_build_object(
    'canManage', true,
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'normalizedName', grouped.normalized_name,
        'canonicalCourseId', grouped.canonical_course_id,
        'courses', grouped.courses
      ) order by grouped.normalized_name)
      from (
        select registry.normalized_name,
          (max(registry.course_id::text) filter (where registry.duplicate_of_course_id is null))::uuid as canonical_course_id,
          jsonb_agg(jsonb_build_object(
            'courseId', registry.course_id, 'title', course_row.title,
            'status', course_row.status,
            'isCanonical', registry.duplicate_of_course_id is null,
            'lectureCount', (select count(*) from public.course_lectures lecture where lecture.course_id = registry.course_id and lecture.archived_at is null),
            'createdAt', course_row.created_at
          ) order by (registry.duplicate_of_course_id is null) desc, course_row.created_at, registry.course_id) as courses
        from public.teacher_microcourse_catalog_courses registry
        join public.courses course_row on course_row.id = registry.course_id
        where registry.course_family_id = p_course_family_id and registry.archived_at is null
        group by registry.organization_id, registry.course_family_id, registry.normalized_name
        having count(*) > 1
      ) grouped
    ), '[]'::jsonb)
  );
end;
$$;

create function public.select_teacher_microcourse_duplicate_canonical(p_course_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); selected_row public.teacher_microcourse_catalog_courses%rowtype;
  current_canonical_id uuid;
begin
  select * into selected_row from public.teacher_microcourse_catalog_courses
  where course_id = p_course_id and archived_at is null for update;
  if not found then raise exception 'COURSE_NOT_FOUND'; end if;
  if uid is null or not (
    public.is_admin(uid)
    or (
      public.has_perm(uid, 'subject.microcourse.maintainer.assign')
      and exists (
        select 1 from public.teacher_microcourse_subject_managers manager
        where manager.course_family_id = selected_row.course_family_id and manager.user_id = uid
      )
    )
  ) then raise exception 'FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtext(
    'teacher-microcourse-duplicate:' || selected_row.organization_id::text || ':' ||
    selected_row.course_family_id::text || ':' || selected_row.normalized_name
  ));
  select registry.course_id into current_canonical_id
  from public.teacher_microcourse_catalog_courses registry
  where registry.organization_id = selected_row.organization_id
    and registry.course_family_id = selected_row.course_family_id
    and registry.normalized_name = selected_row.normalized_name
    and registry.duplicate_of_course_id is null and registry.archived_at is null
  for update;
  if current_canonical_id = p_course_id then return; end if;
  update public.teacher_microcourse_catalog_courses
  set duplicate_of_course_id = p_course_id, updated_at = now()
  where course_id = current_canonical_id;
  update public.teacher_microcourse_catalog_courses
  set duplicate_of_course_id = null, updated_at = now()
  where course_id = p_course_id;
  update public.teacher_microcourse_catalog_courses
  set duplicate_of_course_id = p_course_id, updated_at = now()
  where organization_id = selected_row.organization_id
    and course_family_id = selected_row.course_family_id
    and normalized_name = selected_row.normalized_name
    and course_id <> p_course_id;
  perform public.emit_domain_event(
    'teacher_microcourse.duplicate_canonical_selected', 'course', p_course_id,
    jsonb_build_object('previousCanonicalCourseId', current_canonical_id), null, null
  );
end;
$$;

revoke all on function public.get_teacher_microcourse_quick_preview(uuid) from public, anon, authenticated;
revoke all on function public.get_teacher_microcourse_branch_members(uuid) from public, anon, authenticated;
revoke all on function public.set_teacher_microcourse_branch_members(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.list_teacher_microcourse_duplicate_report(uuid) from public, anon, authenticated;
revoke all on function public.select_teacher_microcourse_duplicate_canonical(uuid) from public, anon, authenticated;
grant execute on function public.get_teacher_microcourse_quick_preview(uuid) to authenticated;
grant execute on function public.get_teacher_microcourse_branch_members(uuid) to authenticated;
grant execute on function public.set_teacher_microcourse_branch_members(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.list_teacher_microcourse_duplicate_report(uuid) to authenticated;
grant execute on function public.select_teacher_microcourse_duplicate_canonical(uuid) to authenticated;

comment on function public.get_teacher_microcourse_quick_preview(uuid) is
  'One-course bounded preview read for abortable client selection; immutable release IDs remain cache keys.';
comment on function public.select_teacher_microcourse_duplicate_canonical(uuid) is
  'Non-destructive duplicate reconciliation: selects the browser canonical while retaining every historical course row.';

notify pgrst, 'reload schema';
commit;
