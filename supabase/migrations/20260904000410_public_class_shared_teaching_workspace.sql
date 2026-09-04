-- DEV-SCHOOL-OPS-1 / public classes reuse the formal teaching-preparation UI.
-- The presentation layer is shared; this table is only the event-segment
-- persistence adapter for preparation artifacts and the BlockNote lesson plan.

begin;

create table public.public_class_segment_preparations (
  segment_id uuid primary key
    references public.public_class_segments(id) on delete cascade,
  solution_notes text not null default '',
  solution_files jsonb not null default '[]'::jsonb,
  lesson_plan_files jsonb not null default '[]'::jsonb,
  rehearsal_video_url text not null default '',
  lesson_plan_id uuid not null default gen_random_uuid(),
  lesson_plan_template_version text not null default 'mathin-teaching-plan-v1',
  lesson_plan_content jsonb not null default '[]'::jsonb,
  lesson_plan_revision integer not null default 0 check (lesson_plan_revision >= 0),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint public_class_prep_solution_files_cap check (
    jsonb_typeof(solution_files) = 'array'
    and jsonb_array_length(solution_files) <= 10
    and octet_length(solution_files::text) <= 32768
  ),
  constraint public_class_prep_lesson_files_cap check (
    jsonb_typeof(lesson_plan_files) = 'array'
    and jsonb_array_length(lesson_plan_files) <= 10
    and octet_length(lesson_plan_files::text) <= 32768
  ),
  constraint public_class_prep_notes_cap check (length(solution_notes) <= 5000),
  constraint public_class_prep_rehearsal_url_cap check (length(rehearsal_video_url) <= 1000),
  constraint public_class_lesson_plan_template_check check (
    lesson_plan_template_version = 'mathin-teaching-plan-v1'
  ),
  constraint public_class_lesson_plan_content_check check (
    jsonb_typeof(lesson_plan_content) = 'array'
    and octet_length(lesson_plan_content::text) <= 524288
  )
);

alter table public.public_class_segment_preparations enable row level security;

create policy public_class_segment_preparations_select_scope
  on public.public_class_segment_preparations for select to authenticated
  using (public.can_teach_public_class_segment(segment_id, (select auth.uid())));

revoke all on public.public_class_segment_preparations from public, anon, authenticated;
grant select on public.public_class_segment_preparations to authenticated;

create function public.validate_public_class_prep_artifact_files(
  p_segment_id uuid,
  p_kind text,
  p_files jsonb
)
returns jsonb
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  item jsonb;
begin
  if p_kind not in ('solution', 'lesson-plan')
     or jsonb_typeof(p_files) <> 'array'
     or jsonb_array_length(p_files) > 10
     or octet_length(p_files::text) > 32768 then
    raise exception 'VALIDATION';
  end if;
  for item in select value from jsonb_array_elements(p_files)
  loop
    if jsonb_typeof(item) <> 'object'
       or coalesce(item ->> 'path', '') not like p_segment_id::text || '/' || p_kind || '/%'
       or length(coalesce(item ->> 'path', '')) > 500
       or length(coalesce(item ->> 'name', '')) not between 1 and 200
       or coalesce(item ->> 'size', '') !~ '^[0-9]+$'
       or (item ->> 'size')::bigint > 12582912 then
      raise exception 'VALIDATION';
    end if;
  end loop;
  return p_files;
end;
$$;

create function public.save_public_class_preparation_artifacts(
  p_segment_id uuid,
  p_solution_notes text,
  p_solution_files jsonb,
  p_lesson_plan_files jsonb,
  p_rehearsal_video_url text
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_segment public.public_class_segments%rowtype;
begin
  select * into v_segment
  from public.public_class_segments segment
  where segment.id = p_segment_id
  for update;
  if not found then raise exception 'PUBLIC_CLASS_SEGMENT_NOT_FOUND'; end if;
  if not public.can_teach_public_class_segment(p_segment_id, v_uid) then
    raise exception 'FORBIDDEN';
  end if;
  if v_segment.kind = 'group_assessment' then raise exception 'INVALID_PUBLIC_CLASS_SEGMENT'; end if;
  if v_segment.teaching_started_at is not null then raise exception 'PUBLIC_CLASS_PREPARATION_LOCKED'; end if;
  if length(coalesce(p_solution_notes, '')) > 5000
     or length(coalesce(p_rehearsal_video_url, '')) > 1000
     or (
       btrim(coalesce(p_rehearsal_video_url, '')) <> ''
       and btrim(p_rehearsal_video_url) !~* '^https://'
     ) then raise exception 'VALIDATION';
  end if;

  insert into public.public_class_segment_preparations(
    segment_id,
    solution_notes,
    solution_files,
    lesson_plan_files,
    rehearsal_video_url,
    updated_by
  ) values (
    p_segment_id,
    left(btrim(coalesce(p_solution_notes, '')), 5000),
    public.validate_public_class_prep_artifact_files(
      p_segment_id, 'solution', coalesce(p_solution_files, '[]'::jsonb)
    ),
    public.validate_public_class_prep_artifact_files(
      p_segment_id, 'lesson-plan', coalesce(p_lesson_plan_files, '[]'::jsonb)
    ),
    left(btrim(coalesce(p_rehearsal_video_url, '')), 1000),
    v_uid
  )
  on conflict (segment_id) do update set
    solution_notes = excluded.solution_notes,
    solution_files = excluded.solution_files,
    lesson_plan_files = excluded.lesson_plan_files,
    rehearsal_video_url = excluded.rehearsal_video_url,
    updated_by = v_uid,
    updated_at = now();
end;
$$;

create function public.save_public_class_lesson_plan(
  p_segment_id uuid,
  p_template_version text,
  p_content jsonb,
  p_base_revision integer default 0
)
returns table(lesson_plan_id uuid, revision integer, status text, updated_at timestamptz)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_segment public.public_class_segments%rowtype;
  v_current public.public_class_segment_preparations%rowtype;
begin
  select * into v_segment
  from public.public_class_segments segment
  where segment.id = p_segment_id
  for update;
  if not found then raise exception 'PUBLIC_CLASS_SEGMENT_NOT_FOUND'; end if;
  if not public.can_teach_public_class_segment(p_segment_id, v_uid) then
    raise exception 'FORBIDDEN';
  end if;
  if v_segment.kind = 'group_assessment' then raise exception 'INVALID_PUBLIC_CLASS_SEGMENT'; end if;
  if v_segment.teaching_started_at is not null then raise exception 'PUBLIC_CLASS_PREPARATION_LOCKED'; end if;
  if coalesce(p_template_version, '') <> 'mathin-teaching-plan-v1'
     or jsonb_typeof(p_content) <> 'array'
     or octet_length(p_content::text) > 524288 then
    raise exception 'VALIDATION';
  end if;

  select * into v_current
  from public.public_class_segment_preparations preparation
  where preparation.segment_id = p_segment_id
  for update;
  if found and v_current.lesson_plan_revision <> p_base_revision then
    raise exception 'VERSION_CONFLICT';
  end if;
  if not found and p_base_revision <> 0 then raise exception 'VERSION_CONFLICT'; end if;

  insert into public.public_class_segment_preparations(
    segment_id,
    lesson_plan_template_version,
    lesson_plan_content,
    lesson_plan_revision,
    updated_by
  ) values (
    p_segment_id,
    p_template_version,
    p_content,
    1,
    v_uid
  )
  on conflict (segment_id) do update set
    lesson_plan_template_version = excluded.lesson_plan_template_version,
    lesson_plan_content = excluded.lesson_plan_content,
    lesson_plan_revision = public.public_class_segment_preparations.lesson_plan_revision + 1,
    updated_by = v_uid,
    updated_at = now()
  returning public.public_class_segment_preparations.lesson_plan_id,
            public.public_class_segment_preparations.lesson_plan_revision,
            'draft'::text,
            public.public_class_segment_preparations.updated_at
    into lesson_plan_id, revision, status, updated_at;
  return next;
end;
$$;

-- The same creation form used by formal-class microcourses supplies the public
-- segment adapter with complete metadata instead of dropping most fields.
create function public.create_public_class_microcourse_draft(
  p_segment_id uuid,
  p_variant_name text,
  p_title text,
  p_description text,
  p_grade smallint,
  p_course_season smallint,
  p_class_type text,
  p_primary_topic_slug text,
  p_keywords text[]
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_microcourse_id uuid;
  v_course_id uuid;
  v_topic_id uuid;
begin
  v_topic_id := public.assert_teacher_microcourse_metadata(
    p_title,
    p_description,
    p_grade,
    p_course_season,
    p_class_type,
    p_primary_topic_slug,
    coalesce(p_keywords, '{}'::text[])
  );
  if char_length(btrim(coalesce(p_variant_name, ''))) not between 1 and 120 then
    raise exception 'VALIDATION';
  end if;

  v_result := public.create_public_class_microcourse_project(
    p_segment_id,
    p_title,
    p_title,
    p_grade
  );
  v_microcourse_id := (v_result ->> 'microcourseId')::uuid;
  v_course_id := (v_result ->> 'courseId')::uuid;

  update public.courses
  set term = p_course_season,
      class_type = btrim(coalesce(p_class_type, ''))
  where id = v_course_id;
  update public.teacher_microcourse_catalog_courses
  set description = left(btrim(coalesce(p_description, '')), 2000)
  where course_id = v_course_id;
  update public.teacher_microcourses
  set variant_name = btrim(p_variant_name)
  where id = v_microcourse_id;
  update public.teacher_microcourse_metadata_revisions
  set title = btrim(p_title),
      description = left(btrim(coalesce(p_description, '')), 2000),
      course_season = p_course_season,
      class_type = btrim(coalesce(p_class_type, '')),
      primary_topic_id = v_topic_id,
      keywords = coalesce(p_keywords, '{}'::text[])
  where microcourse_id = v_microcourse_id
    and revision_no = 1;
  return v_result;
end;
$$;

drop policy if exists prep_artifacts_storage_insert on storage.objects;
create policy prep_artifacts_storage_insert on storage.objects
for insert to authenticated with check (
  bucket_id = 'prep-artifacts'
  and cardinality(storage.foldername(name)) >= 2
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[2] in ('solution', 'lesson-plan')
  and (
    public.is_session_teacher((storage.foldername(name))[1]::uuid, (select auth.uid()))
    or public.can_teach_public_class_segment((storage.foldername(name))[1]::uuid, (select auth.uid()))
  )
);

drop policy if exists prep_artifacts_storage_select on storage.objects;
create policy prep_artifacts_storage_select on storage.objects
for select to authenticated using (
  bucket_id = 'prep-artifacts'
  and cardinality(storage.foldername(name)) >= 2
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and (
    public.is_session_teacher((storage.foldername(name))[1]::uuid, (select auth.uid()))
    or public.can_review_session_preparation((storage.foldername(name))[1]::uuid, (select auth.uid()))
    or public.can_teach_public_class_segment((storage.foldername(name))[1]::uuid, (select auth.uid()))
  )
);

drop policy if exists prep_artifacts_storage_delete on storage.objects;
create policy prep_artifacts_storage_delete on storage.objects
for delete to authenticated using (
  bucket_id = 'prep-artifacts'
  and cardinality(storage.foldername(name)) >= 2
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and (
    public.is_session_teacher((storage.foldername(name))[1]::uuid, (select auth.uid()))
    or public.can_teach_public_class_segment((storage.foldername(name))[1]::uuid, (select auth.uid()))
  )
);

revoke all on function public.validate_public_class_prep_artifact_files(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.save_public_class_preparation_artifacts(uuid, text, jsonb, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.save_public_class_lesson_plan(uuid, text, jsonb, integer)
  from public, anon, authenticated;
revoke all on function public.create_public_class_microcourse_draft(uuid, text, text, text, smallint, smallint, text, text, text[])
  from public, anon, authenticated;
grant execute on function public.save_public_class_preparation_artifacts(uuid, text, jsonb, jsonb, text)
  to authenticated;
grant execute on function public.save_public_class_lesson_plan(uuid, text, jsonb, integer)
  to authenticated;
grant execute on function public.create_public_class_microcourse_draft(uuid, text, text, text, smallint, smallint, text, text, text[])
  to authenticated;

comment on table public.public_class_segment_preparations is
  'Event-segment persistence adapter for the shared formal/public teaching preparation workbench.';

notify pgrst, 'reload schema';

commit;
