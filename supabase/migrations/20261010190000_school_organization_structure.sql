-- 员工组织：业务组升级为可嵌套、可排序的组织树；组长成为正式成员身份；业务分工可多选。
-- 层级生效：成员可查看所在组织及全部下级组织的学生资料；按组的诊断统一规则覆盖下级组织成员。
-- 既有组、成员、分工与来源组别保持原样；组织调整由一次保存原子生效并逐条记录。

alter table public.school_business_groups
  add column parent_id uuid references public.school_business_groups(id),
  add column kind text not null default 'group' check (kind in ('org','campus','dept','group')),
  add column sort_order integer not null default 0 check (sort_order between 0 and 100000),
  add column archived_at timestamptz,
  add column archived_by uuid references public.profiles(id),
  add constraint school_business_groups_not_own_parent check (parent_id is distinct from id);
alter table public.school_business_groups drop constraint school_business_groups_name_key;
create unique index school_business_groups_active_name on public.school_business_groups(btrim(name)) where archived_at is null;
create index school_business_groups_parent on public.school_business_groups(parent_id,sort_order) where archived_at is null;

-- 原表组别按编号排序（一组、二组、三组），其余按创建时间排在其后。
update public.school_business_groups g set sort_order=o.n from (
  select id,row_number() over(order by case when source_code ~ '^\d{1,4}$' then source_code::integer end nulls last,created_at,id) as n
  from public.school_business_groups) o where o.id=g.id;

alter table public.school_business_group_members add column is_lead boolean not null default false;

alter table public.school_staff_business_roles drop constraint school_staff_business_roles_pkey;
alter table public.school_staff_business_roles add primary key (user_id,business_role);

-- 自身及全部上级组织，按由近到远排列。
create function public.school_group_lineage(p_group uuid) returns uuid[]
language sql stable security definer set search_path=public,pg_temp as $$
  with recursive up(id,parent_id,depth) as (
    select id,parent_id,0 from public.school_business_groups where id=p_group
    union all select g.id,g.parent_id,up.depth+1 from up join public.school_business_groups g on g.id=up.parent_id where up.depth<64
  ) select coalesce(array_agg(id order by depth),'{}'::uuid[]) from up;
$$;

-- 成员所在组织及全部下级组织，即该成员按组织可查看的范围。
create function public.school_actor_group_scope(p_uid uuid) returns table(group_id uuid)
language sql stable security definer set search_path=public,pg_temp as $$
  with recursive down(id,depth) as (
    select m.group_id,0 from public.school_business_group_members m join public.school_business_groups g on g.id=m.group_id
      where m.user_id=p_uid and m.removed_at is null and g.archived_at is null
    union select g.id,down.depth+1 from down join public.school_business_groups g on g.parent_id=down.id
      where g.archived_at is null and down.depth<64
  ) select distinct id from down;
$$;

-- 组织树的显示顺序：逐层按同级顺序、名称排列。
create function public.school_group_sort_key(p_group uuid) returns text
language sql stable security definer set search_path=public,pg_temp as $$
  select string_agg(lpad(g.sort_order::text,6,'0')||':'||g.name,'/' order by l.depth desc)
    from unnest(public.school_group_lineage(p_group)) with ordinality l(id,depth) join public.school_business_groups g on g.id=l.id;
$$;

create or replace function public.assessment_rule_applies(p_rule public.assessment_availability_rules,p_teacher uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(p_rule.teacher_id=p_teacher or (p_rule.teacher_id is null and (
    p_rule.scope->>'kind'='all' or (p_rule.scope->>'kind'='teachers' and p_rule.scope->'ids' @> to_jsonb(array[p_teacher]))
    or (p_rule.scope->>'kind'='groups' and exists(select 1 from public.school_business_group_members m
      cross join lateral unnest(public.school_group_lineage(m.group_id)) a(group_id)
      where m.user_id=p_teacher and m.removed_at is null and p_rule.scope->'ids' @> to_jsonb(array[a.group_id]))))),false);
$$;

create or replace function public.school_subject_in_my_groups(p_student_id uuid,p_lead_id uuid,p_uid uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_staff(p_uid) and exists(select 1 from public.school_subject_group_rows(p_student_id,p_lead_id) g
    where g.id in(select group_id from public.school_actor_group_scope(p_uid)));
$$;

create or replace function public.school_list_scope_keys(p_actor uuid,p_scope text) returns table(key text)
language sql stable security definer set search_path=public,pg_temp as $$
  with participants as materialized (
    select coalesce('student:'||p.student_id,'student:'||l.student_id,'lead:'||p.lead_id) as key,p.user_id
      from public.school_subject_participants p left join public.leads l on l.id=p.lead_id
      where p_scope in ('mine','group')
  ), actor_groups as materialized (
    select group_id from public.school_actor_group_scope(p_actor) where p_scope='group'
  )
  select distinct p.key from participants p where p_scope='mine' and p.user_id=p_actor
  union
  select coalesce('student:'||g.student_id,'student:'||l.student_id,'lead:'||g.lead_id)
    from public.school_subject_groups g join actor_groups a on a.group_id=g.group_id left join public.leads l on l.id=g.lead_id
  union
  select p.key from participants p join public.school_business_group_members m on m.user_id=p.user_id and m.removed_at is null
    join actor_groups a on a.group_id=m.group_id;
$$;

do $wire$
declare v_sig text; v_def text; v_before text; v_after text; v_defs jsonb:='{}';
begin
  for v_sig,v_before,v_after in select * from (values
    ('public.school_collaboration_projection(uuid,uuid,uuid)',
      '''inMyGroups'',(select active from actor) and exists(select 1 from groups g join public.school_business_group_members m',
      '''inMyGroups'',(select active from actor) and exists(select 1 from groups g join public.school_actor_group_scope(p_uid) m'),
    ('public.school_collaboration_projection(uuid,uuid,uuid)',
      'on m.group_id=g.id where m.user_id=p_uid and m.removed_at is null)',
      'on m.group_id=g.id)'),
    ('public.school_collaboration_projection(uuid,uuid,uuid)',
      '''groups'',coalesce((select jsonb_agg(jsonb_build_object(''id'',id,''name'',name) order by name) from groups),''[]''::jsonb)',
      '''groups'',coalesce((select jsonb_agg(jsonb_build_object(''id'',id,''name'',name) order by public.school_group_sort_key(id)) from groups),''[]''::jsonb)'),
    ('public.school_list_collaboration(jsonb,uuid)',
      'select group_id from public.school_business_group_members where user_id=p_actor and removed_at is null',
      'select group_id from public.school_actor_group_scope(p_actor)'),
    ('public.school_list_collaboration(jsonb,uuid)',
      'jsonb_agg(jsonb_build_object(''id'',g.id,''name'',g.name) order by g.name) as groups',
      'jsonb_agg(jsonb_build_object(''id'',g.id,''name'',g.name) order by public.school_group_sort_key(g.id)) as groups'),
    ('public.get_assessment_rules_workspace()',
      '''groupIds'',coalesce((select jsonb_agg(m.group_id) from public.school_business_group_members m where m.user_id=p.id and m.removed_at is null),''[]''::jsonb)',
      '''groupIds'',coalesce((select jsonb_agg(distinct a.group_id) from public.school_business_group_members m cross join lateral unnest(public.school_group_lineage(m.group_id)) a(group_id) where m.user_id=p.id and m.removed_at is null),''[]''::jsonb)'),
    ('public.get_assessment_rules_workspace()',
      'order by g.name) from public.school_business_groups g',
      'order by public.school_group_sort_key(g.id)) from public.school_business_groups g'),
    ('public.get_assessment_rules_workspace()',
      'where v_all or exists(select 1 from public.school_business_group_members m where m.group_id=g.id and m.user_id=v_uid and m.removed_at is null)),''[]''::jsonb));',
      'where g.archived_at is null and (v_all or g.id in(select group_id from public.school_actor_group_scope(v_uid)))),''[]''::jsonb));')
  ) changes(sig,before_text,after_text) loop
    -- 同一函数的多处替换全部完成后再一次重建。
    v_def:=coalesce(v_defs->>v_sig,pg_get_functiondef(v_sig::regprocedure));
    if position(v_before in v_def)=0 then raise exception 'ORGANIZATION_SCOPE_ANCHOR_MISSING: % / %',v_sig,left(v_before,60); end if;
    v_defs:=v_defs||jsonb_build_object(v_sig,replace(v_def,v_before,v_after));
  end loop;
  for v_sig,v_def in select * from jsonb_each_text(v_defs) loop execute v_def; end loop;
end $wire$;

create or replace function public.read_school_collaboration_settings() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare manager boolean:=public.can_manage_school_groups();
begin
  if not public.is_staff(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object('canManage',manager,
    'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'parentId',g.parent_id,'kind',g.kind,'sortOrder',g.sort_order,
      'memberIds',coalesce((select jsonb_agg(m.user_id order by m.user_id) from public.school_business_group_members m where m.group_id=g.id and m.removed_at is null),'[]'::jsonb),
      'leadIds',coalesce((select jsonb_agg(m.user_id order by m.user_id) from public.school_business_group_members m where m.group_id=g.id and m.removed_at is null and m.is_lead),'[]'::jsonb),
      'studentCount',(select count(distinct s.subject_key) from public.school_subject_groups s where s.group_id=g.id))
      order by public.school_group_sort_key(g.id))
      from public.school_business_groups g where g.archived_at is null
        and (manager or g.id in(select group_id from public.school_actor_group_scope(auth.uid())))),'[]'::jsonb),
    'staff',case when manager then coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,
      'role',(select r.business_role from public.school_staff_business_roles r where r.user_id=p.id
        order by array_position(array['school_support','assessment_teacher','teacher'],r.business_role) limit 1),
      'roles',coalesce((select jsonb_agg(r.business_role order by array_position(array['school_support','assessment_teacher','teacher'],r.business_role))
        from public.school_staff_business_roles r where r.user_id=p.id),'[]'::jsonb),
      'jobs',coalesce((select jsonb_agg(sr.name order by sr.name) from public.staff_role_members sm join public.staff_roles sr on sr.id=sm.role_id where sm.user_id=p.id),'[]'::jsonb),
      'canFollowUp',public.has_perm(p.id,'followup.write'),'canReview',public.has_perm(p.id,'review.write'),
      'studentCount',(select count(*) from public.students s where s.assigned_to=p.id and s.deleted_at is null),
      'classCount',(select count(*) from public.classrooms c where c.owner_id=p.id and c.archived_at is null and c.trashed_at is null),
      'upcomingAssessmentCount',(select count(*) from public.assessment_slots s where s.teacher_id=p.id and s.enabled
        and s.starts_at>=now() and s.starts_at<now()+interval '14 days')) order by p.display_name,p.id)
      from public.profiles p where p.role in ('staff','admin') and p.is_active and p.account_status='active'),'[]'::jsonb) else '[]'::jsonb end,
    'rules',case when manager then coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'kind',r.definition->>'kind','label',coalesce(r.definition->>'label',''),
      'groupIds',r.scope->'ids') order by r.definition->>'kind',r.id)
      from public.assessment_availability_rules r where r.teacher_id is null and r.scope->>'kind'='groups'),'[]'::jsonb) else '[]'::jsonb end);
end $$;

create or replace function public.save_school_business_group(p_id uuid,p_name text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare gid uuid; prior jsonb;
begin
  if not public.can_manage_school_groups() then raise exception 'FORBIDDEN'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 80 then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('school-organization',0));
  if p_id is null then insert into public.school_business_groups(name,created_by,sort_order)
    values(btrim(p_name),auth.uid(),coalesce((select max(sort_order)+1 from public.school_business_groups where parent_id is null and archived_at is null),0)) returning id into gid;
  else
    select to_jsonb(g) into prior from public.school_business_groups g where id=p_id and archived_at is null for update;
    if prior is null then raise exception 'NOT_FOUND'; end if;
    update public.school_business_groups set name=btrim(p_name) where id=p_id returning id into gid;
  end if;
  insert into public.school_collaboration_events(action,subject_id,previous_values,saved_values,recorded_by)
    values('save_group',gid,prior,jsonb_build_object('name',btrim(p_name)),auth.uid());
  return gid;
end $$;

create function public.set_school_staff_business_roles(p_user_id uuid,p_roles text[]) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare prior jsonb; v_roles text[]:=coalesce(p_roles,'{}'::text[]);
begin
  if not public.can_manage_school_groups() then raise exception 'FORBIDDEN'; end if;
  if cardinality(v_roles)>3 or array_position(v_roles,null) is not null
    or cardinality(v_roles)<>(select count(distinct x) from unnest(v_roles) x)
    or exists(select 1 from unnest(v_roles) x where x not in ('school_support','assessment_teacher','teacher'))
    or not exists(select 1 from public.profiles where id=p_user_id and role in ('staff','admin')) then raise exception 'VALIDATION'; end if;
  if 'school_support'=any(v_roles) and not exists(select 1 from public.school_staff_business_roles where user_id=p_user_id and business_role='school_support')
    and (not public.is_staff(p_user_id) or not public.has_perm(p_user_id,'followup.write')) then raise exception 'TARGET_CANNOT_FOLLOW_UP'; end if;
  perform pg_advisory_xact_lock(hashtextextended('school-business-role:'||p_user_id,0));
  select jsonb_build_object('roles',coalesce(jsonb_agg(business_role order by business_role),'[]'::jsonb)) into prior
    from public.school_staff_business_roles where user_id=p_user_id;
  if prior->'roles'=(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from unnest(v_roles) x) then return; end if;
  delete from public.school_staff_business_roles where user_id=p_user_id and not business_role=any(v_roles);
  insert into public.school_staff_business_roles(user_id,business_role,updated_by)
    select p_user_id,x,auth.uid() from unnest(v_roles) x on conflict do nothing;
  insert into public.school_collaboration_events(action,subject_id,previous_values,saved_values,recorded_by)
    values('set_business_role',p_user_id,prior,jsonb_build_object('roles',to_jsonb(v_roles)),auth.uid());
end $$;

create or replace function public.set_school_staff_business_role(p_user_id uuid,p_role text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.set_school_staff_business_roles(p_user_id,case when p_role is null then '{}'::text[] else array[p_role] end);
end $$;

-- 组织画板的一次保存：组织增改、上级与顺序、成员与组长、业务分工、归档。全部通过才生效。
create function public.save_school_organization(p_changes jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); item jsonb; v_id uuid; v_parent uuid; v_user uuid; prior jsonb; v_moved uuid[]:='{}'; v_teacher uuid;
  v_roles text[]; v_lead boolean;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.can_manage_school_groups() then raise exception 'FORBIDDEN'; end if;
  if p_changes is null or jsonb_typeof(p_changes)<>'object' or pg_column_size(p_changes)>262144
    or p_changes-array['units','members','roles','archive']<>'{}'::jsonb
    or exists(select 1 from unnest(array['units','members','roles','archive']) k where jsonb_typeof(coalesce(p_changes->k,'[]'::jsonb))<>'array'
      or jsonb_array_length(coalesce(p_changes->k,'[]'::jsonb))>500) then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('school-organization',0));

  begin
    -- 组织：先写名称、类型、顺序，再统一设置上级，最后检查环路。
    for item in select * from jsonb_array_elements(coalesce(p_changes->'units','[]'::jsonb)) loop
      v_id:=(item->>'id')::uuid;
      if v_id is null or jsonb_typeof(item)<>'object' or item->>'name' is null or length(btrim(item->>'name')) not between 1 and 80
        or item->>'kind' is null or item->>'kind' not in ('org','campus','dept','group')
        or jsonb_typeof(item->'sortOrder')<>'number' or (item->>'sortOrder')::numeric not between 0 and 100000
        or (item->>'sortOrder')::numeric<>trunc((item->>'sortOrder')::numeric) then raise exception 'VALIDATION'; end if;
      select to_jsonb(g) into prior from public.school_business_groups g where g.id=v_id for update;
      if prior is not null and prior->>'archived_at' is not null then raise exception 'NOT_FOUND'; end if;
      if prior is null then
        insert into public.school_business_groups(id,name,kind,sort_order,created_by)
          values(v_id,btrim(item->>'name'),item->>'kind',(item->>'sortOrder')::integer,v_uid);
      else
        update public.school_business_groups set name=btrim(item->>'name'),kind=item->>'kind',sort_order=(item->>'sortOrder')::integer where id=v_id;
      end if;
      insert into public.school_collaboration_events(action,subject_id,previous_values,saved_values,recorded_by)
        values('save_group',v_id,prior,item,v_uid);
    end loop;
    for item in select * from jsonb_array_elements(coalesce(p_changes->'units','[]'::jsonb)) loop
      v_id:=(item->>'id')::uuid; v_parent:=nullif(item->>'parentId','')::uuid;
      if v_parent is not null and not exists(select 1 from public.school_business_groups where id=v_parent and archived_at is null) then raise exception 'VALIDATION'; end if;
      if (select parent_id from public.school_business_groups where id=v_id) is distinct from v_parent then
        update public.school_business_groups set parent_id=v_parent where id=v_id; v_moved:=v_moved||v_id;
      end if;
    end loop;
  exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'VALIDATION';
    when unique_violation then raise exception 'GROUP_NAME_TAKEN';
  end;
  if exists(with recursive walk(start,id,depth) as (
      select id,parent_id,1 from public.school_business_groups where parent_id is not null
      union all select w.start,g.parent_id,w.depth+1 from walk w join public.school_business_groups g on g.id=w.id
        where g.parent_id is not null and w.depth<64 and w.id<>w.start
    ) select 1 from walk where id=start or depth>=64) then raise exception 'ORGANIZATION_CYCLE'; end if;

    -- 成员与组长。
  begin
    for item in select * from jsonb_array_elements(coalesce(p_changes->'members','[]'::jsonb)) loop
      v_id:=(item->>'groupId')::uuid; v_user:=(item->>'userId')::uuid;
      if jsonb_typeof(item->'active')<>'boolean' or jsonb_typeof(coalesce(item->'lead','false'::jsonb))<>'boolean'
        or not exists(select 1 from public.school_business_groups where id=v_id and archived_at is null)
        or not exists(select 1 from public.profiles where id=v_user and role in ('staff','admin') and is_active and account_status='active') then raise exception 'VALIDATION'; end if;
      v_lead:=coalesce((item->>'lead')::boolean,false);
      perform pg_advisory_xact_lock(hashtextextended('school-group-member:'||v_id||':'||v_user,0));
      if (item->>'active')::boolean then
        insert into public.school_business_group_members(group_id,user_id,added_by,is_lead) values(v_id,v_user,v_uid,v_lead) on conflict do nothing;
        update public.school_business_group_members set is_lead=v_lead where group_id=v_id and user_id=v_user and removed_at is null and is_lead<>v_lead;
      else
        update public.school_business_group_members set removed_at=now(),removed_by=v_uid where group_id=v_id and user_id=v_user and removed_at is null;
        v_lead:=false;
      end if;
      insert into public.school_collaboration_events(action,subject_id,saved_values,recorded_by)
        values('set_member',v_id,jsonb_build_object('userId',v_user,'active',(item->>'active')::boolean,'lead',v_lead),v_uid);
    end loop;
    -- 业务分工。
    for item in select * from jsonb_array_elements(coalesce(p_changes->'roles','[]'::jsonb)) loop
      if jsonb_typeof(item->'roles')<>'array' then raise exception 'VALIDATION'; end if;
      v_roles:=array(select jsonb_array_elements_text(item->'roles'));
      perform public.set_school_staff_business_roles((item->>'userId')::uuid,v_roles);
    end loop;
    -- 归档：成员、下级组织、学生来源组别与诊断规则都移开后才能归档。
    for item in select * from jsonb_array_elements(coalesce(p_changes->'archive','[]'::jsonb)) loop
      v_id:=(item#>>'{}')::uuid;
      if not exists(select 1 from public.school_business_groups where id=v_id and archived_at is null) then raise exception 'NOT_FOUND'; end if;
      if exists(select 1 from public.school_business_group_members where group_id=v_id and removed_at is null)
        or exists(select 1 from public.school_business_groups where parent_id=v_id and archived_at is null) then raise exception 'GROUP_NOT_EMPTY'; end if;
      if exists(select 1 from public.school_subject_groups where group_id=v_id)
        or exists(select 1 from public.assessment_availability_rules where scope->>'kind'='groups' and scope->'ids' @> to_jsonb(array[v_id])) then raise exception 'GROUP_IN_USE'; end if;
      update public.school_business_groups set archived_at=now(),archived_by=v_uid where id=v_id;
      insert into public.school_collaboration_events(action,subject_id,saved_values,recorded_by) values('archive_group',v_id,'{}'::jsonb,v_uid);
    end loop;
  exception when invalid_text_representation then raise exception 'VALIDATION';
  end;

  -- 组织移动会改变下级成员适用的诊断统一规则。
  if cardinality(v_moved)>0 then
    for v_teacher in select distinct m.user_id from public.school_business_group_members m
      where m.removed_at is null and exists(select 1 from unnest(public.school_group_lineage(m.group_id)) a where a=any(v_moved))
        and public.is_assessment_teacher(m.user_id) order by m.user_id loop
      perform pg_advisory_xact_lock(hashtextextended('assessment-teacher:'||v_teacher::text,0));
      perform public.refresh_assessment_rule_slots(v_teacher,v_uid);
    end loop;
  end if;
  return public.read_school_collaboration_settings();
end $$;

revoke all on function public.school_group_lineage(uuid),public.school_actor_group_scope(uuid),public.school_group_sort_key(uuid),
  public.set_school_staff_business_roles(uuid,text[]),public.save_school_organization(jsonb) from public,anon,authenticated;
grant execute on function public.set_school_staff_business_roles(uuid,text[]),public.save_school_organization(jsonb) to authenticated;
select pg_notify('pgrst','reload schema');
