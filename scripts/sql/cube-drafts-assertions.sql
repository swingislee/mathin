-- 由 cube-drafts-local.mjs 在已核对的本机事务中运行，最后回滚。
-- 复用固定教师与学辅身份；不创建账号、不修改身份或正式业务数据。
do $$
declare owner_id uuid; other_id uuid;
begin
  select id into owner_id from auth.users where email='test-teacher@mathin.local';
  select id into other_id from auth.users where email='test-sales@mathin.local';
  if owner_id is null or other_id is null
    or not exists(select 1 from public.profiles where id=owner_id and is_active and account_status='active')
    or not exists(select 1 from public.profiles where id=other_id and is_active and account_status='active') then
    raise exception 'FIXED_LOCAL_ACCOUNTS_REQUIRED';
  end if;
  perform set_config('cube_drafts.owner', owner_id::text, true);
  perform set_config('cube_drafts.other', other_id::text, true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub',current_setting('cube_drafts.owner'),'role','authenticated')::text, true);
do $$
declare
  draft_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  saved public.cube_structure_drafts;
  payload jsonb := '{"version":"cube-structures-saved-draft-v1","identity":0,"session":{"work":{},"lesson":null,"recording":"off","preview":null}}';
begin
  select * into saved from public.save_cube_structure_draft(draft_id, '结构草稿', payload, 0);
  perform set_config('cube_drafts.test_id', draft_id::text, true);
  if saved.owner_id <> auth.uid() or saved.revision <> 1 or saved.name <> '结构草稿' then raise exception 'CREATE_FAILED'; end if;
  select * into saved from public.save_cube_structure_draft(draft_id, '更新草稿', payload, 1);
  if saved.revision <> 2 then raise exception 'REVISION_FAILED'; end if;
  begin
    perform public.save_cube_structure_draft(draft_id, '过期覆盖', payload, 1);
    raise exception 'STALE_WRITE_ALLOWED';
  exception when raise_exception then if sqlerrm <> 'CUBE_DRAFT_CONFLICT' then raise; end if; end;
  if not exists(select 1 from public.cube_structure_drafts where id=draft_id and name='更新草稿' and revision=2) then raise exception 'CONFLICT_OVERWROTE_DATA'; end if;
  begin
    insert into public.cube_structure_drafts(id,owner_id,name,snapshot) values(other_id,auth.uid(),'直接写入',payload);
    raise exception 'DIRECT_INSERT_ALLOWED';
  exception when insufficient_privilege then null; end;
  begin
    update public.cube_structure_drafts set name='直接覆盖' where id=draft_id;
    raise exception 'DIRECT_UPDATE_ALLOWED';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.cube_structure_drafts where id=draft_id;
    raise exception 'DIRECT_DELETE_ALLOWED';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_cube_structure_draft(other_id, '损坏草稿', '{}'::jsonb, 0);
    raise exception 'INVALID_ENVELOPE_ALLOWED';
  exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claims', jsonb_build_object('sub',current_setting('cube_drafts.other'),'role','authenticated')::text, true);
do $$ begin
  if exists(select 1 from public.cube_structure_drafts where id=current_setting('cube_drafts.test_id')::uuid) then raise exception 'FOREIGN_READ_ALLOWED'; end if;
  begin
    perform public.save_cube_structure_draft(current_setting('cube_drafts.test_id')::uuid, '越权覆盖',
      '{"version":"cube-structures-saved-draft-v1","identity":0,"session":{"recording":"off","preview":null}}', 2);
    raise exception 'FOREIGN_UPDATE_ALLOWED';
  exception when no_data_found then null; end;
end $$;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
do $$ begin
  if exists(select 1 from public.cube_structure_drafts) then raise exception 'MISSING_UID_READ_ALLOWED'; end if;
  begin
    perform public.save_cube_structure_draft(gen_random_uuid(), '无身份写入', '{}'::jsonb, 0);
    raise exception 'MISSING_UID_WRITE_ALLOWED';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.cube_structure_drafts; raise exception 'ANON_READ_ALLOWED'; exception when insufficient_privilege then null; end;
  begin perform public.save_cube_structure_draft(gen_random_uuid(), '匿名写入', '{}'::jsonb, 0); raise exception 'ANON_RPC_ALLOWED'; exception when insufficient_privilege then null; end;
end $$;
reset role;
