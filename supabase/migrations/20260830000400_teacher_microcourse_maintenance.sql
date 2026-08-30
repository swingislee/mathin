begin;

-- DEV-TMC-4 Phase 4: stable course identity, course-level maintenance
-- directions, immutable published commits, and an audited default pointer.

create function public.normalize_teacher_microcourse_course_name(p_title text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select lower(regexp_replace(btrim(normalize(coalesce(p_title, ''), NFKC)), '[[:space:]]+', ' ', 'g'))
$$;

create table public.teacher_microcourse_catalog_courses (
  course_id uuid primary key references public.courses(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  course_family_id uuid not null references public.course_families(id) on delete restrict,
  normalized_name text not null check (char_length(normalized_name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  duplicate_of_course_id uuid references public.courses(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (duplicate_of_course_id is distinct from course_id)
);
create unique index teacher_microcourse_catalog_courses_canonical_name_idx
  on public.teacher_microcourse_catalog_courses(organization_id, course_family_id, normalized_name)
  where duplicate_of_course_id is null and archived_at is null;
create index teacher_microcourse_catalog_courses_duplicate_idx
  on public.teacher_microcourse_catalog_courses(duplicate_of_course_id)
  where duplicate_of_course_id is not null;

with candidates as (
  select organization_row.id as organization_id, course_row.family_id,
         course_row.id as course_id,
         public.normalize_teacher_microcourse_course_name(course_row.title) as normalized_name,
         coalesce(course_row.created_by, root.created_by) as created_by,
         row_number() over (
           partition by organization_row.id, course_row.family_id,
             public.normalize_teacher_microcourse_course_name(course_row.title)
           order by (root.course_id is not null) desc,
             (course_row.status = 'enabled') desc,
             (course_row.status = 'draft') desc,
             course_row.created_at, course_row.id
         ) as duplicate_rank,
         first_value(course_row.id) over (
           partition by organization_row.id, course_row.family_id,
             public.normalize_teacher_microcourse_course_name(course_row.title)
           order by (root.course_id is not null) desc,
             (course_row.status = 'enabled') desc,
             (course_row.status = 'draft') desc,
             course_row.created_at, course_row.id
         ) as canonical_course_id
  from public.courses course_row
  join public.course_families family on family.id = course_row.family_id
  cross join public.organizations organization_row
  left join public.teacher_microcourse_class_courses root on root.course_id = course_row.id
  where family.slug = 'teacher-microcourses'
    and course_row.course_kind = 'microcourse'
    and course_row.trashed_at is null
    and organization_row.singleton_key = 1
)
insert into public.teacher_microcourse_catalog_courses(
  course_id, organization_id, course_family_id, normalized_name,
  duplicate_of_course_id, created_by
)
select course_id, organization_id, family_id, normalized_name,
       case when duplicate_rank = 1 then null else canonical_course_id end,
       created_by
from candidates
where created_by is not null;

create table public.teacher_microcourse_maintenance_branches (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.teacher_microcourse_catalog_courses(course_id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  source_branch_id uuid references public.teacher_microcourse_maintenance_branches(id) on delete restrict,
  based_on_commit_id uuid,
  head_commit_id uuid,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index teacher_microcourse_personal_branch_unique
  on public.teacher_microcourse_maintenance_branches(course_id, owner_id)
  where status = 'active';
create index teacher_microcourse_branches_course_idx
  on public.teacher_microcourse_maintenance_branches(course_id, updated_at desc);

create table public.teacher_microcourse_branch_collaborators (
  branch_id uuid not null references public.teacher_microcourse_maintenance_branches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  role text not null default 'editor' check (role in ('owner', 'editor')),
  added_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (branch_id, user_id)
);

create table public.teacher_microcourse_branch_proposals (
  branch_id uuid not null references public.teacher_microcourse_maintenance_branches(id) on delete cascade,
  catalog_lecture_id uuid not null references public.course_lectures(id) on delete restrict,
  microcourse_id uuid not null references public.teacher_microcourses(id) on delete restrict,
  inherited boolean not null default false,
  linked_at timestamptz not null default now(),
  primary key (branch_id, catalog_lecture_id)
);

create table public.teacher_microcourse_course_commits (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.teacher_microcourse_catalog_courses(course_id) on delete restrict,
  branch_id uuid not null references public.teacher_microcourse_maintenance_branches(id) on delete restrict,
  commit_no integer not null check (commit_no > 0),
  message text not null check (char_length(btrim(message)) between 1 and 500),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'array'),
  release_count integer not null check (release_count > 0),
  status text not null default 'published' check (status = 'published'),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (course_id, commit_no)
);
create index teacher_microcourse_course_commits_branch_idx
  on public.teacher_microcourse_course_commits(branch_id, created_at desc);

alter table public.teacher_microcourse_maintenance_branches
  add constraint teacher_microcourse_branches_based_commit_fk
  foreign key (based_on_commit_id) references public.teacher_microcourse_course_commits(id) on delete restrict;
alter table public.teacher_microcourse_maintenance_branches
  add constraint teacher_microcourse_branches_head_commit_fk
  foreign key (head_commit_id) references public.teacher_microcourse_course_commits(id) on delete restrict;

create table public.teacher_microcourse_course_defaults (
  course_id uuid primary key references public.teacher_microcourse_catalog_courses(course_id) on delete restrict,
  commit_id uuid not null references public.teacher_microcourse_course_commits(id) on delete restrict,
  selected_by uuid not null references public.profiles(id) on delete restrict,
  selected_at timestamptz not null default now()
);

create table public.teacher_microcourse_default_history (
  id bigint generated always as identity primary key,
  course_id uuid not null references public.teacher_microcourse_catalog_courses(course_id) on delete restrict,
  previous_commit_id uuid references public.teacher_microcourse_course_commits(id) on delete restrict,
  commit_id uuid not null references public.teacher_microcourse_course_commits(id) on delete restrict,
  selected_by uuid not null references public.profiles(id) on delete restrict,
  reason text not null default '' check (char_length(reason) <= 500),
  selected_at timestamptz not null default now()
);
create index teacher_microcourse_default_history_course_idx
  on public.teacher_microcourse_default_history(course_id, selected_at desc);

alter table public.teacher_microcourse_catalog_courses enable row level security;
alter table public.teacher_microcourse_maintenance_branches enable row level security;
alter table public.teacher_microcourse_branch_collaborators enable row level security;
alter table public.teacher_microcourse_branch_proposals enable row level security;
alter table public.teacher_microcourse_course_commits enable row level security;
alter table public.teacher_microcourse_course_defaults enable row level security;
alter table public.teacher_microcourse_default_history enable row level security;
revoke all on table
  public.teacher_microcourse_catalog_courses,
  public.teacher_microcourse_maintenance_branches,
  public.teacher_microcourse_branch_collaborators,
  public.teacher_microcourse_branch_proposals,
  public.teacher_microcourse_course_commits,
  public.teacher_microcourse_course_defaults,
  public.teacher_microcourse_default_history
from public, anon, authenticated;

create function public.guard_teacher_microcourse_course_commit_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'TEACHER_MICROCOURSE_COMMIT_IMMUTABLE';
end;
$$;
create trigger teacher_microcourse_course_commits_immutable
before update or delete on public.teacher_microcourse_course_commits
for each row execute function public.guard_teacher_microcourse_course_commit_immutable();

create function public.can_manage_teacher_microcourse_branch(
  p_branch_id uuid,
  p_uid uuid default auth.uid()
)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p_uid is not null and (
    public.is_admin(p_uid)
    or public.has_perm(p_uid, 'course.manage')
    or exists (
      select 1 from public.teacher_microcourse_maintenance_branches branch
      where branch.id = p_branch_id and branch.status = 'active'
        and (
          branch.owner_id = p_uid
          or exists (
            select 1 from public.teacher_microcourse_branch_collaborators collaborator
            where collaborator.branch_id = branch.id
              and collaborator.user_id = p_uid
          )
        )
    )
  )
$$;

-- Existing proposal authors become one course-level maintenance direction.
insert into public.teacher_microcourse_maintenance_branches(
  course_id, name, owner_id, created_by
)
select registry.course_id,
       left(coalesce(profile.display_name, 'Teacher') || ' · maintenance', 120),
       microcourse.author_id, microcourse.author_id
from public.teacher_microcourse_catalog_courses registry
join public.teacher_microcourses microcourse on microcourse.course_id = registry.course_id
join public.profiles profile on profile.id = microcourse.author_id
where registry.duplicate_of_course_id is null
group by registry.course_id, microcourse.author_id, profile.display_name
on conflict do nothing;

insert into public.teacher_microcourse_branch_collaborators(branch_id, user_id, role, added_by)
select branch.id, branch.owner_id, 'owner', branch.created_by
from public.teacher_microcourse_maintenance_branches branch
on conflict do nothing;

insert into public.teacher_microcourse_branch_proposals(
  branch_id, catalog_lecture_id, microcourse_id
)
select distinct on (branch.id, class_lecture.lecture_id)
       branch.id, class_lecture.lecture_id, microcourse.id
from public.teacher_microcourse_maintenance_branches branch
join public.teacher_microcourses microcourse
  on microcourse.course_id = branch.course_id and microcourse.author_id = branch.owner_id
join public.teacher_microcourse_class_lectures class_lecture
  on class_lecture.source_session_id = microcourse.source_session_id
order by branch.id, class_lecture.lecture_id, microcourse.updated_at desc, microcourse.id
on conflict do nothing;

create function public.create_teacher_microcourse_catalog_course(
  p_course_family_id uuid,
  p_title text,
  p_description text default '',
  p_scene_ids uuid[] default '{}',
  p_grade_ids uuid[] default '{}',
  p_term_ids uuid[] default '{}',
  p_class_system_ids uuid[] default '{}',
  p_class_type_ids uuid[] default '{}'
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid(); v_organization_id uuid; catalog_version_id uuid;
  v_normalized_name text; existing_course_id uuid; new_course_id uuid;
  new_branch_id uuid; actor_name text;
begin
  if uid is null or not (
    public.is_admin(uid) or public.has_perm(uid, 'subject.microcourse.course.create')
  ) then raise exception 'FORBIDDEN'; end if;
  v_normalized_name := public.normalize_teacher_microcourse_course_name(p_title);
  if char_length(v_normalized_name) < 1 or char_length(v_normalized_name) > 120 then
    raise exception 'INVALID_COURSE_NAME';
  end if;
  if char_length(coalesce(p_description, '')) > 1000 then raise exception 'INVALID_DESCRIPTION'; end if;
  select organization_row.id into v_organization_id
  from public.organizations organization_row where organization_row.singleton_key = 1;
  select version.id into catalog_version_id
  from public.course_families family
  join public.course_catalog_versions version
    on version.family_id = family.id and version.is_current and version.status = 'enabled'
  where family.id = p_course_family_id
    and family.slug = 'teacher-microcourses' and family.status = 'enabled';
  if catalog_version_id is null then raise exception 'MICROCOURSE_FAMILY_MISSING'; end if;

  perform pg_advisory_xact_lock(hashtext(
    'teacher-microcourse-name:' || v_organization_id::text || ':' ||
    p_course_family_id::text || ':' || v_normalized_name
  ));
  select registry.course_id into existing_course_id
  from public.teacher_microcourse_catalog_courses registry
  where registry.organization_id = v_organization_id
    and registry.course_family_id = p_course_family_id
    and registry.normalized_name = v_normalized_name
    and registry.duplicate_of_course_id is null
    and registry.archived_at is null;
  if existing_course_id is not null then
    return jsonb_build_object('created', false, 'courseId', existing_course_id);
  end if;

  insert into public.courses(
    family_id, catalog_version_id, title, grade, term, class_type,
    status, purpose, course_kind, created_by
  ) values (
    p_course_family_id, catalog_version_id, btrim(normalize(p_title, NFKC)),
    1, null, '', 'draft', 'production', 'microcourse', uid
  ) returning id into new_course_id;
  insert into public.teacher_microcourse_catalog_courses(
    course_id, organization_id, course_family_id, normalized_name,
    description, created_by
  ) values (
    new_course_id, v_organization_id, p_course_family_id, v_normalized_name,
    coalesce(p_description, ''), uid
  );

  if exists (
    select 1 from unnest(coalesce(p_scene_ids, '{}')) requested(id)
    left join public.subject_microcourse_scenes scene
      on scene.id = requested.id and scene.course_family_id = p_course_family_id and scene.status = 'active'
    where scene.id is null
  ) then raise exception 'INVALID_SCENE_SCOPE'; end if;
  if exists (
    select 1 from unnest(coalesce(p_grade_ids, '{}')) requested(id)
    left join public.organization_academic_grades grade
      on grade.id = requested.id and grade.organization_id = v_organization_id and grade.active
    where grade.id is null
  ) then raise exception 'INVALID_GRADE_SCOPE'; end if;
  if exists (
    select 1 from unnest(coalesce(p_term_ids, '{}')) requested(id)
    left join public.organization_academic_terms term
      on term.id = requested.id and term.organization_id = v_organization_id and term.active
    where term.id is null
  ) then raise exception 'INVALID_TERM_SCOPE'; end if;
  if exists (
    select 1 from unnest(coalesce(p_class_system_ids, '{}')) requested(id)
    left join public.organization_class_systems system
      on system.id = requested.id and system.organization_id = v_organization_id and system.active
    where system.id is null
  ) then raise exception 'INVALID_CLASS_SYSTEM_SCOPE'; end if;
  if exists (
    select 1 from unnest(coalesce(p_class_type_ids, '{}')) requested(id)
    left join public.organization_class_types class_type
      on class_type.id = requested.id and class_type.organization_id = v_organization_id and class_type.active
    where class_type.id is null
  ) then raise exception 'INVALID_CLASS_TYPE_SCOPE'; end if;

  insert into public.teacher_microcourse_course_scenes(course_id, scene_id, created_by)
    select new_course_id, id, uid from (select distinct unnest(coalesce(p_scene_ids, '{}')) id) requested;
  insert into public.teacher_microcourse_course_grades(course_id, grade_id, created_by)
    select new_course_id, id, uid from (select distinct unnest(coalesce(p_grade_ids, '{}')) id) requested;
  insert into public.teacher_microcourse_course_terms(course_id, term_id, created_by)
    select new_course_id, id, uid from (select distinct unnest(coalesce(p_term_ids, '{}')) id) requested;
  insert into public.teacher_microcourse_course_class_systems(course_id, class_system_id, created_by)
    select new_course_id, id, uid from (select distinct unnest(coalesce(p_class_system_ids, '{}')) id) requested;
  insert into public.teacher_microcourse_course_class_types(course_id, class_type_id, created_by)
    select new_course_id, id, uid from (select distinct unnest(coalesce(p_class_type_ids, '{}')) id) requested;

  select profile.display_name into actor_name from public.profiles profile where profile.id = uid;
  insert into public.teacher_microcourse_maintenance_branches(
    course_id, name, owner_id, created_by
  ) values (
    new_course_id, left(coalesce(actor_name, 'Teacher') || ' · maintenance', 120), uid, uid
  ) returning id into new_branch_id;
  insert into public.teacher_microcourse_branch_collaborators(branch_id, user_id, role, added_by)
  values (new_branch_id, uid, 'owner', uid);
  perform public.emit_domain_event(
    'teacher_microcourse.course_created', 'course', new_course_id,
    jsonb_build_object('courseFamilyId', p_course_family_id, 'branchId', new_branch_id), null, null
  );
  return jsonb_build_object('created', true, 'courseId', new_course_id, 'branchId', new_branch_id);
end;
$$;

create function public.add_teacher_microcourse_catalog_lecture(
  p_course_id uuid,
  p_name text,
  p_objectives text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); next_no smallint; new_lecture_id uuid;
begin
  if uid is null or char_length(btrim(p_name)) not between 1 and 120
     or char_length(coalesce(p_objectives, '')) > 1000 then
    raise exception 'VALIDATION';
  end if;
  if not exists (
    select 1 from public.teacher_microcourse_catalog_courses registry
    where registry.course_id = p_course_id and registry.duplicate_of_course_id is null
      and registry.archived_at is null
      and (
        registry.created_by = uid or public.is_admin(uid) or public.has_perm(uid, 'course.manage')
        or exists (
          select 1 from public.teacher_microcourse_maintenance_branches branch
          where branch.course_id = p_course_id and branch.owner_id = uid and branch.status = 'active'
        )
      )
  ) then raise exception 'FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtext('teacher-microcourse-lectures:' || p_course_id::text));
  select (coalesce(max(lecture.no), 0) + 1)::smallint into next_no
  from public.course_lectures lecture where lecture.course_id = p_course_id;
  if next_no > 999 then raise exception 'LECTURE_LIMIT'; end if;
  insert into public.course_lectures(course_id, no, name, objectives, status)
  values (p_course_id, next_no, btrim(p_name), coalesce(p_objectives, ''), 'draft')
  returning id into new_lecture_id;
  perform public.emit_domain_event(
    'teacher_microcourse.lecture_added', 'course_lecture', new_lecture_id,
    jsonb_build_object('courseId', p_course_id, 'lectureNo', next_no), null, null
  );
  return new_lecture_id;
end;
$$;

create function public.create_teacher_microcourse_maintenance_branch(
  p_course_id uuid,
  p_name text
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); existing_branch_id uuid; new_branch_id uuid;
  source_branch_id uuid; base_commit_id uuid;
begin
  if uid is null or not (
    public.is_admin(uid) or public.has_perm(uid, 'subject.microcourse.branch.create')
  ) then raise exception 'FORBIDDEN'; end if;
  if char_length(btrim(p_name)) not between 1 and 120 then raise exception 'VALIDATION'; end if;
  if not public.can_read_teacher_microcourse_catalog_course(p_course_id, uid) then raise exception 'FORBIDDEN'; end if;
  select branch.id into existing_branch_id
  from public.teacher_microcourse_maintenance_branches branch
  where branch.course_id = p_course_id and branch.owner_id = uid and branch.status = 'active';
  if existing_branch_id is not null then
    return jsonb_build_object('created', false, 'branchId', existing_branch_id);
  end if;
  select defaults.commit_id, commit.branch_id into base_commit_id, source_branch_id
  from public.teacher_microcourse_course_defaults defaults
  join public.teacher_microcourse_course_commits commit on commit.id = defaults.commit_id
  where defaults.course_id = p_course_id;
  insert into public.teacher_microcourse_maintenance_branches(
    course_id, name, owner_id, source_branch_id, based_on_commit_id, created_by
  ) values (
    p_course_id, btrim(p_name), uid, source_branch_id, base_commit_id, uid
  ) returning id into new_branch_id;
  insert into public.teacher_microcourse_branch_collaborators(branch_id, user_id, role, added_by)
  values (new_branch_id, uid, 'owner', uid);
  if base_commit_id is not null then
    insert into public.teacher_microcourse_branch_proposals(
      branch_id, catalog_lecture_id, microcourse_id, inherited
    )
    select new_branch_id, (item->>'lectureId')::uuid, (item->>'microcourseId')::uuid, true
    from public.teacher_microcourse_course_commits commit
    cross join lateral jsonb_array_elements(commit.manifest) item
    where commit.id = base_commit_id and item ? 'microcourseId';
  end if;
  perform public.emit_domain_event(
    'teacher_microcourse.branch_created', 'teacher_microcourse_branch', new_branch_id,
    jsonb_build_object('courseId', p_course_id, 'basedOnCommitId', base_commit_id), null, null
  );
  return jsonb_build_object('created', true, 'branchId', new_branch_id);
end;
$$;

create function public.apply_teacher_microcourse_default_commit(
  p_commit_id uuid,
  p_uid uuid,
  p_reason text default ''
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare commit_row public.teacher_microcourse_course_commits%rowtype;
  previous_commit_id uuid;
begin
  select * into commit_row from public.teacher_microcourse_course_commits
  where id = p_commit_id and status = 'published';
  if not found then raise exception 'PUBLISHED_COMMIT_REQUIRED'; end if;
  select defaults.commit_id into previous_commit_id
  from public.teacher_microcourse_course_defaults defaults
  where defaults.course_id = commit_row.course_id for update;
  insert into public.teacher_microcourse_course_defaults(course_id, commit_id, selected_by)
  values (commit_row.course_id, commit_row.id, p_uid)
  on conflict(course_id) do update set
    commit_id = excluded.commit_id, selected_by = excluded.selected_by, selected_at = now();
  insert into public.teacher_microcourse_default_history(
    course_id, previous_commit_id, commit_id, selected_by, reason
  ) values (
    commit_row.course_id, previous_commit_id, commit_row.id, p_uid, coalesce(p_reason, '')
  );
  update public.course_lectures lecture
  set current_release_id = (item->>'releaseId')::uuid,
      name = coalesce(metadata.title, lecture.name),
      objectives = coalesce(metadata.description, lecture.objectives),
      status = 'active'
  from jsonb_array_elements(commit_row.manifest) item
  left join public.teacher_microcourse_catalog_releases catalog_release
    on catalog_release.release_id = (item->>'releaseId')::uuid
  left join public.teacher_microcourse_metadata_revisions metadata
    on metadata.id = catalog_release.metadata_revision_id
  where lecture.id = (item->>'lectureId')::uuid
    and lecture.course_id = commit_row.course_id;
  update public.courses set status = 'enabled', updated_at = now()
  where id = commit_row.course_id;
end;
$$;

create function public.commit_teacher_microcourse_maintenance_branch(
  p_branch_id uuid,
  p_message text
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); branch_row public.teacher_microcourse_maintenance_branches%rowtype;
  manifest jsonb; lecture_count integer; release_count integer; next_commit_no integer;
  new_commit_id uuid; has_default boolean;
begin
  if uid is null or not public.has_perm(uid, 'subject.microcourse.commit.create')
     or not public.can_manage_teacher_microcourse_branch(p_branch_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  if char_length(btrim(p_message)) not between 1 and 500 then raise exception 'VALIDATION'; end if;
  select * into branch_row from public.teacher_microcourse_maintenance_branches
  where id = p_branch_id and status = 'active' for update;
  if not found then raise exception 'BRANCH_NOT_FOUND'; end if;
  select count(*)::integer into lecture_count
  from public.course_lectures lecture
  where lecture.course_id = branch_row.course_id and lecture.archived_at is null;
  select coalesce(jsonb_agg(jsonb_build_object(
      'lectureId', selected.catalog_lecture_id,
      'releaseId', selected.release_id,
      'releaseNo', selected.release_no,
      'microcourseId', selected.microcourse_id,
      'metadataRevisionId', selected.metadata_revision_id
    ) order by selected.lecture_no), '[]'::jsonb), count(*)::integer
  into manifest, release_count
  from (
    select distinct on (lecture.id)
      lecture.id as catalog_lecture_id, lecture.no as lecture_no,
      catalog_release.release_id, release.release_no,
      catalog_release.microcourse_id, catalog_release.metadata_revision_id
    from public.course_lectures lecture
    join public.teacher_microcourse_branch_proposals proposal
      on proposal.branch_id = branch_row.id and proposal.catalog_lecture_id = lecture.id
    join public.teacher_microcourses microcourse
      on microcourse.id = proposal.microcourse_id and microcourse.withdrawn_at is null
    join public.teacher_microcourse_catalog_releases catalog_release
      on catalog_release.microcourse_id = microcourse.id
       and catalog_release.catalog_lecture_id = lecture.id
    join public.cw_lecture_releases release on release.id = catalog_release.release_id
    where lecture.course_id = branch_row.course_id and lecture.archived_at is null
      and release.track = 'native-16x9'
    order by lecture.id, release.release_no desc, release.id
  ) selected;
  if lecture_count = 0 or release_count <> lecture_count then
    raise exception 'ALL_LECTURES_REQUIRE_PUBLISHED_RELEASES';
  end if;
  perform pg_advisory_xact_lock(hashtext('teacher-microcourse-commits:' || branch_row.course_id::text));
  select coalesce(max(commit.commit_no), 0) + 1 into next_commit_no
  from public.teacher_microcourse_course_commits commit where commit.course_id = branch_row.course_id;
  insert into public.teacher_microcourse_course_commits(
    course_id, branch_id, commit_no, message, manifest, release_count, created_by
  ) values (
    branch_row.course_id, branch_row.id, next_commit_no, btrim(p_message), manifest, release_count, uid
  ) returning id into new_commit_id;
  update public.teacher_microcourse_maintenance_branches
  set head_commit_id = new_commit_id, updated_at = now()
  where id = branch_row.id;
  select exists (
    select 1 from public.teacher_microcourse_course_defaults defaults
    where defaults.course_id = branch_row.course_id
  ) into has_default;
  if not has_default then
    perform public.apply_teacher_microcourse_default_commit(new_commit_id, uid, 'first published commit');
  end if;
  perform public.emit_domain_event(
    'teacher_microcourse.course_committed', 'teacher_microcourse_commit', new_commit_id,
    jsonb_build_object('courseId', branch_row.course_id, 'branchId', branch_row.id, 'commitNo', next_commit_no), null, null
  );
  return new_commit_id;
end;
$$;

create function public.select_teacher_microcourse_default_commit(
  p_course_id uuid,
  p_commit_id uuid,
  p_reason text default ''
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); family_id uuid;
begin
  select registry.course_family_id into family_id
  from public.teacher_microcourse_catalog_courses registry
  where registry.course_id = p_course_id and registry.duplicate_of_course_id is null;
  if uid is null or family_id is null or not (
    public.is_admin(uid)
    or (
      public.has_perm(uid, 'subject.microcourse.default.select')
      and exists (
        select 1 from public.teacher_microcourse_subject_managers manager
        where manager.course_family_id = family_id and manager.user_id = uid
      )
    )
  ) then raise exception 'FORBIDDEN'; end if;
  if not exists (
    select 1 from public.teacher_microcourse_course_commits commit
    where commit.id = p_commit_id and commit.course_id = p_course_id and commit.status = 'published'
  ) then raise exception 'PUBLISHED_COMMIT_REQUIRED'; end if;
  perform public.apply_teacher_microcourse_default_commit(p_commit_id, uid, p_reason);
  perform public.emit_domain_event(
    'teacher_microcourse.default_selected', 'course', p_course_id,
    jsonb_build_object('commitId', p_commit_id, 'reason', coalesce(p_reason, '')), null, null
  );
end;
$$;

create function public.get_teacher_microcourse_catalog_course(p_course_id uuid)
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
    'course', jsonb_build_object(
      'id', course_row.id, 'familyId', course_row.family_id, 'title', course_row.title,
      'description', registry.description, 'status', course_row.status,
      'createdBy', registry.created_by, 'createdByName', creator.display_name,
      'updatedAt', greatest(course_row.updated_at, registry.updated_at),
      'defaultCommitId', defaults.commit_id
    ),
    'lectures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', lecture.id, 'no', lecture.no, 'name', lecture.name,
        'objectives', lecture.objectives, 'status', lecture.status,
        'currentReleaseId', lecture.current_release_id,
        'releaseNo', release.release_no,
        'pageCount', coalesce(jsonb_array_length(release.snapshot), 0)
      ) order by lecture.no, lecture.id)
      from public.course_lectures lecture
      left join public.cw_lecture_releases release on release.id = lecture.current_release_id
      where lecture.course_id = course_row.id and lecture.archived_at is null
    ), '[]'::jsonb),
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', branch.id, 'name', branch.name, 'ownerId', branch.owner_id,
        'ownerName', owner.display_name, 'status', branch.status,
        'sourceBranchId', branch.source_branch_id,
        'basedOnCommitId', branch.based_on_commit_id,
        'headCommitId', branch.head_commit_id,
        'proposalCount', (select count(*) from public.teacher_microcourse_branch_proposals proposal where proposal.branch_id = branch.id),
        'canManage', public.can_manage_teacher_microcourse_branch(branch.id, uid),
        'createdAt', branch.created_at, 'updatedAt', branch.updated_at
      ) order by branch.updated_at desc, branch.id)
      from public.teacher_microcourse_maintenance_branches branch
      join public.profiles owner on owner.id = branch.owner_id
      where branch.course_id = course_row.id
    ), '[]'::jsonb),
    'commits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', commit.id, 'branchId', commit.branch_id,
        'branchName', branch.name, 'commitNo', commit.commit_no,
        'message', commit.message, 'releaseCount', commit.release_count,
        'status', commit.status, 'createdBy', commit.created_by,
        'createdByName', author.display_name, 'createdAt', commit.created_at,
        'isDefault', defaults.commit_id = commit.id
      ) order by commit.commit_no desc)
      from public.teacher_microcourse_course_commits commit
      join public.teacher_microcourse_maintenance_branches branch on branch.id = commit.branch_id
      join public.profiles author on author.id = commit.created_by
      where commit.course_id = course_row.id
    ), '[]'::jsonb),
    'capabilities', jsonb_build_object(
      'canAddLecture', registry.created_by = uid or public.is_admin(uid) or public.has_perm(uid, 'course.manage'),
      'canCreateBranch', public.is_admin(uid) or public.has_perm(uid, 'subject.microcourse.branch.create'),
      'canCommit', public.is_admin(uid) or public.has_perm(uid, 'subject.microcourse.commit.create'),
      'canSelectDefault', public.is_admin(uid) or (
        public.has_perm(uid, 'subject.microcourse.default.select') and exists (
          select 1 from public.teacher_microcourse_subject_managers manager
          where manager.course_family_id = course_row.family_id and manager.user_id = uid
        )
      )
    )
  ) into result
  from public.teacher_microcourse_catalog_courses registry
  join public.courses course_row on course_row.id = registry.course_id
  join public.profiles creator on creator.id = registry.created_by
  left join public.teacher_microcourse_course_defaults defaults on defaults.course_id = course_row.id
  where registry.course_id = p_course_id and registry.duplicate_of_course_id is null
    and registry.archived_at is null;
  if result is null then raise exception 'COURSE_NOT_FOUND'; end if;
  return result;
end;
$$;

-- The browser reads the stable catalog registry. Historical duplicate rows are
-- retained for explicit manager reconciliation but no longer appear twice.
create or replace function public.can_read_teacher_microcourse_catalog_course(
  p_course_id uuid,
  p_uid uuid default auth.uid()
)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p_uid is not null and exists (
    select 1
    from public.teacher_microcourse_catalog_courses registry
    join public.courses course_row on course_row.id = registry.course_id
    where registry.course_id = p_course_id
      and registry.duplicate_of_course_id is null and registry.archived_at is null
      and course_row.course_kind = 'microcourse' and course_row.trashed_at is null
      and (
        course_row.status = 'enabled'
        or public.has_perm(p_uid, 'course.manage')
        or registry.created_by = p_uid
        or exists (
          select 1 from public.teacher_microcourse_maintenance_branches branch
          where branch.course_id = course_row.id and branch.owner_id = p_uid and branch.status = 'active'
        )
        or exists (
          select 1 from public.teacher_microcourses proposal
          where proposal.course_id = course_row.id and proposal.author_id = p_uid
        )
      )
  )
$$;

create or replace function public.list_teacher_microcourse_browser_catalog(p_course_family_id uuid)
returns table (
  course_id uuid, course_title text, author_name text, updated_at timestamptz,
  lecture_titles text[], lecture_count integer, released_lecture_count integer,
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
  select course_row.id, course_row.title, creator.display_name,
         greatest(registry.updated_at, course_row.updated_at),
         coalesce(lecture_data.titles, '{}'::text[]),
         coalesce(lecture_data.lecture_count, 0),
         coalesce(lecture_data.released_lecture_count, 0),
         concat_ws(' ', course_row.title, creator.display_name, lecture_data.search_text)
  from public.teacher_microcourse_catalog_courses registry
  join public.courses course_row on course_row.id = registry.course_id
  join public.profiles creator on creator.id = registry.created_by
  left join lateral (
    select array_agg(lecture.name order by lecture.no, lecture.id) as titles,
           count(*)::integer as lecture_count,
           count(*) filter (where lecture.current_release_id is not null)::integer as released_lecture_count,
           string_agg(concat_ws(' ', lecture.name, lecture.objectives), ' ' order by lecture.no, lecture.id) as search_text
    from public.course_lectures lecture
    where lecture.course_id = course_row.id and lecture.archived_at is null
  ) lecture_data on true
  where registry.course_family_id = p_course_family_id
    and registry.duplicate_of_course_id is null and registry.archived_at is null
    and public.can_read_teacher_microcourse_catalog_course(course_row.id, uid)
  order by greatest(registry.updated_at, course_row.updated_at) desc, course_row.title, course_row.id;
end;
$$;

revoke all on function public.normalize_teacher_microcourse_course_name(text) from public, anon, authenticated;
revoke all on function public.can_manage_teacher_microcourse_branch(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_teacher_microcourse_catalog_course(uuid, text, text, uuid[], uuid[], uuid[], uuid[], uuid[]) from public, anon, authenticated;
revoke all on function public.add_teacher_microcourse_catalog_lecture(uuid, text, text) from public, anon, authenticated;
revoke all on function public.create_teacher_microcourse_maintenance_branch(uuid, text) from public, anon, authenticated;
revoke all on function public.apply_teacher_microcourse_default_commit(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.commit_teacher_microcourse_maintenance_branch(uuid, text) from public, anon, authenticated;
revoke all on function public.select_teacher_microcourse_default_commit(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.get_teacher_microcourse_catalog_course(uuid) from public, anon, authenticated;
grant execute on function public.create_teacher_microcourse_catalog_course(uuid, text, text, uuid[], uuid[], uuid[], uuid[], uuid[]) to authenticated;
grant execute on function public.add_teacher_microcourse_catalog_lecture(uuid, text, text) to authenticated;
grant execute on function public.create_teacher_microcourse_maintenance_branch(uuid, text) to authenticated;
grant execute on function public.commit_teacher_microcourse_maintenance_branch(uuid, text) to authenticated;
grant execute on function public.select_teacher_microcourse_default_commit(uuid, uuid, text) to authenticated;
grant execute on function public.get_teacher_microcourse_catalog_course(uuid) to authenticated;

comment on table public.teacher_microcourse_catalog_courses is
  'Stable course identity registry. Normalized duplicate names resolve to one canonical course without deleting historical rows.';
comment on table public.teacher_microcourse_maintenance_branches is
  'Course-language maintenance directions; autosave remains in proposal drafts and does not create commits.';
comment on table public.teacher_microcourse_course_commits is
  'Immutable course-level manifests of already-published lecture releases.';
comment on table public.teacher_microcourse_course_defaults is
  'Current default commit for new browsing and future use; frozen classroom snapshots are unchanged.';

notify pgrst, 'reload schema';
commit;
