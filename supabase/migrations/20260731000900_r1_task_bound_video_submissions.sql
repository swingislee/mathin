-- R1-5: a family video upload is a submission to a published video task.
-- Staff review uploads may remain taskless; customer uploads may not.

alter table public.session_videos
  add column if not exists video_task_id uuid references public.session_video_tasks(id) on delete restrict;

grant insert(video_task_id) on public.session_videos to authenticated;

create index if not exists session_videos_video_task_student_idx
  on public.session_videos(video_task_id, student_id)
  where video_task_id is not null and deleted_at is null;

update public.session_videos video_row
   set video_task_id = task_row.id
  from public.session_video_tasks task_row
 where video_row.video_task_id is null
   and video_row.session_id = task_row.session_id
   and task_row.published_at is not null;

drop policy if exists session_videos_insert_scope on public.session_videos;
create policy session_videos_insert_scope on public.session_videos
for insert to authenticated with check(
  uploaded_by = (select auth.uid())
  and exists(
    select 1
      from public.class_sessions session_row
      join public.enrollments enrollment_row
        on enrollment_row.classroom_id = session_row.classroom_id
       and enrollment_row.student_id = session_videos.student_id
       and enrollment_row.status = 'active'
     where session_row.id = session_videos.session_id
       and (
         public.can_review_session(session_row.classroom_id, (select auth.uid()))
         or (
           public.can_upload_student_media(session_videos.student_id, (select auth.uid()))
           and session_videos.video_task_id is not null
           and exists(
             select 1 from public.session_video_tasks task_row
              where task_row.id = session_videos.video_task_id
                and task_row.session_id = session_videos.session_id
                and task_row.published_at is not null
           )
         )
       )
  )
);

create or replace function public.get_my_video_sessions()
returns table(
  session_id uuid, student_id uuid, classroom_id uuid, classroom_name text,
  lecture_name text, scheduled_at timestamptz
)
language sql security definer stable set search_path = public, pg_temp
as $$
  select session_row.id, student_row.id, classroom_row.id, classroom_row.name,
         session_row.title, session_row.scheduled_at
    from public.students student_row
    join public.enrollments enrollment_row
      on enrollment_row.student_id = student_row.id and enrollment_row.status = 'active'
    join public.classrooms classroom_row on classroom_row.id = enrollment_row.classroom_id
    join public.class_sessions session_row on session_row.classroom_id = classroom_row.id
    join public.session_video_tasks task_row
      on task_row.session_id = session_row.id and task_row.published_at is not null
   where public.can_upload_student_media(student_row.id, auth.uid())
     and student_row.deleted_at is null and session_row.deleted_at is null
     and not exists(
       select 1 from public.session_videos video_row
        where video_row.video_task_id = task_row.id
          and video_row.student_id = student_row.id
          and video_row.deleted_at is null
     )
   order by task_row.due_at asc nulls last, task_row.published_at desc
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
         exists(
           select 1 from public.session_videos video_row
            where video_row.video_task_id = task_row.id
              and video_row.student_id = student_row.id
              and video_row.deleted_at is null
         )
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
      recipient, '/dashboard/assignments?videoTask=' || task_row.id::text || '&videoStudent=' || student_id::text || '#video-tasks'
    );
  end loop;
  return task_row.id;
end
$$;