-- 名单的可见集合按请求计算一次；原有鉴权、办理标记及写入口继续使用原合同。
create function public.school_list_visibility(p_actor uuid)
returns table(key text, can_access boolean, can_view boolean)
language sql stable security definer set search_path=public,pg_temp as $$
  with actor as materialized (
    select public.is_staff(p_actor) as active, public.is_admin(p_actor) as admin,
      public.staff_has_perm(p_actor,'student.view.all') as staff_all,
      public.staff_has_perm(p_actor,'student.view.assigned') as staff_assigned,
      public.has_perm(p_actor,'student.view.all') as view_all,
      public.has_perm(p_actor,'student.view.assigned') as view_assigned,
      public.has_perm(p_actor,'followup.view') as followup,
      public.has_perm(p_actor,'student.import') as importing
  ), participants as materialized (select key from public.school_list_scope_keys(p_actor,'mine')),
  groups as materialized (select key from public.school_list_scope_keys(p_actor,'group')),
  teaching as materialized (
    select e.student_id from public.enrollments e join public.classroom_members m on m.classroom_id=e.classroom_id
      where e.status='active' and m.role='teacher' and m.user_id=p_actor
    union select e.student_id from public.enrollments e join public.classroom_staff_assignments s on s.classroom_id=e.classroom_id
      where e.status='active' and s.user_id=p_actor and s.responsibility='learning_support'
  ), students as materialized (
    select s.id, a.active and (a.admin or a.staff_all or a.staff_assigned and
      (s.assigned_to=p_actor or exists(select 1 from teaching t where t.student_id=s.id))
      or exists(select 1 from participants p where p.key='student:'||s.id)) as access,
      a.active and (a.followup or a.view_assigned) and exists(select 1 from groups g where g.key='student:'||s.id) as group_access
      from public.students s cross join actor a
  )
  select 'student:'||s.id,s.access,s.access or s.group_access from students s
  union all
  select 'lead:'||l.id,
    a.active and (l.owner_id=p_actor or a.view_all or exists(select 1 from participants p where p.key=coalesce('student:'||l.student_id,'lead:'||l.id)) or s.access),
    a.active and (a.followup and (l.owner_id is null or l.owner_id=p_actor or a.view_all
      or exists(select 1 from participants p where p.key=coalesce('student:'||l.student_id,'lead:'||l.id)) or s.access
      or exists(select 1 from groups g where g.key=coalesce('student:'||l.student_id,'lead:'||l.id)))
      or l.created_by=p_actor and a.importing)
    from public.leads l cross join actor a left join students s on s.id=l.student_id;
$$;
revoke all on function public.school_list_visibility(uuid) from public,anon,authenticated,service_role;

do $migration$
declare item record; definition text; owner_name text;
begin
  -- 批量集合依赖这些明确的权限定义；发生漂移时先重新检查。
  for item in select * from (values
    ('can_access_student(uuid,uuid)','2e40802d3656104cdb2efdf0235300d0'),
    ('can_view_school_student(uuid,uuid)','96e5af540df9466ce36d439b5bb016e5'),
    ('can_view_school_lead(uuid,uuid)','be9b8572b0fce994372574a3851c322a'),
    ('can_edit_school_lead(uuid,uuid)','c33b368dee46a10557f195ba5731eeb1'),
    ('assigned_of_student(uuid,uuid)','d1b13dcbe25bfe076d3c14fd5787f9a9'),
    ('teacher_of_student(uuid,uuid)','4fd7ed9e8151c7d90ba122f7282dcc94'),
    ('support_of_student(uuid,uuid)','ca51e32ed61250ca8b1b655493df481d'),
    ('school_subject_participant_rows(uuid,uuid)','75a44c1f2f66bb00ec22aa101c8db666'),
    ('school_subject_group_rows(uuid,uuid)','5d004299db5bd601bcf406b95bd92aea'),
    ('student_list_query_facts(text,text,text,text,jsonb)','95be1fcf4c0ab7404d7e0f136da4b559')
  ) expected(signature,hash) loop
    if (select md5(prosrc) from pg_proc where oid=('public.'||item.signature)::regprocedure) is distinct from item.hash then
      raise exception 'COMMUNICATION_READ_DEFINITION_CHANGED: %',item.signature;
    end if;
  end loop;
  select pg_get_userbyid(proowner),pg_get_functiondef(oid) into owner_name,definition
    from pg_proc where oid='public.student_list_query_facts(text,text,text,text,jsonb)'::regprocedure;
  execute format('alter function public.school_list_visibility(uuid) owner to %I',owner_name);
  definition:=replace(definition,'return query with',
    'return query with visibility as materialized (select key,can_view from public.school_list_visibility(actor)),');
  definition:=replace(definition,'public.can_view_school_student(s.id,actor)',
    'exists(select 1 from visibility v where v.key=''student:''||s.id and v.can_view)');
  definition:=replace(definition,'public.can_view_school_lead(l.id,actor)',
    'exists(select 1 from visibility v where v.key=''lead:''||l.id and v.can_view)');
  execute definition;
end;
$migration$;
