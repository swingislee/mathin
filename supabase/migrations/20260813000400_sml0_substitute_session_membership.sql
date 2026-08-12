-- SML-0：按次替课教师必须拥有该课次的读取与 realtime membership。
--
-- is_session_teacher 自 P4E 起已经识别 class_sessions.teacher_override，但
-- is_session_member 仍只识别 classroom_members，导致合法替课教师能执行教师写操作，
-- 却不能读取同一课次的 release 课件、页文档、签名资产与 realtime topic。
-- 这里仅增加“当前课次的 active substitute”分支，不把 admin 或其他 staff 自动
-- 扩张为课堂成员，也不改变班级成员的既有语义。

create or replace function public.is_session_member(sid uuid, uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.class_sessions session
    left join public.classroom_members member
      on member.classroom_id = session.classroom_id
     and member.user_id = uid
    left join public.profiles substitute
      on substitute.id = uid
     and substitute.is_active
    where session.id = sid
      and (
        member.user_id is not null
        or (session.teacher_override = uid and substitute.id is not null)
      )
  );
$$;

revoke all on function public.is_session_member(uuid, uuid) from public, anon;
grant execute on function public.is_session_member(uuid, uuid) to authenticated;

comment on function public.is_session_member(uuid, uuid) is
  'True for classroom members and the active teacher_override of this session; admin/staff status alone is insufficient.';

-- The live route loads class_sessions through table RLS before it calls any
-- member-scoped RPC. Keep the existing policy name, but make it consume the
-- same session-aware predicate so a valid substitute does not receive a 404.
drop policy if exists "sessions_select_member" on public.class_sessions;
create policy "sessions_select_member" on public.class_sessions
  for select to authenticated
  using (public.is_session_member(id, (select auth.uid())));

-- A substitute needs the classroom shell and roster to render this session,
-- but is not inserted into classroom_members and does not inherit class-level
-- management or invite privileges.
drop policy if exists "classrooms_select_session_substitute" on public.classrooms;
create policy "classrooms_select_session_substitute" on public.classrooms
  for select to authenticated
  using (exists (
    select 1
    from public.class_sessions session
    where session.classroom_id = classrooms.id
      and session.teacher_override = (select auth.uid())
      and session.deleted_at is null
  ));

drop policy if exists "cls_members_select_session_substitute" on public.classroom_members;
create policy "cls_members_select_session_substitute" on public.classroom_members
  for select to authenticated
  using (exists (
    select 1
    from public.class_sessions session
    where session.classroom_id = classroom_members.classroom_id
      and session.teacher_override = (select auth.uid())
      and session.deleted_at is null
  ));
