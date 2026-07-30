-- R1: preparation artifacts save immediately, enter review, and notify the effective courseware reviewer.

begin;

create or replace function public.can_review_session_preparation(p_session_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_user_id is not null and (
    public.is_admin(p_user_id)
    or exists (
      select 1
      from public.class_sessions session_row
      cross join lateral public.resolve_course_assignments(session_row.lecture_id) assignment
      where session_row.id = p_session_id
        and session_row.deleted_at is null
        and assignment.responsibility = 'reviewer'
        and assignment.user_id = p_user_id
    )
  );
$$;

revoke all on function public.can_review_session_preparation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_review_session_preparation(uuid, uuid) to authenticated;

create table public.session_preparation_reviews (
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  artifact_kind text not null check (artifact_kind in ('solution', 'lesson_plan', 'rehearsal_video')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'changes_requested')),
  revision integer not null default 1 check (revision > 0),
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text not null default '' check (length(review_note) <= 1000),
  primary key (session_id, artifact_kind)
);
create index session_preparation_reviews_queue_idx
  on public.session_preparation_reviews(status, submitted_at desc);

alter table public.session_preparation_reviews enable row level security;
create policy session_preparation_reviews_select_scope on public.session_preparation_reviews
for select to authenticated using (
  public.is_session_teacher(session_id, (select auth.uid()))
  or public.can_review_session_preparation(session_id, (select auth.uid()))
);
revoke all on table public.session_preparation_reviews from anon, authenticated;
grant select on table public.session_preparation_reviews to authenticated;

drop policy if exists session_preparation_artifacts_select_scope on public.session_preparation_artifacts;
create policy session_preparation_artifacts_select_scope on public.session_preparation_artifacts
for select to authenticated using (
  public.is_session_teacher(session_id, (select auth.uid()))
  or public.can_review_session_preparation(session_id, (select auth.uid()))
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
  )
);

create or replace function public.notify_session_preparation_reviewers(
  p_session_id uuid,
  p_artifact_kind text,
  p_revision integer,
  p_actor uuid
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  session_row record;
  reviewer_row record;
  assigned_count integer := 0;
  target_link text;
begin
  select session_data.id, session_data.lecture_id, session_data.title, classroom.name as classroom_name
    into session_row
    from public.class_sessions session_data
    join public.classrooms classroom on classroom.id = session_data.classroom_id
   where session_data.id = p_session_id and session_data.deleted_at is null;
  if not found or session_row.lecture_id is null then return; end if;

  target_link := '/dashboard/courseware/preparation-review?sessionId=' || p_session_id::text
    || '&focus=' || p_session_id::text || ':' || p_artifact_kind;

  for reviewer_row in
    select distinct assignment.user_id
      from public.resolve_course_assignments(session_row.lecture_id) assignment
     where assignment.responsibility = 'reviewer'
       and assignment.user_id <> p_actor
  loop
    assigned_count := assigned_count + 1;
    perform public.emit_domain_event(
      'session.preparation.submitted', 'class_session', p_session_id,
      jsonb_build_object(
        'title', session_row.classroom_name || ' · ' || session_row.title,
        'artifactKind', p_artifact_kind,
        'revision', p_revision
      ), reviewer_row.user_id, target_link
    );
  end loop;

  -- A missing explicit reviewer must not make the submission invisible. Administrators
  -- are the fail-safe review queue, while the UI still encourages assigning a reviewer.
  if assigned_count = 0 then
    for reviewer_row in
      select profile.id as user_id
        from public.profiles profile
       where profile.id <> p_actor
         and profile.role in ('admin', 'staff')
         and profile.account_status = 'active'
         and public.is_admin(profile.id)
    loop
      perform public.emit_domain_event(
        'session.preparation.submitted', 'class_session', p_session_id,
        jsonb_build_object(
          'title', session_row.classroom_name || ' · ' || session_row.title,
          'artifactKind', p_artifact_kind,
          'revision', p_revision
        ), reviewer_row.user_id, target_link
      );
    end loop;
  end if;
end;
$$;

revoke all on function public.notify_session_preparation_reviewers(uuid, text, integer, uuid) from public, anon, authenticated;

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

  solution_files := public.validate_prep_artifact_files(
    p_session_id, 'solution', coalesce(p_solution_files, '[]'::jsonb)
  );
  lesson_plan_files := public.validate_prep_artifact_files(
    p_session_id, 'lesson-plan', coalesce(p_lesson_plan_files, '[]'::jsonb)
  );
  rehearsal_url := left(btrim(coalesce(p_rehearsal_video_url,'')), 1000);

  select * into previous
    from public.session_preparation_artifacts
   where session_id = p_session_id
   for update;

  solution_changed := jsonb_array_length(solution_files) > 0 and (
    previous.session_id is null
    or previous.solution_files is distinct from solution_files
    or previous.solution_notes is distinct from left(btrim(coalesce(p_solution_notes,'')), 5000)
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
    p_session_id, left(btrim(coalesce(p_solution_notes,'')),5000),
    solution_files, lesson_plan_files, rehearsal_url, uid
  )
  on conflict(session_id) do update set
    solution_notes = excluded.solution_notes,
    solution_files = excluded.solution_files,
    lesson_plan_files = excluded.lesson_plan_files,
    rehearsal_video_url = excluded.rehearsal_video_url,
    updated_by = uid,
    updated_at = now();

  if jsonb_array_length(solution_files) = 0 then
    delete from public.session_preparation_reviews where session_id = p_session_id and artifact_kind = 'solution';
  elsif solution_changed then
    insert into public.session_preparation_reviews(session_id, artifact_kind, submitted_by)
      values(p_session_id, 'solution', uid)
    on conflict(session_id, artifact_kind) do update set
      status = 'pending', revision = public.session_preparation_reviews.revision + 1,
      submitted_by = uid, submitted_at = now(), reviewed_by = null,
      reviewed_at = null, review_note = ''
    returning revision into review_revision;
    perform public.notify_session_preparation_reviewers(p_session_id, 'solution', review_revision, uid);
  end if;

  if jsonb_array_length(lesson_plan_files) = 0 then
    delete from public.session_preparation_reviews where session_id = p_session_id and artifact_kind = 'lesson_plan';
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
    delete from public.session_preparation_reviews where session_id = p_session_id and artifact_kind = 'rehearsal_video';
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

create or replace function public.review_session_preparation_artifact(
  p_session_id uuid,
  p_artifact_kind text,
  p_decision text,
  p_note text default ''
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  review_row public.session_preparation_reviews%rowtype;
  session_title text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_artifact_kind not in ('solution', 'lesson_plan', 'rehearsal_video')
     or p_decision not in ('approved', 'changes_requested')
     or length(btrim(coalesce(p_note, ''))) > 1000 then
    raise exception 'VALIDATION';
  end if;
  if not public.can_review_session_preparation(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;

  select * into review_row
    from public.session_preparation_reviews
   where session_id = p_session_id and artifact_kind = p_artifact_kind
   for update;
  if not found then raise exception 'REVIEW_NOT_FOUND'; end if;
  if review_row.status <> 'pending' then raise exception 'REVIEW_ALREADY_DECIDED'; end if;
  if p_decision = 'changes_requested' and length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'REVIEW_NOTE_REQUIRED';
  end if;

  update public.session_preparation_reviews
     set status = p_decision,
         reviewed_by = uid,
         reviewed_at = now(),
         review_note = left(btrim(coalesce(p_note, '')), 1000)
   where session_id = p_session_id and artifact_kind = p_artifact_kind;

  select classroom.name || ' · ' || session_row.title into session_title
    from public.class_sessions session_row
    join public.classrooms classroom on classroom.id = session_row.classroom_id
   where session_row.id = p_session_id;

  perform public.emit_domain_event(
    'session.preparation.' || p_decision, 'class_session', p_session_id,
    jsonb_build_object(
      'title', session_title,
      'artifactKind', p_artifact_kind,
      'revision', review_row.revision,
      'note', left(btrim(coalesce(p_note, '')), 1000)
    ), review_row.submitted_by,
    '/dashboard/sessions/' || p_session_id::text || '?stage=pre&focus=prep-' || p_artifact_kind
  );
end;
$$;

revoke all on function public.save_session_preparation_artifacts(uuid,text,jsonb,jsonb,text) from public, anon, authenticated;
revoke all on function public.review_session_preparation_artifact(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.save_session_preparation_artifacts(uuid,text,jsonb,jsonb,text) to authenticated;
grant execute on function public.review_session_preparation_artifact(uuid,text,text,text) to authenticated;

create or replace function public.list_my_session_preparation_reviews(p_session_id uuid default null)
returns table(
  session_id uuid,
  artifact_kind text,
  status text,
  revision integer,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  review_note text,
  session_title text,
  classroom_name text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select review_row.session_id, review_row.artifact_kind, review_row.status,
         review_row.revision, review_row.submitted_at, review_row.reviewed_at,
         review_row.review_note, session_row.title, classroom.name
    from public.session_preparation_reviews review_row
    join public.class_sessions session_row on session_row.id = review_row.session_id
    join public.classrooms classroom on classroom.id = session_row.classroom_id
   where (p_session_id is null or review_row.session_id = p_session_id)
     and public.can_review_session_preparation(review_row.session_id, auth.uid())
   order by (review_row.status = 'pending') desc, review_row.submitted_at desc;
$$;

revoke all on function public.list_my_session_preparation_reviews(uuid) from public, anon, authenticated;
grant execute on function public.list_my_session_preparation_reviews(uuid) to authenticated;

create or replace function public.assert_session_preparation_complete(p_session_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); artifact_row public.session_preparation_artifacts%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  select * into artifact_row from public.session_preparation_artifacts where session_id = p_session_id;
  if artifact_row.session_id is null
     or jsonb_array_length(artifact_row.solution_files) = 0
     or jsonb_array_length(artifact_row.lesson_plan_files) = 0
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

revoke all on function public.assert_session_preparation_complete(uuid) from public, anon, authenticated;
grant execute on function public.assert_session_preparation_complete(uuid) to authenticated;

commit;
