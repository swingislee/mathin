-- P4E-S：绑码防枚举、课堂权威频道分权、白板快照乐观锁。

-- ---------------------------------------------------------------------------
-- 学生/监护人邀请码：48 bit 随机码、单用途、一次性、带尝试节流。
-- ---------------------------------------------------------------------------

alter table public.students
  add column if not exists bind_code_used_at timestamptz,
  add column if not exists bind_code_expires_at timestamptz not null default now()+interval '30 days';

create table public.bind_claim_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  purpose text not null check (purpose in ('student', 'guardian')),
  code_hash text not null,
  ip_hint text,
  attempted_at timestamptz not null default now(),
  ok boolean not null default false
);
create index bind_claim_attempts_rate_idx
  on public.bind_claim_attempts(user_id, purpose, attempted_at desc) where not ok;

create table public.guardian_bind_invitations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  code text not null unique,
  relation text not null default '',
  scope text[] not null default array['grades','video','finance']::text[],
  issued_by uuid not null references public.profiles(id),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references public.profiles(id),
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint guardian_invitation_scope check (scope <@ array['grades','video','finance']::text[])
);
create index guardian_bind_invitations_student_idx
  on public.guardian_bind_invitations(student_id, created_at desc);

create or replace function public.generate_student_bind_code()
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare code text;
begin
  loop
    code := lower(encode(gen_random_bytes(6), 'hex'));
    exit when not exists(select 1 from public.students where bind_code=code)
      and not exists(select 1 from public.guardian_bind_invitations where guardian_bind_invitations.code=code);
  end loop;
  return code;
end $$;

create or replace function public.assert_bind_claim_rate(p_uid uuid, p_purpose text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  -- 同一用户的并发尝试串行，防止并发请求同时越过计数。
  perform pg_advisory_xact_lock(hashtext(p_uid::text || ':' || p_purpose));
  if (select count(*) from public.bind_claim_attempts
       where user_id=p_uid and purpose=p_purpose and not ok
         and attempted_at > now() - interval '15 minutes') >= 5 then
    raise exception 'RATE_LIMITED';
  end if;
end $$;

create or replace function public.claim_student_account(p_code text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); sid uuid; normalized text:=lower(trim(coalesce(p_code,'')));
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  perform public.assert_bind_claim_rate(uid,'student');
  update public.students set user_id=uid, bind_code_used_at=now(), bind_code=public.generate_student_bind_code(),bind_code_expires_at=now()+interval '30 days'
   where bind_code=normalized and user_id is null and bind_code_used_at is null and bind_code_expires_at>now() and deleted_at is null
   returning id into sid;
  insert into public.bind_claim_attempts(user_id,purpose,code_hash,ok)
  values(uid,'student',encode(digest(normalized,'sha256'),'hex'),sid is not null);
  -- 无效码必须正常返回 null；若在这里 raise，刚写入的失败尝试会随事务回滚，
  -- 节流计数将永远为零。Server Action 负责把 null 翻译成 INVALID_BIND_CODE。
  if sid is null then return null; end if;
  return sid;
end $$;

create or replace function public.issue_guardian_invite(
  p_student_id uuid, p_relation text default '', p_scope text[] default array['grades','video','finance']::text[]
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); invite_code text;
begin
  if uid is null or not public.has_perm(uid,'student.edit') or not public.can_access_student(p_student_id,uid)
  then raise exception 'FORBIDDEN'; end if;
  if not coalesce(p_scope,'{}'::text[]) <@ array['grades','video','finance']::text[]
  then raise exception 'INVALID_SCOPE'; end if;
  loop
    invite_code:=public.generate_student_bind_code();
    exit when not exists(select 1 from public.guardian_bind_invitations where code=invite_code);
  end loop;
  insert into public.guardian_bind_invitations(student_id,code,relation,scope,issued_by)
  values(p_student_id,invite_code,left(trim(coalesce(p_relation,'')),50),coalesce(p_scope,'{}'::text[]),uid);
  return invite_code;
end $$;

alter table public.student_guardians
  add column if not exists scope text[] not null default array['grades','video','finance']::text[];

create or replace function public.bind_guardian(p_code text, p_relation text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); sid uuid; invite_id uuid; invite_relation text; invite_scope text[];
  normalized text:=lower(trim(coalesce(p_code,'')));
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  perform public.assert_bind_claim_rate(uid,'guardian');
  select id,student_id,relation,scope into invite_id,sid,invite_relation,invite_scope
    from public.guardian_bind_invitations
   where code=normalized and used_at is null and expires_at>now() for update;
  insert into public.bind_claim_attempts(user_id,purpose,code_hash,ok)
  values(uid,'guardian',encode(digest(normalized,'sha256'),'hex'),sid is not null);
  if sid is null then return null; end if;
  update public.guardian_bind_invitations set used_by=uid,used_at=now() where id=invite_id;
  insert into public.student_guardians(student_id,guardian_id,relation,scope)
  values(sid,uid,coalesce(nullif(trim(p_relation),''),invite_relation),invite_scope)
  on conflict(student_id,guardian_id) do update
    set relation=excluded.relation,scope=excluded.scope;
  perform set_config('app.allow_profile_role_update','1',true);
  update public.profiles set role='parent' where id=uid and role='student';
  return sid;
end $$;

alter table public.bind_claim_attempts enable row level security;
alter table public.guardian_bind_invitations enable row level security;
revoke all on public.bind_claim_attempts, public.guardian_bind_invitations from anon,authenticated;
grant select on public.guardian_bind_invitations to authenticated;
create policy guardian_invites_staff_select on public.guardian_bind_invitations
  for select to authenticated using(public.can_access_student(student_id,(select auth.uid())));
revoke all on function public.assert_bind_claim_rate(uuid,text) from public,anon,authenticated;
revoke all on function public.issue_guardian_invite(uuid,text,text[]) from public,anon,authenticated;
grant execute on function public.issue_guardian_invite(uuid,text,text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 课堂 broadcast 拆成 authoritative（教师写）/client（成员写）。原 topic
-- 仅保留 presence 与 P2P 信令，不再允许业务 broadcast。
-- ---------------------------------------------------------------------------

drop policy if exists "session_broadcast_receive_member" on realtime.messages;
drop policy if exists "session_broadcast_send_member" on realtime.messages;

create policy "session_broadcast_receive_split_member" on realtime.messages
  for select to authenticated using(
    extension='broadcast'
    and (select realtime.topic()) ~* '^session:[0-9a-f-]{36}:(authoritative|client)$'
    and public.is_session_member(substring((select realtime.topic()) from 9 for 36)::uuid,(select auth.uid()))
  );
create policy "session_broadcast_send_authoritative_teacher" on realtime.messages
  for insert to authenticated with check(
    extension='broadcast'
    and (select realtime.topic()) ~* '^session:[0-9a-f-]{36}:authoritative$'
    and public.is_session_teacher(substring((select realtime.topic()) from 9 for 36)::uuid,(select auth.uid()))
  );
create policy "session_broadcast_send_client_member" on realtime.messages
  for insert to authenticated with check(
    extension='broadcast'
    and (select realtime.topic()) ~* '^session:[0-9a-f-]{36}:client$'
    and public.is_session_member(substring((select realtime.topic()) from 9 for 36)::uuid,(select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- 白板快照：收回裸 snapshot update，改为 shape/大小校验 + version 乐观锁 RPC。
-- ---------------------------------------------------------------------------

alter table public.whiteboards add column if not exists version bigint not null default 0;
revoke update(snapshot) on public.whiteboards from authenticated;

create or replace function public.save_whiteboard_snapshot(wb_id uuid,p_snapshot jsonb,p_base_version bigint)
returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); next_version bigint;
begin
  if uid is null or not public.is_whiteboard_member(wb_id,uid,true) then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(p_snapshot) is distinct from 'array'
    or jsonb_array_length(p_snapshot)>4000
    or octet_length(p_snapshot::text)>1048576 then raise exception 'SNAPSHOT_TOO_LARGE_OR_INVALID'; end if;
  update public.whiteboards set snapshot=p_snapshot,version=version+1
   where id=wb_id and version=p_base_version returning version into next_version;
  if next_version is null then raise exception 'VERSION_CONFLICT'; end if;
  return next_version;
end $$;
revoke all on function public.save_whiteboard_snapshot(uuid,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.save_whiteboard_snapshot(uuid,jsonb,bigint) to authenticated;
