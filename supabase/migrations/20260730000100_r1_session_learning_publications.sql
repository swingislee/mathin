-- R1 classroom workflow repair: independent knowledge, homework and video publications.

begin;

alter table public.assignments add column if not exists session_id uuid references public.class_sessions(id) on delete cascade;
create index if not exists assignments_session_idx on public.assignments(session_id, created_at desc) where session_id is not null;
grant insert(classroom_id, session_id, title, content, due_at, created_by) on public.assignments to authenticated;

create or replace function public.publish_session_assignment(
  p_session_id uuid, p_title text, p_content text default '', p_due_at timestamptz default null
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); cid uuid; assignment_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select classroom_id into cid from public.class_sessions where id = p_session_id and deleted_at is null;
  if cid is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_review_session(cid, uid) then raise exception 'FORBIDDEN'; end if;
  if length(trim(coalesce(p_title, ''))) not between 1 and 100 or length(coalesce(p_content, '')) > 20000 then
    raise exception 'VALIDATION';
  end if;
  insert into public.assignments(classroom_id, session_id, title, content, due_at, created_by)
  values(cid, p_session_id, left(trim(p_title), 100),
    jsonb_build_object('text', left(trim(coalesce(p_content, '')), 20000)), p_due_at, uid)
  returning id into assignment_id;
  update public.session_completion_tasks
     set status = 'done', completed_by = uid, completed_at = now(), skip_reason = null
   where session_id = p_session_id and kind = 'assignment' and status = 'pending';
  return assignment_id;
end
$$;
revoke all on function public.publish_session_assignment(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.publish_session_assignment(uuid, text, text, timestamptz) to authenticated;

create table if not exists public.session_video_tasks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.class_sessions(id) on delete cascade,
  title text not null default '',
  instructions text not null default '',
  due_at timestamptz,
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_video_tasks_title_cap check (length(title) <= 100),
  constraint session_video_tasks_instructions_cap check (length(instructions) <= 5000)
);
drop trigger if exists session_video_tasks_set_updated_at on public.session_video_tasks;
create trigger session_video_tasks_set_updated_at before update on public.session_video_tasks
for each row execute function public.set_updated_at();
alter table public.session_video_tasks enable row level security;
drop policy if exists session_video_tasks_select_staff_scope on public.session_video_tasks;
create policy session_video_tasks_select_staff_scope on public.session_video_tasks for select to authenticated
using (
  public.is_admin((select auth.uid()))
  or exists (
    select 1 from public.class_sessions session_row
     where session_row.id = session_id
       and public.can_review_session(session_row.classroom_id, (select auth.uid()))
  )
);
revoke all on table public.session_video_tasks from anon, authenticated;
grant select on table public.session_video_tasks to authenticated;

create or replace function public.save_session_video_task(
  p_session_id uuid, p_title text, p_instructions text default '', p_due_at timestamptz default null
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); cid uuid; task_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select classroom_id into cid from public.class_sessions where id = p_session_id and deleted_at is null;
  if cid is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_review_session(cid, uid) then raise exception 'FORBIDDEN'; end if;
  if length(trim(coalesce(p_title, ''))) > 100 or length(coalesce(p_instructions, '')) > 5000 then
    raise exception 'VALIDATION';
  end if;
  insert into public.session_video_tasks(session_id, title, instructions, due_at)
  values(p_session_id, left(trim(coalesce(p_title, '')), 100),
    left(trim(coalesce(p_instructions, '')), 5000), p_due_at)
  on conflict(session_id) do update set title = excluded.title, instructions = excluded.instructions,
    due_at = excluded.due_at, updated_at = now()
  returning id into task_id;
  return task_id;
end
$$;

create or replace function public.publish_session_video_task(p_session_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid(); cid uuid; task_row public.session_video_tasks%rowtype;
  recipient uuid; student_id uuid; student_name text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select classroom_id into cid from public.class_sessions where id = p_session_id and deleted_at is null;
  if cid is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_review_session(cid, uid) then raise exception 'FORBIDDEN'; end if;
  select * into task_row from public.session_video_tasks where session_id = p_session_id;
  if task_row.id is null then raise exception 'VIDEO_TASK_NOT_FOUND'; end if;
  if trim(task_row.title) = '' then raise exception 'VALIDATION'; end if;
  update public.session_video_tasks set published_by = uid, published_at = now()
   where id = task_row.id returning * into task_row;
  for student_id, student_name, recipient in
    select student_row.id, student_row.name, target.user_id
      from public.enrollments enrollment_row
      join public.students student_row on student_row.id = enrollment_row.student_id
      cross join lateral (
        select student_row.user_id as user_id
        union
        select guardian_row.guardian_id from public.student_guardians guardian_row
         where guardian_row.student_id = student_row.id and 'video' = any(guardian_row.scope)
      ) target
     where enrollment_row.classroom_id = cid and enrollment_row.status = 'active' and target.user_id is not null
  loop
    perform public.emit_domain_event(
      'video_task.published', 'session_video_task', task_row.id,
      jsonb_build_object('title', task_row.title, 'studentId', student_id, 'studentName', student_name),
      recipient, '/dashboard/assignments?videoSession=' || p_session_id::text || '&videoStudent=' || student_id::text || '#video-tasks'
    );
  end loop;
  return task_row.id;
end
$$;
revoke all on function public.save_session_video_task(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.publish_session_video_task(uuid) from public, anon, authenticated;
grant execute on function public.save_session_video_task(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.publish_session_video_task(uuid) to authenticated;

create or replace function public.publish_session_family_brief(p_session_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid(); cid uuid; brief_row public.session_family_briefs%rowtype;
  recipient uuid; student_id uuid; student_name text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select classroom_id into cid from public.class_sessions where id = p_session_id and deleted_at is null;
  if cid is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_review_session(cid, uid) then raise exception 'FORBIDDEN'; end if;
  select * into brief_row from public.session_family_briefs where session_id = p_session_id;
  if brief_row.session_id is null then raise exception 'BRIEF_NOT_FOUND'; end if;
  if trim(brief_row.lesson_title) = '' or trim(brief_row.learning_summary) = '' then raise exception 'VALIDATION'; end if;
  update public.session_family_briefs set published_by = uid, published_at = now()
   where session_id = p_session_id returning * into brief_row;
  update public.session_completion_tasks
     set status = 'done', completed_by = uid, completed_at = now(), skip_reason = null
   where session_id = p_session_id and kind = 'summary' and status = 'pending';
  for student_id, student_name, recipient in
    select student_row.id, student_row.name, target.user_id
      from public.enrollments enrollment_row
      join public.students student_row on student_row.id = enrollment_row.student_id
      cross join lateral (
        select student_row.user_id as user_id
        union
        select guardian_row.guardian_id from public.student_guardians guardian_row
         where guardian_row.student_id = student_row.id and 'grades' = any(guardian_row.scope)
      ) target
     where enrollment_row.classroom_id = cid and enrollment_row.status = 'active' and target.user_id is not null
  loop
    perform public.emit_domain_event(
      'knowledge_summary.published', 'class_session', p_session_id,
      jsonb_build_object('title', brief_row.lesson_title, 'studentId', student_id, 'studentName', student_name),
      recipient, '/dashboard/children?child=' || student_id::text || '#knowledge-summary'
    );
  end loop;
end
$$;

create or replace function public.get_my_published_video_tasks()
returns table(
  video_task_id uuid, session_id uuid, classroom_id uuid, classroom_name text,
  lecture_name text, title text, instructions text, due_at timestamptz,
  student_id uuid, student_name text, submitted boolean
)
language plpgsql security definer stable set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  return query
  select task_row.id, session_row.id, classroom_row.id, classroom_row.name,
         session_row.title, task_row.title, task_row.instructions, task_row.due_at,
         student_row.id, student_row.name,
         exists(select 1 from public.session_videos video_row
          where video_row.session_id = session_row.id and video_row.student_id = student_row.id
            and video_row.deleted_at is null)
    from public.session_video_tasks task_row
    join public.class_sessions session_row on session_row.id = task_row.session_id
    join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
    join public.enrollments enrollment_row on enrollment_row.classroom_id = classroom_row.id
      and enrollment_row.status = 'active'
    join public.students student_row on student_row.id = enrollment_row.student_id
   where task_row.published_at is not null and student_row.deleted_at is null
     and public.can_upload_student_media(student_row.id, uid)
   order by task_row.due_at asc nulls last, task_row.published_at desc;
end
$$;
revoke all on function public.get_my_published_video_tasks() from public, anon, authenticated;
grant execute on function public.get_my_published_video_tasks() to authenticated;

create or replace function public.get_my_session_reviews(p_from timestamptz, p_to timestamptz)
returns table(
  session_id uuid, student_id uuid, student_name text, classroom_name text,
  lecture_name text, scheduled_at timestamptz, entry_score numeric, exit_score numeric,
  focus smallint, participation smallint, mastery smallint, comment text, knowledge_summary text
)
language sql security definer stable set search_path = public, pg_temp as $$
  select session_row.id, student_row.id, student_row.name, classroom_row.name,
         session_row.title, session_row.scheduled_at, review_row.entry_score,
         review_row.exit_score, review_row.focus, review_row.participation,
         review_row.mastery, review_row.comment,
         coalesce(brief_row.learning_summary, session_row.knowledge_summary)
    from public.session_reviews review_row
    join public.class_sessions session_row on session_row.id = review_row.session_id
    join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
    join public.students student_row on student_row.id = review_row.student_id
    left join public.session_family_briefs brief_row
      on brief_row.session_id = session_row.id and brief_row.published_at is not null
   where student_row.deleted_at is null and session_row.deleted_at is null
     and session_row.scheduled_at >= p_from and session_row.scheduled_at < p_to
     and (student_row.user_id = auth.uid() or public.guardian_can(student_row.id, auth.uid(), 'grades'))
   order by session_row.scheduled_at desc
$$;

commit;
