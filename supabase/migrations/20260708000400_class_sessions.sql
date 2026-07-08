-- ============================================================================
-- P4-4 课堂事件层（docs/plan/08-§3.4/§3.6/§4）
-- class_sessions：课次 + 课件页数组（jsonb，页类型 image/video/game/board）。
-- session_events：append-only 课堂事件流；id 为客户端 uuid（幂等回传关键），
--   (session_id, device_id, seq) 唯一约束去重；离线事件晚到，不设时间锁。
-- Storage：私有 bucket courseware，路径首段 = classroom_id。
-- ============================================================================

create table public.class_sessions (
  id           uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  title        text not null default '',
  courseware   jsonb not null default '[]',
  current_page int not null default 0,
  started_at   timestamptz,
  ended_at     timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint class_sessions_courseware_cap check (octet_length(courseware::text) <= 1048576)
);

comment on table public.class_sessions is '课次；courseware 为有序页数组，current_page 由教师端回传';

create index class_sessions_classroom_idx on public.class_sessions (classroom_id, created_at desc);

create trigger class_sessions_set_updated_at
  before update on public.class_sessions
  for each row execute function public.set_updated_at();

create table public.session_events (
  id         uuid primary key,
  session_id uuid not null references public.class_sessions (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  device_id  text not null,
  seq        bigint not null,
  type       text not null,
  payload    jsonb not null default '{}',
  at         timestamptz not null,
  created_at timestamptz not null default now(),
  unique (session_id, device_id, seq),
  constraint session_events_payload_cap check (octet_length(payload::text) <= 1048576)
);

comment on table public.session_events is '课堂事件流 append-only；at 为客户端时间（报告展示），created_at 仅审计';

create index session_events_session_type_idx on public.session_events (session_id, type);

-- RLS 辅助（security definer 防策略递归）
create function public.is_session_member(sid uuid, uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.class_sessions s
      join public.classroom_members m on m.classroom_id = s.classroom_id
     where s.id = sid and m.user_id = uid
  );
$$;

create function public.is_session_teacher(sid uuid, uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.class_sessions s
      join public.classroom_members m on m.classroom_id = s.classroom_id
     where s.id = sid and m.user_id = uid and m.role = 'teacher'
  );
$$;

revoke all on function public.is_session_member(uuid, uuid) from public;
revoke all on function public.is_session_teacher(uuid, uuid) from public;
grant execute on function public.is_session_member(uuid, uuid) to authenticated;
grant execute on function public.is_session_teacher(uuid, uuid) to authenticated;

alter table public.class_sessions enable row level security;

create policy "sessions_select_member" on public.class_sessions
  for select to authenticated
  using (public.is_classroom_member(classroom_id, (select auth.uid())));
create policy "sessions_insert_teacher" on public.class_sessions
  for insert to authenticated
  with check (public.is_classroom_teacher(classroom_id, (select auth.uid())));
create policy "sessions_update_teacher" on public.class_sessions
  for update to authenticated
  using (public.is_classroom_teacher(classroom_id, (select auth.uid())))
  with check (public.is_classroom_teacher(classroom_id, (select auth.uid())));
create policy "sessions_delete_teacher" on public.class_sessions
  for delete to authenticated
  using (public.is_classroom_teacher(classroom_id, (select auth.uid())));

revoke all on public.class_sessions from anon, authenticated;
grant select on public.class_sessions to authenticated;
grant insert (classroom_id, title, courseware) on public.class_sessions to authenticated;
grant update (title, courseware, current_page, started_at, ended_at) on public.class_sessions to authenticated;
grant delete on public.class_sessions to authenticated;

alter table public.session_events enable row level security;

create policy "events_select_member" on public.session_events
  for select to authenticated
  using (public.is_session_member(session_id, (select auth.uid())));
-- 学生可写类型白名单（举手/作答），其余类型（翻页/加星/板书快照/发题…）仅教师；
-- 离线事件晚到不等于放松鉴权（08-§7）
create policy "events_insert_own" on public.session_events
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_session_member(session_id, (select auth.uid()))
    and (
      type in ('hand', 'answer')
      or public.is_session_teacher(session_id, (select auth.uid()))
    )
  );

revoke all on public.session_events from anon, authenticated;
grant select, insert on public.session_events to authenticated;

-- 私有频道 session:<uuid>：读/写 = 教室成员（broadcast payload 仅提示，业务数值以事件流/DB 为准）
create policy "session_broadcast_receive_member" on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and (select realtime.topic()) ~* '^session:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_session_member(substring((select realtime.topic()) from 9)::uuid, (select auth.uid()))
  );

create policy "session_broadcast_send_member" on realtime.messages
  for insert to authenticated
  with check (
    extension = 'broadcast'
    and (select realtime.topic()) ~* '^session:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_session_member(substring((select realtime.topic()) from 9)::uuid, (select auth.uid()))
  );

create policy "session_presence_receive_member" on realtime.messages
  for select to authenticated
  using (
    extension = 'presence'
    and (select realtime.topic()) ~* '^session:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_session_member(substring((select realtime.topic()) from 9)::uuid, (select auth.uid()))
  );

create policy "session_presence_send_member" on realtime.messages
  for insert to authenticated
  with check (
    extension = 'presence'
    and (select realtime.topic()) ~* '^session:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_session_member(substring((select realtime.topic()) from 9)::uuid, (select auth.uid()))
  );

-- 课件 Storage：私有 bucket，路径 <classroom_id>/<hash>.<ext>；
-- 图片/视频体积远超笔记贴图，上限 200MB
insert into storage.buckets (id, name, public, file_size_limit)
values ('courseware', 'courseware', false, 209715200)
on conflict (id) do nothing;

create policy "courseware_select_member" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'courseware'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_classroom_member(((storage.foldername(name))[1])::uuid, (select auth.uid()))
  );

create policy "courseware_insert_teacher" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'courseware'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_classroom_teacher(((storage.foldername(name))[1])::uuid, (select auth.uid()))
  );

create policy "courseware_delete_teacher" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'courseware'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_classroom_teacher(((storage.foldername(name))[1])::uuid, (select auth.uid()))
  );
