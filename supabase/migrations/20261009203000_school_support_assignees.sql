-- 学服分工与岗位权限同时决定新分配资格；已有负责人和参与经历保持原值。
create or replace function public.is_school_support_owner(p_user_id uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(public.is_staff(p_user_id) and public.has_perm(p_user_id,'followup.write')
    and exists(select 1 from public.school_staff_business_roles r
      where r.user_id=p_user_id and r.business_role='school_support'),false);
$$;
revoke all on function public.is_school_support_owner(uuid) from public,anon,authenticated;

create function public.list_school_support_owners() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.is_staff(auth.uid()) or not (public.has_perm(auth.uid(),'student.assign')
    or public.can_manage_school_groups()) then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('userId',p.id,'displayName',p.display_name) order by p.display_name,p.id)
    from public.school_staff_business_roles r join public.profiles p on p.id=r.user_id
    where r.business_role='school_support' and public.is_school_support_owner(p.id)),'[]'::jsonb);
end;
$$;
revoke all on function public.list_school_support_owners() from public,anon,authenticated;
grant execute on function public.list_school_support_owners() to authenticated;

-- 清除的是默认业务分工；原有学生、线索归属和历史参与记录继续保留。
create or replace function public.set_school_staff_business_role(p_user_id uuid,p_role text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare prior jsonb;
begin
  if not public.can_manage_school_groups() then raise exception 'FORBIDDEN'; end if;
  if (p_role is not null and p_role not in ('school_support','assessment_teacher','teacher'))
    or not exists(select 1 from public.profiles where id=p_user_id and role in ('staff','admin')) then raise exception 'VALIDATION'; end if;
  if p_role='school_support' and (not public.is_staff(p_user_id) or not public.has_perm(p_user_id,'followup.write')) then
    raise exception 'TARGET_CANNOT_FOLLOW_UP';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('school-business-role:'||p_user_id,0));
  select to_jsonb(r) into prior from public.school_staff_business_roles r where user_id=p_user_id for update;
  if p_role is null then
    delete from public.school_staff_business_roles where user_id=p_user_id;
  else
    insert into public.school_staff_business_roles(user_id,business_role,updated_by) values(p_user_id,p_role,auth.uid())
      on conflict(user_id) do update set business_role=excluded.business_role,updated_by=excluded.updated_by,updated_at=now();
  end if;
  insert into public.school_collaboration_events(action,subject_id,previous_values,saved_values,recorded_by)
    values('set_business_role',p_user_id,prior,jsonb_build_object('role',p_role),auth.uid());
end;
$$;

-- 保留三种分配入口的原作用域、事务和并发校验，只收紧目标人资格。
do $owners$
declare routine regprocedure; definition text; updated text; previous_guard text;
begin
  for routine,previous_guard in select * from (values
    ('public.assign_student(uuid,uuid)'::regprocedure,
      $before$if not public.is_staff(p_staff_user_id) or not public.has_perm(p_staff_user_id, 'followup.write') then$before$),
    ('public.assign_leads(uuid[],uuid)'::regprocedure,
      $before$if not public.is_staff(p_staff_user_id)
     or not public.has_perm(p_staff_user_id, 'followup.write') then$before$),
    ('public.assign_student_stage_subjects(jsonb,uuid)'::regprocedure,
      $before$if p_staff_user_id is null or not public.is_staff(p_staff_user_id) or not public.has_perm(p_staff_user_id,'followup.write') then$before$)
  ) guards(routine,previous_guard) loop
    definition:=pg_get_functiondef(routine);
    updated:=replace(definition,previous_guard,'if not public.is_school_support_owner(p_staff_user_id) then');
    if updated=definition then raise exception 'SUPPORT_ASSIGNMENT_GUARD_CHANGED: %',routine; end if;
    execute updated;
  end loop;
  definition:=pg_get_functiondef('public.read_school_collaboration_settings()'::regprocedure);
  updated:=replace(definition,$before$'role',r.business_role)$before$,
    $after$'role',r.business_role,'canFollowUp',public.has_perm(p.id,'followup.write'))$after$);
  if updated=definition then raise exception 'SUPPORT_SETTINGS_READ_CHANGED'; end if;
  execute updated;
end;
$owners$;
