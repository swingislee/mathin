-- ============================================================================
-- P4-2 白板协同（docs/plan/08-§3.2/§3.3）
-- 1) wb:<uuid> 私有频道策略：broadcast 读=成员、写=可编辑成员；presence 读写=成员。
-- 2) 邀请协作：invite_code 列 + owner 专属开关/读取 RPC + 凭码加入 RPC。
--    invite_code 不进普通列级 select（防成员转发扩权），owner 经 RPC 读取。
-- ============================================================================

alter table public.whiteboards add column invite_code text;

-- 收紧列级读权限：不暴露 invite_code
revoke select on public.whiteboards from authenticated;
grant select (id, owner_id, title, snapshot, created_at, updated_at)
  on public.whiteboards to authenticated;

create function public.set_whiteboard_invite(wb_id uuid, enabled boolean)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  code text;
begin
  if not public.is_whiteboard_owner(wb_id, auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;
  if enabled then
    -- 不依赖 pgcrypto（search_path 已锁 public）：md5(uuid+时钟) 截 18 hex
    code := substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 18);
    update public.whiteboards set invite_code = code where id = wb_id;
    return code;
  end if;
  update public.whiteboards set invite_code = null where id = wb_id;
  return null;
end;
$$;

create function public.get_whiteboard_invite(wb_id uuid)
returns text
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select w.invite_code
    from public.whiteboards w
   where w.id = wb_id
     and w.owner_id = auth.uid();
$$;

create function public.join_whiteboard(wb_id uuid, code text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or code is null or code = '' then
    return false;
  end if;
  if not exists (
    select 1 from public.whiteboards w
     where w.id = wb_id and w.invite_code is not null and w.invite_code = code
  ) then
    return false;
  end if;
  insert into public.whiteboard_members (whiteboard_id, user_id, can_edit)
  values (wb_id, auth.uid(), true)
  on conflict (whiteboard_id, user_id) do nothing;
  return true;
end;
$$;

revoke all on function public.set_whiteboard_invite(uuid, boolean) from public;
revoke all on function public.get_whiteboard_invite(uuid) from public;
revoke all on function public.join_whiteboard(uuid, text) from public;
grant execute on function public.set_whiteboard_invite(uuid, boolean) to authenticated;
grant execute on function public.get_whiteboard_invite(uuid) to authenticated;
grant execute on function public.join_whiteboard(uuid, text) to authenticated;

-- 私有频道策略。topic 先用正则校验再取 uuid，避免恶意 topic 造成 cast 报错。
create policy "wb_broadcast_receive_member" on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and (select realtime.topic()) ~* '^wb:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_whiteboard_member(substring((select realtime.topic()) from 4)::uuid, (select auth.uid()))
  );

create policy "wb_broadcast_send_editor" on realtime.messages
  for insert to authenticated
  with check (
    extension = 'broadcast'
    and (select realtime.topic()) ~* '^wb:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_whiteboard_member(substring((select realtime.topic()) from 4)::uuid, (select auth.uid()), true)
  );

create policy "wb_presence_receive_member" on realtime.messages
  for select to authenticated
  using (
    extension = 'presence'
    and (select realtime.topic()) ~* '^wb:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_whiteboard_member(substring((select realtime.topic()) from 4)::uuid, (select auth.uid()))
  );

create policy "wb_presence_send_member" on realtime.messages
  for insert to authenticated
  with check (
    extension = 'presence'
    and (select realtime.topic()) ~* '^wb:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_whiteboard_member(substring((select realtime.topic()) from 4)::uuid, (select auth.uid()))
  );
