-- 在已经识别的本机隔离库中由 BEGIN / ROLLBACK 包裹。
begin;
set local statement_timeout='60s';
do $check$
declare actor uuid; member uuid; role_id uuid:=gen_random_uuid(); root_id uuid:=gen_random_uuid(); child_id uuid:=gen_random_uuid();
  other_id uuid:=gen_random_uuid(); sid uuid; outside_sid uuid; lid uuid; outside_lid uuid; profile jsonb; label text:='组长权限事务 '||gen_random_uuid();
begin
  select id into actor from public.profiles where role='staff' and purpose='test' and is_active and account_status='active'
    and not password_change_required order by id limit 1;
  select id into member from public.profiles where role='staff' and purpose='test' and is_active and account_status='active'
    and not password_change_required and id<>actor order by id limit 1;
  if actor is null or member is null then raise exception 'FIXED_DEVELOPMENT_STAFF_REQUIRED'; end if;
  delete from public.staff_role_members where user_id=actor;
  update public.school_business_group_members set removed_at=now() where user_id=actor;
  insert into public.staff_roles(id,key,name) values(role_id,'leader_fixture_'||role_id,label);
  insert into public.role_permissions(role_id,perm_key) values(role_id,'student.view.assigned'),(role_id,'followup.view');
  insert into public.staff_role_members(user_id,role_id) values(actor,role_id);
  insert into public.school_business_groups(id,name,parent_id) values(root_id,label,null),(child_id,label||'下级',root_id),(other_id,label||'组外',null);
  insert into public.school_business_group_members(group_id,user_id,is_lead) values(root_id,actor,true),(child_id,member,false);
  insert into public.students(name,bind_code,assigned_to,created_by,purpose) values(label,gen_random_uuid()::text,member,member,'test') returning id into sid;
  insert into public.students(name,bind_code,created_by,purpose) values(label||'外',gen_random_uuid()::text,member,'test') returning id into outside_sid;
  insert into public.leads(provisional_student_name,normalized_name,phone,phone_normalized,owner_id,created_by,purpose)
    values(label,public.normalize_lead_name(label),'15500001341','15500001341',member,member,'test') returning id into lid;
  insert into public.leads(provisional_student_name,normalized_name,phone,phone_normalized,created_by,purpose)
    values(label||'外',public.normalize_lead_name(label||'外'),'15500001342','15500001342',member,'test') returning id into outside_lid;
  -- 创建者不是正式对象负责人：去除造数时附带的参与关系，专门核对组外对象。
  delete from public.school_subject_participants where student_id=outside_sid or lead_id=outside_lid;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  if not public.has_perm(actor,'student.edit') or not public.has_perm(actor,'followup.write') then raise exception 'LEADER_CAPABILITY_MISSING'; end if;
  if public.has_perm(actor,'student.view.all') or public.has_perm(actor,'permission.configure') then raise exception 'LEADER_GLOBAL_PERMISSION_LEAK'; end if;
  if not public.can_access_student(sid,actor) or not public.can_edit_school_lead(lid,actor) then raise exception 'DESCENDANT_SUBJECT_NOT_EDITABLE'; end if;
  if public.can_access_student(outside_sid,actor) or public.can_edit_school_lead(outside_lid,actor) then raise exception 'OUTSIDE_SUBJECT_EDITABLE'; end if;
  if not exists(select 1 from public.school_list_visibility(actor) where key='student:'||sid and can_access and can_view)
    or not exists(select 1 from public.school_list_visibility(actor) where key='lead:'||lid and can_access and can_view) then raise exception 'LIST_PERMISSION_MISMATCH'; end if;
  profile:=public.read_school_support_profile(sid,null);
  if not (profile->>'canEdit')::boolean then raise exception 'PROFILE_PERMISSION_MISSING'; end if;
  perform public.update_school_support_profile(sid,null,profile->>'version',jsonb_set(profile->'values','{remark}',to_jsonb('组长事务登记'::text)));
  if (select remark from public.students where id=sid)<>'组长事务登记' then raise exception 'PROFILE_SAVE_NOT_APPLIED'; end if;
  -- 撤销组长即时失去组内办理能力，仍保持普通成员查看。
  update public.school_business_group_members set is_lead=false where group_id=root_id and user_id=actor;
  if public.can_access_student(sid,actor) or public.can_edit_school_lead(lid,actor) or public.has_perm(actor,'student.edit') then raise exception 'REVOKED_LEADER_STILL_WRITES'; end if;
  if not public.can_view_school_student(sid,actor) then raise exception 'MEMBER_READ_LOST'; end if;
  update public.school_business_group_members set is_lead=true where group_id=root_id and user_id=actor;
  update public.school_business_groups set archived_at=now() where id=root_id;
  if public.can_access_student(sid,actor) then raise exception 'ARCHIVED_GROUP_STILL_WRITES'; end if;
end $check$;
rollback;
