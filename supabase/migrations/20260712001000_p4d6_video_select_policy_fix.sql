-- P4D-6：修复视频本人读取分支被 students 表自身 RLS 隐式过滤。
create or replace function public.is_student_self(p_student_id uuid, p_uid uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.students s
     where s.id = p_student_id
       and s.user_id = p_uid
       and s.deleted_at is null
  );
$$;

revoke all on function public.is_student_self(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_student_self(uuid, uuid) to authenticated;

drop policy if exists session_videos_select_scope on public.session_videos;
create policy session_videos_select_scope
  on public.session_videos
  for select
  to authenticated
  using (
    deleted_at is null
    and (
      public.is_student_self(student_id, (select auth.uid()))
      or public.can_access_student(student_id, (select auth.uid()))
    )
  );
