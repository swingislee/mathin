-- Run only in a verified isolated development database, in BEGIN / ROLLBACK.
create function pg_temp.expect_org_error(p_sql text,p_error text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then
    if sqlerrm=p_error then return; end if;
    raise exception 'EXPECTED_%,GOT_%',p_error,sqlerrm;
  end;
  raise exception 'EXPECTED_ERROR_%',p_error;
end $$;

do $org$
declare v_admin uuid; v_teacher uuid; v_role uuid:=gen_random_uuid(); v_dept uuid:=gen_random_uuid(); v_group uuid:=gen_random_uuid();
  v_rule uuid:=gen_random_uuid(); v_settings jsonb; v_staff jsonb; v_order text[];
begin
  select p.id into v_admin from public.profiles p join auth.users u on u.id=p.id
    where u.email='test-admin@mathin.local' and p.purpose='test' and p.role='admin';
  select id into v_teacher from public.profiles where role='staff' and purpose='test' and is_active and account_status='active'
    and not password_change_required order by id limit 1;
  if v_admin is null or v_teacher is null then raise exception 'FIXED_DEVELOPMENT_STAFF_REQUIRED'; end if;
  delete from public.staff_role_members where user_id=v_teacher;
  insert into public.staff_roles(id,key,name) values(v_role,'org_fixture_'||v_role,'组织事务岗位');
  insert into public.role_permissions(role_id,perm_key) values(v_role,'review.write');
  insert into public.staff_role_members(user_id,role_id) values(v_teacher,v_role);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,true);

  -- 原表组别按编号排序。
  select array_agg(name order by public.school_group_sort_key(id)) into v_order from public.school_business_groups where source_code in ('1','2','3');
  if v_order is distinct from array['一组','二组','三组'] then raise exception 'SOURCE_GROUP_ORDER %',v_order; end if;

  -- 一次保存：新部门、下级小组、组长、多分工。
  v_settings:=public.save_school_organization(jsonb_build_object(
    'units',jsonb_build_array(
      jsonb_build_object('id',v_group,'name','组织事务小组 '||v_group,'kind','group','sortOrder',0,'parentId',v_dept),
      jsonb_build_object('id',v_dept,'name','组织事务部门 '||v_dept,'kind','dept','sortOrder',99,'parentId',null)),
    'members',jsonb_build_array(jsonb_build_object('groupId',v_group,'userId',v_teacher,'active',true,'lead',true),
      jsonb_build_object('groupId',v_dept,'userId',v_admin,'active',true,'lead',false)),
    'roles',jsonb_build_array(jsonb_build_object('userId',v_teacher,'roles',jsonb_build_array('teacher','assessment_teacher')))));
  if (select parent_id from public.school_business_groups where id=v_group) is distinct from v_dept then raise exception 'PARENT_NOT_SAVED'; end if;
  if not exists(select 1 from public.school_business_group_members where group_id=v_group and user_id=v_teacher and is_lead and removed_at is null) then raise exception 'LEAD_NOT_SAVED'; end if;
  select s into v_staff from jsonb_array_elements(v_settings->'staff') s where s->>'id'=v_teacher::text;
  if jsonb_array_length(v_staff->'roles')<>2 or v_staff->>'role'<>'assessment_teacher' then raise exception 'ROLES_NOT_SAVED %',v_staff; end if;
  if not exists(select 1 from jsonb_array_elements(v_settings->'groups') g where g->>'id'=v_group::text and g->>'parentId'=v_dept::text
    and g->'leadIds' @> to_jsonb(array[v_teacher])) then raise exception 'SETTINGS_TREE_MISSING'; end if;

  -- 层级生效：部门成员的查看范围包含下级小组；按部门的统一规则覆盖小组成员。
  if not exists(select 1 from public.school_actor_group_scope(v_admin) where group_id=v_group) then raise exception 'SCOPE_NOT_INHERITED'; end if;
  if exists(select 1 from public.school_actor_group_scope(v_teacher) where group_id=v_dept) then raise exception 'SCOPE_LEAKED_UPWARD'; end if;
  insert into public.assessment_availability_rules(id,teacher_id,scope,definition,created_by,updated_by)
    select v_rule,null,jsonb_build_object('kind','groups','ids',jsonb_build_array(v_dept)),r.definition,v_admin,v_admin
    from public.assessment_availability_rules r limit 1;
  if found and not public.assessment_rule_applies((select r from public.assessment_availability_rules r where id=v_rule),v_teacher) then raise exception 'RULE_NOT_INHERITED'; end if;
  if not exists(select 1 from jsonb_array_elements(public.get_assessment_rules_workspace()->'teachers') t
    where t->>'id'=v_teacher::text and t->'groupIds' @> to_jsonb(array[v_dept])) then raise exception 'WORKSPACE_LINEAGE_MISSING'; end if;
  delete from public.assessment_availability_rules where id=v_rule;

  perform set_config('test.org.dept',v_dept::text,true);
  perform set_config('test.org.group',v_group::text,true);
  perform set_config('test.org.teacher',v_teacher::text,true);
end $org$;

-- 环路、重名、非空归档与旧接口均受保护。
select pg_temp.expect_org_error(format($$select public.save_school_organization(jsonb_build_object('units',jsonb_build_array(
  jsonb_build_object('id',%L,'name','环路','kind','dept','sortOrder',0,'parentId',%L))))$$,
  current_setting('test.org.dept'),current_setting('test.org.group')),'ORGANIZATION_CYCLE');
select pg_temp.expect_org_error(format($$select public.save_school_organization(jsonb_build_object('units',jsonb_build_array(
  jsonb_build_object('id',gen_random_uuid(),'name','一组','kind','group','sortOrder',0,'parentId',null))))$$),'GROUP_NAME_TAKEN');
select pg_temp.expect_org_error(format($$select public.save_school_organization(jsonb_build_object('archive',jsonb_build_array(%L)))$$,
  current_setting('test.org.dept')),'GROUP_NOT_EMPTY');
select pg_temp.expect_org_error($$select public.save_school_organization('{"other":[]}'::jsonb)$$,'VALIDATION');

do $legacy$
declare v_teacher uuid:=current_setting('test.org.teacher')::uuid; v_group uuid:=current_setting('test.org.group')::uuid;
begin
  perform public.set_school_staff_business_role(v_teacher,'teacher');
  if (select array_agg(business_role) from public.school_staff_business_roles where user_id=v_teacher) is distinct from array['teacher'] then raise exception 'LEGACY_ROLE_REPLACE'; end if;
  perform public.save_school_organization(jsonb_build_object('members',jsonb_build_array(jsonb_build_object('groupId',v_group,'userId',v_teacher,'active',false))));
  perform public.save_school_organization(jsonb_build_object('archive',jsonb_build_array(v_group)));
  if (select archived_at from public.school_business_groups where id=v_group) is null then raise exception 'ARCHIVE_NOT_SAVED'; end if;
  if exists(select 1 from jsonb_array_elements(public.read_school_collaboration_settings()->'groups') g where g->>'id'=v_group::text) then raise exception 'ARCHIVED_VISIBLE'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_teacher,'role','authenticated','aal','aal2')::text,true);
  begin perform public.save_school_organization('{}'::jsonb); raise exception 'MANAGER_REQUIRED';
  exception when others then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
end $legacy$;
