begin;

-- DEV-TMC-4 Phase 2: explicit many-to-many use cases and applicability.
-- Zero rows in an applicability dimension means universal for that dimension.

create table public.teacher_microcourse_course_scenes (
  course_id uuid not null references public.courses(id) on delete cascade,
  scene_id uuid not null references public.subject_microcourse_scenes(id) on delete restrict,
  scope_origin text not null default 'manual' check (scope_origin in ('manual', 'legacy_source')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (course_id, scene_id)
);

create table public.teacher_microcourse_course_grades (
  course_id uuid not null references public.courses(id) on delete cascade,
  grade_id uuid not null references public.organization_academic_grades(id) on delete restrict,
  scope_origin text not null default 'manual' check (scope_origin in ('manual', 'legacy_source')),
  confirmed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (course_id, grade_id)
);

create table public.teacher_microcourse_course_terms (
  course_id uuid not null references public.courses(id) on delete cascade,
  term_id uuid not null references public.organization_academic_terms(id) on delete restrict,
  scope_origin text not null default 'manual' check (scope_origin in ('manual', 'legacy_source')),
  confirmed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (course_id, term_id)
);

create table public.teacher_microcourse_course_class_systems (
  course_id uuid not null references public.courses(id) on delete cascade,
  class_system_id uuid not null references public.organization_class_systems(id) on delete restrict,
  scope_origin text not null default 'manual' check (scope_origin in ('manual', 'legacy_source')),
  confirmed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (course_id, class_system_id)
);

create table public.teacher_microcourse_course_class_types (
  course_id uuid not null references public.courses(id) on delete cascade,
  class_type_id uuid not null references public.organization_class_types(id) on delete restrict,
  scope_origin text not null default 'manual' check (scope_origin in ('manual', 'legacy_source')),
  confirmed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (course_id, class_type_id)
);

create index teacher_microcourse_course_scenes_scene_idx
  on public.teacher_microcourse_course_scenes(scene_id, course_id);
create index teacher_microcourse_course_grades_grade_idx
  on public.teacher_microcourse_course_grades(grade_id, course_id);
create index teacher_microcourse_course_terms_term_idx
  on public.teacher_microcourse_course_terms(term_id, course_id);
create index teacher_microcourse_course_class_systems_system_idx
  on public.teacher_microcourse_course_class_systems(class_system_id, course_id);
create index teacher_microcourse_course_class_types_type_idx
  on public.teacher_microcourse_course_class_types(class_type_id, course_id);

alter table public.teacher_microcourse_course_scenes enable row level security;
alter table public.teacher_microcourse_course_grades enable row level security;
alter table public.teacher_microcourse_course_terms enable row level security;
alter table public.teacher_microcourse_course_class_systems enable row level security;
alter table public.teacher_microcourse_course_class_types enable row level security;

revoke all on table
  public.teacher_microcourse_course_scenes,
  public.teacher_microcourse_course_grades,
  public.teacher_microcourse_course_terms,
  public.teacher_microcourse_course_class_systems,
  public.teacher_microcourse_course_class_types
from public, anon, authenticated;

create function public.can_manage_teacher_microcourse_scope(
  p_course_family_id uuid,
  p_uid uuid default auth.uid()
)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p_uid is not null and (
    public.is_admin(p_uid)
    or (
      public.has_perm(p_uid, 'subject.microcourse.scope.manage')
      and exists (
        select 1 from public.teacher_microcourse_subject_managers manager
        where manager.course_family_id = p_course_family_id and manager.user_id = p_uid
      )
    )
  )
$$;

create function public.assert_teacher_microcourse_scope_manager(p_course_family_id uuid)
returns uuid
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.can_manage_teacher_microcourse_scope(p_course_family_id, uid) then
    raise exception 'FORBIDDEN_SUBJECT';
  end if;
  return uid;
end;
$$;

-- Conservative legacy-source migration. Empty old fields remain universal and
-- no use case is inferred from titles, keywords, or class types.
insert into public.teacher_microcourse_course_grades(course_id, grade_id, scope_origin)
select course_row.id, grade.id, 'legacy_source'
from public.courses course_row
join public.organization_academic_grades grade on grade.grade_no = course_row.grade
join public.course_families family on family.id = course_row.family_id
where course_row.course_kind = 'microcourse' and family.slug = 'teacher-microcourses'
on conflict do nothing;

insert into public.teacher_microcourse_course_terms(course_id, term_id, scope_origin)
select course_row.id, term.id, 'legacy_source'
from public.courses course_row
join public.organization_academic_terms term on term.legacy_season = course_row.term
join public.course_families family on family.id = course_row.family_id
where course_row.course_kind = 'microcourse' and family.slug = 'teacher-microcourses'
  and course_row.term is not null
on conflict do nothing;

insert into public.teacher_microcourse_course_class_types(course_id, class_type_id, scope_origin)
select course_row.id, class_type.id, 'legacy_source'
from public.courses course_row
join public.organization_class_types class_type
  on lower(btrim(class_type.code)) = lower(btrim(course_row.class_type))
join public.course_families family on family.id = course_row.family_id
where course_row.course_kind = 'microcourse' and family.slug = 'teacher-microcourses'
  and btrim(course_row.class_type) <> ''
on conflict do nothing;

create function public.list_teacher_microcourse_scopes(p_course_family_id uuid)
returns jsonb
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
      and course_row.course_kind = 'microcourse'
      and course_row.trashed_at is null
      and (course_row.status = 'enabled' or public.has_perm(uid, 'course.manage'))
  ), '[]'::jsonb);
end;
$$;

create function public.set_teacher_microcourse_course_scopes(
  p_course_family_id uuid,
  p_course_ids uuid[],
  p_scene_ids uuid[],
  p_grade_ids uuid[],
  p_term_ids uuid[],
  p_class_system_ids uuid[],
  p_class_type_ids uuid[]
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := public.assert_teacher_microcourse_scope_manager(p_course_family_id);
  course_ids uuid[]; scene_ids uuid[]; grade_ids uuid[]; term_ids uuid[];
  system_ids uuid[]; class_type_ids uuid[];
begin
  select coalesce(array_agg(distinct selected.id order by selected.id), '{}'::uuid[])
  into course_ids from unnest(coalesce(p_course_ids, '{}'::uuid[])) as selected(id);
  select coalesce(array_agg(distinct selected.id order by selected.id), '{}'::uuid[])
  into scene_ids from unnest(coalesce(p_scene_ids, '{}'::uuid[])) as selected(id);
  select coalesce(array_agg(distinct selected.id order by selected.id), '{}'::uuid[])
  into grade_ids from unnest(coalesce(p_grade_ids, '{}'::uuid[])) as selected(id);
  select coalesce(array_agg(distinct selected.id order by selected.id), '{}'::uuid[])
  into term_ids from unnest(coalesce(p_term_ids, '{}'::uuid[])) as selected(id);
  select coalesce(array_agg(distinct selected.id order by selected.id), '{}'::uuid[])
  into system_ids from unnest(coalesce(p_class_system_ids, '{}'::uuid[])) as selected(id);
  select coalesce(array_agg(distinct selected.id order by selected.id), '{}'::uuid[])
  into class_type_ids from unnest(coalesce(p_class_type_ids, '{}'::uuid[])) as selected(id);

  if cardinality(course_ids) not between 1 and 100
     or cardinality(course_ids) <> cardinality(coalesce(p_course_ids, '{}'::uuid[]))
     or cardinality(scene_ids) <> cardinality(coalesce(p_scene_ids, '{}'::uuid[]))
     or cardinality(grade_ids) <> cardinality(coalesce(p_grade_ids, '{}'::uuid[]))
     or cardinality(term_ids) <> cardinality(coalesce(p_term_ids, '{}'::uuid[]))
     or cardinality(system_ids) <> cardinality(coalesce(p_class_system_ids, '{}'::uuid[]))
     or cardinality(class_type_ids) <> cardinality(coalesce(p_class_type_ids, '{}'::uuid[]))
     or cardinality(scene_ids) > 100 or cardinality(grade_ids) > 99
     or cardinality(term_ids) > 20 or cardinality(system_ids) > 50 or cardinality(class_type_ids) > 100
  then
    raise exception 'INVALID_SCOPE_SELECTION:%', jsonb_build_object(
      'courses', cardinality(course_ids), 'rawCourses', cardinality(coalesce(p_course_ids, '{}'::uuid[])),
      'scenes', cardinality(scene_ids), 'rawScenes', cardinality(coalesce(p_scene_ids, '{}'::uuid[])),
      'grades', cardinality(grade_ids), 'rawGrades', cardinality(coalesce(p_grade_ids, '{}'::uuid[])),
      'terms', cardinality(term_ids), 'rawTerms', cardinality(coalesce(p_term_ids, '{}'::uuid[])),
      'systems', cardinality(system_ids), 'rawSystems', cardinality(coalesce(p_class_system_ids, '{}'::uuid[])),
      'classTypes', cardinality(class_type_ids), 'rawClassTypes', cardinality(coalesce(p_class_type_ids, '{}'::uuid[]))
    );
  end if;

  if exists (
    select 1 from unnest(course_ids) as selected(id)
    left join public.courses course_row on course_row.id = selected.id
      and course_row.family_id = p_course_family_id and course_row.course_kind = 'microcourse'
      and course_row.trashed_at is null
    where course_row.id is null
  ) or exists (
    select 1 from unnest(scene_ids) as selected(id)
    left join public.subject_microcourse_scenes scene on scene.id = selected.id
      and scene.course_family_id = p_course_family_id and scene.status = 'active'
    where scene.id is null
  ) or exists (
    select 1 from unnest(grade_ids) as selected(id)
    left join public.organization_academic_grades grade on grade.id = selected.id and grade.active
    where grade.id is null
  ) or exists (
    select 1 from unnest(term_ids) as selected(id)
    left join public.organization_academic_terms term on term.id = selected.id and term.active
    where term.id is null
  ) or exists (
    select 1 from unnest(system_ids) as selected(id)
    left join public.organization_class_systems system on system.id = selected.id and system.active
    where system.id is null
  ) or exists (
    select 1 from unnest(class_type_ids) as selected(id)
    left join public.organization_class_types class_type on class_type.id = selected.id and class_type.active
    where class_type.id is null
  ) then raise exception 'INVALID_SCOPE_TARGET'; end if;

  delete from public.teacher_microcourse_course_scenes where course_id = any(course_ids);
  delete from public.teacher_microcourse_course_grades where course_id = any(course_ids);
  delete from public.teacher_microcourse_course_terms where course_id = any(course_ids);
  delete from public.teacher_microcourse_course_class_systems where course_id = any(course_ids);
  delete from public.teacher_microcourse_course_class_types where course_id = any(course_ids);

  insert into public.teacher_microcourse_course_scenes(course_id, scene_id, created_by)
  select selected_course.id, selected_scene.id, uid
  from unnest(course_ids) as selected_course(id)
  cross join unnest(scene_ids) as selected_scene(id);
  insert into public.teacher_microcourse_course_grades(course_id, grade_id, scope_origin, confirmed_at, created_by)
  select selected_course.id, selected_grade.id, 'manual', now(), uid
  from unnest(course_ids) as selected_course(id)
  cross join unnest(grade_ids) as selected_grade(id);
  insert into public.teacher_microcourse_course_terms(course_id, term_id, scope_origin, confirmed_at, created_by)
  select selected_course.id, selected_term.id, 'manual', now(), uid
  from unnest(course_ids) as selected_course(id)
  cross join unnest(term_ids) as selected_term(id);
  insert into public.teacher_microcourse_course_class_systems(course_id, class_system_id, scope_origin, confirmed_at, created_by)
  select selected_course.id, selected_system.id, 'manual', now(), uid
  from unnest(course_ids) as selected_course(id)
  cross join unnest(system_ids) as selected_system(id);
  insert into public.teacher_microcourse_course_class_types(course_id, class_type_id, scope_origin, confirmed_at, created_by)
  select selected_course.id, selected_type.id, 'manual', now(), uid
  from unnest(course_ids) as selected_course(id)
  cross join unnest(class_type_ids) as selected_type(id);

  perform public.emit_domain_event(
    'teacher_microcourse.course_scopes.updated', 'course_family', p_course_family_id,
    jsonb_build_object(
      'courseIds', to_jsonb(course_ids), 'sceneIds', to_jsonb(scene_ids),
      'gradeIds', to_jsonb(grade_ids), 'termIds', to_jsonb(term_ids),
      'classSystemIds', to_jsonb(system_ids), 'classTypeIds', to_jsonb(class_type_ids)
    )
  );
end;
$$;

revoke all on function public.can_manage_teacher_microcourse_scope(uuid, uuid) from public, anon, authenticated;
revoke all on function public.assert_teacher_microcourse_scope_manager(uuid) from public, anon, authenticated;
revoke all on function public.list_teacher_microcourse_scopes(uuid) from public, anon, authenticated;
revoke all on function public.set_teacher_microcourse_course_scopes(uuid, uuid[], uuid[], uuid[], uuid[], uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.list_teacher_microcourse_scopes(uuid) to authenticated;
grant execute on function public.set_teacher_microcourse_course_scopes(uuid, uuid[], uuid[], uuid[], uuid[], uuid[], uuid[]) to authenticated;

comment on table public.teacher_microcourse_course_scenes is
  'Many-to-many course/use-case links. There is deliberately no primary scene.';
comment on table public.teacher_microcourse_course_class_systems is
  'A system target dynamically includes present and future class types in that system.';
comment on table public.teacher_microcourse_course_class_types is
  'A concrete class-type target remains a stable leaf and does not expand automatically.';

notify pgrst, 'reload schema';
commit;
