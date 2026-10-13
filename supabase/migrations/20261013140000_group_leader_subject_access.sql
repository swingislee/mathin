-- 组长办理本组及下级组织的学生资料与沟通；普通成员继续沿原办理范围。
create function public.school_group_leader_scope(p_uid uuid) returns table(group_id uuid)
language sql stable security definer set search_path=public,pg_temp as $$
  with recursive down(id,depth) as (
    select m.group_id,0 from public.school_business_group_members m
      join public.school_business_groups g on g.id=m.group_id
      where m.user_id=p_uid and m.is_lead and m.removed_at is null and g.archived_at is null
        and public.is_staff(p_uid)
    union select g.id,down.depth+1 from down join public.school_business_groups g on g.parent_id=down.id
      where g.archived_at is null and down.depth<64
  ) select distinct id from down;
$$;

create function public.school_group_leader_subject_keys(p_uid uuid) returns table(key text)
language sql stable security definer set search_path=public,pg_temp as $$
  with managed as materialized (select group_id from public.school_group_leader_scope(p_uid)),
  members as materialized (
    select distinct m.user_id from public.school_business_group_members m join managed g using(group_id)
      where m.removed_at is null and public.is_staff(m.user_id)
  )
  select coalesce('student:'||g.student_id,'student:'||l.student_id,'lead:'||g.lead_id)
    from public.school_subject_groups g join managed m using(group_id) left join public.leads l on l.id=g.lead_id
  union select coalesce('student:'||p.student_id,'student:'||l.student_id,'lead:'||p.lead_id)
    from public.school_subject_participants p join members m on m.user_id=p.user_id left join public.leads l on l.id=p.lead_id
  union select 'student:'||s.id from public.students s join members m on m.user_id=s.assigned_to where s.deleted_at is null
  union select coalesce('student:'||l.student_id,'lead:'||l.id) from public.leads l join members m on m.user_id=l.owner_id
  union select 'student:'||e.student_id from public.enrollments e
    join public.classroom_members c on c.classroom_id=e.classroom_id and c.role='teacher'
    join members m on m.user_id=c.user_id where e.status='active' and e.left_at is null
  union select 'student:'||e.student_id from public.enrollments e
    join public.classroom_staff_assignments c on c.classroom_id=e.classroom_id and c.responsibility='learning_support'
    join members m on m.user_id=c.user_id where e.status='active' and e.left_at is null;
$$;
revoke all on function public.school_group_leader_scope(uuid),public.school_group_leader_subject_keys(uuid) from public,anon,authenticated,service_role;

-- 只补齐学生资料、沟通的岗位能力；实际对象边界仍由下方关系函数和各写入入口校验。
do $permissions$
declare definition text; anchor text:='profile_row.role = ''admin''';
begin
  definition:=pg_get_functiondef('public.has_perm(uuid,text)'::regprocedure);
  if position(anchor in definition)=0 then raise exception 'GROUP_LEADER_PERMISSION_ANCHOR_MISSING'; end if;
  execute replace(definition,anchor,anchor||'
           or (p_key in (''student.view.assigned'',''student.edit'',''followup.view'',''followup.write'')
             and exists(select 1 from public.school_group_leader_scope(uid)))');
end $permissions$;

create or replace function public.can_access_student(sid uuid,uid uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_staff(uid) and (public.is_admin(uid) or public.staff_has_perm(uid,'student.view.all')
    or (public.staff_has_perm(uid,'student.view.assigned') and (
      public.assigned_of_student(sid,uid) or public.teacher_of_student(sid,uid) or public.support_of_student(sid,uid)))
    or public.school_subject_is_participant(sid,null,uid)
    or exists(select 1 from public.school_group_leader_subject_keys(uid) g where g.key='student:'||sid));
$$;

create or replace function public.can_edit_school_lead(p_lead_id uuid,p_uid uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_staff(p_uid) and exists(select 1 from public.leads l where l.id=p_lead_id and
    (l.owner_id=p_uid or public.has_perm(p_uid,'student.view.all')
      or public.school_subject_is_participant(l.student_id,l.id,p_uid)
      or l.student_id is not null and public.can_access_student(l.student_id,p_uid)
      or exists(select 1 from public.school_group_leader_subject_keys(p_uid) g
        where g.key=coalesce('student:'||l.student_id,'lead:'||l.id))));
$$;

-- 列表批量投影与详情/写入使用相同关系，避免列表显示只读而详情允许修改。
do $visibility$
declare definition text; before_text text; after_text text;
begin
  definition:=pg_get_functiondef('public.school_list_visibility(uuid)'::regprocedure);
  for before_text,after_text in select * from (values
    ('with actor as materialized (','with managed as materialized (select key from public.school_group_leader_subject_keys(p_actor)), actor as materialized ('),
    ('or exists(select 1 from participants p where p.key=''student:''||s.id)) as access',
     'or exists(select 1 from participants p where p.key=''student:''||s.id) or exists(select 1 from managed g where g.key=''student:''||s.id)) as access'),
    ('or s.access','or s.access or exists(select 1 from managed g where g.key=coalesce(''student:''||l.student_id,''lead:''||l.id))')
  ) changes(b,a) loop
    if position(before_text in definition)=0 then raise exception 'GROUP_LEADER_VISIBILITY_ANCHOR_MISSING'; end if;
    definition:=replace(definition,before_text,after_text);
  end loop;
  execute definition;
end $visibility$;

select pg_notify('pgrst','reload schema');
