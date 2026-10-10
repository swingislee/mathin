-- Run only in a verified isolated development database, in BEGIN / ROLLBACK.
do $board$
declare v_admin uuid; v_lead uuid; v_member uuid; v_outsider uuid; v_dept uuid:=gen_random_uuid(); v_group uuid:=gen_random_uuid();
  v_board jsonb; v_student uuid; v_key text; v_role uuid:=gen_random_uuid();
begin
  select p.id into v_admin from public.profiles p join auth.users u on u.id=p.id where u.email='test-admin@mathin.local' and p.role='admin';
  select id into v_lead from public.profiles where role='staff' and purpose='test' and is_active and account_status='active' order by id limit 1;
  select id into v_member from public.profiles where role='staff' and purpose='test' and is_active and account_status='active' and id<>v_lead order by id limit 1;
  select id into v_outsider from public.profiles where role='staff' and purpose='test' and is_active and account_status='active' and id not in (v_lead,v_member) order by id limit 1;
  if v_admin is null or v_member is null or v_outsider is null then raise exception 'FIXED_DEVELOPMENT_STAFF_REQUIRED'; end if;
  -- 事务内仅收窄固定测试员工的岗位，保证组长只靠组织身份获得查看权。
  delete from public.staff_role_members where user_id in (v_lead,v_member,v_outsider);
  insert into public.staff_roles(id,key,name) values(v_role,'lead_board_fixture_'||v_role,'观察台事务岗位');
  insert into public.role_permissions(role_id,perm_key) values(v_role,'followup.view'),(v_role,'followup.write');
  insert into public.staff_role_members(user_id,role_id) values(v_lead,v_role),(v_member,v_role),(v_outsider,v_role);

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,true);
  perform public.save_school_organization(jsonb_build_object(
    'units',jsonb_build_array(jsonb_build_object('id',v_dept,'name','观察台部门 '||v_dept,'kind','dept','sortOrder',90,'parentId',null),
      jsonb_build_object('id',v_group,'name','观察台小组 '||v_group,'kind','group','sortOrder',0,'parentId',v_dept)),
    'members',jsonb_build_array(jsonb_build_object('groupId',v_dept,'userId',v_lead,'active',true,'lead',true),
      jsonb_build_object('groupId',v_group,'userId',v_member,'active',true,'lead',false)),
    'roles',jsonb_build_array(jsonb_build_object('userId',v_member,'roles',jsonb_build_array('school_support')))));
  select id into v_student from public.students where deleted_at is null and purpose<>'test' order by id limit 1;
  update public.students set assigned_to=v_member where id=v_student;
  v_key:='student:'||v_student;

  -- 上级部门的组长可以看到下级小组成员负责的学生。
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_lead,'role','authenticated','aal','aal2')::text,true);
  v_board:=public.get_school_lead_board(v_dept);
  if not exists(select 1 from jsonb_array_elements(v_board->'units') u where u->>'id'=v_group::text) then raise exception 'LEAD_UNITS_MISSING_CHILD'; end if;
  if not exists(select 1 from jsonb_array_elements(v_board->'members') m where m->>'id'=v_member::text) then raise exception 'MEMBER_MISSING'; end if;
  if not exists(select 1 from jsonb_array_elements(v_board->'support') s where s->>'key'=v_key and s->>'ownerId'=v_member::text) then raise exception 'SUPPORT_SUBJECT_MISSING'; end if;
  perform public.get_school_lead_board_subject(v_dept,v_key);
  v_board:=public.save_school_lead_board_rules(v_dept,'support',jsonb_build_object('rules',jsonb_build_array(
    jsonb_build_object('color','red','all',jsonb_build_array(jsonb_build_array('sinceContact','>',7)))),'else','green','cadence',jsonb_build_object('first',1)));
  if v_board->'rules'->'support'->>'unitId' is distinct from v_dept::text then raise exception 'RULES_NOT_SAVED'; end if;
  -- 下级小组沿用上级部门的规则。
  if public.get_school_lead_board(v_group)->'rules'->'support'->>'unitId' is distinct from v_dept::text then raise exception 'RULES_NOT_INHERITED'; end if;

  -- 组员与组外员工都不能打开观察台。
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_member,'role','authenticated','aal','aal2')::text,true);
  if jsonb_array_length(public.get_school_lead_board(null)->'units')<>0 then raise exception 'MEMBER_SEES_UNITS'; end if;
  begin perform public.get_school_lead_board(v_group); raise exception 'MEMBER_NOT_BLOCKED';
  exception when others then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_outsider,'role','authenticated','aal','aal2')::text,true);
  begin perform public.get_school_lead_board_subject(v_dept,v_key); raise exception 'OUTSIDER_NOT_BLOCKED';
  exception when others then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  begin perform public.save_school_lead_board_rules(v_dept,'support','{"rules":[],"else":"gray"}'::jsonb); raise exception 'OUTSIDER_SAVE_NOT_BLOCKED';
  exception when others then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
end $board$;
