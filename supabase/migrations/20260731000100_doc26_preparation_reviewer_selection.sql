-- doc 26: session-level preparation reviewer selection.
-- Phase 1 lets the session teacher choose any active staff member, including
-- themselves. The assignment source keeps the future supervisor-owned policy
-- explicit without introducing that management UI in this phase.

begin;

alter table public.session_preparations
  add column reviewer_id uuid references public.profiles(id) on delete set null,
  add column reviewer_assignment_source text
    check (reviewer_assignment_source in ('teacher_selected', 'supervisor_assigned')),
  add column reviewer_assigned_by uuid references public.profiles(id) on delete set null,
  add column reviewer_assigned_at timestamptz;

comment on column public.session_preparations.reviewer_id is
  '课次备课审校人。第一阶段由教师选择（允许本人）；后续由主管指派。';
comment on column public.session_preparations.reviewer_assignment_source is
  'teacher_selected 为第一阶段教师选择；supervisor_assigned 预留给主管指派，教师不得覆盖。';

-- Existing review rows did not carry an explicit assignee. Preserve their
-- visibility by treating the latest submitter as the temporary self-reviewer.
with latest_submission as (
  select distinct on (review_row.session_id)
         review_row.session_id, review_row.submitted_by, review_row.submitted_at
    from public.session_preparation_reviews review_row
   order by review_row.session_id, review_row.submitted_at desc
)
update public.session_preparations preparation
   set reviewer_id = latest_submission.submitted_by,
       reviewer_assignment_source = 'teacher_selected',
       reviewer_assigned_by = latest_submission.submitted_by,
       reviewer_assigned_at = latest_submission.submitted_at
  from latest_submission
 where preparation.session_id = latest_submission.session_id
   and preparation.reviewer_id is null;

create or replace function public.can_review_session_preparation(p_session_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_user_id is not null and (
    public.is_admin(p_user_id)
    or exists (
      select 1
        from public.session_preparations preparation
       where preparation.session_id = p_session_id
         and preparation.reviewer_id = p_user_id
    )
    or (
      not exists (
        select 1 from public.session_preparations preparation
         where preparation.session_id = p_session_id
           and preparation.reviewer_id is not null
      )
      and exists (
        select 1
          from public.class_sessions session_row
          cross join lateral public.resolve_course_assignments(session_row.lecture_id) assignment
         where session_row.id = p_session_id
           and session_row.deleted_at is null
           and assignment.responsibility = 'reviewer'
           and assignment.user_id = p_user_id
      )
    )
  );
$$;

revoke all on function public.can_review_session_preparation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_review_session_preparation(uuid, uuid) to authenticated;

create or replace function public.list_session_preparation_reviewer_candidates(p_session_id uuid)
returns table(user_id uuid, display_name text, is_self boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_session_teacher(p_session_id, uid) and not public.is_admin(uid) then
    raise exception 'FORBIDDEN';
  end if;
  return query
    select profile.id, profile.display_name, profile.id = uid
      from public.profiles profile
     where profile.role in ('staff', 'admin')
       and profile.account_status = 'active'
       and profile.is_active
     order by (profile.id = uid) desc, profile.display_name, profile.id;
end;
$$;

create or replace function public.set_session_preparation_reviewer(
  p_session_id uuid,
  p_reviewer_id uuid
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  current_source text;
  session_title text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  if exists (
    select 1 from public.class_sessions session_row
     where session_row.id = p_session_id
       and (session_row.deleted_at is not null
         or session_row.courseware_frozen_at is not null
         or session_row.started_at is not null)
  ) then raise exception 'PREPARATION_LOCKED'; end if;
  if not exists (
    select 1 from public.profiles profile
     where profile.id = p_reviewer_id
       and profile.role in ('staff', 'admin')
       and profile.account_status = 'active'
       and profile.is_active
  ) then raise exception 'REVIEWER_NOT_AVAILABLE'; end if;

  select preparation.reviewer_assignment_source into current_source
    from public.session_preparations preparation
   where preparation.session_id = p_session_id
   for update;
  if current_source = 'supervisor_assigned' then
    raise exception 'REVIEWER_LOCKED_BY_SUPERVISOR';
  end if;

  insert into public.session_preparations(
    session_id, status, last_contributor_id, reviewer_id,
    reviewer_assignment_source, reviewer_assigned_by, reviewer_assigned_at
  ) values (
    p_session_id, 'in_progress', uid, p_reviewer_id,
    'teacher_selected', uid, now()
  )
  on conflict(session_id) do update set
    reviewer_id = excluded.reviewer_id,
    reviewer_assignment_source = 'teacher_selected',
    reviewer_assigned_by = uid,
    reviewer_assigned_at = now(),
    last_contributor_id = uid,
    updated_at = now();

  select classroom.name || ' · ' || session_row.title into session_title
    from public.class_sessions session_row
    join public.classrooms classroom on classroom.id = session_row.classroom_id
   where session_row.id = p_session_id;

  if exists (
    select 1 from public.session_preparation_reviews review_row
     where review_row.session_id = p_session_id and review_row.status = 'pending'
  ) then
    perform public.emit_domain_event(
      'session.preparation.reviewer.assigned', 'class_session', p_session_id,
      jsonb_build_object('title', session_title), p_reviewer_id,
      '/dashboard/courseware/preparation-review?sessionId=' || p_session_id::text
    );
  end if;
end;
$$;

create or replace function public.ensure_session_preparation_reviewer()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'pending' and not exists (
    select 1 from public.session_preparations preparation
     where preparation.session_id = new.session_id
       and preparation.reviewer_id is not null
  ) then
    insert into public.session_preparations(
      session_id, status, last_contributor_id, reviewer_id,
      reviewer_assignment_source, reviewer_assigned_by, reviewer_assigned_at
    ) values (
      new.session_id, 'in_progress', new.submitted_by, new.submitted_by,
      'teacher_selected', new.submitted_by, now()
    )
    on conflict(session_id) do update set
      reviewer_id = excluded.reviewer_id,
      reviewer_assignment_source = 'teacher_selected',
      reviewer_assigned_by = excluded.reviewer_assigned_by,
      reviewer_assigned_at = now(),
      updated_at = now();
  end if;
  return new;
end;
$$;

create trigger session_preparation_reviews_ensure_reviewer
before insert or update of status, revision, submitted_at
on public.session_preparation_reviews
for each row execute function public.ensure_session_preparation_reviewer();

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
  selected_reviewer uuid;
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
  select preparation.reviewer_id into selected_reviewer
    from public.session_preparations preparation
   where preparation.session_id = p_session_id;

  if selected_reviewer is not null then
    perform public.emit_domain_event(
      'session.preparation.submitted', 'class_session', p_session_id,
      jsonb_build_object(
        'title', session_row.classroom_name || ' · ' || session_row.title,
        'artifactKind', p_artifact_kind,
        'revision', p_revision
      ), selected_reviewer, target_link
    );
    return;
  end if;

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

drop function if exists public.list_my_session_preparation_reviews(uuid);
create function public.list_my_session_preparation_reviews(p_session_id uuid default null)
returns table(
  session_id uuid,
  artifact_kind text,
  status text,
  revision integer,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  review_note text,
  session_title text,
  classroom_name text,
  assigned_reviewer_id uuid,
  assigned_reviewer_name text,
  self_review boolean
)
language sql stable security definer set search_path = public, pg_temp as $$
  select review_row.session_id, review_row.artifact_kind, review_row.status,
         review_row.revision, review_row.submitted_at, review_row.reviewed_at,
         review_row.review_note, session_row.title, classroom.name,
         preparation.reviewer_id, reviewer.display_name,
         preparation.reviewer_id = review_row.submitted_by
    from public.session_preparation_reviews review_row
    join public.class_sessions session_row on session_row.id = review_row.session_id
    join public.classrooms classroom on classroom.id = session_row.classroom_id
    left join public.session_preparations preparation on preparation.session_id = review_row.session_id
    left join public.profiles reviewer on reviewer.id = preparation.reviewer_id
   where (p_session_id is null or review_row.session_id = p_session_id)
     and public.can_review_session_preparation(review_row.session_id, auth.uid())
   order by (review_row.status = 'pending') desc, review_row.submitted_at desc;
$$;

revoke all on function public.list_session_preparation_reviewer_candidates(uuid) from public, anon, authenticated;
revoke all on function public.set_session_preparation_reviewer(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ensure_session_preparation_reviewer() from public, anon, authenticated;
revoke all on function public.notify_session_preparation_reviewers(uuid, text, integer, uuid) from public, anon, authenticated;
revoke all on function public.list_my_session_preparation_reviews(uuid) from public, anon, authenticated;
grant execute on function public.list_session_preparation_reviewer_candidates(uuid) to authenticated;
grant execute on function public.set_session_preparation_reviewer(uuid, uuid) to authenticated;
grant execute on function public.list_my_session_preparation_reviews(uuid) to authenticated;

commit;
