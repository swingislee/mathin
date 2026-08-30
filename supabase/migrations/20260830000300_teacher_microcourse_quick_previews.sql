begin;

-- DEV-TMC-4 Phase 3: one lightweight current-default preview payload per
-- course. The immutable current release IDs are suitable cache keys.

create function public.can_read_teacher_microcourse_catalog_course(
  p_course_id uuid,
  p_uid uuid default auth.uid()
)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p_uid is not null and exists (
    select 1 from public.courses course_row
    where course_row.id = p_course_id
      and course_row.course_kind = 'microcourse'
      and course_row.trashed_at is null
      and (
        course_row.status = 'enabled'
        or public.has_perm(p_uid, 'course.manage')
        or exists (
          select 1 from public.teacher_microcourse_class_courses root
          where root.course_id = course_row.id and root.created_by = p_uid
        )
        or exists (
          select 1 from public.teacher_microcourses branch
          where branch.course_id = course_row.id and branch.author_id = p_uid
        )
      )
  )
$$;

create function public.list_teacher_microcourse_browser_catalog(p_course_family_id uuid)
returns table (
  course_id uuid,
  course_title text,
  author_name text,
  updated_at timestamptz,
  lecture_titles text[],
  lecture_count integer,
  released_lecture_count integer,
  search_text text
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.has_perm(uid, 'course.view') then raise exception 'FORBIDDEN'; end if;
  if not exists (
    select 1 from public.course_families family
    where family.id = p_course_family_id and family.slug = 'teacher-microcourses'
  ) then raise exception 'COURSE_FAMILY_NOT_FOUND'; end if;
  return query
  select course_row.id, course_row.title, author.display_name,
         greatest(root.updated_at, course_row.updated_at),
         coalesce(lecture_data.titles, '{}'::text[]),
         coalesce(lecture_data.lecture_count, 0),
         coalesce(lecture_data.released_lecture_count, 0),
         concat_ws(' ', course_row.title, classroom.name, author.display_name, lecture_data.search_text)
  from public.teacher_microcourse_class_courses root
  join public.courses course_row on course_row.id = root.course_id
  join public.classrooms classroom on classroom.id = root.source_classroom_id
  join public.profiles author on author.id = root.created_by
  left join lateral (
    select array_agg(lecture.name order by lecture.no, lecture.id) as titles,
           count(*)::integer as lecture_count,
           count(*) filter (where lecture.current_release_id is not null)::integer as released_lecture_count,
           string_agg(concat_ws(' ', lecture.name, lecture.objectives), ' ' order by lecture.no, lecture.id) as search_text
    from public.course_lectures lecture
    where lecture.course_id = course_row.id and lecture.archived_at is null
  ) lecture_data on true
  where course_row.family_id = p_course_family_id
    and public.can_read_teacher_microcourse_catalog_course(course_row.id, uid)
  order by greatest(root.updated_at, course_row.updated_at) desc, course_row.title, course_row.id;
end;
$$;

create function public.list_teacher_microcourse_browser_scopes(p_course_family_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.has_perm(uid, 'course.view') then raise exception 'FORBIDDEN'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'courseId', course_row.id,
      'sceneIds', coalesce((select jsonb_agg(link.scene_id order by link.scene_id) from public.teacher_microcourse_course_scenes link where link.course_id = course_row.id), '[]'::jsonb),
      'gradeIds', coalesce((select jsonb_agg(link.grade_id order by grade.sort_order) from public.teacher_microcourse_course_grades link join public.organization_academic_grades grade on grade.id = link.grade_id where link.course_id = course_row.id), '[]'::jsonb),
      'termIds', coalesce((select jsonb_agg(link.term_id order by term.sort_order) from public.teacher_microcourse_course_terms link join public.organization_academic_terms term on term.id = link.term_id where link.course_id = course_row.id), '[]'::jsonb),
      'classSystemIds', coalesce((select jsonb_agg(link.class_system_id order by system.sort_order) from public.teacher_microcourse_course_class_systems link join public.organization_class_systems system on system.id = link.class_system_id where link.course_id = course_row.id), '[]'::jsonb),
      'classTypeIds', coalesce((select jsonb_agg(link.class_type_id order by class_type.sort_order) from public.teacher_microcourse_course_class_types link join public.organization_class_types class_type on class_type.id = link.class_type_id where link.course_id = course_row.id), '[]'::jsonb),
      'hasLegacyScope', exists (
        select 1 from public.teacher_microcourse_course_grades link where link.course_id = course_row.id and link.scope_origin = 'legacy_source'
        union all select 1 from public.teacher_microcourse_course_terms link where link.course_id = course_row.id and link.scope_origin = 'legacy_source'
        union all select 1 from public.teacher_microcourse_course_class_types link where link.course_id = course_row.id and link.scope_origin = 'legacy_source'
      )
    ) order by course_row.updated_at desc, course_row.id)
    from public.courses course_row
    where course_row.family_id = p_course_family_id
      and public.can_read_teacher_microcourse_catalog_course(course_row.id, uid)
  ), '[]'::jsonb);
end;
$$;

create function public.list_teacher_microcourse_quick_previews(p_course_family_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); can_manage boolean;
begin
  if uid is null or not public.has_perm(uid, 'course.view') then raise exception 'FORBIDDEN'; end if;
  if not exists (
    select 1 from public.course_families family
    where family.id = p_course_family_id and family.slug = 'teacher-microcourses'
  ) then raise exception 'COURSE_FAMILY_NOT_FOUND'; end if;
  can_manage := public.has_perm(uid, 'course.manage');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'courseId', course_row.id,
      'updatedAt', course_row.updated_at,
      'branchCount', (
        select count(*) from public.teacher_microcourses branch
        where branch.course_id = course_row.id and (can_manage or branch.withdrawn_at is null)
      ),
      'lectures', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', lecture.id,
          'no', lecture.no,
          'name', lecture.name,
          'objectives', lecture.objectives,
          'status', lecture.status,
          'currentReleaseId', lecture.current_release_id,
          'releaseNo', release.release_no,
          'pageCount', case when release.id is null then 0 else jsonb_array_length(release.courseware_pages) end,
          'cacheKey', coalesce(lecture.current_release_id::text, 'draft:' || lecture.id::text)
        ) order by lecture.no, lecture.id)
        from public.course_lectures lecture
        left join public.cw_lecture_releases release on release.id = lecture.current_release_id
        where lecture.course_id = course_row.id and lecture.archived_at is null
      ), '[]'::jsonb)
    ) order by course_row.updated_at desc, course_row.id)
    from public.courses course_row
    where course_row.family_id = p_course_family_id
      and course_row.course_kind = 'microcourse'
      and public.can_read_teacher_microcourse_catalog_course(course_row.id, uid)
  ), '[]'::jsonb);
end;
$$;

create function public.get_teacher_microcourse_browser_capabilities(p_course_family_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); is_subject_manager boolean;
begin
  if uid is null or not public.has_perm(uid, 'course.view') then raise exception 'FORBIDDEN'; end if;
  if not exists (
    select 1 from public.course_families family
    where family.id = p_course_family_id and family.slug = 'teacher-microcourses'
  ) then raise exception 'COURSE_FAMILY_NOT_FOUND'; end if;
  is_subject_manager := public.is_admin(uid) or exists (
    select 1 from public.teacher_microcourse_subject_managers manager
    where manager.course_family_id = p_course_family_id and manager.user_id = uid
  );
  return jsonb_build_object(
    'canManageScenes', public.can_manage_teacher_microcourse_subject(p_course_family_id, uid),
    'canManageScopes', public.can_manage_teacher_microcourse_scope(p_course_family_id, uid),
    'canCreateCourse', public.is_admin(uid) or public.has_perm(uid, 'subject.microcourse.course.create'),
    'canCreateBranch', public.is_admin(uid) or public.has_perm(uid, 'subject.microcourse.branch.create'),
    'canCommit', public.is_admin(uid) or public.has_perm(uid, 'subject.microcourse.commit.create'),
    'canAssignMaintainer', is_subject_manager and (public.is_admin(uid) or public.has_perm(uid, 'subject.microcourse.maintainer.assign')),
    'canSelectDefault', is_subject_manager and (public.is_admin(uid) or public.has_perm(uid, 'subject.microcourse.default.select'))
  );
end;
$$;

revoke all on function public.list_teacher_microcourse_quick_previews(uuid)
  from public, anon, authenticated;
revoke all on function public.can_read_teacher_microcourse_catalog_course(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.list_teacher_microcourse_browser_catalog(uuid)
  from public, anon, authenticated;
revoke all on function public.list_teacher_microcourse_browser_scopes(uuid)
  from public, anon, authenticated;
revoke all on function public.get_teacher_microcourse_browser_capabilities(uuid)
  from public, anon, authenticated;
grant execute on function public.list_teacher_microcourse_quick_previews(uuid)
  to authenticated;
grant execute on function public.list_teacher_microcourse_browser_catalog(uuid)
  to authenticated;
grant execute on function public.list_teacher_microcourse_browser_scopes(uuid)
  to authenticated;
grant execute on function public.get_teacher_microcourse_browser_capabilities(uuid)
  to authenticated;

comment on function public.list_teacher_microcourse_quick_previews(uuid) is
  'Lightweight current-default lecture preview; does not load editor documents or historical branches.';

notify pgrst, 'reload schema';
commit;
