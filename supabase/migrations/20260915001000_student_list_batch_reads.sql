-- 名单先汇总协作范围；每条记录继续沿用现有的可见、办理与历史事实规则。
create function public.school_list_scope_keys(p_actor uuid,p_scope text)
returns table(key text) language sql stable security definer set search_path=public,pg_temp as $$
  with participants as materialized (
    select coalesce('student:'||p.student_id,'student:'||l.student_id,'lead:'||p.lead_id) as key,p.user_id
      from public.school_subject_participants p left join public.leads l on l.id=p.lead_id
      where p_scope in ('mine','group')
  ), actor_groups as materialized (
    select group_id from public.school_business_group_members where user_id=p_actor and removed_at is null and p_scope='group'
  )
  select distinct p.key from participants p where p_scope='mine' and p.user_id=p_actor
  union
  select coalesce('student:'||g.student_id,'student:'||l.student_id,'lead:'||g.lead_id)
    from public.school_subject_groups g join actor_groups a on a.group_id=g.group_id left join public.leads l on l.id=g.lead_id
  union
  select p.key from participants p join public.school_business_group_members m on m.user_id=p.user_id and m.removed_at is null
    join actor_groups a on a.group_id=m.group_id;
$$;
revoke all on function public.school_list_scope_keys(uuid,text) from public,anon,authenticated,service_role;

-- 调用方已验证身份和可见集合；私有投影只汇合明确的 Lead→Student 关系。
create function public.school_list_collaboration(p_subjects jsonb,p_actor uuid)
returns table(key text,projection jsonb) language sql stable security definer set search_path=public,pg_temp as $$
  with subjects as materialized (
    select s.key,coalesce(s.student_id,l.student_id) as student_id,s.lead_id
      from jsonb_to_recordset(p_subjects) s(key text,student_id uuid,lead_id uuid) left join public.leads l on l.id=s.lead_id
  ), refs as materialized (
    select s.key,l.id from subjects s join public.leads l on l.student_id=s.student_id
    union select key,lead_id from subjects where lead_id is not null
  ), links as materialized (
    select s.key,p.user_id,p.business_role from subjects s join public.school_subject_participants p on p.student_id=s.student_id
    union all select r.key,p.user_id,p.business_role from refs r join public.school_subject_participants p on p.lead_id=r.id
  ), participants as materialized (
    select distinct p.key,p.user_id,u.display_name,coalesce(r.business_role,p.business_role) as business_role
      from links p join public.profiles u on u.id=p.user_id left join public.school_staff_business_roles r on r.user_id=p.user_id
  ), group_ids as materialized (
    select s.key,g.group_id from subjects s join public.school_subject_groups g on g.student_id=s.student_id
    union select r.key,g.group_id from refs r join public.school_subject_groups g on g.lead_id=r.id
    union select p.key,m.group_id from participants p join public.school_business_group_members m on m.user_id=p.user_id and m.removed_at is null
  ), actor_groups as materialized (
    select group_id from public.school_business_group_members where user_id=p_actor and removed_at is null
  ), participant_data as (
    select p.key,jsonb_agg(jsonb_build_object('userId',user_id,'name',display_name,'role',business_role) order by display_name,business_role) as participants,
      bool_or(user_id=p_actor) as mine,
      string_agg(distinct display_name,'、' order by display_name) filter(where business_role='school_support') as support,
      string_agg(distinct display_name,'、' order by display_name) filter(where business_role in ('assessment_teacher','teacher')) as teachers
      from participants p group by p.key
  ), group_data as (
    select r.key,jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.name) as groups,bool_or(a.group_id is not null) as mine
      from group_ids r join public.school_business_groups g on g.id=r.group_id left join actor_groups a on a.group_id=g.id group by r.key
  ), actor as materialized (select public.is_staff(p_actor) as active)
  select s.key,jsonb_build_object('participants',coalesce(p.participants,'[]'::jsonb),'groups',coalesce(g.groups,'[]'::jsonb),
    'isParticipant',(select active from actor) and coalesce(p.mine,false),'inMyGroups',(select active from actor) and coalesce(g.mine,false),
    'supportNames',coalesce(p.support,''),'assessmentTeacherNames',coalesce(p.teachers,''))
    from subjects s left join participant_data p using(key) left join group_data g using(key);
$$;
revoke all on function public.school_list_collaboration(jsonb,uuid) from public,anon,authenticated,service_role;

create function public.school_list_apply_collaboration(p_row jsonb,p_projection jsonb)
returns jsonb language sql immutable set search_path=public,pg_temp as $$
  with names as (select coalesce(nullif(p_projection->>'supportNames',''),p_row->>'ownerName','') as support)
  select p_row||(p_projection-'supportNames'-'assessmentTeacherNames')||jsonb_build_object(
    'ownerName',case when p_projection->>'supportNames'='' and exists(select 1 from jsonb_array_elements(p_projection->'participants') p
      where p->>'role' in ('assessment_teacher','teacher') and p->>'name'=support) then '' else support end,
    'teacherName',coalesce(nullif(p_projection->>'assessmentTeacherNames',''),p_row->>'teacherName','')) from names;
$$;
revoke all on function public.school_list_apply_collaboration(jsonb,jsonb) from public,anon,authenticated,service_role;

-- 两个已知的部署顺序都归一到现行协作合同；未知函数体停止迁移。
do $batch$
declare routine regprocedure; definition text; body text; expected text; changed text; owner_name text;
  permission_definition text;
begin
  select pg_get_userbyid(proowner) into owner_name from pg_proc where oid='public.student_list_base_facts(text,text,text,text)'::regprocedure;
  foreach routine in array array['public.school_list_scope_keys(uuid,text)'::regprocedure,'public.school_list_collaboration(jsonb,uuid)'::regprocedure,'public.school_list_apply_collaboration(jsonb,jsonb)'::regprocedure] loop
    execute format('alter function %s owner to %I',routine,owner_name);
  end loop;
  routine:='public.student_list_base_facts(text,text,text,text)'::regprocedure;
  select pg_get_functiondef(oid),prosrc into definition,body from pg_proc where oid=routine;
  if md5(body) not in ('a42cb66e76c38036706025399bcee7f8','30eb1a9c38f569f4b1e24000586b25f3') then raise exception 'STUDENT_LIST_BASE_CHANGED'; end if;
  if md5(body)='30eb1a9c38f569f4b1e24000586b25f3' then
    definition:=replace(definition,'(view_all or public.can_access_student(s.id,actor))','(view_all or public.can_view_school_student(s.id,actor))');
    definition:=replace(definition,'(''all'',''mine'',''unassigned'')','(''all'',''mine'',''unassigned'',''group'')');
    definition:=replace(definition,'p_scope=''mine'' and s.assigned_to=actor','p_scope=''mine'' and public.school_subject_is_participant(s.id,null,actor)');
    definition:=replace(definition,'p_scope=''mine'' and l.owner_id=actor','p_scope=''mine'' and public.school_subject_is_participant(l.student_id,l.id,actor)');
    definition:=replace(definition,'p_scope=''unassigned'' and s.assigned_to is null','p_scope=''unassigned'' and s.assigned_to is null or p_scope=''group'' and public.school_subject_in_my_groups(s.id,null,actor)');
    definition:=replace(definition,'p_scope=''unassigned'' and l.owner_id is null','p_scope=''unassigned'' and l.owner_id is null or p_scope=''group'' and public.school_subject_in_my_groups(l.student_id,l.id,actor)');
    definition:=replace(definition,'(l.owner_id is null or l.owner_id=actor or view_all)','public.can_view_school_lead(l.id,actor)');
    definition:=replace(definition,'select r.payload,r.stage','select public.school_collaboration_row(r.payload),r.stage');
    execute definition;
    if (select md5(prosrc) from pg_proc where oid=routine)<>'a42cb66e76c38036706025399bcee7f8' then raise exception 'STUDENT_LIST_COLLABORATION_BASE_MISMATCH'; end if;
  end if;

  -- 使用经身份检查的请求级权限标记，其他归属继续调用原有权限函数。
  foreach routine in array array['public.student_list_base_facts(text,text,text,text)'::regprocedure,
    'public.student_record_index_with_enrollments(text,text,public.business_course_enrollment_subjects[])'::regprocedure] loop
    select pg_get_functiondef(oid),prosrc into definition,body from pg_proc where oid=routine;
    expected:=case when routine::text like 'student_list_base_facts(%' then 'a42cb66e76c38036706025399bcee7f8' else 'c4d4809cda2e31062b0c47ceb423799b' end;
    if md5(body)<>expected then raise exception 'STUDENT_LIST_SCOPE_BODY_CHANGED'; end if;
    changed:=replace(definition,'return query with', $scope$if p_scope in ('mine','group') and not exists(select 1 from public.school_list_scope_keys(actor,p_scope)) then return; end if;
  return query with
  scope_keys as materialized (select scoped.key from public.school_list_scope_keys(actor,p_scope) scoped),$scope$);
    changed:=replace(changed,'public.school_subject_is_participant(s.id,null,actor)','exists(select 1 from scope_keys k where k.key=''student:''||s.id)');
    changed:=replace(changed,'public.school_subject_in_my_groups(s.id,null,actor)','exists(select 1 from scope_keys k where k.key=''student:''||s.id)');
    changed:=replace(changed,'public.school_subject_is_participant(l.student_id,l.id,actor)','exists(select 1 from scope_keys k where k.key=coalesce(''student:''||l.student_id,''lead:''||l.id))');
    changed:=replace(changed,'public.school_subject_in_my_groups(l.student_id,l.id,actor)','exists(select 1 from scope_keys k where k.key=coalesce(''student:''||l.student_id,''lead:''||l.id))');
    if routine::text like 'student_list_base_facts(%' then
      -- IS NULL 在读取原表时筛选，使用真实列统计；保留工作名单的物化边界，先排除归档再计算权限。
      changed:=replace(changed,'select s.* from public.students s where s.deleted_at is null and (',
        'select s.* from public.students s where s.deleted_at is null and (p_scope<>''unassigned'' or s.assigned_to is null) and (');
      changed:=replace(changed,'select l.* from public.leads l where l.student_id is null and (',
        'select l.* from public.leads l where l.student_id is null and (p_scope<>''unassigned'' or l.owner_id is null) and (');
      changed:=replace(changed,'p_scope=''unassigned'' and s.assigned_to is null','p_scope=''unassigned''');
      changed:=replace(changed,'p_scope=''unassigned'' and l.owner_id is null','p_scope=''unassigned''');
      changed:=replace(changed,'view_followup and public.can_view_school_lead(l.id,actor)',
        'view_followup and case when view_all or l.owner_id is null or l.owner_id=actor then true else public.can_view_school_lead(l.id,actor) end');
      changed:=replace(changed,'select public.school_collaboration_row(r.payload),r.stage from rows r', $projection$select public.school_list_apply_collaboration(r.payload,c.projection),r.stage from rows r
    join public.school_list_collaboration(coalesce((select jsonb_agg(jsonb_build_object('key',payload->>'key','student_id',payload->>'studentId','lead_id',payload->>'leadId')) from rows),'[]'::jsonb),actor) c on c.key=r.key$projection$);
    else
      changed:=replace(changed,'select l.*,coalesce(''student:''||l.student_id,''lead:''||l.id) as key from public.leads l',
        'select l.*,coalesce(''student:''||l.student_id,''lead:''||l.id) as key from public.leads l
      where exists(select 1 from subjects s where s.key=coalesce(''student:''||l.student_id,''lead:''||l.id))');
    end if;
    if changed=definition then raise exception 'STUDENT_LIST_BATCH_NO_CHANGE'; end if;
    execute changed;
  end loop;

  routine:='public.student_record_list_rows(jsonb,public.business_course_enrollment_subjects[])'::regprocedure;
  select pg_get_functiondef(oid),prosrc into definition,body from pg_proc where oid=routine;
  if md5(body)<>'dd55dc4b0e97cfb7c7c152fcd51c2c01' then raise exception 'STUDENT_RECORD_ROWS_CHANGED'; end if;
  changed:=replace(definition,'public.can_access_student(s.student_id,actor)','case when view_all then true else public.can_access_student(s.student_id,actor) end');
  changed:=replace(changed,'public.can_access_student(st.id,actor)','case when view_all then true else public.can_access_student(st.id,actor) end');
  changed:=replace(changed,'public.can_edit_school_lead(l.id,actor)','case when view_all or l.owner_id=actor then true else public.can_edit_school_lead(l.id,actor) end');
  changed:=replace(changed,'return (select coalesce(jsonb_agg(public.school_collaboration_row(r)),''[]''::jsonb) from jsonb_array_elements(result) r);',
    $projection$return (select coalesce(jsonb_agg(public.school_list_apply_collaboration(r.value,c.projection) order by r.ordinal),'[]'::jsonb)
    from jsonb_array_elements(result) with ordinality r(value,ordinal)
    join public.school_list_collaboration(coalesce((select jsonb_agg(jsonb_build_object('key',v->>'key','student_id',v->>'studentId','lead_id',v->>'leadId')) from jsonb_array_elements(result) v),'[]'::jsonb),actor) c on c.key=r.value->>'key');$projection$);
  execute changed;

  routine:='public.student_list_row_permissions(jsonb,uuid,boolean,boolean)'::regprocedure;
  select prosrc into body from pg_proc where oid=routine;
  if md5(body) not in ('4e2192f419b046f959d764d87395b059','b4b7f31a1c352377ace213f7cf925a24') then raise exception 'STUDENT_LIST_ROW_PERMISSIONS_CHANGED'; end if;
  -- 现行办理合同对学生与线索分别验证；组内查看不授予办理权限。
  select pg_get_functiondef(oid) into permission_definition from pg_proc where oid=routine;
  execute replace(permission_definition,body,$permissions$
    declare actor uuid:=p_actor; view_all boolean:=p_view_all; write_followup boolean:=p_write_followup;
    begin
      if p_row is null then return null; end if;
      return (select p_row||jsonb_build_object('canWrite',write_followup and (s.student_id is not null and public.can_access_student(s.student_id,actor) or l.id is not null and public.can_edit_school_lead(l.id,actor)),
      'canContact',write_followup and (l.id is not null and l.status not in ('invalid','converted') and public.can_edit_school_lead(l.id,actor)
        or l.id is null and s.student_id is not null and public.can_access_student(st.id,actor)))
        from (select (p_row->>'studentId')::uuid as student_id,(p_row->>'leadId')::uuid as lead_id) s
        left join public.students st on st.id=s.student_id left join public.leads l on l.id=s.lead_id);
    end;
    $permissions$);

  routine:='public.list_student_recontact_summaries(text,text,text)'::regprocedure;
  select pg_get_functiondef(oid),prosrc into definition,body from pg_proc where oid=routine;
  if md5(body)<>'36f698d6ae191038570ddc691f5fe7bc' then raise exception 'RECONTACT_SCOPE_VALIDATION_CHANGED'; end if;
  execute replace(definition,'(''mine'',''all'',''unassigned'')','(''mine'',''all'',''unassigned'',''group'')');
end;
$batch$;
