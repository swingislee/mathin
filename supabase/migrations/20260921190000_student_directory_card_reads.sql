-- 卡片在数据库内批量构造；详细档案和选人沟通继续使用完整读取合同。
do $guard$
declare item record;
begin
  for item in select * from (values
    ('list_student_directory(text,text,text,text,text,integer,integer,uuid[])','14fd5a0adf814afd84547bf1f495c961'),
    ('student_record_list_rows(jsonb,public.business_course_enrollment_subjects[])','47b638a2e956b2bce4b21402c5ac5459'),
    ('read_student_record_with_enrollments(uuid,uuid,public.business_course_enrollment_subjects[])','f157eceef4f5d05056fca12a4b43fe99'),
    ('student_stage_learning_background(uuid,uuid,text,text)','065d8e92b8940be04d2ec030bc5d37d9'),
    ('student_first_contact_detail(uuid,text,text,text)','ee95573cfb015524fb044cbbabcf8cdc'),
    ('student_learning_band(text)','67c994da79a2f4e3248b6afbb2bee168')
  ) expected(signature,hash) loop
    if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=('public.'||item.signature)::regprocedure)
      is distinct from item.hash then raise exception 'DIRECTORY_CARD_DEPENDENCY_CHANGED: %',item.signature; end if;
  end loop;
end;
$guard$;

-- 私有函数只接收经名录核心完成可见性、筛选与分页后的身份。
create function public.student_directory_card_rows(p_subjects jsonb,p_enrollments public.business_course_enrollment_subjects[])
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp set plan_cache_mode=force_custom_plan as $$
declare actor uuid:=auth.uid(); view_all boolean:=public.has_perm(auth.uid(),'student.view.all');
  view_followup boolean:=public.has_perm(auth.uid(),'followup.view'); write_followup boolean:=public.has_perm(auth.uid(),'followup.write');
  timezone_name text:=public.get_organization_timezone_v2(); today date; result jsonb;
begin
  if actor is null or not public.is_staff(actor) then raise exception 'FORBIDDEN'; end if;
  today:=(now() at time zone timezone_name)::date;
  with subjects as materialized (
    select s.*,s.stage not in ('awaiting_first_contact','awaiting_assessment') or exists(
      select 1 from public.lead_invitation_threads i where i.lead_id=s.lead_id and i.state not in ('completed','cancelled')) as full_facts
    from jsonb_to_recordset(p_subjects) s(student_id uuid,lead_id uuid,key text,stage text,detail text,created_at timestamptz)
  ), visibility as materialized (
    select v.key,v.can_access,v.can_view from public.school_list_visibility(actor) v where not view_all
  ), lead_refs as materialized (
    select s.key,l.id,l.source_record_id,
      view_followup and (view_all or l.owner_id is null or l.owner_id=actor or coalesce(v.can_view,false)) as visible
      from subjects s join public.leads l on l.id=s.lead_id or l.student_id=s.student_id
      left join visibility v on v.key='lead:'||l.id
  ), contacts as materialized (
    select ref.key,ref.visible,c.id,c.occurred_at,coalesce(r.effective_patch->>'outcome',c.outcome) as outcome
      from lead_refs ref join public.business_lead_communications c on c.lead_id=ref.id
      left join lateral (select r.effective_patch from public.communication_record_revisions r
        where r.source='contact' and r.event_id=c.id order by r.revision_no desc limit 1) r on true
  ), contact_flags as (
    select c.key from contacts c where c.outcome in ('connected','declined') group by c.key
  ), latest_contacts as (
    select distinct on(c.key) c.key,c.outcome from contacts c where c.visible order by c.key,c.occurred_at desc,c.id
  ), subject_sources as materialized (
    select ref.key,h.id from lead_refs ref join public.history_import_records h on h.lead_id=ref.id
    union select ref.key,h.id from lead_refs ref join public.history_import_records h on h.id=ref.source_record_id
  ), registration_refs as materialized (
    select s.key,r.id from subjects s join public.activity_registrations r on r.student_id=s.student_id where s.full_facts
    union select ref.key,r.id from lead_refs ref join subjects s using(key) join public.activity_registrations r on r.lead_id=ref.id where s.full_facts
    union select ref.key,r.id from subject_sources ref join subjects s using(key) join public.activity_registrations r on r.source_record_id=ref.id where s.full_facts
  ), registrations as materialized (
    select ref.key,r.id,r.activity_id,r.status,r.assessment_started_at,r.assessment_completed_at,r.created_at,r.record_state,r.source_enrollment_facts
      from registration_refs ref join public.business_activity_registrations r on r.id=ref.id
  ), registration_flags as (
    select r.key,bool_or(r.source_enrollment_facts @> '{"confirmed":true}'::jsonb) as enrolled,
      bool_or(r.record_state='current' and r.source_enrollment_facts @> '{"confirmed":true}'::jsonb) as active,
      bool_or(r.status='attended' and a.id is not null and a.deleted_at is null) as attended
      from registrations r left join public.business_activities a on a.id=r.activity_id group by r.key
  ), stage_assessments as materialized (
    select distinct on(r.key) r.key,r.id as registration_id,a.score,a.assessment_band,
      coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) as completed_at
      from registrations r join public.business_assessment_results a on a.activity_registration_id=r.id
      where public.student_assessment_is_complete(r.status,r.assessment_completed_at,a.result_finalized_at,
        a.result_source,a.score,a.assessment_band,a.strengths,
        concat_ws(E'\n',a.strengths,a.focus_areas,a.parent_concerns,a.teacher_recommendation,a.teacher_observation))
      order by r.key,coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) desc,a.id
  ), appointments as (
    select distinct on(r.key) r.key,r.status,r.assessment_started_at from registrations r join public.business_activities a on a.id=r.activity_id
      where r.record_state='current' and a.record_state='current' and a.deleted_at is null and a.kind in ('assessment_1v1','assessment')
      order by r.key,coalesce(a.scheduled_at,r.created_at) desc,r.id
  ), enrollment_facts as materialized (
    select e.id,e.subject_key,e.source_record_id,e.status,e.record_state,e.term_id,e.confirmed_at from unnest(p_enrollments) e
  ), enrollment_refs as materialized (
    select s.key,e.id,e.status,e.record_state,e.term_id,e.confirmed_at from subjects s join enrollment_facts e on e.subject_key=s.key where s.full_facts
    union select ref.key,e.id,e.status,e.record_state,e.term_id,e.confirmed_at from subject_sources ref join subjects s using(key)
      join enrollment_facts e on e.source_record_id=ref.id where s.full_facts
  ), enrollment_flags as (
    select e.key,bool_or(e.status='active' and e.record_state='current' and (t.ends_on is null or t.ends_on>=today)) as active,
      bool_or(e.record_state='current') as current_record from enrollment_refs e left join public.school_terms t on t.id=e.term_id group by e.key
  ), latest_enrollments as (
    select distinct on(e.key) e.key,e.status from enrollment_refs e order by e.key,(e.status='active' and e.record_state='current') desc,e.confirmed_at desc,e.id
  ), memberships as materialized (
    select s.key,bool_or(e.status='active' and e.left_at is null and (t.ends_on is null or t.ends_on>=today)) as active,
      bool_or(e.status='active' and e.left_at is null and c.archived_at is null and c.trashed_at is null
        and (t.ends_on is null or t.ends_on>=today)
        and (regexp_match(c.name,'(?:春季|暑期|暑假|秋季|寒假)(X[+＋]|G[+＋]|A[+＋]?|S|C|培优|基础)(?:[|｜班]|$)'))[1] is not null) as class_band
      from subjects s join public.enrollments e on e.student_id=s.student_id join public.classrooms c on c.id=e.classroom_id
      left join public.school_terms t on t.id=c.term_id where s.full_facts group by s.key
  ), opportunities as (
    select distinct on(s.key) s.key,o.stage,o.opportunity_type from subjects s join public.business_course_opportunities o on
      o.student_id=s.student_id or exists(select 1 from lead_refs ref where ref.key=s.key and ref.id=o.lead_id)
      where s.full_facts and o.record_state='current' order by s.key,o.updated_at desc,o.id
  ), invitations as (
    select distinct on(s.key) s.key,i.kind,i.state from subjects s join public.lead_invitation_threads i on i.lead_id=s.lead_id
      where s.full_facts and i.state not in ('completed','cancelled') order by s.key,i.updated_at desc,i.id
  ), stages as materialized (
    select s.*,case when not s.full_facts then s.stage
      when coalesce(e.active,false) or coalesce(m.active,false) or coalesce(r.active,false) and not coalesce(e.current_record,false) then 'awaiting_renewal'
      when e.key is not null or m.key is not null or coalesce(r.enrolled,false) then 'former_student'
      when a.key is not null then 'awaiting_enrollment'
      when c.key is not null or coalesce(r.attended,false) then 'awaiting_assessment' else 'awaiting_first_contact' end as current_stage
      from subjects s left join enrollment_flags e using(key) left join memberships m using(key)
      left join registration_flags r using(key) left join stage_assessments a using(key) left join contact_flags c using(key)
  ), background_leads as materialized (
    select ref.key,ref.id,ref.source_record_id from lead_refs ref join subjects s using(key) where s.full_facts or ref.visible
  ), source_refs as materialized (
    select s.key,h.id from subjects s join public.history_import_records h on h.student_id=s.student_id
    union select ref.key,h.id from background_leads ref join public.history_import_records h on h.lead_id=ref.id
    union select s.key,a.record_id from subjects s join public.history_import_associations a on a.student_id=s.student_id
    union select ref.key,ref.source_record_id from background_leads ref where ref.source_record_id is not null
    union select ref.key,c.source_record_id from background_leads ref join public.lead_communications c on c.lead_id=ref.id where c.source_record_id is not null
    union select s.key,r.source_record_id from subjects s join public.activity_registrations r on r.student_id=s.student_id where r.source_record_id is not null
    union select ref.key,r.source_record_id from background_leads ref join public.activity_registrations r on r.lead_id=ref.id where r.source_record_id is not null
    union select s.key,a.source_record_id from subjects s join public.assessment_results a on a.student_id=s.student_id where a.source_record_id is not null
    union select ref.key,a.source_record_id from background_leads ref join public.assessment_results a on a.lead_id=ref.id where a.source_record_id is not null
    union select s.key,e.source_record_id from subjects s join public.course_enrollments e on e.student_id=s.student_id where e.source_record_id is not null
  ), source_hints as (
    select ref.key,bool_or(c->>'fieldName' in ('报名服务老师','学服老师','确认人员') and nullif(btrim(c->>'text'),'') is not null) as owner_hint,
      bool_or(h.record_data->>'tableName'='2026秋季在读学员表格' and c->>'fieldName'='班型' and nullif(btrim(c->>'text'),'') is not null) as class_band
      from source_refs ref join stages s using(key) join public.history_import_records h on h.id=ref.id
      cross join lateral jsonb_array_elements(h.record_data->'cells') c
      where h.source_data->>'format'='feishu-base' and s.current_stage in ('awaiting_first_contact','awaiting_renewal') group by ref.key
  ), assessment_refs as materialized (
    select s.key,a.id from subjects s join public.assessment_results a on a.student_id=s.student_id where s.full_facts
    union select s.key,a.id from subjects s join public.activity_registrations r on r.student_id=s.student_id join public.assessment_results a on a.activity_registration_id=r.id where s.full_facts
    union select ref.key,a.id from background_leads ref join subjects s using(key) join public.assessment_results a on a.lead_id=ref.id where s.full_facts
    union select ref.key,a.id from background_leads ref join subjects s using(key) join public.activity_registrations r on r.lead_id=ref.id
      join public.assessment_results a on a.activity_registration_id=r.id where s.full_facts
    union select ref.key,a.id from source_refs ref join subjects s using(key) join public.assessment_results a on a.source_record_id=ref.id where s.full_facts
    union select ref.key,a.id from source_refs ref join subjects s using(key) join public.activity_registrations r on r.source_record_id=ref.id
      join public.assessment_results a on a.activity_registration_id=r.id where s.full_facts
  ), actual_assessments as (
    select distinct on(ref.key) ref.key,a.id,a.score,public.student_learning_band(a.assessment_band) as band,
      coalesce(a.assessed_on,(coalesce(r.assessment_completed_at,a.result_finalized_at) at time zone timezone_name)::date,
        act.occurred_on,(act.scheduled_at at time zone timezone_name)::date) as assessed_on
      from assessment_refs ref join public.business_assessment_results a on a.id=ref.id
      join public.business_activity_registrations r on r.id=a.activity_registration_id join public.business_activities act on act.id=r.activity_id
      where act.deleted_at is null and public.student_assessment_is_complete(r.status,r.assessment_completed_at,a.result_finalized_at,
        a.result_source,a.score,a.assessment_band,a.strengths,
        concat_ws(E'\n',a.strengths,a.focus_areas,a.parent_concerns,a.teacher_recommendation,a.teacher_observation))
      order by ref.key,coalesce(a.assessed_on,(coalesce(r.assessment_completed_at,a.result_finalized_at) at time zone timezone_name)::date,
        act.occurred_on,(act.scheduled_at at time zone timezone_name)::date) desc nulls last,a.updated_at desc,a.id
  )
  select coalesce(jsonb_agg(jsonb_build_object('key',s.key,'id',st.id,'name',st.name,
    'phoneTail',right(regexp_replace(coalesce(nullif(st.parent_phone,''),nullif(st.phone,''),l.phone,''),'[^0-9]','','g'),4),
    'grade',coalesce(st.grade,l.grade_hint),'gradeText',coalesce(l.grade_text,''),'stage',s.current_stage,
    'detail',case
      when s.current_stage='awaiting_first_contact' then public.student_first_contact_detail(coalesce(st.assigned_to,l.owner_id),
        coalesce(p.display_name,case when h.owner_hint then 'source' end),l.status,c.outcome)
      when not s.full_facts then s.detail
      when s.current_stage='awaiting_assessment' then case when i.kind='assessment_1v1' and i.state='confirmed' then 'booked'
        when i.kind='assessment_1v1' then 'coordinating' when ap.status='no_show' then 'no_show' when ap.status='cancelled' then 'cancelled'
        when ap.assessment_started_at is not null then 'in_progress' when ap.status='attended' then 'attended_without_result'
        when ap.status='booked' then 'booked' when rf.attended then 'attended_without_result' else 'not_booked' end
      when s.current_stage='awaiting_enrollment' then case o.stage when 'committed' then 'ready_to_enroll' when 'not_enrolled' then 'not_enrolling'
        when 'considering' then 'considering' when 'payment_pending' then 'payment_pending' when 'nurturing' then 'nurturing' else coalesce(w.classification,'assessed') end
      when s.current_stage='awaiting_renewal' then case when o.opportunity_type='renewal' and o.stage='not_enrolled' then 'not_renewing'
        when o.opportunity_type='renewal' and o.stage='considering' then 'renewal_considering'
        when o.opportunity_type='renewal' and o.stage='committed' then 'renewal_committed'
        when o.opportunity_type='renewal' and o.stage='enrolled' then 'renewal_confirmed'
        when m.active then 'attending' else 'awaiting_class' end
      else case when e.status='cancelled' then 'withdrawn' else 'ended' end end,
    'canContact',write_followup and (view_all or coalesce(vs.can_access,false) or coalesce(vl.can_access,false)),
    'assessment',case when not s.full_facts then null
      when actual.id is not null then jsonb_build_object('band',actual.band,'score',actual.score,'at',actual.assessed_on)
      when s.current_stage='awaiting_renewal' and (coalesce(m.class_band,false) or coalesce(h.class_band,false)) then null
      when a.completed_at is not null then jsonb_build_object('band',a.assessment_band,'score',a.score,'at',a.completed_at) else null end
    ) order by s.created_at desc,s.key),'[]'::jsonb) into result
    from stages s join public.students st on st.id=s.student_id left join public.leads l on l.id=s.lead_id
    left join public.profiles p on p.id=coalesce(st.assigned_to,l.owner_id)
    left join visibility vs on vs.key=s.key left join visibility vl on vl.key='lead:'||s.lead_id
    left join latest_contacts c on c.key=s.key left join invitations i on i.key=s.key left join appointments ap on ap.key=s.key
    left join opportunities o on o.key=s.key left join memberships m on m.key=s.key left join source_hints h on h.key=s.key
    left join registration_flags rf on rf.key=s.key left join stage_assessments a on a.key=s.key left join latest_enrollments e on e.key=s.key
    left join public.assessment_workflow_states w on w.registration_id=a.registration_id left join actual_assessments actual on actual.key=s.key;
  return result;
end;
$$;
revoke all on function public.student_directory_card_rows(jsonb,public.business_course_enrollment_subjects[]) from public,anon,authenticated,service_role;

-- 这两个私有读取器已完成身份授权。业务视图的来源与归档规则改为查询内集合，
-- 同一来源在多张业务表出现时复用判定；原视图及其 RLS 继续服务其他入口。
do $business_sets$
declare item record; signature text; definition text; relation text; sets text:=$sets$
  directory_sources as materialized (
    select h.id,coalesce(d.decision='continue',s.record_id is null) as current_source
      from public.history_import_records h
      left join public.history_workflow_decisions d on d.key='record:'||h.id
      left join (select distinct record_id from public.history_workflow_scopes where resumed_at is null) s on s.record_id=h.id
      where h.source_data->>'format'='feishu-base'
  ), directory_historical_facts as materialized (
    select distinct s.relation,s.record_id from public.history_business_workflow_scopes s
      left join public.history_workflow_decisions d on d.key='record:'||s.source_record_id
      where coalesce(d.decision,'archive')<>'continue'
  ), directory_business_lead_communications as not materialized (
    select r.id,r.lead_id,r.occurred_at,r.outcome from public.lead_communications r
      where r.source_record_id is null or r.source_record_id in(select id from directory_sources)
  ), directory_business_activity_registrations as not materialized (
    select r.id,r.student_id,r.lead_id,r.activity_id,r.status,r.assessment_started_at,r.assessment_completed_at,r.created_at,
      r.source_record_id,r.source_enrollment_facts,
      case when (r.source_record_id is null or r.source_record_id in(select id from directory_sources where current_source))
        and not exists(select 1 from directory_historical_facts f where f.relation='activity_registrations' and f.record_id=r.id)
        then r.record_state else 'historical'::text end as record_state
      from public.activity_registrations r where r.source_record_id is null or r.source_record_id in(select id from directory_sources)
  ), directory_business_activities as not materialized (
    select r.id,r.kind,r.scheduled_at,r.occurred_on,r.deleted_at,
      case when (r.source_record_id is null or r.source_record_id in(select id from directory_sources where current_source))
        and not exists(select 1 from directory_historical_facts f where f.relation='activities' and f.record_id=r.id)
        then r.record_state else 'historical'::text end as record_state
      from public.activities r where r.source_record_id is null or r.source_record_id in(select id from directory_sources)
  ), directory_business_assessment_results as not materialized (
    select r.id,r.activity_registration_id,r.student_id,r.lead_id,r.score,r.assessment_band,r.assessed_on,r.assessed_by,r.updated_at,
      r.result_finalized_at,r.result_source,r.strengths,r.focus_areas,r.parent_concerns,r.teacher_recommendation,r.teacher_observation
      from public.assessment_results r where r.source_record_id is null or r.source_record_id in(select id from directory_sources)
  ), directory_business_course_opportunities as not materialized (
    select r.id,r.student_id,r.lead_id,r.stage,r.opportunity_type,r.course_id,r.term_id,r.updated_at,
      case when (r.source_record_id is null or r.source_record_id in(select id from directory_sources where current_source))
        and not exists(select 1 from directory_historical_facts f where f.relation='course_opportunities' and f.record_id=r.id)
        then r.record_state else 'historical'::text end as record_state
      from public.course_opportunities r where r.source_record_id is null or r.source_record_id in(select id from directory_sources)
  ),
$sets$;
begin
  for item in select * from (values
    ('business_source_is_current(text)','cd024ce4e2806e5a8917cd2d2813bbb6'),
    ('business_source_is_authoritative(text)','32b4b1d123b65d451ba3d8da863977cd'),
    ('business_fact_is_current(text,uuid)','d7502c72618896d124b4207cf953c92b')
  ) expected(signature,hash) loop
    if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=('public.'||item.signature)::regprocedure)
      is distinct from item.hash then raise exception 'DIRECTORY_BUSINESS_RULE_CHANGED: %',item.signature;end if;
  end loop;
  for item in select * from (values
    ('business_activities','6b6770af825c89c6584e66021ea49374'),
    ('business_activity_registrations','591e0418c08b0c5d42fbafffab01965f'),
    ('business_assessment_results','12da195b6e922f4aea45139f8f98d7a8'),
    ('business_course_opportunities','436c3243ecf6d78ba0b4f76fcbf41290'),
    ('business_lead_communications','58bc9ae6a940d095cad768ceb604309f')
  ) expected(name,hash) loop
    if md5(btrim(replace(pg_get_viewdef(('public.'||item.name)::regclass,true),chr(13),''),E' \n\r\t')) is distinct from item.hash
      or not exists(select 1 from pg_class where oid=('public.'||item.name)::regclass and reloptions @> array['security_invoker=true']) then
      raise exception 'DIRECTORY_BUSINESS_VIEW_CHANGED: %',item.name;end if;
  end loop;
  foreach signature in array array['public.student_record_index_for_population(text,text,public.business_course_enrollment_subjects[],boolean)',
    'public.student_directory_card_rows(jsonb,public.business_course_enrollment_subjects[])'] loop
    select pg_get_functiondef(signature::regprocedure) into definition;
    foreach relation in array array['lead_communications','activity_registrations','activities','assessment_results','course_opportunities'] loop
      definition:=replace(definition,'public.business_'||relation,'directory_business_'||relation);
    end loop;
    if signature like 'public.student_record_index_for_population%' then
      definition:=replace(definition,'return query with','return query with '||sets);
    else definition:=replace(definition,'with subjects as materialized','with '||sets||' subjects as materialized');end if;
    if definition not like '%directory_sources as materialized%' then raise exception 'DIRECTORY_BUSINESS_REWRITE_FAILED';end if;
    execute definition;
  end loop;
end;
$business_sets$;

-- 分组、过滤、计数、排序与分页只有一个实现；两种出口在选页后选择所需投影。
do $core$
declare definition text; owner_name text;
begin
  select pg_get_functiondef(oid),pg_get_userbyid(proowner) into definition,owner_name
    from pg_proc where oid='public.list_student_directory(text,text,text,text,text,integer,integer,uuid[])'::regprocedure;
  definition:=replace(definition,'FUNCTION public.list_student_directory(', 'FUNCTION public.student_directory_page(');
  definition:=replace(definition,'p_selected uuid[] DEFAULT NULL::uuid[])','p_selected uuid[] DEFAULT NULL::uuid[], p_cards_only boolean DEFAULT false)');
  definition:=replace(definition,'public.student_record_index_with_enrollments(p_scope,p_search,facts)',
    'public.student_record_index_for_population(p_scope,p_search,facts,true)');
  -- 全部身份保持数据库行；仅协作分组和当前页需要 JSON，避免先序列化数千人再拆回行。
  definition:=replace(definition,$old$select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) into subjects
    from public.student_record_index_for_population(p_scope,p_search,facts,true) s
    where s.student_id is not null and (p_selected is null or s.student_id=any(p_selected));
  with identities as materialized ($old$,
    $new$with directory_subjects as materialized (
    select s.* from public.student_record_index_for_population(p_scope,p_search,facts,true) s
    where s.student_id is not null and (p_selected is null or s.student_id=any(p_selected))
  ), identities as materialized ($new$);
  definition:=replace(definition,
    'from jsonb_to_recordset(subjects) s(student_id uuid,lead_id uuid,key text,stage text,detail text,created_at timestamptz)',
    'from directory_subjects s');
  definition:=replace(definition,$old$left join public.school_list_collaboration(case when p_group_by in ('owner','group') then subjects else '[]'::jsonb end,actor) c using(key)$old$,
    $new$left join lateral (
      select c.key,c.projection from public.school_list_collaboration(
        (select coalesce(jsonb_agg(to_jsonb(ref)),'[]'::jsonb) from directory_subjects ref),actor) c
      where p_group_by in ('owner','group')
    ) c using(key)$new$);
  definition:=replace(definition,$old$select r from jsonb_array_elements(public.student_record_list_rows(
      coalesce((select jsonb_agg(jsonb_build_object('key',key,'student_id',student_id,'lead_id',lead_id,'stage',stage,'detail',detail,'created_at',created_at)) from page_rows),'[]'::jsonb),facts)) r$old$,
    $new$select r from (select coalesce(jsonb_agg(jsonb_build_object('key',key,'student_id',student_id,'lead_id',lead_id,'stage',stage,'detail',detail,'created_at',created_at)),'[]'::jsonb) as items from page_rows) selected
      cross join lateral jsonb_array_elements(case when p_cards_only then public.student_directory_card_rows(selected.items,facts)
        else public.student_record_list_rows(selected.items,facts) end) r$new$);
  definition:=replace(definition,'d.r||jsonb_build_object(''directoryGroups'',s.items)',
    'case when p_cards_only then (d.r-''key'')||jsonb_build_object(''groups'',s.items) else d.r||jsonb_build_object(''directoryGroups'',s.items) end');
  if definition not like '%p_cards_only boolean%' or definition not like '%student_directory_card_rows(selected.items,facts)%'
    or definition not like '%with directory_subjects as materialized%' or definition like '%into subjects%' then
    raise exception 'DIRECTORY_CARD_REWRITE_FAILED'; end if;
  execute definition;
  execute format('alter function public.student_directory_page(text,text,text,text,text,integer,integer,uuid[],boolean) owner to %I',owner_name);
  execute format('alter function public.student_directory_card_rows(jsonb,public.business_course_enrollment_subjects[]) owner to %I',owner_name);
end;
$core$;
revoke all on function public.student_directory_page(text,text,text,text,text,integer,integer,uuid[],boolean) from public,anon,authenticated,service_role;

create or replace function public.list_student_directory(p_scope text default 'mine',p_search text default '',p_stage text default 'all',
  p_group_by text default 'classroom',p_group text default '',p_page integer default 1,p_page_size integer default 100,p_selected uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp set jit=off set plan_cache_mode=force_custom_plan as $$
begin return public.student_directory_page(p_scope,p_search,p_stage,p_group_by,p_group,p_page,p_page_size,p_selected,false); end;
$$;

create function public.list_student_directory_cards(p_scope text default 'mine',p_search text default '',p_stage text default 'all',
  p_group_by text default 'classroom',p_group text default '',p_page integer default 1,p_page_size integer default 100)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp set jit=off set plan_cache_mode=force_custom_plan as $$
begin return public.student_directory_page(p_scope,p_search,p_stage,p_group_by,p_group,p_page,p_page_size,null,true); end;
$$;
revoke all on function public.list_student_directory_cards(text,text,text,text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_student_directory_cards(text,text,text,text,text,integer,integer) to authenticated;
do $owner$ begin
  execute format('alter function public.list_student_directory_cards(text,text,text,text,text,integer,integer) owner to %I',
    (select pg_get_userbyid(proowner) from pg_proc where oid='public.list_student_directory(text,text,text,text,text,integer,integer,uuid[])'::regprocedure));
end; $owner$;
