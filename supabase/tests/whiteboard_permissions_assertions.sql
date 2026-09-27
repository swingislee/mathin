\set ON_ERROR_STOP on
-- 仅在隔离开发库使用既有固定账号；所有画板及成员变更随事务回滚。
begin;

do $$
declare owner_id uuid; member_id uuid; other_id uuid;
begin
  if not has_column_privilege('authenticated','public.whiteboards','version','SELECT') then
    raise exception 'WHITEBOARD_VERSION_SELECT_REQUIRED';
  end if;
  if has_table_privilege('authenticated','public.whiteboards','SELECT')
    or has_column_privilege('authenticated','public.whiteboards','invite_code','SELECT')
    or has_column_privilege('authenticated','public.whiteboards','snapshot','UPDATE')
    or has_column_privilege('authenticated','public.whiteboards','version','UPDATE')
    or has_column_privilege('authenticated','public.whiteboards','owner_id','UPDATE')
    or has_any_column_privilege('anon','public.whiteboards','SELECT')
    or not (select relrowsecurity from pg_class where oid='public.whiteboards'::regclass)
    or not (select relrowsecurity from pg_class where oid='public.whiteboard_members'::regclass) then
    raise exception 'WHITEBOARD_PERMISSION_BOUNDARY_CHANGED';
  end if;
  select id into owner_id from public.profiles where display_name='测试-教师';
  select id into member_id from public.profiles where display_name='测试-学生';
  select id into other_id from public.profiles where display_name='测试-管理员';
  if owner_id is null or member_id is null or other_id is null then
    raise exception 'WHITEBOARD_FIXED_ACCOUNTS_REQUIRED';
  end if;
  perform set_config('mathin.whiteboard_test.owner',owner_id::text,true);
  perform set_config('mathin.whiteboard_test.member',member_id::text,true);
  perform set_config('mathin.whiteboard_test.other',other_id::text,true);
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
end $$;

set local role authenticated;
do $$
declare board_id uuid; board record; next_version bigint; invite text;
begin
  -- 与 createWhiteboard/getWhiteboard 相同的 INSERT RETURNING 与列投影。
  insert into public.whiteboards(owner_id,title)
    values(auth.uid(),'__WHITEBOARD_PERMISSION_ASSERTION__') returning id into board_id;
  perform set_config('mathin.whiteboard_test.board',board_id::text,true);
  select id,title,snapshot,version,updated_at,owner_id into strict board
    from public.whiteboards where id=board_id;
  if board.version<>0 or board.snapshot<>'[]'::jsonb or board.owner_id<>auth.uid()
    or not public.is_whiteboard_member(board_id,auth.uid(),true) then
    raise exception 'WHITEBOARD_CREATE_READ_FAILED';
  end if;
  next_version := public.save_whiteboard_snapshot(board_id,'[{"id":"permission-stroke","mode":"ink","color":"ink","wNorm":0.003,"points":[[0.1,0.2]]}]'::jsonb,0);
  if next_version<>1 or (select version from public.whiteboards where id=board_id)<>1
    or (select snapshot->0->>'id' from public.whiteboards where id=board_id)<>'permission-stroke' then
    raise exception 'WHITEBOARD_SAVE_READ_FAILED';
  end if;
  begin
    perform public.save_whiteboard_snapshot(board_id,'[]'::jsonb,0);
    raise exception 'WHITEBOARD_STALE_WRITE_ACCEPTED';
  exception when raise_exception then
    if sqlerrm<>'VERSION_CONFLICT' then raise; end if;
  end;
  update public.whiteboards set title='__WHITEBOARD_RENAMED__' where id=board_id;
  if (select title from public.whiteboards where id=board_id)<>'__WHITEBOARD_RENAMED__' then
    raise exception 'WHITEBOARD_RENAME_FAILED';
  end if;
  invite := public.set_whiteboard_invite(board_id,true);
  if invite is null or public.get_whiteboard_invite(board_id) is distinct from invite then
    raise exception 'WHITEBOARD_OWNER_INVITE_FAILED';
  end if;
  begin
    perform invite_code from public.whiteboards where id=board_id;
    raise exception 'WHITEBOARD_INVITE_COLUMN_EXPOSED';
  exception when insufficient_privilege then null;
  end;
  insert into public.whiteboard_members(whiteboard_id,user_id,can_edit)
    values(board_id,current_setting('mathin.whiteboard_test.member')::uuid,false);
  perform set_config('request.jwt.claim.sub',current_setting('mathin.whiteboard_test.member'),true);
end $$;

do $$
declare board_id uuid := current_setting('mathin.whiteboard_test.board')::uuid;
begin
  if (select version from public.whiteboards where id=board_id) is distinct from 1::bigint then
    raise exception 'WHITEBOARD_VIEWER_READ_FAILED';
  end if;
  begin
    perform public.save_whiteboard_snapshot(board_id,'[]'::jsonb,1);
    raise exception 'WHITEBOARD_VIEWER_WRITE_ACCEPTED';
  exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if;
  end;
  if public.get_whiteboard_invite(board_id) is not null then raise exception 'WHITEBOARD_MEMBER_INVITE_EXPOSED'; end if;
  begin
    perform public.set_whiteboard_invite(board_id,true);
    raise exception 'WHITEBOARD_MEMBER_INVITE_WRITE_ACCEPTED';
  exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub',current_setting('mathin.whiteboard_test.owner'),true);
  update public.whiteboard_members set can_edit=true
    where whiteboard_id=board_id and user_id=current_setting('mathin.whiteboard_test.member')::uuid;
  perform set_config('request.jwt.claim.sub',current_setting('mathin.whiteboard_test.member'),true);
  if public.save_whiteboard_snapshot(board_id,'[]'::jsonb,1)<>2 then raise exception 'WHITEBOARD_EDITOR_SAVE_FAILED'; end if;
  delete from public.whiteboards where id=board_id;
  if not exists(select id from public.whiteboards where id=board_id) then raise exception 'WHITEBOARD_MEMBER_DELETE_ACCEPTED'; end if;
  perform set_config('request.jwt.claim.sub',current_setting('mathin.whiteboard_test.other'),true);
end $$;

do $$
declare board_id uuid := current_setting('mathin.whiteboard_test.board')::uuid;
begin
  if exists(select id,title,snapshot,version,updated_at,owner_id from public.whiteboards where id=board_id)
    or exists(select 1 from public.whiteboard_members where whiteboard_id=board_id) then
    raise exception 'WHITEBOARD_OUTSIDER_READ_ACCEPTED';
  end if;
  begin
    insert into public.whiteboards(owner_id,title) values(current_setting('mathin.whiteboard_test.owner')::uuid,'forged');
    raise exception 'WHITEBOARD_FORGED_OWNER_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_whiteboard_snapshot(board_id,'[]'::jsonb,2);
    raise exception 'WHITEBOARD_OUTSIDER_WRITE_ACCEPTED';
  exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if;
  end;
  if public.join_whiteboard(board_id,'invalid') then raise exception 'WHITEBOARD_INVALID_INVITE_ACCEPTED'; end if;
end $$;

set local role anon;
do $$
begin
  begin
    perform id,version from public.whiteboards;
    raise exception 'WHITEBOARD_ANON_READ_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_whiteboard_snapshot(current_setting('mathin.whiteboard_test.board')::uuid,'[]'::jsonb,2);
    raise exception 'WHITEBOARD_ANON_WRITE_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
end $$;

set local role authenticated;
do $$
declare board_id uuid := current_setting('mathin.whiteboard_test.board')::uuid;
begin
  perform set_config('request.jwt.claim.sub',current_setting('mathin.whiteboard_test.owner'),true);
  delete from public.whiteboards where id=board_id;
  if exists(select id from public.whiteboards where id=board_id)
    or exists(select 1 from public.whiteboard_members where whiteboard_id=board_id) then
    raise exception 'WHITEBOARD_OWNER_DELETE_FAILED';
  end if;
end $$;
rollback;
select 'WHITEBOARD_PERMISSIONS_PASS';
