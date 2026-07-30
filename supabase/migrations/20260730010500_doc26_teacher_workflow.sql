-- doc 26: session-scoped lesson plans, page notes, vector annotations, and
-- unified solution records. Existing preparation review rows remain the
-- authoritative approval queue for solution / lesson_plan / rehearsal_video.

begin;

create table public.lesson_plans (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.class_sessions(id) on delete cascade,
  template_version text not null default 'mathin-teaching-plan-v1',
  content jsonb not null default '[]'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'approved', 'changes_requested')),
  revision integer not null default 0 check (revision >= 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lesson_plans_template_version_check check (template_version = 'mathin-teaching-plan-v1'),
  constraint lesson_plans_content_shape check (
    jsonb_typeof(content) = 'array' and octet_length(content::text) <= 524288
  )
);

create table public.lesson_page_notes (
  id uuid primary key default gen_random_uuid(),
  lesson_plan_id uuid not null references public.lesson_plans(id) on delete cascade,
  page_doc_id uuid not null references public.cw_page_docs(id) on delete restrict,
  content text not null default '' check (length(content) <= 5000),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_plan_id, page_doc_id)
);

create table public.courseware_annotations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  page_doc_id uuid not null references public.cw_page_docs(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  annotation_type text not null default 'board' check (annotation_type = 'board'),
  content jsonb not null default '[]'::jsonb,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, page_doc_id, user_id, annotation_type),
  constraint courseware_annotations_content_shape check (
    jsonb_typeof(content) = 'array' and octet_length(content::text) <= 2097152
  )
);

create table public.solution_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  solution_source text not null check (solution_source in ('upload', 'board')),
  annotation_id uuid references public.courseware_annotations(id) on delete restrict,
  page_doc_id uuid references public.cw_page_docs(id) on delete restrict,
  content jsonb not null,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint solution_records_content_shape check (
    jsonb_typeof(content) = 'object' and octet_length(content::text) <= 4194304
  ),
  constraint solution_records_source_shape check (
    (solution_source = 'upload' and annotation_id is null and page_doc_id is null)
    or (solution_source = 'board' and annotation_id is not null and page_doc_id is not null)
  )
);

create unique index solution_records_upload_unique
  on public.solution_records(session_id) where solution_source = 'upload';
create unique index solution_records_board_unique
  on public.solution_records(annotation_id) where solution_source = 'board';
create index courseware_annotations_session_page_idx
  on public.courseware_annotations(session_id, page_doc_id, updated_at desc);

-- Existing uploaded solutions remain valid on the first deploy. Project them
-- immediately so the new completion gate never requires a no-op UI resave.
insert into public.solution_records(
  session_id, solution_source, content, revision, created_by, updated_by, created_at, updated_at
)
select artifact.session_id, 'upload',
       jsonb_build_object('notes', artifact.solution_notes, 'files', artifact.solution_files),
       1, artifact.updated_by, artifact.updated_by, artifact.updated_at, artifact.updated_at
  from public.session_preparation_artifacts artifact
 where jsonb_array_length(artifact.solution_files) > 0
on conflict(session_id) where solution_source = 'upload' do nothing;

alter table public.lesson_plans enable row level security;
alter table public.lesson_page_notes enable row level security;
alter table public.courseware_annotations enable row level security;
alter table public.solution_records enable row level security;

create policy lesson_plans_select_scope on public.lesson_plans
for select to authenticated using (
  public.is_session_teacher(session_id, (select auth.uid()))
  or public.can_review_session_preparation(session_id, (select auth.uid()))
);
create policy lesson_page_notes_select_scope on public.lesson_page_notes
for select to authenticated using (
  exists (
    select 1 from public.lesson_plans plan
     where plan.id = lesson_plan_id
       and (
         public.is_session_teacher(plan.session_id, (select auth.uid()))
         or public.can_review_session_preparation(plan.session_id, (select auth.uid()))
       )
  )
);
create policy courseware_annotations_select_scope on public.courseware_annotations
for select to authenticated using (
  public.is_session_teacher(session_id, (select auth.uid()))
  or public.can_review_session_preparation(session_id, (select auth.uid()))
);
create policy solution_records_select_scope on public.solution_records
for select to authenticated using (
  public.is_session_teacher(session_id, (select auth.uid()))
  or public.can_review_session_preparation(session_id, (select auth.uid()))
);

revoke all on table public.lesson_plans from anon, authenticated;
revoke all on table public.lesson_page_notes from anon, authenticated;
revoke all on table public.courseware_annotations from anon, authenticated;
revoke all on table public.solution_records from anon, authenticated;
grant select on table public.lesson_plans to authenticated;
grant select on table public.lesson_page_notes to authenticated;
grant select on table public.courseware_annotations to authenticated;
grant select on table public.solution_records to authenticated;

create or replace function public.is_session_page_doc(p_session_id uuid, p_page_doc_id uuid)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  resolved jsonb;
  session_lecture_id uuid;
  release_id uuid;
  release_snapshot jsonb;
begin
  select session_row.courseware_resolved, session_row.lecture_id
    into resolved, session_lecture_id
    from public.class_sessions session_row
   where session_row.id = p_session_id and session_row.deleted_at is null;
  if not found then return false; end if;

  if resolved is not null
     and resolved ->> 'version' = 'cw-session-resolved-v1'
     and coalesce(resolved ->> 'releaseId', '') ~ '^[0-9a-f-]{36}$' then
    release_id := (resolved ->> 'releaseId')::uuid;
  elsif session_lecture_id is not null then
    select lecture.current_release_id into release_id
      from public.course_lectures lecture where lecture.id = session_lecture_id;
  end if;
  if release_id is null then return false; end if;

  select release.snapshot into release_snapshot
    from public.cw_lecture_releases release where release.id = release_id;
  return exists (
    select 1
      from jsonb_array_elements(coalesce(release_snapshot, '[]'::jsonb)) entry
     where entry.value ->> 'pageDocId' = p_page_doc_id::text
  );
end;
$$;

create or replace function public.validate_courseware_annotation_content(p_content jsonb)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare
  item jsonb;
  point jsonb;
  width_value numeric;
begin
  if jsonb_typeof(p_content) <> 'array'
     or jsonb_array_length(p_content) > 5000
     or octet_length(p_content::text) > 2097152 then
    raise exception 'VALIDATION';
  end if;
  for item in select value from jsonb_array_elements(p_content)
  loop
    if jsonb_typeof(item) <> 'object'
       or coalesce(item ->> 'id', '') !~ '^[0-9a-f-]{36}$'
       or item ->> 'mode' not in ('ink', 'erase')
       or item ->> 'color' not in ('ink', 'rose', 'leaf', 'crater', 'cheek', 'moon')
       or jsonb_typeof(item -> 'wNorm') <> 'number'
       or jsonb_typeof(item -> 'points') <> 'array'
       or jsonb_array_length(item -> 'points') > 10000 then
      raise exception 'VALIDATION';
    end if;
    width_value := (item ->> 'wNorm')::numeric;
    if width_value <= 0 or width_value > 0.1 then raise exception 'VALIDATION'; end if;
    for point in select value from jsonb_array_elements(item -> 'points')
    loop
      if jsonb_typeof(point) <> 'array'
         or jsonb_array_length(point) <> 2
         or jsonb_typeof(point -> 0) <> 'number'
         or jsonb_typeof(point -> 1) <> 'number'
         or (point ->> 0)::numeric < 0 or (point ->> 0)::numeric > 1
         or (point ->> 1)::numeric < 0 or (point ->> 1)::numeric > 1 then
        raise exception 'VALIDATION';
      end if;
    end loop;
  end loop;
  return p_content;
end;
$$;

create or replace function public.save_courseware_annotation(
  p_session_id uuid,
  p_page_doc_id uuid,
  p_content jsonb,
  p_base_version integer default 0
)
returns table(annotation_id uuid, version integer, updated_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  current_row public.courseware_annotations%rowtype;
  valid_content jsonb;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  if exists (
    select 1 from public.class_sessions session_row
     where session_row.id = p_session_id
       and (session_row.deleted_at is not null or session_row.courseware_frozen_at is not null or session_row.started_at is not null)
  ) then raise exception 'PREPARATION_LOCKED'; end if;
  if not public.is_session_page_doc(p_session_id, p_page_doc_id) then raise exception 'PAGE_NOT_IN_SESSION'; end if;
  valid_content := public.validate_courseware_annotation_content(coalesce(p_content, '[]'::jsonb));

  select * into current_row
    from public.courseware_annotations annotation
   where annotation.session_id = p_session_id
     and annotation.page_doc_id = p_page_doc_id
     and annotation.user_id = uid
     and annotation.annotation_type = 'board'
   for update;

  if found and current_row.version <> p_base_version then raise exception 'VERSION_CONFLICT'; end if;
  if not found and p_base_version <> 0 then raise exception 'VERSION_CONFLICT'; end if;

  insert into public.courseware_annotations(
    session_id, page_doc_id, user_id, annotation_type, content
  ) values (
    p_session_id, p_page_doc_id, uid, 'board', valid_content
  )
  on conflict(session_id, page_doc_id, user_id, annotation_type) do update set
    content = excluded.content,
    version = public.courseware_annotations.version + 1,
    updated_at = now()
  returning id, public.courseware_annotations.version, public.courseware_annotations.updated_at
    into annotation_id, version, updated_at;
  return next;
end;
$$;

create or replace function public.generate_solution_record_from_board(
  p_session_id uuid,
  p_page_doc_id uuid
)
returns table(solution_record_id uuid, revision integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  annotation_row public.courseware_annotations%rowtype;
  review_revision integer;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  if exists (
    select 1 from public.class_sessions session_row
     where session_row.id = p_session_id
       and (session_row.deleted_at is not null or session_row.courseware_frozen_at is not null or session_row.started_at is not null)
  ) then raise exception 'PREPARATION_LOCKED'; end if;

  select * into annotation_row
    from public.courseware_annotations annotation
   where annotation.session_id = p_session_id
     and annotation.page_doc_id = p_page_doc_id
     and annotation.user_id = uid
     and annotation.annotation_type = 'board'
   for update;
  if not found or jsonb_array_length(annotation_row.content) = 0 then
    raise exception 'ANNOTATION_REQUIRED';
  end if;

  insert into public.solution_records(
    session_id, solution_source, annotation_id, page_doc_id, content,
    created_by, updated_by
  ) values (
    p_session_id, 'board', annotation_row.id, p_page_doc_id,
    jsonb_build_object(
      'annotationVersion', annotation_row.version,
      'annotationUpdatedAt', annotation_row.updated_at,
      'strokes', annotation_row.content
    ), uid, uid
  )
  on conflict(annotation_id) where solution_source = 'board' do update set
    content = excluded.content,
    revision = public.solution_records.revision + 1,
    updated_by = uid,
    updated_at = now()
  returning id, public.solution_records.revision
    into solution_record_id, revision;

  insert into public.session_preparation_reviews(session_id, artifact_kind, submitted_by)
    values(p_session_id, 'solution', uid)
  on conflict(session_id, artifact_kind) do update set
    status = 'pending', revision = public.session_preparation_reviews.revision + 1,
    submitted_by = uid, submitted_at = now(), reviewed_by = null,
    reviewed_at = null, review_note = ''
  returning public.session_preparation_reviews.revision into review_revision;
  perform public.notify_session_preparation_reviewers(p_session_id, 'solution', review_revision, uid);
  return next;
end;
$$;

create or replace function public.save_session_lesson_plan(
  p_session_id uuid,
  p_template_version text,
  p_content jsonb,
  p_base_revision integer default 0
)
returns table(lesson_plan_id uuid, revision integer, status text, updated_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  current_row public.lesson_plans%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  if coalesce(p_template_version, '') <> 'mathin-teaching-plan-v1'
     or jsonb_typeof(p_content) <> 'array'
     or octet_length(p_content::text) > 524288 then
    raise exception 'VALIDATION';
  end if;
  if exists (
    select 1 from public.class_sessions session_row
     where session_row.id = p_session_id
       and (session_row.deleted_at is not null or session_row.courseware_frozen_at is not null or session_row.started_at is not null)
  ) then raise exception 'PREPARATION_LOCKED'; end if;

  select * into current_row from public.lesson_plans plan
   where plan.session_id = p_session_id for update;
  if found and current_row.revision <> p_base_revision then raise exception 'VERSION_CONFLICT'; end if;
  if not found and p_base_revision <> 0 then raise exception 'VERSION_CONFLICT'; end if;

  insert into public.lesson_plans(
    session_id, template_version, content, status, revision, created_by, updated_by
  ) values (
    p_session_id, p_template_version, p_content, 'draft', 1, uid, uid
  )
  on conflict(session_id) do update set
    template_version = excluded.template_version,
    content = excluded.content,
    status = 'draft',
    revision = public.lesson_plans.revision + 1,
    updated_by = uid,
    updated_at = now()
  returning id, public.lesson_plans.revision, public.lesson_plans.status, public.lesson_plans.updated_at
    into lesson_plan_id, revision, status, updated_at;

  -- Editing invalidates the submitted lesson-plan package. A later explicit
  -- submit creates the next review revision for the current document/files.
  delete from public.session_preparation_reviews
   where session_id = p_session_id and artifact_kind = 'lesson_plan';
  return next;
end;
$$;

create or replace function public.submit_session_lesson_plan(
  p_session_id uuid,
  p_revision integer
)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  plan_row public.lesson_plans%rowtype;
  review_revision integer;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  select * into plan_row from public.lesson_plans plan
   where plan.session_id = p_session_id for update;
  if not found then raise exception 'LESSON_PLAN_REQUIRED'; end if;
  if plan_row.revision <> p_revision then raise exception 'VERSION_CONFLICT'; end if;
  if jsonb_array_length(plan_row.content) = 0 then raise exception 'LESSON_PLAN_REQUIRED'; end if;
  if exists (
    select 1 from public.class_sessions session_row
     where session_row.id = p_session_id
       and (session_row.deleted_at is not null or session_row.courseware_frozen_at is not null or session_row.started_at is not null)
  ) then raise exception 'PREPARATION_LOCKED'; end if;

  update public.lesson_plans set status = 'pending', updated_by = uid, updated_at = now()
   where id = plan_row.id;
  insert into public.session_preparation_reviews(
    session_id, artifact_kind, status, revision, submitted_by
  ) values (
    p_session_id, 'lesson_plan', 'pending', greatest(plan_row.revision, 1), uid
  )
  on conflict(session_id, artifact_kind) do update set
    status = 'pending', revision = greatest(public.session_preparation_reviews.revision + 1, plan_row.revision),
    submitted_by = uid, submitted_at = now(), reviewed_by = null,
    reviewed_at = null, review_note = ''
  returning revision into review_revision;
  perform public.notify_session_preparation_reviewers(p_session_id, 'lesson_plan', review_revision, uid);
  return review_revision;
end;
$$;

create or replace function public.save_lesson_page_note(
  p_session_id uuid,
  p_page_doc_id uuid,
  p_content text
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  plan_id uuid;
  normalized text := btrim(coalesce(p_content, ''));
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  if length(normalized) > 5000 then raise exception 'VALIDATION'; end if;
  if not public.is_session_page_doc(p_session_id, p_page_doc_id) then raise exception 'PAGE_NOT_IN_SESSION'; end if;
  if exists (
    select 1 from public.class_sessions session_row
     where session_row.id = p_session_id
       and (session_row.deleted_at is not null or session_row.courseware_frozen_at is not null or session_row.started_at is not null)
  ) then raise exception 'PREPARATION_LOCKED'; end if;
  select plan.id into plan_id from public.lesson_plans plan where plan.session_id = p_session_id;
  if plan_id is null then raise exception 'LESSON_PLAN_REQUIRED'; end if;

  if normalized = '' then
    delete from public.lesson_page_notes note
     where note.lesson_plan_id = plan_id and note.page_doc_id = p_page_doc_id;
    return;
  end if;
  insert into public.lesson_page_notes(
    lesson_plan_id, page_doc_id, content, created_by, updated_by
  ) values (plan_id, p_page_doc_id, normalized, uid, uid)
  on conflict(lesson_plan_id, page_doc_id) do update set
    content = excluded.content, updated_by = uid, updated_at = now();
end;
$$;

create or replace function public.sync_lesson_plan_review_status()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.artifact_kind = 'lesson_plan' then
    update public.lesson_plans set status = new.status, updated_at = now()
     where session_id = new.session_id;
  end if;
  return new;
end;
$$;

create trigger session_preparation_reviews_sync_lesson_plan
after insert or update of status on public.session_preparation_reviews
for each row execute function public.sync_lesson_plan_review_status();

-- Keep the upload path as a first-class solution source and preserve the
-- existing three-kind review/notification behavior.
create or replace function public.save_session_preparation_artifacts(
  p_session_id uuid,
  p_solution_notes text,
  p_solution_files jsonb,
  p_lesson_plan_files jsonb,
  p_rehearsal_video_url text
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  session_exists boolean;
  previous public.session_preparation_artifacts%rowtype;
  solution_changed boolean;
  lesson_plan_changed boolean;
  rehearsal_changed boolean;
  review_revision integer;
  solution_files jsonb;
  lesson_plan_files jsonb;
  rehearsal_url text;
  solution_notes text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select exists(select 1 from public.class_sessions where id = p_session_id and deleted_at is null)
    into session_exists;
  if not session_exists then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  if length(coalesce(p_solution_notes,'')) > 5000
     or length(coalesce(p_rehearsal_video_url,'')) > 1000
     or (btrim(coalesce(p_rehearsal_video_url,'')) <> ''
       and btrim(p_rehearsal_video_url) !~* '^https://') then
    raise exception 'VALIDATION';
  end if;

  solution_notes := left(btrim(coalesce(p_solution_notes,'')), 5000);
  solution_files := public.validate_prep_artifact_files(
    p_session_id, 'solution', coalesce(p_solution_files, '[]'::jsonb)
  );
  lesson_plan_files := public.validate_prep_artifact_files(
    p_session_id, 'lesson-plan', coalesce(p_lesson_plan_files, '[]'::jsonb)
  );
  rehearsal_url := left(btrim(coalesce(p_rehearsal_video_url,'')), 1000);

  select * into previous from public.session_preparation_artifacts
   where session_id = p_session_id for update;
  solution_changed := jsonb_array_length(solution_files) > 0 and (
    previous.session_id is null or previous.solution_files is distinct from solution_files
    or previous.solution_notes is distinct from solution_notes
  );
  lesson_plan_changed := jsonb_array_length(lesson_plan_files) > 0 and (
    previous.session_id is null or previous.lesson_plan_files is distinct from lesson_plan_files
  );
  rehearsal_changed := rehearsal_url <> '' and (
    previous.session_id is null or previous.rehearsal_video_url is distinct from rehearsal_url
  );

  insert into public.session_preparation_artifacts(
    session_id, solution_notes, solution_files, lesson_plan_files,
    rehearsal_video_url, updated_by
  ) values (
    p_session_id, solution_notes, solution_files, lesson_plan_files, rehearsal_url, uid
  )
  on conflict(session_id) do update set
    solution_notes = excluded.solution_notes,
    solution_files = excluded.solution_files,
    lesson_plan_files = excluded.lesson_plan_files,
    rehearsal_video_url = excluded.rehearsal_video_url,
    updated_by = uid,
    updated_at = now();

  if jsonb_array_length(solution_files) = 0 then
    delete from public.solution_records
     where session_id = p_session_id and solution_source = 'upload';
    if not exists(select 1 from public.solution_records where session_id = p_session_id) then
      delete from public.session_preparation_reviews
       where session_id = p_session_id and artifact_kind = 'solution';
    end if;
  else
    -- A save of lesson-plan files or the rehearsal URL must not create a
    -- synthetic solution revision. Insert a missing legacy projection once;
    -- update it only when the solution payload actually changed.
    if solution_changed or not exists (
      select 1 from public.solution_records
       where session_id = p_session_id and solution_source = 'upload'
    ) then
      insert into public.solution_records(
        session_id, solution_source, content, created_by, updated_by
      ) values (
        p_session_id, 'upload', jsonb_build_object('notes', solution_notes, 'files', solution_files), uid, uid
      )
      on conflict(session_id) where solution_source = 'upload' do update set
        content = excluded.content,
        revision = public.solution_records.revision + 1,
        updated_by = uid,
        updated_at = now();
    end if;
    if solution_changed then
      insert into public.session_preparation_reviews(session_id, artifact_kind, submitted_by)
        values(p_session_id, 'solution', uid)
      on conflict(session_id, artifact_kind) do update set
        status = 'pending', revision = public.session_preparation_reviews.revision + 1,
        submitted_by = uid, submitted_at = now(), reviewed_by = null,
        reviewed_at = null, review_note = ''
      returning revision into review_revision;
      perform public.notify_session_preparation_reviewers(p_session_id, 'solution', review_revision, uid);
    end if;
  end if;

  if jsonb_array_length(lesson_plan_files) = 0 then
    if not exists(select 1 from public.lesson_plans where session_id = p_session_id and status <> 'draft') then
      delete from public.session_preparation_reviews
       where session_id = p_session_id and artifact_kind = 'lesson_plan';
    end if;
  elsif lesson_plan_changed then
    insert into public.session_preparation_reviews(session_id, artifact_kind, submitted_by)
      values(p_session_id, 'lesson_plan', uid)
    on conflict(session_id, artifact_kind) do update set
      status = 'pending', revision = public.session_preparation_reviews.revision + 1,
      submitted_by = uid, submitted_at = now(), reviewed_by = null,
      reviewed_at = null, review_note = ''
    returning revision into review_revision;
    perform public.notify_session_preparation_reviewers(p_session_id, 'lesson_plan', review_revision, uid);
  end if;

  if rehearsal_url = '' then
    delete from public.session_preparation_reviews
     where session_id = p_session_id and artifact_kind = 'rehearsal_video';
  elsif rehearsal_changed then
    insert into public.session_preparation_reviews(session_id, artifact_kind, submitted_by)
      values(p_session_id, 'rehearsal_video', uid)
    on conflict(session_id, artifact_kind) do update set
      status = 'pending', revision = public.session_preparation_reviews.revision + 1,
      submitted_by = uid, submitted_at = now(), reviewed_by = null,
      reviewed_at = null, review_note = ''
    returning revision into review_revision;
    perform public.notify_session_preparation_reviewers(p_session_id, 'rehearsal_video', review_revision, uid);
  end if;
end;
$$;

create or replace function public.assert_session_preparation_complete(p_session_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  artifact_row public.session_preparation_artifacts%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  select * into artifact_row from public.session_preparation_artifacts where session_id = p_session_id;
  if artifact_row.session_id is null
     or not exists(select 1 from public.solution_records where session_id = p_session_id)
     or (
       jsonb_array_length(artifact_row.lesson_plan_files) = 0
       and not exists(select 1 from public.lesson_plans where session_id = p_session_id)
     )
     or btrim(artifact_row.rehearsal_video_url) = '' then
    raise exception 'PREP_ARTIFACTS_REQUIRED';
  end if;
  if (select count(*) from public.session_preparation_reviews
       where session_id = p_session_id and status = 'approved') <> 3 then
    raise exception 'PREP_REVIEW_REQUIRED';
  end if;
  if not exists(select 1 from public.session_learning_checks where session_id = p_session_id) then
    raise exception 'LEARNING_CHECKS_REQUIRED';
  end if;
end;
$$;

revoke all on function public.is_session_page_doc(uuid, uuid) from public, anon, authenticated;
revoke all on function public.validate_courseware_annotation_content(jsonb) from public, anon, authenticated;
revoke all on function public.save_courseware_annotation(uuid, uuid, jsonb, integer) from public, anon, authenticated;
revoke all on function public.generate_solution_record_from_board(uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_session_lesson_plan(uuid, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.submit_session_lesson_plan(uuid, integer) from public, anon, authenticated;
revoke all on function public.save_lesson_page_note(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.sync_lesson_plan_review_status() from public, anon, authenticated;
revoke all on function public.save_session_preparation_artifacts(uuid,text,jsonb,jsonb,text) from public, anon, authenticated;
revoke all on function public.assert_session_preparation_complete(uuid) from public, anon, authenticated;

grant execute on function public.save_courseware_annotation(uuid, uuid, jsonb, integer) to authenticated;
grant execute on function public.generate_solution_record_from_board(uuid, uuid) to authenticated;
grant execute on function public.save_session_lesson_plan(uuid, text, jsonb, integer) to authenticated;
grant execute on function public.submit_session_lesson_plan(uuid, integer) to authenticated;
grant execute on function public.save_lesson_page_note(uuid, uuid, text) to authenticated;
grant execute on function public.save_session_preparation_artifacts(uuid,text,jsonb,jsonb,text) to authenticated;
grant execute on function public.assert_session_preparation_complete(uuid) to authenticated;

commit;
