create function public.school_collaboration_row(p_row jsonb) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c jsonb; support_name text; teacher_name text;
begin
  if p_row is null then return null; end if;
  c:=public.school_collaboration_projection((p_row->>'studentId')::uuid,(p_row->>'leadId')::uuid,auth.uid());
  support_name:=coalesce(nullif(c->>'supportNames',''),p_row->>'ownerName','');
  if c->>'supportNames'='' and exists(select 1 from jsonb_array_elements(c->'participants') p
    where p->>'role' in ('assessment_teacher','teacher') and p->>'name'=support_name) then support_name:=''; end if;
  teacher_name:=coalesce(nullif(c->>'assessmentTeacherNames',''),p_row->>'teacherName','');
  return p_row||(c-'supportNames'-'assessmentTeacherNames')||jsonb_build_object('ownerName',support_name,'teacherName',teacher_name);
end;
$$;
revoke all on function public.school_collaboration_row(jsonb) from public,anon,authenticated;

create or replace function public.can_access_communication_row(p_row_key text,p_write boolean default false)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); item uuid; registration public.activity_registrations%rowtype;
begin
  if not public.is_staff(actor) or p_row_key is null
    or p_row_key !~ '^(lead|post):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  item:=split_part(p_row_key,':',2)::uuid;
  if split_part(p_row_key,':',1)='post' then
    if p_write then return public.has_perm(actor,'followup.write') and public.can_follow_up_participation(item,actor); end if;
    select * into registration from public.activity_registrations where id=item;
    return public.has_perm(actor,'followup.view') and (public.can_follow_up_participation(item,actor)
      or registration.student_id is not null and public.can_view_school_student(registration.student_id,actor)
      or registration.lead_id is not null and public.can_view_school_lead(registration.lead_id,actor));
  end if;
  if p_write then return public.has_perm(actor,'followup.write') and public.can_edit_school_lead(item,actor); end if;
  return public.can_view_school_lead(item,actor) or public.has_assigned_invitation_lead(actor,item) or public.has_assessment_history_lead_access(item);
end;
$$;

create function public.can_revise_school_business_record(p_kind text,p_id uuid) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare relation_name text; permission_key text; record_data jsonb; sid uuid; lid uuid;
begin
  if not public.is_staff(auth.uid()) then return false; end if;
  relation_name:=case p_kind when 'activity' then 'activity_registrations' when 'assessment' then 'assessment_results'
    when 'renewal' then 'course_opportunities' when 'enrollment' then 'course_enrollments' when 'communication' then 'student_follow_ups' end;
  permission_key:=case p_kind when 'activity' then 'activity.register' when 'assessment' then 'review.write'
    when 'enrollment' then 'enrollment.manage' else 'followup.write' end;
  if relation_name is null or not public.has_perm(auth.uid(),permission_key) then return false; end if;
  execute format('select to_jsonb(r) from public.%I r where id=$1 and record_state=''historical''',relation_name) into record_data using p_id;
  if record_data is null then return false; end if;
  sid:=(record_data->>'student_id')::uuid; lid:=(record_data->>'lead_id')::uuid;
  return (sid is not null and public.can_access_student(sid,auth.uid())) or (lid is not null and public.can_edit_school_lead(lid,auth.uid()));
end;
$$;
revoke all on function public.can_revise_school_business_record(text,uuid) from public,anon,authenticated;
grant execute on function public.can_revise_school_business_record(text,uuid) to authenticated;

create or replace function public.school_support_subject_access(p_student_id uuid,p_lead_id uuid,p_write boolean default false)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); l public.leads%rowtype;
begin
  if actor is null or not public.is_staff(actor) or not public.has_perm(actor,'followup.view')
    or p_write and not public.has_perm(actor,'followup.write') or num_nonnulls(p_student_id,p_lead_id)=0 then return false; end if;
  if p_student_id is not null and not exists(select 1 from public.students s where s.id=p_student_id and s.deleted_at is null
    and case when p_write then public.can_access_student(s.id,actor) else public.can_view_school_student(s.id,actor) end) then return false; end if;
  if p_lead_id is not null then
    select * into l from public.leads where id=p_lead_id;
    if l.id is null or p_student_id is not null and l.student_id is distinct from p_student_id then return false; end if;
    if l.student_id is not null and not exists(select 1 from public.students s where s.id=l.student_id and s.deleted_at is null
      and case when p_write then public.can_access_student(s.id,actor) else public.can_view_school_student(s.id,actor) end) then return false; end if;
    if p_write then return public.can_edit_school_lead(l.id,actor); end if;
    return public.can_view_school_lead(l.id,actor);
  end if;
  return true;
end;
$$;

-- 在已有版本化入口替换范围校验，保留状态、参数、并发、审计、幂等与岗位能力校验。
do $guards$
declare routine regprocedure; definition text; updated text;
begin
  for routine in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('record_lead_contact','record_lead_contact_v2','update_lead_invitation','set_lead_contact_reminder','ensure_lead_student_profile','confirm_lead_identity','get_lead_identity_options') loop
    definition:=pg_get_functiondef(routine);
    updated:=regexp_replace(definition,'v_lead.owner_id is null and not public.has_perm\(v_uid,''student.view.all''\)',
      'not public.can_edit_school_lead(v_lead.id,v_uid)','g');
    updated:=regexp_replace(updated,'v_lead.owner_id <> v_uid and not public.has_perm\(v_uid, ''student.view.all''\)',
      'not public.can_edit_school_lead(v_lead.id,v_uid)','g');
    updated:=replace(updated,'if v_lead.owner_id is null then','if not public.can_edit_school_lead(v_lead.id,v_uid) then');
    updated:=replace(updated,'''LEAD_UNASSIGNED''','''FORBIDDEN_SCOPE''');
    if updated=definition then raise exception 'COLLABORATION_GUARD_CHANGED: %',routine; end if;
    execute updated;
  end loop;
  definition:=pg_get_functiondef('public.save_student_stage_entry(uuid,jsonb)'::regprocedure);
  updated:=replace(definition,'(student.assigned_to=actor or public.has_perm(actor,''student.view.all''))','public.can_access_student(student.id,actor)');
  updated:=replace(updated,'lead.owner_id is null and not public.has_perm(actor,''student.view.all'')','not public.can_edit_school_lead(lead.id,actor)');
  updated:=replace(updated,'lead.owner_id<>actor and not public.has_perm(actor,''student.view.all'')','not public.can_edit_school_lead(lead.id,actor)');
  updated:=replace(updated,'''LEAD_UNASSIGNED''','''FORBIDDEN_SCOPE''');
  -- 笔记同样校验可办理范围，组内只读人员不能由 note 分支进入写入。
  updated:=replace(updated,'perform public.read_student_stage_subject(student_id,lead_id);',
    'perform public.read_student_stage_subject(student_id,lead_id);
    if not public.school_support_subject_access(student_id,lead_id,true) then raise exception ''FORBIDDEN_SCOPE''; end if;');
  if updated=definition then raise exception 'COLLABORATION_ENTRY_GUARD_CHANGED'; end if;
  execute updated;
end;
$guards$;

do $history_permissions$
declare definition text; updated text; routine regprocedure;
begin
  definition:=pg_get_functiondef('public.can_revise_communication_record(text,uuid)'::regprocedure);
  updated:=replace(definition,'return v_author=v_uid or public.has_perm(v_uid,''student.view.all'');','return true;');
  if updated=definition then raise exception 'COMMUNICATION_REVISION_GUARD_CHANGED'; end if;
  execute updated;

  definition:=pg_get_functiondef('public.can_access_course_opportunity_subject(uuid,uuid,uuid,uuid)'::regprocedure);
  updated:=replace(definition,'and (lead.owner_id is null or lead.owner_id = p_uid)',
    'and (lead.owner_id is null or public.can_edit_school_lead(lead.id,p_uid))');
  execute updated;
  definition:=pg_get_functiondef('public.reassign_assessment_assessor(uuid,uuid)'::regprocedure);
  updated:=replace(definition,'v_lead_owner_id is distinct from v_uid
     and not public.has_perm(v_uid, ''student.view.all'')','not public.can_edit_school_lead(v_invitation.lead_id,v_uid)');
  if updated=definition then raise exception 'ASSESSOR_REASSIGNMENT_GUARD_CHANGED'; end if;
  execute updated;

  foreach routine in array array['public.get_business_record_revision(text,uuid)'::regprocedure,'public.revise_business_record(text,uuid,text,jsonb,text)'::regprocedure] loop
    definition:=pg_get_functiondef(routine);
    updated:=replace(definition,'if not public.is_admin(auth.uid()) then raise exception ''FORBIDDEN''; end if;',
      'if not public.can_revise_school_business_record(p_kind,p_id) then raise exception ''FORBIDDEN''; end if;');
    if updated=definition then raise exception 'BUSINESS_REVISION_SCOPE_CHANGED: %',routine; end if;
    -- 共享活动的场次资料由活动管理权限维护；个人参与状态仍可单独修订。
    if routine::text like 'get_business_record_revision(%' then
      updated:=replace(updated,'for item in select value from jsonb_array_elements(rows) loop',
        'for item in select value from jsonb_array_elements(rows) loop
        if item->>''relation''=''activities'' and not public.has_perm(auth.uid(),''activity.manage'')
          and exists(select 1 from public.activity_registrations where activity_id=(item->>''id'')::uuid and id<>p_id) then continue; end if;');
      updated:=replace(updated,'where exists(select 1 from jsonb_array_elements(r.after_data)',
        'where (public.is_admin(auth.uid()) or r.kind=p_kind and r.record_id=p_id) and exists(select 1 from jsonb_array_elements(r.after_data)');
    else
      updated:=replace(updated,'rows:=public.business_record_revision_rows(p_kind,p_id);',
        'rows:=public.business_record_revision_rows(p_kind,p_id);
        if p_kind=''activity'' and coalesce(p_values->''activities'',''{}''::jsonb)<>''{}''::jsonb and not public.has_perm(auth.uid(),''activity.manage'')
          and exists(select 1 from public.activity_registrations r join public.activity_registrations other on other.activity_id=r.activity_id
            where r.id=p_id and other.id<>r.id) then raise exception ''FORBIDDEN''; end if;');
    end if;
    execute updated;
  end loop;
end;
$history_permissions$;

-- 阅读入口可见同组；写能力字段使用 can_access_student/can_edit_school_lead。
do $readers$
declare routine regprocedure; definition text; updated text; name text;
begin
  for routine,name in select p.oid::regprocedure,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('read_student_record_with_enrollments','read_student_stage_subject_with_enrollments') loop
    definition:=pg_get_functiondef(routine);
    updated:=replace(definition,'student.id is null or not public.can_access_student(student.id,actor)',
      'student.id is null or not public.can_view_school_student(student.id,actor)');
    updated:=replace(updated,'(lead.owner_id is null or lead.owner_id=actor or public.has_perm(actor,''student.view.all''))','public.can_view_school_lead(lead.id,actor)');
    updated:=replace(updated,'(l.owner_id=actor or l.owner_id is null or public.has_perm(actor,''student.view.all''))','public.can_view_school_lead(l.id,actor)');
    updated:=replace(updated,'(l.owner_id is null or l.owner_id=actor or public.has_perm(actor,''student.view.all''))','public.can_view_school_lead(l.id,actor)');
    updated:=replace(updated,'(coalesce(lead.owner_id=actor,false) or public.has_perm(actor,''student.view.all''))','public.can_edit_school_lead(lead.id,actor)');
    updated:=replace(updated,'(student.assigned_to=actor or public.has_perm(actor,''student.view.all''))','public.can_access_student(student.id,actor)');
    updated:=replace(updated,'return jsonb_build_object(','return public.school_collaboration_row(jsonb_build_object(');
    updated:=replace(updated,'''assessmentAt'') else ''{}''::jsonb end;','''assessmentAt'') else ''{}''::jsonb end);');
    if updated=definition then raise exception 'COLLABORATION_READER_CHANGED: %',routine; end if;
    execute updated;
  end loop;

  for routine,name in select p.oid::regprocedure,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('student_list_facts','student_record_list_rows','student_record_index_with_enrollments','student_stage_index_with_enrollments') loop
    definition:=pg_get_functiondef(routine);
    updated:=replace(definition,'(view_all or public.can_access_student(s.id,actor))','(view_all or public.can_view_school_student(s.id,actor))');
    updated:=replace(updated,'and public.can_access_student(s.id,actor)','and public.can_view_school_student(s.id,actor)');
    updated:=replace(updated,'(''all'',''mine'',''unassigned'')','(''all'',''mine'',''unassigned'',''group'')');
    updated:=replace(updated,'p_scope=''mine'' and s.assigned_to=actor','p_scope=''mine'' and public.school_subject_is_participant(s.id,null,actor)');
    updated:=replace(updated,'p_scope=''mine'' and l.owner_id=actor','p_scope=''mine'' and public.school_subject_is_participant(l.student_id,l.id,actor)');
    updated:=replace(updated,'p_scope=''unassigned'' and s.assigned_to is null','p_scope=''unassigned'' and s.assigned_to is null or p_scope=''group'' and public.school_subject_in_my_groups(s.id,null,actor)');
    updated:=replace(updated,'p_scope=''unassigned'' and l.owner_id is null','p_scope=''unassigned'' and l.owner_id is null or p_scope=''group'' and public.school_subject_in_my_groups(l.student_id,l.id,actor)');
    updated:=replace(updated,'(l.owner_id is null or l.owner_id=actor or view_all)','public.can_view_school_lead(l.id,actor)');
    updated:=replace(updated,'(coalesce(l.owner_id=actor,false) or view_all)','public.can_edit_school_lead(l.id,actor)');
    updated:=replace(updated,'(st.assigned_to=actor or view_all)','public.can_access_student(st.id,actor)');
    if name='student_list_facts' then
      updated:=replace(updated,'write_followup and (s.student_id is not null or l.id is not null and',
        'write_followup and (s.student_id is not null and public.can_access_student(s.student_id,actor) or l.id is not null and');
      updated:=replace(updated,'select r.payload,r.stage','select public.school_collaboration_row(r.payload),r.stage');
    elsif name='student_record_list_rows' then
      updated:=replace(updated,'  return result;','  return (select coalesce(jsonb_agg(public.school_collaboration_row(r)),''[]''::jsonb) from jsonb_array_elements(result) r);');
    end if;
    if updated=definition then raise exception 'COLLABORATION_LIST_CHANGED: %',routine; end if;
    execute updated;
  end loop;

  -- 这些函数只读业务经历；删除、合并、监护、财务等入口继续沿用其专门授权。
  for routine in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('get_student_lifecycle','get_student_source_archive','get_business_source_records','get_history_source_context','get_student_merge_history') loop
    definition:=pg_get_functiondef(routine);
    updated:=replace(definition,'public.can_access_student(','public.can_view_school_student(');
    updated:=replace(updated,'(v_lead.owner_id is null or v_lead.owner_id=v_uid or public.has_perm(v_uid,''student.view.all''))','public.can_view_school_lead(v_lead.id,v_uid)');
    execute updated;
  end loop;
end;
$readers$;

do $filters$
declare routine regprocedure; definition text; updated text;
begin
  for routine in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('list_student_records_page','list_student_record_workspace','list_student_record_summaries','list_student_recontact_summaries','list_student_stage_workspace','list_student_stage_summaries') loop
    definition:=pg_get_functiondef(routine);
    updated:=replace(definition,'(''all'',''mine'',''unassigned'')','(''all'',''mine'',''unassigned'',''group'')');
    if routine::text like 'list_student_records_page(%' then
      updated:=replace(updated,'array[''grade'',''detail'',''scope'',''owner'']','array[''grade'',''detail'',''scope'',''owner'',''group'']');
      updated:=replace(updated,'coalesce(p_labels->f.id->>v.value,e.fields->f.id->>''label'',v.value)',
        'coalesce(p_labels->f.id->>v.value,case when f.id=''group'' then (select name from public.school_business_groups where id::text=v.value)
          when f.id in (''owner'',''teacher'') then (select display_name from public.profiles where id::text=v.value) end,e.fields->f.id->>''label'',v.value)');
    end if;
    execute updated;
  end loop;
  definition:=pg_get_functiondef('public.student_list_field(jsonb,text,jsonb,uuid,text)'::regprocedure);
  updated:=replace(definition,'when ''owner'',''teacher'' then','when ''owner'',''teacher'' then
      values:=(select jsonb_agg(p->>''userId'') from jsonb_array_elements(p_row->''participants'') p
        where case when p_field=''owner'' then p->>''role''=''school_support'' else p->>''role'' in (''teacher'',''assessment_teacher'') end);
      if values is not null then return jsonb_build_object(''values'',values,''label'',p_row->>(p_field||''Name''),''sort'',p_row->>(p_field||''Name''),''missing'',false); end if;');
  updated:=replace(updated,'if p_row->>''ownerId''=p_actor::text then',
    'if coalesce((p_row->>''inMyGroups'')::boolean,false) then values:=values||jsonb_build_array(''group''); end if;
      if coalesce((p_row->>''isParticipant'')::boolean,false) then');
  updated:=replace(updated,'when ''scope'' then','when ''group'' then
      values:=coalesce((select jsonb_agg(g->>''id'') from jsonb_array_elements(p_row->''groups'') g),''[]''::jsonb);
      label:=(select string_agg(g->>''name'',''、'' order by g->>''name'') from jsonb_array_elements(p_row->''groups'') g);
      return jsonb_build_object(''values'',values,''label'',label,''sort'',label,''missing'',jsonb_array_length(values)=0);
    when ''scope'' then');
  execute updated;
end;
$filters$;

-- 线索页复用安全视图过滤参与范围；不向浏览器发送全库参与人 ID。
create view public.collaborative_lead_records with (security_invoker=true) as
  select l.*,public.school_subject_is_participant(l.student_id,l.id,auth.uid()) as is_participant,
    public.school_subject_in_my_groups(l.student_id,l.id,auth.uid()) as in_my_groups,
    public.can_edit_school_lead(l.id,auth.uid()) as can_edit from public.leads l;
create view public.collaborative_leads with (security_invoker=true) as
  select * from public.collaborative_lead_records l where public.business_subject_is_current(l.student_id,l.id);
grant select on public.collaborative_lead_records,public.collaborative_leads to authenticated;
