-- Run only in a verified isolated development database, in BEGIN / ROLLBACK.
do $reserve$
declare v_admin uuid; v_staff uuid; v_group uuid:=gen_random_uuid(); v_settings jsonb; v_row jsonb;
begin
  select p.id into v_admin from public.profiles p join auth.users u on u.id=p.id where u.email='test-admin@mathin.local' and p.role='admin';
  select id into v_staff from public.profiles where role='staff' and purpose='production' and is_active and account_status='active' order by id limit 1;
  if v_admin is null or v_staff is null then raise exception 'DEVELOPMENT_STAFF_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,true);
  delete from public.school_business_group_members where user_id=v_staff;

  v_settings:=public.set_school_staff_reserve(v_staff,'placeholder');
  select s into v_row from jsonb_array_elements(v_settings->'staff') s where s->>'id'=v_staff::text;
  if v_row->>'reserve' is distinct from 'placeholder' or (v_row->>'fixedTest')::boolean then raise exception 'RESERVE_NOT_SAVED %',v_row; end if;
  if not exists(select 1 from jsonb_array_elements(v_settings->'staff') s where (s->>'fixedTest')::boolean and s->>'reserve'='test') then raise exception 'TEST_NOT_RESERVED'; end if;
  v_settings:=public.set_school_staff_reserve(v_staff,null);
  if exists(select 1 from public.school_staff_reserve where user_id=v_staff) then raise exception 'RESERVE_NOT_CLEARED'; end if;

  perform public.save_school_organization(jsonb_build_object('units',jsonb_build_array(jsonb_build_object('id',v_group,'name','备用事务组 '||v_group,'kind','group','sortOrder',99,'parentId',null)),
    'members',jsonb_build_array(jsonb_build_object('groupId',v_group,'userId',v_staff,'active',true,'lead',false))));
  begin perform public.set_school_staff_reserve(v_staff,'other'); raise exception 'MEMBER_RESERVED';
  exception when others then if sqlerrm<>'STAFF_IN_ORGANIZATION' then raise; end if; end;
end $reserve$;

-- 一次保存：移出组织并移入备用账号；再移回并入组。
do $batch$
declare v_admin uuid; v_staff uuid; v_group uuid:=gen_random_uuid();
begin
  select p.id into v_admin from public.profiles p join auth.users u on u.id=p.id where u.email='test-admin@mathin.local' and p.role='admin';
  select id into v_staff from public.profiles where role='staff' and purpose='production' and is_active and account_status='active' order by id offset 1 limit 1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,true);
  delete from public.school_staff_reserve where user_id=v_staff;
  perform public.save_school_organization(jsonb_build_object('units',jsonb_build_array(jsonb_build_object('id',v_group,'name','备用批量组 '||v_group,'kind','group','sortOrder',98,'parentId',null)),
    'members',jsonb_build_array(jsonb_build_object('groupId',v_group,'userId',v_staff,'active',true,'lead',true))));
  perform public.save_school_organization(jsonb_build_object(
    'members',jsonb_build_array(jsonb_build_object('groupId',v_group,'userId',v_staff,'active',false,'lead',false)),
    'reserve',jsonb_build_array(jsonb_build_object('userId',v_staff,'reason','placeholder'))));
  if (select reason from public.school_staff_reserve where user_id=v_staff) is distinct from 'placeholder' then raise exception 'BATCH_RESERVE_MISSING'; end if;
  perform public.save_school_organization(jsonb_build_object(
    'members',jsonb_build_array(jsonb_build_object('groupId',v_group,'userId',v_staff,'active',true,'lead',false)),
    'reserve',jsonb_build_array(jsonb_build_object('userId',v_staff,'reason',null))));
  if exists(select 1 from public.school_staff_reserve where user_id=v_staff) then raise exception 'BATCH_RESTORE_MISSING'; end if;
end $batch$;
