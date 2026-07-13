-- P4D-6：修复学生提交视频元数据时，报名表自身 RLS 导致合法插入被拒绝。
create or replace function public.can_upload_session_video(
  p_session_id uuid,
  p_student_id uuid,
  p_uid uuid
)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.class_sessions cs
      join public.enrollments e
        on e.classroom_id = cs.classroom_id
       and e.student_id = p_student_id
       and e.status = 'active'
      join public.students s on s.id = e.student_id
     where cs.id = p_session_id
       and cs.deleted_at is null
       and s.deleted_at is null
       and (
         s.user_id = p_uid
         or public.can_review_session(cs.classroom_id, p_uid)
       )
  );
$$;

revoke all on function public.can_upload_session_video(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_upload_session_video(uuid, uuid, uuid) to authenticated;

drop policy if exists session_videos_insert_scope on public.session_videos;
create policy session_videos_insert_scope
  on public.session_videos
  for insert
  to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and public.can_upload_session_video(session_id, student_id, (select auth.uid()))
  );
