-- R1-5: family portal publication boundaries and stable multi-child identity.

begin;

-- A parent can have children with the same display name. Customer schedule and
-- attendance projections therefore carry the stable student id used by the
-- portal selector instead of asking the UI to join rows by name.
drop function if exists public.get_my_schedule(timestamptz, timestamptz);
create function public.get_my_schedule(p_from timestamptz, p_to timestamptz)
returns table (
  session_id uuid, classroom_name text, lecture_name text, scheduled_at timestamptz,
  duration_min smallint, teacher_name text, student_name text, classroom_id uuid,
  student_id uuid
)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select session_row.id, classroom_row.name, session_row.title, session_row.scheduled_at,
         session_row.duration_min,
         coalesce((
           select profile_row.display_name
             from public.classroom_members member_row
             join public.profiles profile_row on profile_row.id = member_row.user_id
            where member_row.classroom_id = classroom_row.id and member_row.role = 'teacher'
            limit 1
         ), ''),
         student_row.name, classroom_row.id, student_row.id
    from public.class_sessions session_row
    join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
    join public.enrollments enrollment_row
      on enrollment_row.classroom_id = classroom_row.id and enrollment_row.status = 'active'
    join public.students student_row on student_row.id = enrollment_row.student_id
   where (
     student_row.user_id = auth.uid()
     or exists (
       select 1
         from public.student_guardians guardian_row
        where guardian_row.student_id = student_row.id
          and guardian_row.guardian_id = auth.uid()
     )
   )
     and student_row.deleted_at is null
     and session_row.deleted_at is null
     and session_row.scheduled_at is not null
     and session_row.scheduled_at >= p_from
     and session_row.scheduled_at < p_to
   order by session_row.scheduled_at;
$$;
revoke all on function public.get_my_schedule(timestamptz, timestamptz) from public;
grant execute on function public.get_my_schedule(timestamptz, timestamptz) to authenticated;

drop function if exists public.get_my_attendance(timestamptz, timestamptz);
create function public.get_my_attendance(p_from timestamptz, p_to timestamptz)
returns table (
  session_id uuid, student_id uuid, student_name text, classroom_name text,
  lecture_name text, scheduled_at timestamptz, status text, note text
)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select session_row.id, student_row.id, student_row.name, classroom_row.name,
         session_row.title, session_row.scheduled_at, attendance_row.status,
         attendance_row.note
    from public.session_attendance attendance_row
    join public.class_sessions session_row on session_row.id = attendance_row.session_id
    join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
    join public.students student_row on student_row.id = attendance_row.student_id
   where (
     student_row.user_id = auth.uid()
     or exists (
       select 1
         from public.student_guardians guardian_row
        where guardian_row.student_id = student_row.id
          and guardian_row.guardian_id = auth.uid()
     )
   )
     and student_row.deleted_at is null
     and session_row.deleted_at is null
     and session_row.scheduled_at is not null
     and session_row.scheduled_at >= p_from
     and session_row.scheduled_at < p_to
   order by session_row.scheduled_at desc;
$$;
revoke all on function public.get_my_attendance(timestamptz, timestamptz) from public;
grant execute on function public.get_my_attendance(timestamptz, timestamptz) to authenticated;

-- Saving a family brief always creates a draft. A previously published version
-- disappears from customer projections until an explicit publish action runs.
create or replace function public.save_session_family_brief(
  p_session_id uuid,
  p_lesson_title text,
  p_learning_summary text,
  p_homework_summary text default '',
  p_materials_note text default '',
  p_teacher_public_comment text default ''
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  cid uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select classroom_id into cid
    from public.class_sessions
   where id = p_session_id and deleted_at is null;
  if cid is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_review_session(cid, uid) then raise exception 'FORBIDDEN'; end if;

  insert into public.session_family_briefs (
    session_id, lesson_title, learning_summary, homework_summary, materials_note,
    teacher_public_comment, published_by, published_at
  )
  values (
    p_session_id,
    left(trim(coalesce(p_lesson_title, '')), 200),
    left(trim(coalesce(p_learning_summary, '')), 2000),
    left(trim(coalesce(p_homework_summary, '')), 2000),
    left(trim(coalesce(p_materials_note, '')), 2000),
    left(trim(coalesce(p_teacher_public_comment, '')), 2000),
    null,
    null
  )
  on conflict (session_id) do update set
    lesson_title = excluded.lesson_title,
    learning_summary = excluded.learning_summary,
    homework_summary = excluded.homework_summary,
    materials_note = excluded.materials_note,
    teacher_public_comment = excluded.teacher_public_comment,
    published_by = null,
    published_at = null,
    updated_at = now();
end;
$$;
revoke all on function public.save_session_family_brief(uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.save_session_family_brief(uuid, text, text, text, text, text)
  to authenticated;

-- An edit to an individual review also invalidates the published family result.
-- The trigger covers both the RPC and any staff write allowed by column grants.
create or replace function public.invalidate_family_brief_on_review_change()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  changed_session_id uuid;
begin
  changed_session_id := case when tg_op = 'DELETE' then old.session_id else new.session_id end;
  update public.session_family_briefs
     set published_by = null, published_at = null, updated_at = now()
   where session_id = changed_session_id and published_at is not null;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.invalidate_family_brief_on_review_change() from public, anon, authenticated;

drop trigger if exists session_reviews_invalidate_family_brief on public.session_reviews;
create trigger session_reviews_invalidate_family_brief
after insert or update or delete on public.session_reviews
for each row execute function public.invalidate_family_brief_on_review_change();

-- Family-facing reviews exist only behind a currently published family brief.
-- Never fall back to the internal class_sessions.knowledge_summary draft.
create or replace function public.get_my_session_reviews(p_from timestamptz, p_to timestamptz)
returns table(
  session_id uuid, student_id uuid, student_name text, classroom_name text,
  lecture_name text, scheduled_at timestamptz, entry_score numeric, exit_score numeric,
  focus smallint, participation smallint, mastery smallint, comment text,
  knowledge_summary text
)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select session_row.id, student_row.id, student_row.name, classroom_row.name,
         session_row.title, session_row.scheduled_at, review_row.entry_score,
         review_row.exit_score, review_row.focus, review_row.participation,
         review_row.mastery, review_row.comment, brief_row.learning_summary
    from public.session_reviews review_row
    join public.class_sessions session_row on session_row.id = review_row.session_id
    join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
    join public.students student_row on student_row.id = review_row.student_id
    join public.session_family_briefs brief_row
      on brief_row.session_id = session_row.id and brief_row.published_at is not null
   where student_row.deleted_at is null
     and session_row.deleted_at is null
     and session_row.scheduled_at >= p_from
     and session_row.scheduled_at < p_to
     and (
       student_row.user_id = auth.uid()
       or public.guardian_can(student_row.id, auth.uid(), 'grades')
     )
   order by session_row.scheduled_at desc;
$$;
revoke all on function public.get_my_session_reviews(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_my_session_reviews(timestamptz, timestamptz)
  to authenticated;

-- The session-wide family brief still requires an enrolled child, and guardians
-- must retain the explicit grades scope. Revoking that scope closes the RPC.
create or replace function public.get_family_session_brief(p_session_id uuid)
returns table(
  lesson_title text, learning_summary text, homework_summary text,
  materials_note text, teacher_public_comment text, published_at timestamptz
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  cid uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select session_row.classroom_id into cid
    from public.class_sessions session_row
   where session_row.id = p_session_id and session_row.deleted_at is null;
  if cid is null then return; end if;

  if not exists (
    select 1
      from public.enrollments enrollment_row
      join public.students student_row on student_row.id = enrollment_row.student_id
     where enrollment_row.classroom_id = cid
       and enrollment_row.status = 'active'
       and (
         student_row.user_id = uid
         or public.guardian_can(student_row.id, uid, 'grades')
       )
  ) then return; end if;

  return query
  select brief_row.lesson_title, brief_row.learning_summary,
         brief_row.homework_summary, brief_row.materials_note,
         brief_row.teacher_public_comment, brief_row.published_at
    from public.session_family_briefs brief_row
   where brief_row.session_id = p_session_id
     and brief_row.published_at is not null;
end;
$$;
revoke all on function public.get_family_session_brief(uuid) from public, anon, authenticated;
grant execute on function public.get_family_session_brief(uuid) to authenticated;

commit;
