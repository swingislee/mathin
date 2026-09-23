
-- 错误拼出的阶段只保留在原始归档和审计中，不作为当前沟通显示。
create or replace view public.business_lead_communications as
 select id,lead_id,channel,outcome,note,wechat_added,visit_committed,interest_level,recorded_by,owner_id_at_contact,
 occurred_at,source_record_id,source_key,occurred_on,source_metric_facts,overview_contact_v2
 from public.lead_communications where public.business_source_is_authoritative(source_record_id)
 and not coalesce(source_metric_facts->'supersededProjection'='true'::jsonb,false);
-- 新 RPC 与旧应用兼容共存，旧四阶段接口保持既有签名和返回范围。
create or replace function public.get_student_lifecycle_v2(p_student_id uuid,p_lead_id uuid)
returns text language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 result:=public.read_student_record_subject(p_student_id,p_lead_id);
 return result->>'stage';
end;$$;
revoke all on function public.get_student_lifecycle_v2(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_student_lifecycle_v2(uuid,uuid) to authenticated;
alter function public.get_student_lifecycle_v2(uuid,uuid) owner to postgres;
create or replace function public.school_other_contact_subjects()
returns table(key text) language sql stable security definer set search_path=public,pg_temp as $$
 select distinct coalesce('student:'||r.student_id,'student:'||l.student_id,'lead:'||r.lead_id)
 from public.business_activity_registrations r left join public.leads l on l.id=r.lead_id
 where coalesce(r.source_metric_facts->'effectiveContact'='true'::jsonb,false)
 union select 'student:'||f.student_id from public.business_student_follow_ups f
 where nullif(btrim(f.content),'') is not null
   and f.content !~ '^[\s0-9，,。.;；:：、/—()（）-]*(未通|未接通|未接听|无人接听|待联系|未联系|暂无|无)[\s0-9，,。.;；:：、/—()（）-]*$';
$$;
revoke all on function public.school_other_contact_subjects() from public,anon,authenticated,service_role;
alter function public.school_other_contact_subjects() owner to postgres;
-- 当前阶段读取全部已确认业务证据，工作单和来源视图只决定查看范围。
create or replace function public.school_contact_is_effective(p_row jsonb,p_patch jsonb default null)
returns boolean language sql immutable set search_path=public,pg_temp as $$
 select coalesce(coalesce(p_patch->>'outcome',p_row->>'outcome') in ('connected','declined')
   or coalesce(p_patch->'wechatAdded',p_row->'wechat_added')='true'::jsonb
   or coalesce(p_patch->'visitCommitted',p_row->'visit_committed')='true'::jsonb
   or not coalesce(p_patch ? 'outcome',false) and p_row->'source_metric_facts'->'effectiveContact'='true'::jsonb,false)
   and not coalesce(p_row->'source_metric_facts'->'supersededProjection'='true'::jsonb,false);
$$;

create or replace function public.school_contact_sort_key(p_at timestamptz,p_on date,p_source jsonb,p_key text)
returns text language sql stable set search_path=public,pg_temp as $$
 select coalesce(to_char(p_at at time zone public.get_organization_timezone_v2(),'YYYY-MM-DD HH24:MI:SS'),p_on::text,'')
 ||':'||case when p_key like '%:followup' then '3' when p_key like '%:project' then '2' else '1' end;
$$;

create or replace function public.student_assessment_is_complete(p_status text,p_completed_at timestamptz,p_finalized_at timestamptz,p_source text,p_score numeric,p_band text,p_strengths text,p_feedback text)
returns boolean language sql immutable set search_path=public,pg_temp as $$
 select coalesce(p_source='legacy' and (p_score is not null or p_band is not null
   or p_strengths ~ '(^|[\r\n])(原测评等级|学习力测评等级)：\s*(未达A|[XG][+＋]|A[+＋]?|S|C)(\s|$)')
   or p_source<>'legacy' and p_status not in ('no_show','cancelled')
     and (p_completed_at is not null or p_finalized_at is not null),false);
$$;

create or replace function public.school_source_statuses(p_subjects jsonb)
returns table(key text,status jsonb) language sql stable security definer set search_path=public,pg_temp as $$
 with subjects as materialized(select v->>'key' as key,(v->>'studentId')::uuid student_id,(v->>'leadId')::uuid lead_id from jsonb_array_elements(p_subjects) v),
 lead_refs as materialized(select s.key,l.id,l.source_record_id from subjects s join public.leads l on l.student_id=s.student_id
   union select s.key,l.id,l.source_record_id from subjects s join public.leads l on l.id=s.lead_id),
 refs as materialized(
  select s.key,h.id from subjects s join public.history_import_records h on h.student_id=s.student_id
  union select s.key,a.record_id from subjects s join public.history_import_associations a on a.student_id=s.student_id
  union select l.key,l.source_record_id from lead_refs l where l.source_record_id is not null
  union select l.key,h.id from lead_refs l join public.history_import_records h on h.lead_id=l.id
  union select l.key,c.source_record_id from lead_refs l join public.lead_communications c on c.lead_id=l.id where c.source_record_id is not null
  union select s.key,r.source_record_id from subjects s join public.activity_registrations r on r.student_id=s.student_id where r.source_record_id is not null
  union select l.key,r.source_record_id from lead_refs l join public.activity_registrations r on r.lead_id=l.id where r.source_record_id is not null
 ), latest as materialized(
  select distinct on(ref.key,h.record_data->>'tableId',h.source_record_id) ref.key,h.id from refs ref join public.history_import_records h on h.id=ref.id
  where h.source_data->>'format'='feishu-base'
  order by ref.key,h.record_data->>'tableId',h.source_record_id,h.source_data->>'filename' desc,h.id
 ), reviews as(
  select l.key,count(*)::integer as count from latest l join public.history_source_business_facts f on f.source_record_id=l.id
  cross join lateral jsonb_array_elements(f.fields) c where jsonb_array_length(coalesce(c->'review','[]'))>0 group by l.key
 ), opportunity_refs as materialized(
  select s.key,o.id from subjects s join public.course_opportunities o on o.student_id=s.student_id
  union select l.key,o.id from lead_refs l join public.course_opportunities o on o.lead_id=l.id
 ), arrangements as(
  select distinct on(s.key) s.key,concat_ws(' · ',nullif(o.term_label,''),nullif(o.class_label,''),nullif(o.teacher_label,''),
    (select string_agg(c->>'text',' ' order by c->>'fieldName') from jsonb_array_elements(h.record_data->'cells') c
      where c->>'fieldName' in ('26秋上课周次','26秋上课时段') and nullif(c->>'text','') is not null)) as label
  from opportunity_refs s join public.course_opportunities o on o.id=s.id
  join public.history_import_records h on h.id=o.source_record_id
  where o.record_state='current' and o.stage in ('planning','considering','committed')
    and h.record_data->>'tableName'='2026秋季在读学员表格'
    and nullif(o.class_label,'') is not null
  order by s.key,o.updated_at desc,o.id
 ) select s.key,jsonb_build_object('sourceReviewCount',coalesce(r.count,0),'sourceArrangement',a.label)
 from subjects s left join reviews r using(key) left join arrangements a using(key);
$$;
revoke all on function public.school_contact_is_effective(jsonb,jsonb),public.school_contact_sort_key(timestamptz,date,jsonb,text),public.school_source_statuses(jsonb) from public,anon,authenticated,service_role;
alter function public.school_contact_is_effective(jsonb,jsonb) owner to postgres;
alter function public.school_contact_sort_key(timestamptz,date,jsonb,text) owner to postgres;
alter function public.school_source_statuses(jsonb) owner to postgres;

CREATE OR REPLACE FUNCTION public.student_list_query_facts(p_scope text, p_search text, p_population text, p_stage text, p_subjects jsonb)
 RETURNS TABLE(row_data jsonb, index_stage text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); view_all boolean; view_followup boolean; write_followup boolean; today date; zone text;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not (public.has_perm(actor,'student.view.all') or public.has_perm(actor,'student.view.assigned')
    or public.has_perm(actor,'followup.view')) then raise exception 'FORBIDDEN'; end if;
  if p_scope is null or p_scope not in ('all','mine','unassigned','group') or p_population is null or p_population not in ('work','records')
    or p_stage is null or p_stage not in ('awaiting_first_contact','awaiting_assessment','awaiting_enrollment','awaiting_renewal','former_student')
    or length(coalesce(p_search,''))>80 then raise exception 'VALIDATION'; end if;
  view_all:=public.has_perm(actor,'student.view.all'); view_followup:=public.has_perm(actor,'followup.view');
  write_followup:=public.has_perm(actor,'followup.write'); zone:=public.get_organization_timezone_v2(); today:=(now() at time zone zone)::date;
  if p_scope in ('mine','group') and not exists(select 1 from public.school_list_scope_keys(actor,p_scope)) then return; end if;
  if p_subjects is not null and jsonb_array_length(p_subjects)=0 then return; end if;
  return query with visibility as materialized (select key,can_view from public.school_list_visibility(actor)),
  wanted as materialized (select w->>'key' as key,w from jsonb_array_elements(coalesce(p_subjects,'[]'::jsonb)) w),
  scope_keys as materialized (select scoped.key from public.school_list_scope_keys(actor,p_scope) scoped),
  paused_scopes as materialized (
    select s.student_id,s.lead_id from public.history_workflow_scopes s
      left join public.history_workflow_decisions d on d.key=s.scope_key
      where p_population='work' and (d.decision='archive' or s.resumed_at is null and coalesce(d.decision,'archive')<>'continue')
  ), paused_subjects as materialized (
    select 'student:'||student_id as key from paused_scopes where student_id is not null
    union select 'lead:'||lead_id from paused_scopes where lead_id is not null
  ), scheduled_subjects as materialized (
    select distinct key from public.communication_worklists w join public.communication_worklist_items i on i.worklist_id=w.id
      join public.leads l on i.row_key='lead:'||l.id
      cross join lateral unnest(array['student:'||l.student_id,'lead:'||l.id]) subject(key)
      where p_population='work' and to_jsonb(w)->>'is_scheduled'='true' and w.closed_at is null and i.completed_at is null and key is not null
  ),
  student_candidates as materialized (
    select s.* from public.students s where s.deleted_at is null and s.purpose<>'test' and (p_subjects is null or exists(select 1 from wanted w where w.key='student:'||s.id)) and (p_scope<>'unassigned' or s.assigned_to is null) and (
      p_population='records'
      or not exists(select 1 from paused_subjects p where p.key='student:'||s.id)
      or exists(select 1 from scheduled_subjects w where w.key='student:'||s.id)
      or exists(select 1 from public.leads l join scheduled_subjects w on w.key='lead:'||l.id where l.student_id=s.id)
    )
  ), lead_candidates as materialized (
    select l.* from public.leads l where l.student_id is null and l.purpose<>'test' and (p_subjects is null or exists(select 1 from wanted w where w.key='lead:'||l.id)) and (p_scope<>'unassigned' or l.owner_id is null) and (
      p_population='records'
      or not exists(select 1 from paused_subjects p where p.key='lead:'||l.id)
      or exists(select 1 from scheduled_subjects w where w.key='lead:'||l.id)
    )
  ), identities as materialized (
    select 'student:'||s.id as key,s.id as student_id,null::uuid as original_lead_id,s.created_at,s.assigned_to as owner_id
    from student_candidates s where (view_all or exists(select 1 from visibility v where v.key='student:'||s.id and v.can_view))
      and (p_scope='all' or p_scope='mine' and exists(select 1 from scope_keys k where k.key='student:'||s.id) or p_scope='unassigned' or p_scope='group' and exists(select 1 from scope_keys k where k.key='student:'||s.id))
      and (coalesce(p_search,'')='' or s.id::text=p_search or position(lower(p_search) in lower(s.name||' '||s.school||' '||s.phone||' '||s.parent_phone))>0
        or length(regexp_replace(p_search,'\D','','g'))>=3 and position(regexp_replace(p_search,'\D','','g') in regexp_replace(s.phone||' '||s.parent_phone,'\D','','g'))>0)
    union all
    select 'lead:'||l.id,null,l.id,l.created_at,l.owner_id from lead_candidates l
    where view_followup and case when view_all or l.owner_id is null or l.owner_id=actor then true else exists(select 1 from visibility v where v.key='lead:'||l.id and v.can_view) end
      and (p_scope='all' or p_scope='mine' and exists(select 1 from scope_keys k where k.key=coalesce('student:'||l.student_id,'lead:'||l.id)) or p_scope='unassigned' or p_scope='group' and exists(select 1 from scope_keys k where k.key=coalesce('student:'||l.student_id,'lead:'||l.id)))
      and (coalesce(p_search,'')='' or l.id::text=p_search or position(lower(p_search) in lower(l.provisional_student_name||' '||l.phone))>0
        or length(regexp_replace(p_search,'\D','','g'))>=3 and position(regexp_replace(p_search,'\D','','g') in l.phone_normalized)>0)
  ), lead_refs as materialized (
    select s.key,l.*,view_followup and case when view_all or l.owner_id is null or l.owner_id=actor then true else exists(select 1 from visibility v where v.key='lead:'||l.id and v.can_view) end as visible
      from identities s join public.leads l on l.student_id=s.student_id
    union all select s.key,l.*,true from identities s join public.leads l on l.id=s.original_lead_id
  ), selected_leads as materialized (
    select distinct on(key) key,id,status,owner_id from lead_refs where visible
      order by key,(status not in ('invalid','converted')) desc,created_at desc,id
  ), subjects as materialized (
    select s.*,l.id as lead_id from identities s left join selected_leads l using(key)
      where p_population='records'
        or not exists(select 1 from paused_subjects ps where ps.key=s.key)
          and not exists(select 1 from paused_subjects pl where pl.key='lead:'||l.id)
        or exists(select 1 from scheduled_subjects ss where ss.key=s.key)
        or exists(select 1 from scheduled_subjects sl where sl.key='lead:'||l.id)
  ), subject_sources as materialized (
    select l.key,h.id from lead_refs l join subjects s using(key) join public.history_import_records h on h.lead_id=l.id
    union select l.key,h.id from lead_refs l join subjects s using(key) join public.history_import_records h on h.id=l.source_record_id
  ), registrations as materialized (
    select id,student_id,lead_id,source_record_id,record_state,source_enrollment_facts,status,activity_id,created_at,assessment_completed_at,assessment_started_at
      from public.business_activity_registrations
  ), registration_refs as materialized (
    select s.key,r.id from subjects s join registrations r on r.student_id=s.student_id
    union select l.key,r.id from lead_refs l join subjects s using(key) join registrations r on r.lead_id=l.id
    union select s.key,r.id from subject_sources s join registrations r on r.source_record_id=s.id
  ), enrollment_input as materialized (
    select id,student_id,source_record_id,opportunity_id,course_id,term_id,status,record_state,confirmed_at from public.business_course_enrollments
  ), enrollment_source_ids as materialized (select distinct source_record_id as id from enrollment_input where source_record_id is not null),
  -- 收窄的是来源编号；这些来源的全部身份归属仍参与冲突判断。
  enrollment_source_refs as (
    select record_id,count(distinct key) as subject_count,min(key) as subject_key from (
      select a.record_id,'student:'||a.student_id as key from public.history_import_associations a join enrollment_source_ids s on s.id=a.record_id
      union all select l.source_record_id,coalesce('student:'||l.student_id,'lead:'||l.id) from public.leads l join enrollment_source_ids s on s.id=l.source_record_id
      union all select o.source_record_id,coalesce('student:'||o.student_id,'student:'||l.student_id,'lead:'||o.lead_id)
        from public.course_opportunities o join enrollment_source_ids s on s.id=o.source_record_id left join public.leads l on l.id=o.lead_id
      union all select r.source_record_id,coalesce('student:'||r.student_id,'student:'||l.student_id,'lead:'||r.lead_id)
        from public.activity_registrations r join enrollment_source_ids s on s.id=r.source_record_id left join public.leads l on l.id=r.lead_id
    ) refs where key is not null group by record_id
  ), enrollment_facts as materialized (
    select e.*,coalesce('student:'||e.student_id,case when coalesce(refs.subject_count,0)<=1
      and coalesce(refs.subject_key,coalesce('student:'||o.student_id,'student:'||l.student_id,'lead:'||o.lead_id))
        =coalesce(coalesce('student:'||o.student_id,'student:'||l.student_id,'lead:'||o.lead_id),refs.subject_key)
      then coalesce(refs.subject_key,'student:'||o.student_id,'student:'||l.student_id,'lead:'||o.lead_id) end) as subject_key,
      e.status='active' and e.record_state='current' and (t.ends_on is null or t.ends_on>=today) as active
    from enrollment_input e left join enrollment_source_refs refs on refs.record_id=e.source_record_id
      left join public.course_opportunities o on o.id=e.opportunity_id left join public.leads l on l.id=o.lead_id left join public.school_terms t on t.id=e.term_id
  ), enrollment_refs as materialized (
    select s.key,e.id from subjects s join enrollment_facts e on e.subject_key=s.key
    union select s.key,e.id from subject_sources s join enrollment_facts e on e.source_record_id=s.id
  ), enrollment_flags as (
    select ref.key,bool_or(e.active) as active,bool_or(e.record_state='current') as has_current from enrollment_refs ref join enrollment_facts e on e.id=ref.id group by ref.key
  ), latest_enrollments as (
    select distinct on(ref.key) ref.key,e.status,e.course_id,e.term_id from enrollment_refs ref join enrollment_facts e on e.id=ref.id
      order by ref.key,(e.status='active' and e.record_state='current') desc,e.confirmed_at desc,e.id
  ), source_enrollment_flags as (
    select ref.key,bool_or(r.record_state='current') as active from registration_refs ref join registrations r on r.id=ref.id
      where false /* 到访表报名由独立正式报名和入班事实交叉验证 */ group by ref.key
  ), memberships as materialized (
    select s.key,e.classroom_id,e.status='active' and e.left_at is null and (t.ends_on is null or t.ends_on>=today) as active
      from subjects s join public.enrollments e on e.student_id=s.student_id join public.classrooms c on c.id=e.classroom_id
      left join public.school_terms t on t.id=c.term_id
  ), membership_flags as (select key,bool_or(active) as active from memberships group by key),
  contacts as materialized (
    select l.key,l.visible,c.id,c.source_record_id,c.occurred_at,coalesce(r.effective_patch->>'note',c.note) as note,
      coalesce(r.effective_patch->>'outcome',c.outcome) as outcome,public.school_contact_is_effective(to_jsonb(c),r.effective_patch) as effective_contact,public.school_contact_sort_key(c.occurred_at,c.occurred_on,c.source_metric_facts,c.source_key) as contact_order from lead_refs l join subjects s using(key)
      join public.business_lead_communications c on c.lead_id=l.id left join lateral (
        select effective_patch from public.communication_record_revisions r where r.source='contact' and r.event_id=c.id order by revision_no desc limit 1
      ) r on true
  ), attendance_flags as (
    select ref.key from registration_refs ref join registrations r on r.id=ref.id
      join public.business_activities a on a.id=r.activity_id where r.status='attended' and a.deleted_at is null group by ref.key
  ), contact_flags as (select key from contacts where effective_contact group by key union select key from attendance_flags union select other_contact.key from public.school_other_contact_subjects() other_contact),
  latest_contacts as (select distinct on(key) key,id,source_record_id,occurred_at,note,outcome from contacts where visible order by key,occurred_at desc nulls last,contact_order desc,id),
  completed_assessments as materialized (
    select a.id,a.student_id,a.lead_id,a.source_record_id,a.activity_registration_id,a.score,a.assessment_band,a.assessed_by,a.updated_at,
      r.student_id as registration_student_id,r.lead_id as registration_lead_id,r.source_record_id as registration_source_id,
      coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) as completed_at,
      coalesce(a.assessed_on,(coalesce(r.assessment_completed_at,a.result_finalized_at) at time zone zone)::date,
        act.occurred_on,(act.scheduled_at at time zone zone)::date) as assessed_on,
      nullif(substring(a.strengths from '(?:^|[\r\n])学习力测评等级：([^\r\n]+)'),'') as learning_band,act.deleted_at,act.id as activity_id
    from public.business_assessment_results a join registrations r on r.id=a.activity_registration_id
      left join public.business_activities act on act.id=r.activity_id
    where public.student_assessment_is_complete(r.status,r.assessment_completed_at,a.result_finalized_at,
        a.result_source,a.score,a.assessment_band,a.strengths,
        concat_ws(E'\n',a.strengths,a.focus_areas,a.parent_concerns,a.teacher_recommendation,a.teacher_observation))
  ), latest_assessments as materialized (
    select distinct on(ref.key) ref.key,a.id,a.activity_registration_id,a.source_record_id,a.completed_at,a.score,a.assessment_band
      from registration_refs ref join completed_assessments a on a.activity_registration_id=ref.id order by ref.key,a.completed_at desc,a.id
  ), stages as materialized (
    select s.*,case when e.active or m.active or se.active and not coalesce(e.has_current,false) then 'awaiting_renewal'
      when e.key is not null or m.key is not null or se.key is not null then 'former_student'
      when a.key is not null then 'awaiting_enrollment' when c.key is not null then 'awaiting_assessment' else 'awaiting_first_contact' end as stage,
      coalesce(m.active,false) as membership,a.activity_registration_id as registration_id,
      a.source_record_id as preferred_source_id,lc.source_record_id as contact_source_id
    from subjects s left join enrollment_flags e using(key) left join membership_flags m using(key) left join source_enrollment_flags se using(key)
      left join latest_assessments a using(key) left join contact_flags c using(key) left join latest_contacts lc using(key)
  ), listed as materialized (select * from stages where p_subjects is not null or coalesce(p_search,'')<>'' or stage=p_stage),
  appointments as (
    select distinct on(ref.key) ref.key,r.status,r.assessment_started_at from registration_refs ref join listed s using(key)
      join registrations r on r.id=ref.id join public.business_activities a on a.id=r.activity_id
    where s.stage='awaiting_assessment' and r.record_state='current' and a.record_state='current' and a.deleted_at is null and a.kind in ('assessment_1v1','assessment')
      order by ref.key,coalesce(a.scheduled_at,r.created_at) desc,r.id
  ), invitations as (
    select distinct on(s.key) s.key,i.kind,i.state from listed s join public.lead_invitation_threads i on i.lead_id=s.lead_id
      where s.stage='awaiting_assessment' and i.state not in ('completed','cancelled') order by s.key,i.updated_at desc,i.id
  ), opportunity_refs as (
    select s.key,o.id from listed s join public.course_opportunities o on o.student_id=s.student_id
    union select l.key,o.id from lead_refs l join listed s using(key) join public.course_opportunities o on o.lead_id=l.id
  ), opportunities as (
    select distinct on(ref.key) ref.key,o.stage,o.opportunity_type,o.course_id,o.term_id from opportunity_refs ref
      join public.business_course_opportunities o on o.id=ref.id where o.record_state='current' order by ref.key,o.updated_at desc,o.id
  ), note_refs as (
    select s.key,f.id,f.content,f.created_at as occurred_at,1 as priority from listed s join public.business_student_follow_ups f on f.student_id=s.student_id where view_followup
    union all select c.key,c.id,c.note,c.occurred_at,0 from contacts c join listed s using(key)
      where c.visible and (s.stage in ('awaiting_first_contact','awaiting_assessment')
        or c.id=(select latest.id from latest_contacts latest where latest.key=c.key))
  ), notes as (select distinct on(key) key,content,occurred_at from note_refs where nullif(btrim(content),'') is not null order by key,occurred_at desc,priority desc,id),
  background_sources as materialized (
    select s.key,h.id from listed s join public.history_import_records h on h.student_id=s.student_id
    union select l.key,h.id from lead_refs l join listed s using(key) join public.history_import_records h on h.lead_id=l.id where l.visible or s.stage not in ('awaiting_first_contact','awaiting_assessment')
    union select s.key,a.record_id from listed s join public.history_import_associations a on a.student_id=s.student_id
    union select l.key,l.source_record_id from lead_refs l join listed s using(key) where l.source_record_id is not null and (l.visible or s.stage not in ('awaiting_first_contact','awaiting_assessment'))
    union select l.key,c.source_record_id from lead_refs l join listed s using(key) join public.lead_communications c on c.lead_id=l.id where c.source_record_id is not null and (l.visible or s.stage not in ('awaiting_first_contact','awaiting_assessment'))
    union select s.key,r.source_record_id from listed s join public.activity_registrations r on r.student_id=s.student_id where r.source_record_id is not null
    union select l.key,r.source_record_id from lead_refs l join listed s using(key) join public.activity_registrations r on r.lead_id=l.id where r.source_record_id is not null and (l.visible or s.stage not in ('awaiting_first_contact','awaiting_assessment'))
    union select s.key,a.source_record_id from listed s join public.assessment_results a on a.student_id=s.student_id where a.source_record_id is not null
    union select l.key,a.source_record_id from lead_refs l join listed s using(key) join public.assessment_results a on a.lead_id=l.id where a.source_record_id is not null and (l.visible or s.stage not in ('awaiting_first_contact','awaiting_assessment'))
    union select s.key,e.source_record_id from listed s join public.course_enrollments e on e.student_id=s.student_id where e.source_record_id is not null
  ), source_fields as materialized (
    select h.id,h.record_data->>'tableName' as table_name,public.business_source_is_current(h.id) as current_source,f.fields
      from public.history_import_records h join (select distinct id from background_sources) ref on ref.id=h.id
      cross join lateral (select jsonb_object_agg(c->>'fieldName',btrim(c->>'text')) as fields from jsonb_array_elements(h.record_data->'cells') c
        where c->>'fieldName' in ('学服老师','确认人员','学科老师','报名服务老师','授课学科老师','班型') and nullif(btrim(c->>'text'),'') is not null) f
      where h.source_data->>'format'='feishu-base'
  ), source_names as materialized (
    select ref.key,h.id,h.table_name,h.current_source,coalesce(h.fields->>'报名服务老师',h.fields->>'学服老师',h.fields->>'确认人员') as owner_name,
      coalesce(h.fields->>'授课学科老师',h.fields->>'学科老师') as teacher_name,h.fields->>'班型' as class_band,
      case when s.stage='awaiting_renewal' and h.table_name='2026秋季在读学员表格' then 0
        when h.id=case when s.stage='awaiting_assessment' then s.contact_source_id else s.preferred_source_id end then 1 when h.current_source then 2 else 3 end as priority
      from background_sources ref join source_fields h on h.id=ref.id join listed s using(key)
  ), source_owners as (select distinct on(key) key,owner_name from source_names where owner_name is not null order by key,priority,id),
  source_teachers as (select distinct on(key) key,teacher_name from source_names where teacher_name is not null order by key,priority,id),
  source_bands as (select distinct on(key) key,class_band from source_names where class_band is not null and table_name='2026秋季在读学员表格' order by key,current_source desc,id),
  class_facts as (
    select m.key,string_agg(distinct p.display_name,'、' order by p.display_name) filter(where a.responsibility='primary_teacher') as teacher_name,
      string_agg(distinct p.display_name,'、' order by p.display_name) filter(where a.responsibility='learning_support') as owner_name,
      string_agg(distinct (regexp_match(c.name,'(?:春季|暑期|暑假|秋季|寒假)(X[+＋]|G[+＋]|A[+＋]?|S|C|培优|基础)(?:[|｜班]|$)'))[1],'、') as class_band
      from memberships m join listed s using(key) join public.classrooms c on c.id=m.classroom_id
      left join public.classroom_staff_assignments a on a.classroom_id=c.id left join public.profiles p on p.id=a.user_id
      where m.active and c.archived_at is null and c.trashed_at is null group by m.key
  ), background_assessment_refs as materialized (
    select s.key,a.id from listed s join completed_assessments a on a.student_id=s.student_id where p_stage not in ('awaiting_first_contact','awaiting_assessment')
    union select s.key,a.id from listed s join completed_assessments a on a.registration_student_id=s.student_id where p_stage not in ('awaiting_first_contact','awaiting_assessment')
    union select l.key,a.id from lead_refs l join listed s using(key) join completed_assessments a on a.lead_id=l.id where p_stage not in ('awaiting_first_contact','awaiting_assessment')
    union select l.key,a.id from lead_refs l join listed s using(key) join completed_assessments a on a.registration_lead_id=l.id where p_stage not in ('awaiting_first_contact','awaiting_assessment')
    union select s.key,a.id from background_sources s join completed_assessments a on a.source_record_id=s.id where p_stage not in ('awaiting_first_contact','awaiting_assessment')
    union select s.key,a.id from background_sources s join completed_assessments a on a.registration_source_id=s.id where p_stage not in ('awaiting_first_contact','awaiting_assessment')
  ), background_assessments as (
    select distinct on(ref.key) ref.key,a.* from background_assessment_refs ref join completed_assessments a on a.id=ref.id
      where a.activity_id is not null and a.deleted_at is null order by ref.key,a.assessed_on desc nulls last,a.updated_at desc,a.id
  ), candidate_counts as (
    select s.key,count(distinct ic.record_id)::integer as count from listed s join public.history_import_identity_candidates ic on ic.student_id=s.student_id
      join public.history_import_records h on h.id=ic.record_id join completed_assessments a on a.source_record_id=ic.record_id
      where p_stage not in ('awaiting_first_contact','awaiting_assessment') and h.source_data->>'format'='feishu-base'
        and not exists(select 1 from background_sources r where r.key=s.key and r.id=ic.record_id) group by s.key
  ), inferred as (
    select r.key,jsonb_agg(a.record_id) as ids from background_sources r join public.history_import_associations a on a.record_id=r.id and a.match_state='inferred'
      where p_stage not in ('awaiting_first_contact','awaiting_assessment') group by r.key
  ), backgrounds as (
    select s.key,coalesce(cf.owner_name,so.owner_name) as owner_name,
      coalesce(case when s.stage='awaiting_renewal' then cf.teacher_name end,st.teacher_name,ap.display_name) as teacher_name,
      case when a.id is not null then 'assessment' when s.stage='awaiting_renewal' and coalesce(cf.class_band,sb.class_band) is not null then 'class_band' end as source,
      case when a.id is not null then public.student_learning_band(a.assessment_band)
        when s.stage='awaiting_renewal' then public.student_learning_band(coalesce(cf.class_band,sb.class_band)) end as band,
      a.score,a.assessed_on,a.id as assessment_id,case when a.learning_band='未达A' then 'X+' else a.learning_band end as learning_band,
      case when a.id is null and s.stage='awaiting_renewal' then coalesce(cf.class_band,sb.class_band,'') else '' end as class_band
    from listed s left join class_facts cf using(key) left join source_owners so using(key) left join source_teachers st using(key)
      left join source_bands sb using(key) left join background_assessments a using(key) left join public.profiles ap on ap.id=a.assessed_by
  ), teacher_ids as (select display_name,case when count(*)=1 then (array_agg(id))[1] end as id from public.profiles
    where is_active and role in ('staff','admin') group by display_name),
  rows as (
    select s.stage,s.created_at,s.key,jsonb_build_object(
      'key',s.key,'studentId',s.student_id,'leadId',s.lead_id,'name',coalesce(st.name,l.provisional_student_name),
      'phone',coalesce(nullif(st.parent_phone,''),nullif(st.phone,''),l.phone,''),'grade',coalesce(st.grade,l.grade_hint),'gradeText',coalesce(l.grade_text,''),
      'ownerId',coalesce(st.assigned_to,l.owner_id),'ownerName',coalesce(p.display_name,b.owner_name,''),'teacherId',ti.id,'teacherName',coalesce(b.teacher_name,''),
      'stage',s.stage,'detail',case s.stage when 'awaiting_first_contact' then public.student_first_contact_detail(coalesce(st.assigned_to,l.owner_id),coalesce(p.display_name,b.owner_name),l.status,lc.outcome)
        when 'awaiting_assessment' then case when i.kind='assessment_1v1' and i.state='confirmed' then 'booked' when i.kind='assessment_1v1' then 'coordinating'
          when a.status='no_show' then 'no_show' when a.status='cancelled' then 'cancelled' when a.assessment_started_at is not null then 'in_progress' when a.status='attended' then 'attended_without_result'
          when a.status='booked' then 'booked' when exists(select 1 from attendance_flags reached where reached.key=s.key) then 'attended_without_result' else 'not_booked' end
        when 'awaiting_enrollment' then case o.stage when 'committed' then 'ready_to_enroll' when 'not_enrolled' then 'not_enrolling'
          when 'considering' then 'considering' when 'payment_pending' then 'payment_pending' when 'nurturing' then 'nurturing' else coalesce(w.classification,'assessed') end
        when 'awaiting_renewal' then case when o.opportunity_type='renewal' and o.stage='not_enrolled' then 'not_renewing'
          when o.opportunity_type='renewal' and o.stage='considering' then 'renewal_considering' when o.opportunity_type='renewal' and o.stage='committed' then 'renewal_committed'
          when o.opportunity_type='renewal' and o.stage='enrolled' then 'renewal_confirmed' when s.membership then 'attending' else 'awaiting_class' end
        else case when e.status='cancelled' then 'withdrawn' else 'ended' end end,
      'note',case when view_followup then coalesce(n.content,'') else '' end,
      'lastContactAt',case when view_followup then case when s.stage in ('awaiting_first_contact','awaiting_assessment') then coalesce(n.occurred_at,lc.occurred_at) else n.occurred_at end end,
      'nextContactAt',null,'invitation',null,'detailLoaded',false,
      'score',case when b.source is not null then b.score else ca.score end,
      'assessmentBand',case when b.source is not null then b.band else ca.assessment_band end,
      'assessmentAt',case when b.source is not null then to_jsonb(b.assessed_on) else to_jsonb(ca.completed_at) end,
      'assessmentSource',b.source,'assessmentRecordId',b.assessment_id,'learningBand',b.learning_band,'classBandLabel',b.class_band,
      'assessmentCandidateCount',coalesce(cc.count,0),'inferredSourceIds',coalesce(inf.ids,'[]'::jsonb),'registrationId',s.registration_id,
      'courseId',coalesce(e.course_id,o.course_id),'termId',coalesce(e.term_id,o.term_id),'courseTitle',coalesce(ec.title,oc.title,''),'termName',coalesce(et.name,ot.name,''),
      'createdAt',s.created_at) as payload
    from listed s left join public.students st on st.id=s.student_id left join public.leads l on l.id=s.lead_id
      left join public.profiles p on p.id=coalesce(st.assigned_to,l.owner_id) left join backgrounds b using(key) left join teacher_ids ti on ti.display_name=b.teacher_name
      left join latest_contacts lc using(key) left join notes n using(key) left join latest_enrollments e using(key) left join opportunities o using(key)
      left join appointments a using(key) left join invitations i using(key) left join latest_assessments ca using(key)
      left join public.assessment_workflow_states w on w.registration_id=s.registration_id
      left join public.courses ec on ec.id=e.course_id left join public.courses oc on oc.id=o.course_id
      left join public.school_terms et on et.id=e.term_id left join public.school_terms ot on ot.id=o.term_id
      left join candidate_counts cc using(key) left join inferred inf using(key)
  ) select public.school_list_apply_collaboration(r.payload||coalesce(source_status.status,'{}'::jsonb)||case when p_subjects is not null then
      jsonb_build_object('phone',w.w->'phone','lastContactAt',w.w->'last_contact_at')||
      case when r.stage in ('awaiting_first_contact','awaiting_assessment') then
        jsonb_build_object('teacherId',null,'teacherName','','courseId',null,'termId',null,'courseTitle','','termName','','assessmentBand',null,'assessmentAt',null)
        else '{}'::jsonb end else '{}'::jsonb end,c.projection),r.stage from rows r left join wanted w on w.key=r.key
    left join public.school_source_statuses(coalesce((select jsonb_agg(payload) from rows),'[]'::jsonb)) source_status on source_status.key=r.key
    join public.school_list_collaboration(coalesce((select jsonb_agg(jsonb_build_object('key',payload->>'key','student_id',payload->>'studentId','lead_id',payload->>'leadId')) from rows),'[]'::jsonb),actor) c on c.key=r.key
    union all select null::jsonb,s.stage from stages s where p_subjects is null and not (coalesce(p_search,'')<>'' or s.stage=p_stage);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.student_first_contact_page_facts(p_scope text, p_page integer, p_page_size integer)
 RETURNS TABLE(row_data jsonb, index_stage text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
#variable_conflict use_variable
declare p_stage text:='awaiting_first_contact'; p_population text:='records'; p_search text:=''; p_subjects jsonb:=null; actor uuid:=auth.uid(); view_all boolean; view_followup boolean; write_followup boolean; today date; zone text;
begin
  if p_page is null or p_page<1 or p_page>1000000 or p_page_size is null or p_page_size not in (20,50,100) then raise exception 'VALIDATION'; end if;
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not (public.has_perm(actor,'student.view.all') or public.has_perm(actor,'student.view.assigned')
    or public.has_perm(actor,'followup.view')) then raise exception 'FORBIDDEN'; end if;
  if p_scope is null or p_scope not in ('all','mine','unassigned','group') or p_population is null or p_population not in ('work','records')
    or p_stage is null or p_stage not in ('awaiting_first_contact','awaiting_assessment','awaiting_enrollment','awaiting_renewal','former_student')
    or length(coalesce(p_search,''))>80 then raise exception 'VALIDATION'; end if;
  view_all:=public.has_perm(actor,'student.view.all'); view_followup:=public.has_perm(actor,'followup.view');
  write_followup:=public.has_perm(actor,'followup.write'); zone:=public.get_organization_timezone_v2(); today:=(now() at time zone zone)::date;
  if p_scope in ('mine','group') and not exists(select 1 from public.school_list_scope_keys(actor,p_scope)) then return; end if;
  if p_subjects is not null and jsonb_array_length(p_subjects)=0 then return; end if;
  return query with visibility as materialized (select key,can_view from public.school_list_visibility(actor)),
  wanted as materialized (select w->>'key' as key,w from jsonb_array_elements(coalesce(p_subjects,'[]'::jsonb)) w),
  scope_keys as materialized (select scoped.key from public.school_list_scope_keys(actor,p_scope) scoped),
  paused_scopes as materialized (
    select s.student_id,s.lead_id from public.history_workflow_scopes s
      left join public.history_workflow_decisions d on d.key=s.scope_key
      where p_population='work' and (d.decision='archive' or s.resumed_at is null and coalesce(d.decision,'archive')<>'continue')
  ), paused_subjects as materialized (
    select 'student:'||student_id as key from paused_scopes where student_id is not null
    union select 'lead:'||lead_id from paused_scopes where lead_id is not null
  ), scheduled_subjects as materialized (
    select distinct key from public.communication_worklists w join public.communication_worklist_items i on i.worklist_id=w.id
      join public.leads l on i.row_key='lead:'||l.id
      cross join lateral unnest(array['student:'||l.student_id,'lead:'||l.id]) subject(key)
      where p_population='work' and to_jsonb(w)->>'is_scheduled'='true' and w.closed_at is null and i.completed_at is null and key is not null
  ),
  student_candidates as materialized (
    select s.* from public.students s where s.deleted_at is null and s.purpose<>'test' and (p_subjects is null or exists(select 1 from wanted w where w.key='student:'||s.id)) and (p_scope<>'unassigned' or s.assigned_to is null) and (
      p_population='records'
      or not exists(select 1 from paused_subjects p where p.key='student:'||s.id)
      or exists(select 1 from scheduled_subjects w where w.key='student:'||s.id)
      or exists(select 1 from public.leads l join scheduled_subjects w on w.key='lead:'||l.id where l.student_id=s.id)
    )
  ), lead_candidates as materialized (
    select l.* from public.leads l where l.student_id is null and l.purpose<>'test' and (p_subjects is null or exists(select 1 from wanted w where w.key='lead:'||l.id)) and (p_scope<>'unassigned' or l.owner_id is null) and (
      p_population='records'
      or not exists(select 1 from paused_subjects p where p.key='lead:'||l.id)
      or exists(select 1 from scheduled_subjects w where w.key='lead:'||l.id)
    )
  ), identities as materialized (
    select 'student:'||s.id as key,s.id as student_id,null::uuid as original_lead_id,s.created_at,s.assigned_to as owner_id
    from student_candidates s where (view_all or exists(select 1 from visibility v where v.key='student:'||s.id and v.can_view))
      and (p_scope='all' or p_scope='mine' and exists(select 1 from scope_keys k where k.key='student:'||s.id) or p_scope='unassigned' or p_scope='group' and exists(select 1 from scope_keys k where k.key='student:'||s.id))
      and (coalesce(p_search,'')='' or s.id::text=p_search or position(lower(p_search) in lower(s.name||' '||s.school||' '||s.phone||' '||s.parent_phone))>0
        or length(regexp_replace(p_search,'\D','','g'))>=3 and position(regexp_replace(p_search,'\D','','g') in regexp_replace(s.phone||' '||s.parent_phone,'\D','','g'))>0)
    union all
    select 'lead:'||l.id,null,l.id,l.created_at,l.owner_id from lead_candidates l
    where view_followup and case when view_all or l.owner_id is null or l.owner_id=actor then true else exists(select 1 from visibility v where v.key='lead:'||l.id and v.can_view) end
      and (p_scope='all' or p_scope='mine' and exists(select 1 from scope_keys k where k.key=coalesce('student:'||l.student_id,'lead:'||l.id)) or p_scope='unassigned' or p_scope='group' and exists(select 1 from scope_keys k where k.key=coalesce('student:'||l.student_id,'lead:'||l.id)))
      and (coalesce(p_search,'')='' or l.id::text=p_search or position(lower(p_search) in lower(l.provisional_student_name||' '||l.phone))>0
        or length(regexp_replace(p_search,'\D','','g'))>=3 and position(regexp_replace(p_search,'\D','','g') in l.phone_normalized)>0)
  ), lead_refs as materialized (
    select s.key,l.*,view_followup and case when view_all or l.owner_id is null or l.owner_id=actor then true else exists(select 1 from visibility v where v.key='lead:'||l.id and v.can_view) end as visible
      from identities s join public.leads l on l.student_id=s.student_id
    union all select s.key,l.*,true from identities s join public.leads l on l.id=s.original_lead_id
  ), selected_leads as materialized (
    select distinct on(key) key,id,status,owner_id from lead_refs where visible
      order by key,(status not in ('invalid','converted')) desc,created_at desc,id
  ), subjects as materialized (
    select s.*,l.id as lead_id from identities s left join selected_leads l using(key)
      where p_population='records'
        or not exists(select 1 from paused_subjects ps where ps.key=s.key)
          and not exists(select 1 from paused_subjects pl where pl.key='lead:'||l.id)
        or exists(select 1 from scheduled_subjects ss where ss.key=s.key)
        or exists(select 1 from scheduled_subjects sl where sl.key='lead:'||l.id)
  ), subject_sources as materialized (
    select l.key,h.id from lead_refs l join subjects s using(key) join public.history_import_records h on h.lead_id=l.id
    union select l.key,h.id from lead_refs l join subjects s using(key) join public.history_import_records h on h.id=l.source_record_id
  ), registrations as materialized (
    select id,student_id,lead_id,source_record_id,record_state,source_enrollment_facts,status,activity_id,created_at,assessment_completed_at,assessment_started_at
      from public.business_activity_registrations
  ), registration_refs as materialized (
    select s.key,r.id from subjects s join registrations r on r.student_id=s.student_id
    union select l.key,r.id from lead_refs l join subjects s using(key) join registrations r on r.lead_id=l.id
    union select s.key,r.id from subject_sources s join registrations r on r.source_record_id=s.id
  ), enrollment_input as materialized (
    select id,student_id,source_record_id,opportunity_id,course_id,term_id,status,record_state,confirmed_at from public.business_course_enrollments
  ), enrollment_source_ids as materialized (select distinct source_record_id as id from enrollment_input where source_record_id is not null),
  -- 收窄的是来源编号；这些来源的全部身份归属仍参与冲突判断。
  enrollment_source_refs as (
    select record_id,count(distinct key) as subject_count,min(key) as subject_key from (
      select a.record_id,'student:'||a.student_id as key from public.history_import_associations a join enrollment_source_ids s on s.id=a.record_id
      union all select l.source_record_id,coalesce('student:'||l.student_id,'lead:'||l.id) from public.leads l join enrollment_source_ids s on s.id=l.source_record_id
      union all select o.source_record_id,coalesce('student:'||o.student_id,'student:'||l.student_id,'lead:'||o.lead_id)
        from public.course_opportunities o join enrollment_source_ids s on s.id=o.source_record_id left join public.leads l on l.id=o.lead_id
      union all select r.source_record_id,coalesce('student:'||r.student_id,'student:'||l.student_id,'lead:'||r.lead_id)
        from public.activity_registrations r join enrollment_source_ids s on s.id=r.source_record_id left join public.leads l on l.id=r.lead_id
    ) refs where key is not null group by record_id
  ), enrollment_facts as materialized (
    select e.*,coalesce('student:'||e.student_id,case when coalesce(refs.subject_count,0)<=1
      and coalesce(refs.subject_key,coalesce('student:'||o.student_id,'student:'||l.student_id,'lead:'||o.lead_id))
        =coalesce(coalesce('student:'||o.student_id,'student:'||l.student_id,'lead:'||o.lead_id),refs.subject_key)
      then coalesce(refs.subject_key,'student:'||o.student_id,'student:'||l.student_id,'lead:'||o.lead_id) end) as subject_key,
      e.status='active' and e.record_state='current' and (t.ends_on is null or t.ends_on>=today) as active
    from enrollment_input e left join enrollment_source_refs refs on refs.record_id=e.source_record_id
      left join public.course_opportunities o on o.id=e.opportunity_id left join public.leads l on l.id=o.lead_id left join public.school_terms t on t.id=e.term_id
  ), enrollment_refs as materialized (
    select s.key,e.id from subjects s join enrollment_facts e on e.subject_key=s.key
    union select s.key,e.id from subject_sources s join enrollment_facts e on e.source_record_id=s.id
  ), enrollment_flags as (
    select ref.key,bool_or(e.active) as active,bool_or(e.record_state='current') as has_current from enrollment_refs ref join enrollment_facts e on e.id=ref.id group by ref.key
  ), latest_enrollments as (
    select distinct on(ref.key) ref.key,e.status,e.course_id,e.term_id from enrollment_refs ref join enrollment_facts e on e.id=ref.id
      order by ref.key,(e.status='active' and e.record_state='current') desc,e.confirmed_at desc,e.id
  ), source_enrollment_flags as (
    select ref.key,bool_or(r.record_state='current') as active from registration_refs ref join registrations r on r.id=ref.id
      where false /* 到访表报名由独立正式报名和入班事实交叉验证 */ group by ref.key
  ), memberships as materialized (
    select s.key,e.classroom_id,e.status='active' and e.left_at is null and (t.ends_on is null or t.ends_on>=today) as active
      from subjects s join public.enrollments e on e.student_id=s.student_id join public.classrooms c on c.id=e.classroom_id
      left join public.school_terms t on t.id=c.term_id
  ), membership_flags as (select key,bool_or(active) as active from memberships group by key),
  contacts as materialized (
    select l.key,l.visible,c.id,c.source_record_id,c.occurred_at,coalesce(r.effective_patch->>'note',c.note) as note,
      coalesce(r.effective_patch->>'outcome',c.outcome) as outcome,public.school_contact_is_effective(to_jsonb(c),r.effective_patch) as effective_contact,public.school_contact_sort_key(c.occurred_at,c.occurred_on,c.source_metric_facts,c.source_key) as contact_order from lead_refs l join subjects s using(key)
      join public.business_lead_communications c on c.lead_id=l.id left join lateral (
        select effective_patch from public.communication_record_revisions r where r.source='contact' and r.event_id=c.id order by revision_no desc limit 1
      ) r on true
  ), attendance_flags as (
    select ref.key from registration_refs ref join registrations r on r.id=ref.id
      join public.business_activities a on a.id=r.activity_id where r.status='attended' and a.deleted_at is null group by ref.key
  ), contact_flags as (select key from contacts where effective_contact group by key union select key from attendance_flags union select other_contact.key from public.school_other_contact_subjects() other_contact),
  latest_contacts as (select distinct on(key) key,id,source_record_id,occurred_at,note,outcome from contacts where visible order by key,occurred_at desc nulls last,contact_order desc,id),
  completed_assessments as materialized (
    select a.id,a.student_id,a.lead_id,a.source_record_id,a.activity_registration_id,a.score,a.assessment_band,a.assessed_by,a.updated_at,
      r.student_id as registration_student_id,r.lead_id as registration_lead_id,r.source_record_id as registration_source_id,
      coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) as completed_at,
      coalesce(a.assessed_on,(coalesce(r.assessment_completed_at,a.result_finalized_at) at time zone zone)::date,
        act.occurred_on,(act.scheduled_at at time zone zone)::date) as assessed_on,
      nullif(substring(a.strengths from '(?:^|[\r\n])学习力测评等级：([^\r\n]+)'),'') as learning_band,act.deleted_at,act.id as activity_id
    from public.business_assessment_results a join registrations r on r.id=a.activity_registration_id
      left join public.business_activities act on act.id=r.activity_id
    where public.student_assessment_is_complete(r.status,r.assessment_completed_at,a.result_finalized_at,
        a.result_source,a.score,a.assessment_band,a.strengths,
        concat_ws(E'\n',a.strengths,a.focus_areas,a.parent_concerns,a.teacher_recommendation,a.teacher_observation))
  ), latest_assessments as materialized (
    select distinct on(ref.key) ref.key,a.id,a.activity_registration_id,a.source_record_id,a.completed_at,a.score,a.assessment_band
      from registration_refs ref join completed_assessments a on a.activity_registration_id=ref.id order by ref.key,a.completed_at desc,a.id
  ), stages as materialized (
    select s.*,case when e.active or m.active or se.active and not coalesce(e.has_current,false) then 'awaiting_renewal'
      when e.key is not null or m.key is not null or se.key is not null then 'former_student'
      when a.key is not null then 'awaiting_enrollment' when c.key is not null then 'awaiting_assessment' else 'awaiting_first_contact' end as stage,
      coalesce(m.active,false) as membership,a.activity_registration_id as registration_id,
      a.source_record_id as preferred_source_id,lc.source_record_id as contact_source_id
    from subjects s left join enrollment_flags e using(key) left join membership_flags m using(key) left join source_enrollment_flags se using(key)
      left join latest_assessments a using(key) left join contact_flags c using(key) left join latest_contacts lc using(key)
  ), eligible as materialized (select * from stages where stage=p_stage),
  listed as materialized (select * from eligible order by created_at desc,key limit p_page_size
    offset (least(p_page,greatest(1,ceil((select count(*) from eligible)::numeric/p_page_size)::integer))-1)*p_page_size),
  appointments as (
    select distinct on(ref.key) ref.key,r.status,r.assessment_started_at from registration_refs ref join listed s using(key)
      join registrations r on r.id=ref.id join public.business_activities a on a.id=r.activity_id
    where s.stage='awaiting_assessment' and r.record_state='current' and a.record_state='current' and a.deleted_at is null and a.kind in ('assessment_1v1','assessment')
      order by ref.key,coalesce(a.scheduled_at,r.created_at) desc,r.id
  ), invitations as (
    select distinct on(s.key) s.key,i.kind,i.state from listed s join public.lead_invitation_threads i on i.lead_id=s.lead_id
      where s.stage='awaiting_assessment' and i.state not in ('completed','cancelled') order by s.key,i.updated_at desc,i.id
  ), opportunity_refs as (
    select s.key,o.id from listed s join public.course_opportunities o on o.student_id=s.student_id
    union select l.key,o.id from lead_refs l join listed s using(key) join public.course_opportunities o on o.lead_id=l.id
  ), opportunities as (
    select distinct on(ref.key) ref.key,o.stage,o.opportunity_type,o.course_id,o.term_id from opportunity_refs ref
      join public.business_course_opportunities o on o.id=ref.id where o.record_state='current' order by ref.key,o.updated_at desc,o.id
  ), note_refs as (
    select s.key,f.id,f.content,f.created_at as occurred_at,1 as priority from listed s join public.business_student_follow_ups f on f.student_id=s.student_id where view_followup
    union all select c.key,c.id,c.note,c.occurred_at,0 from contacts c join listed s using(key)
      where c.visible and (s.stage in ('awaiting_first_contact','awaiting_assessment')
        or c.id=(select latest.id from latest_contacts latest where latest.key=c.key))
  ), notes as (select distinct on(key) key,content,occurred_at from note_refs where nullif(btrim(content),'') is not null order by key,occurred_at desc,priority desc,id),
  background_sources as materialized (
    select s.key,h.id from listed s join public.history_import_records h on h.student_id=s.student_id
    union select l.key,h.id from lead_refs l join listed s using(key) join public.history_import_records h on h.lead_id=l.id where l.visible or s.stage not in ('awaiting_first_contact','awaiting_assessment')
    union select s.key,a.record_id from listed s join public.history_import_associations a on a.student_id=s.student_id
    union select l.key,l.source_record_id from lead_refs l join listed s using(key) where l.source_record_id is not null and (l.visible or s.stage not in ('awaiting_first_contact','awaiting_assessment'))
    union select l.key,c.source_record_id from lead_refs l join listed s using(key) join public.lead_communications c on c.lead_id=l.id where c.source_record_id is not null and (l.visible or s.stage not in ('awaiting_first_contact','awaiting_assessment'))
    union select s.key,r.source_record_id from listed s join public.activity_registrations r on r.student_id=s.student_id where r.source_record_id is not null
    union select l.key,r.source_record_id from lead_refs l join listed s using(key) join public.activity_registrations r on r.lead_id=l.id where r.source_record_id is not null and (l.visible or s.stage not in ('awaiting_first_contact','awaiting_assessment'))
    union select s.key,a.source_record_id from listed s join public.assessment_results a on a.student_id=s.student_id where a.source_record_id is not null
    union select l.key,a.source_record_id from lead_refs l join listed s using(key) join public.assessment_results a on a.lead_id=l.id where a.source_record_id is not null and (l.visible or s.stage not in ('awaiting_first_contact','awaiting_assessment'))
    union select s.key,e.source_record_id from listed s join public.course_enrollments e on e.student_id=s.student_id where e.source_record_id is not null
  ), source_fields as materialized (
    select h.id,h.record_data->>'tableName' as table_name,public.business_source_is_current(h.id) as current_source,f.fields
      from public.history_import_records h join (select distinct id from background_sources) ref on ref.id=h.id
      cross join lateral (select jsonb_object_agg(c->>'fieldName',btrim(c->>'text')) as fields from jsonb_array_elements(h.record_data->'cells') c
        where c->>'fieldName' in ('学服老师','确认人员','学科老师','报名服务老师','授课学科老师','班型') and nullif(btrim(c->>'text'),'') is not null) f
      where h.source_data->>'format'='feishu-base'
  ), source_names as materialized (
    select ref.key,h.id,h.table_name,h.current_source,coalesce(h.fields->>'报名服务老师',h.fields->>'学服老师',h.fields->>'确认人员') as owner_name,
      coalesce(h.fields->>'授课学科老师',h.fields->>'学科老师') as teacher_name,h.fields->>'班型' as class_band,
      case when s.stage='awaiting_renewal' and h.table_name='2026秋季在读学员表格' then 0
        when h.id=case when s.stage='awaiting_assessment' then s.contact_source_id else s.preferred_source_id end then 1 when h.current_source then 2 else 3 end as priority
      from background_sources ref join source_fields h on h.id=ref.id join listed s using(key)
  ), source_owners as (select distinct on(key) key,owner_name from source_names where owner_name is not null order by key,priority,id),
  source_teachers as (select distinct on(key) key,teacher_name from source_names where teacher_name is not null order by key,priority,id),
  source_bands as (select distinct on(key) key,class_band from source_names where class_band is not null and table_name='2026秋季在读学员表格' order by key,current_source desc,id),
  class_facts as (
    select m.key,string_agg(distinct p.display_name,'、' order by p.display_name) filter(where a.responsibility='primary_teacher') as teacher_name,
      string_agg(distinct p.display_name,'、' order by p.display_name) filter(where a.responsibility='learning_support') as owner_name,
      string_agg(distinct (regexp_match(c.name,'(?:春季|暑期|暑假|秋季|寒假)(X[+＋]|G[+＋]|A[+＋]?|S|C|培优|基础)(?:[|｜班]|$)'))[1],'、') as class_band
      from memberships m join listed s using(key) join public.classrooms c on c.id=m.classroom_id
      left join public.classroom_staff_assignments a on a.classroom_id=c.id left join public.profiles p on p.id=a.user_id
      where m.active and c.archived_at is null and c.trashed_at is null group by m.key
  ), background_assessment_refs as materialized (
    select s.key,a.id from listed s join completed_assessments a on a.student_id=s.student_id where p_stage not in ('awaiting_first_contact','awaiting_assessment')
    union select s.key,a.id from listed s join completed_assessments a on a.registration_student_id=s.student_id where p_stage not in ('awaiting_first_contact','awaiting_assessment')
    union select l.key,a.id from lead_refs l join listed s using(key) join completed_assessments a on a.lead_id=l.id where p_stage not in ('awaiting_first_contact','awaiting_assessment')
    union select l.key,a.id from lead_refs l join listed s using(key) join completed_assessments a on a.registration_lead_id=l.id where p_stage not in ('awaiting_first_contact','awaiting_assessment')
    union select s.key,a.id from background_sources s join completed_assessments a on a.source_record_id=s.id where p_stage not in ('awaiting_first_contact','awaiting_assessment')
    union select s.key,a.id from background_sources s join completed_assessments a on a.registration_source_id=s.id where p_stage not in ('awaiting_first_contact','awaiting_assessment')
  ), background_assessments as (
    select distinct on(ref.key) ref.key,a.* from background_assessment_refs ref join completed_assessments a on a.id=ref.id
      where a.activity_id is not null and a.deleted_at is null order by ref.key,a.assessed_on desc nulls last,a.updated_at desc,a.id
  ), candidate_counts as (
    select s.key,count(distinct ic.record_id)::integer as count from listed s join public.history_import_identity_candidates ic on ic.student_id=s.student_id
      join public.history_import_records h on h.id=ic.record_id join completed_assessments a on a.source_record_id=ic.record_id
      where p_stage not in ('awaiting_first_contact','awaiting_assessment') and h.source_data->>'format'='feishu-base'
        and not exists(select 1 from background_sources r where r.key=s.key and r.id=ic.record_id) group by s.key
  ), inferred as (
    select r.key,jsonb_agg(a.record_id) as ids from background_sources r join public.history_import_associations a on a.record_id=r.id and a.match_state='inferred'
      where p_stage not in ('awaiting_first_contact','awaiting_assessment') group by r.key
  ), backgrounds as (
    select s.key,coalesce(cf.owner_name,so.owner_name) as owner_name,
      coalesce(case when s.stage='awaiting_renewal' then cf.teacher_name end,st.teacher_name,ap.display_name) as teacher_name,
      case when a.id is not null then 'assessment' when s.stage='awaiting_renewal' and coalesce(cf.class_band,sb.class_band) is not null then 'class_band' end as source,
      case when a.id is not null then public.student_learning_band(a.assessment_band)
        when s.stage='awaiting_renewal' then public.student_learning_band(coalesce(cf.class_band,sb.class_band)) end as band,
      a.score,a.assessed_on,a.id as assessment_id,case when a.learning_band='未达A' then 'X+' else a.learning_band end as learning_band,
      case when a.id is null and s.stage='awaiting_renewal' then coalesce(cf.class_band,sb.class_band,'') else '' end as class_band
    from listed s left join class_facts cf using(key) left join source_owners so using(key) left join source_teachers st using(key)
      left join source_bands sb using(key) left join background_assessments a using(key) left join public.profiles ap on ap.id=a.assessed_by
  ), teacher_ids as (select display_name,case when count(*)=1 then (array_agg(id))[1] end as id from public.profiles
    where is_active and role in ('staff','admin') group by display_name),
  rows as (
    select s.stage,s.created_at,s.key,jsonb_build_object(
      'key',s.key,'studentId',s.student_id,'leadId',s.lead_id,'name',coalesce(st.name,l.provisional_student_name),
      'phone',coalesce(nullif(st.parent_phone,''),nullif(st.phone,''),l.phone,''),'grade',coalesce(st.grade,l.grade_hint),'gradeText',coalesce(l.grade_text,''),
      'ownerId',coalesce(st.assigned_to,l.owner_id),'ownerName',coalesce(p.display_name,b.owner_name,''),'teacherId',ti.id,'teacherName',coalesce(b.teacher_name,''),
      'stage',s.stage,'detail',case s.stage when 'awaiting_first_contact' then public.student_first_contact_detail(coalesce(st.assigned_to,l.owner_id),coalesce(p.display_name,b.owner_name),l.status,lc.outcome)
        when 'awaiting_assessment' then case when i.kind='assessment_1v1' and i.state='confirmed' then 'booked' when i.kind='assessment_1v1' then 'coordinating'
          when a.status='no_show' then 'no_show' when a.status='cancelled' then 'cancelled' when a.assessment_started_at is not null then 'in_progress' when a.status='attended' then 'attended_without_result'
          when a.status='booked' then 'booked' when exists(select 1 from attendance_flags reached where reached.key=s.key) then 'attended_without_result' else 'not_booked' end
        when 'awaiting_enrollment' then case o.stage when 'committed' then 'ready_to_enroll' when 'not_enrolled' then 'not_enrolling'
          when 'considering' then 'considering' when 'payment_pending' then 'payment_pending' when 'nurturing' then 'nurturing' else coalesce(w.classification,'assessed') end
        when 'awaiting_renewal' then case when o.opportunity_type='renewal' and o.stage='not_enrolled' then 'not_renewing'
          when o.opportunity_type='renewal' and o.stage='considering' then 'renewal_considering' when o.opportunity_type='renewal' and o.stage='committed' then 'renewal_committed'
          when o.opportunity_type='renewal' and o.stage='enrolled' then 'renewal_confirmed' when s.membership then 'attending' else 'awaiting_class' end
        else case when e.status='cancelled' then 'withdrawn' else 'ended' end end,
      'note',case when view_followup then coalesce(n.content,'') else '' end,
      'lastContactAt',case when view_followup then case when s.stage in ('awaiting_first_contact','awaiting_assessment') then coalesce(n.occurred_at,lc.occurred_at) else n.occurred_at end end,
      'nextContactAt',null,'invitation',null,'detailLoaded',false,
      'score',case when b.source is not null then b.score else ca.score end,
      'assessmentBand',case when b.source is not null then b.band else ca.assessment_band end,
      'assessmentAt',case when b.source is not null then to_jsonb(b.assessed_on) else to_jsonb(ca.completed_at) end,
      'assessmentSource',b.source,'assessmentRecordId',b.assessment_id,'learningBand',b.learning_band,'classBandLabel',b.class_band,
      'assessmentCandidateCount',coalesce(cc.count,0),'inferredSourceIds',coalesce(inf.ids,'[]'::jsonb),'registrationId',s.registration_id,
      'courseId',coalesce(e.course_id,o.course_id),'termId',coalesce(e.term_id,o.term_id),'courseTitle',coalesce(ec.title,oc.title,''),'termName',coalesce(et.name,ot.name,''),
      'createdAt',s.created_at) as payload
    from listed s left join public.students st on st.id=s.student_id left join public.leads l on l.id=s.lead_id
      left join public.profiles p on p.id=coalesce(st.assigned_to,l.owner_id) left join backgrounds b using(key) left join teacher_ids ti on ti.display_name=b.teacher_name
      left join latest_contacts lc using(key) left join notes n using(key) left join latest_enrollments e using(key) left join opportunities o using(key)
      left join appointments a using(key) left join invitations i using(key) left join latest_assessments ca using(key)
      left join public.assessment_workflow_states w on w.registration_id=s.registration_id
      left join public.courses ec on ec.id=e.course_id left join public.courses oc on oc.id=o.course_id
      left join public.school_terms et on et.id=e.term_id left join public.school_terms ot on ot.id=o.term_id
      left join candidate_counts cc using(key) left join inferred inf using(key)
  ) select public.school_list_apply_collaboration(r.payload||coalesce(source_status.status,'{}'::jsonb)||case when p_subjects is not null then
      jsonb_build_object('phone',w.w->'phone','lastContactAt',w.w->'last_contact_at')||
      case when r.stage in ('awaiting_first_contact','awaiting_assessment') then
        jsonb_build_object('teacherId',null,'teacherName','','courseId',null,'termId',null,'courseTitle','','termName','','assessmentBand',null,'assessmentAt',null)
        else '{}'::jsonb end else '{}'::jsonb end,c.projection),r.stage from rows r left join wanted w on w.key=r.key
    left join public.school_source_statuses(coalesce((select jsonb_agg(payload) from rows),'[]'::jsonb)) source_status on source_status.key=r.key
    join public.school_list_collaboration(coalesce((select jsonb_agg(jsonb_build_object('key',payload->>'key','student_id',payload->>'studentId','lead_id',payload->>'leadId')) from rows),'[]'::jsonb),actor) c on c.key=r.key
    union all select null::jsonb,s.stage from stages s where not exists(select 1 from listed page where page.key=s.key);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.student_record_index_for_population(p_scope text, p_search text, p_enrollments business_course_enrollment_subjects[], p_students_only boolean)
 RETURNS TABLE(student_id uuid, lead_id uuid, key text, stage text, detail text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); view_all boolean; view_followup boolean; today date;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) then raise exception 'FORBIDDEN'; end if;
  view_all:=public.has_perm(actor,'student.view.all');
  view_followup:=public.has_perm(actor,'followup.view');
  today:=(now() at time zone public.get_organization_timezone_v2())::date;
  if p_scope in ('mine','group') and not exists(select 1 from public.school_list_scope_keys(actor,p_scope)) then return; end if;
  return query with
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
    select r.id,r.lead_id,r.occurred_at,r.occurred_on,r.outcome,r.source_key,r.source_metric_facts,r.wechat_added,r.visit_committed from public.business_lead_communications r
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
 visibility as materialized (select vis.key,vis.can_view from public.school_list_visibility(actor) vis where not view_all),
  scope_keys as materialized (select scoped.key from public.school_list_scope_keys(actor,p_scope) scoped),
  subjects as materialized (
    select s.id as student_id,null::uuid as lead_id,'student:'||s.id as key,s.created_at,s.assigned_to as owner_id
      from public.students s where s.deleted_at is null and s.purpose<>'test' and (view_all or exists(select 1 from visibility v where v.key='student:'||s.id and v.can_view))
        and (p_scope='all' or (p_scope='mine' and exists(select 1 from scope_keys k where k.key='student:'||s.id)) or (p_scope='unassigned' and s.assigned_to is null or p_scope='group' and exists(select 1 from scope_keys k where k.key='student:'||s.id)))
        and (coalesce(p_search,'')='' or s.id::text=p_search
          or position(lower(p_search) in lower(s.name||' '||s.school||' '||s.phone||' '||s.parent_phone))>0
          or (length(regexp_replace(p_search,'\D','','g'))>=3 and
            position(regexp_replace(p_search,'\D','','g') in regexp_replace(s.phone||' '||s.parent_phone,'\D','','g'))>0))
    union all
    select null,l.id,'lead:'||l.id,l.created_at,l.owner_id from public.leads l
      where not p_students_only and l.student_id is null and l.purpose<>'test' and view_followup and case when view_all or l.owner_id is null or l.owner_id=actor then true else exists(select 1 from visibility v where v.key='lead:'||l.id and v.can_view) end
        and (p_scope='all' or (p_scope='mine' and exists(select 1 from scope_keys k where k.key=coalesce('student:'||l.student_id,'lead:'||l.id))) or (p_scope='unassigned' and l.owner_id is null or p_scope='group' and exists(select 1 from scope_keys k where k.key=coalesce('student:'||l.student_id,'lead:'||l.id))))
        and (coalesce(p_search,'')='' or l.id::text=p_search
          or position(lower(p_search) in lower(l.provisional_student_name||' '||l.phone))>0
          or (length(regexp_replace(p_search,'\D','','g'))>=3 and position(regexp_replace(p_search,'\D','','g') in l.phone_normalized)>0))
  ), lead_refs as materialized (
    select l.*,coalesce('student:'||l.student_id,'lead:'||l.id) as key from public.leads l
      where exists(select 1 from subjects s where s.key=coalesce('student:'||l.student_id,'lead:'||l.id))
  ), stage_enrollments as materialized (
    select * from unnest(p_enrollments)
  ), source_lead_refs as materialized (
    select l.key,h.id as source_record_id from lead_refs l join public.history_import_records h on h.lead_id=l.id
    union select l.key,h.id from lead_refs l join public.history_import_records h on h.id=l.source_record_id
  ), selected_leads as materialized (
    select distinct on(l.key) l.key,l.id,l.status,l.owner_id from lead_refs l
      where view_followup and case when view_all or l.owner_id is null or l.owner_id=actor then true else exists(select 1 from visibility v where v.key='lead:'||l.id and v.can_view) end
      order by l.key,(l.status not in ('invalid','converted')) desc,l.created_at desc,l.id
  ), contacts as materialized (
    select l.key,c.id,c.occurred_at,coalesce(r.effective_patch->>'outcome',c.outcome) as outcome,public.school_contact_is_effective(to_jsonb(c),r.effective_patch) as effective_contact,public.school_contact_sort_key(c.occurred_at,c.occurred_on,c.source_metric_facts,c.source_key) as contact_order,
      view_followup and case when view_all or l.owner_id is null or l.owner_id=actor then true else exists(select 1 from visibility v where v.key='lead:'||l.id and v.can_view) end as visible
      from directory_business_lead_communications c join lead_refs l on l.id=c.lead_id
      left join lateral (select r.effective_patch from public.communication_record_revisions r
        where r.source='contact' and r.event_id=c.id order by r.revision_no desc limit 1) r on true
  ), contact_flags as (select c.key from contacts c where c.effective_contact group by c.key union select other_contact.key from public.school_other_contact_subjects() other_contact),
  latest_contacts as (select distinct on(c.key) c.key,c.outcome from contacts c where c.visible order by c.key,c.occurred_at desc nulls last,c.contact_order desc,c.id),
  stage_registrations as materialized (
    select r.* from directory_business_activity_registrations r where exists(select 1 from subjects s where s.student_id=r.student_id)
      or exists(select 1 from lead_refs l where l.id=r.lead_id)
      or exists(select 1 from source_lead_refs l where l.source_record_id=r.source_record_id)
  ), registration_refs as materialized (
    select 'student:'||r.student_id as key,r.id from stage_registrations r where r.student_id is not null
    union select l.key,r.id from stage_registrations r join lead_refs l on l.id=r.lead_id
    union select l.key,r.id from stage_registrations r join source_lead_refs l on l.source_record_id=r.source_record_id
  ), attendance_flags as (
    select ref.key from registration_refs ref join stage_registrations r on r.id=ref.id
      join directory_business_activities a on a.id=r.activity_id where r.status='attended' and a.deleted_at is null group by ref.key
  ), source_owner_flags as (
    select distinct ref.key from source_lead_refs ref join public.history_import_records h on h.id=ref.source_record_id
      cross join lateral jsonb_array_elements(h.record_data->'cells') c
      where c->>'fieldName' in ('报名服务老师','学服老师','确认人员') and nullif(btrim(c->>'text'),'') is not null
  ), enrollment_facts as (
    select e.subject_key as key,
      e.status='active' and e.record_state='current' and (t.ends_on is null or t.ends_on>=today) as active,
      false as membership from stage_enrollments e left join public.school_terms t on t.id=e.term_id
    union all select l.key,e.status='active' and e.record_state='current' and (t.ends_on is null or t.ends_on>=today),false
      from stage_enrollments e join source_lead_refs l on l.source_record_id=e.source_record_id left join public.school_terms t on t.id=e.term_id
    union all
    select 'student:'||e.student_id,
      e.status='active' and e.left_at is null and (t.ends_on is null or t.ends_on>=today),
      e.status='active' and e.left_at is null and (t.ends_on is null or t.ends_on>=today)
      from public.enrollments e join public.classrooms c on c.id=e.classroom_id left join public.school_terms t on t.id=c.term_id
    union all
    select ref.key,r.record_state='current' and not exists(select 1 from stage_enrollments e where e.subject_key=ref.key and e.record_state='current'),false
      from registration_refs ref join stage_registrations r on r.id=ref.id where false /* 到访表报名由独立正式报名和入班事实交叉验证 */
  ), enrollment_flags as (
    select f.key,bool_or(f.active) as active,bool_or(f.membership) as membership from enrollment_facts f group by f.key
  ), latest_enrollments as (
    select distinct on(e.subject_key) e.subject_key,e.status from stage_enrollments e
      order by e.subject_key,(e.status='active' and e.record_state='current') desc,e.confirmed_at desc,e.id
  ), assessments as materialized (
    select distinct on(ref.key) ref.key,r.id as registration_id
      from registration_refs ref join stage_registrations r on r.id=ref.id
      join directory_business_assessment_results a on a.activity_registration_id=r.id
      where public.student_assessment_is_complete(r.status,r.assessment_completed_at,a.result_finalized_at,
        a.result_source,a.score,a.assessment_band,a.strengths,
        concat_ws(E'\n',a.strengths,a.focus_areas,a.parent_concerns,a.teacher_recommendation,a.teacher_observation))
      order by ref.key,coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) desc,a.id
  ), appointments as (
    select distinct on(ref.key) ref.key,r.status,r.assessment_started_at
      from registration_refs ref join stage_registrations r on r.id=ref.id join directory_business_activities a on a.id=r.activity_id
      where r.record_state='current' and a.record_state='current' and a.deleted_at is null and a.kind in ('assessment_1v1','assessment')
      order by ref.key,coalesce(a.scheduled_at,r.created_at) desc,r.id
  ), opportunity_refs as (
    select 'student:'||o.student_id as key,o.id from directory_business_course_opportunities o where o.student_id is not null
    union select l.key,o.id from directory_business_course_opportunities o join lead_refs l on l.id=o.lead_id
  ), opportunities as (
    select distinct on(ref.key) ref.key,o.stage,o.opportunity_type from opportunity_refs ref
      join directory_business_course_opportunities o on o.id=ref.id left join public.courses c on c.id=o.course_id left join public.school_terms t on t.id=o.term_id
      where o.record_state='current' order by ref.key,o.updated_at desc,o.id
  ), stages as (
    select s.*,case when e.active then 'awaiting_renewal' when e.key is not null then 'former_student'
      when a.key is not null then 'awaiting_enrollment' when c.key is not null or reached.key is not null then 'awaiting_assessment' else 'awaiting_first_contact' end as stage,
      coalesce(e.membership,false) as membership,a.registration_id
      from subjects s left join enrollment_flags e on e.key=s.key left join assessments a on a.key=s.key left join contact_flags c on c.key=s.key left join attendance_flags reached on reached.key=s.key
  ) select s.student_id,l.id,s.key,s.stage,
    case s.stage
      when 'awaiting_first_contact' then public.student_first_contact_detail(coalesce(s.owner_id,l.owner_id),case when exists(select 1 from source_owner_flags owned where owned.key=s.key) then 'source' end,l.status,c.outcome)
      when 'awaiting_assessment' then case when i.kind='assessment_1v1' and i.state='confirmed' then 'booked'
        when i.kind='assessment_1v1' then 'coordinating' when a.status='no_show' then 'no_show' when a.status='cancelled' then 'cancelled'
        when a.assessment_started_at is not null then 'in_progress' when a.status='attended' then 'attended_without_result' when a.status='booked' then 'booked' when exists(select 1 from attendance_flags reached where reached.key=s.key) then 'attended_without_result' else 'not_booked' end
      when 'awaiting_enrollment' then case o.stage when 'committed' then 'ready_to_enroll' when 'not_enrolled' then 'not_enrolling'
        when 'considering' then 'considering' when 'payment_pending' then 'payment_pending' when 'nurturing' then 'nurturing' else coalesce(w.classification,'assessed') end
      when 'awaiting_renewal' then case when o.opportunity_type='renewal' and o.stage='not_enrolled' then 'not_renewing'
        when o.opportunity_type='renewal' and o.stage='considering' then 'renewal_considering'
        when o.opportunity_type='renewal' and o.stage='committed' then 'renewal_committed'
        when o.opportunity_type='renewal' and o.stage='enrolled' then 'renewal_confirmed'
        when s.membership then 'attending' else 'awaiting_class' end
      else case when e.status='cancelled' then 'withdrawn' else 'ended' end end,s.created_at
    from stages s left join selected_leads l on l.key=s.key left join latest_contacts c on c.key=s.key
    left join public.lead_invitation_threads i on i.lead_id=l.id and i.state not in ('completed','cancelled')
    left join appointments a on a.key=s.key left join opportunities o on o.key=s.key
    left join public.assessment_workflow_states w on w.registration_id=s.registration_id
    left join latest_enrollments e on e.subject_key=s.key;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.student_directory_card_rows(p_subjects jsonb, p_enrollments business_course_enrollment_subjects[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare actor uuid:=auth.uid(); view_all boolean:=public.has_perm(auth.uid(),'student.view.all');
  view_followup boolean:=public.has_perm(auth.uid(),'followup.view'); write_followup boolean:=public.has_perm(auth.uid(),'followup.write');
  timezone_name text:=public.get_organization_timezone_v2(); today date; result jsonb;
begin
  if actor is null or not public.is_staff(actor) then raise exception 'FORBIDDEN'; end if;
  today:=(now() at time zone timezone_name)::date;
  with
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
    select r.id,r.lead_id,r.occurred_at,r.occurred_on,r.outcome,r.source_key,r.source_metric_facts,r.wechat_added,r.visit_committed from public.business_lead_communications r
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
 subjects as materialized (
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
    select ref.key,ref.visible,c.id,c.occurred_at,coalesce(r.effective_patch->>'outcome',c.outcome) as outcome,public.school_contact_is_effective(to_jsonb(c),r.effective_patch) as effective_contact,public.school_contact_sort_key(c.occurred_at,c.occurred_on,c.source_metric_facts,c.source_key) as contact_order
      from lead_refs ref join directory_business_lead_communications c on c.lead_id=ref.id
      left join lateral (select r.effective_patch from public.communication_record_revisions r
        where r.source='contact' and r.event_id=c.id order by r.revision_no desc limit 1) r on true
  ), contact_flags as (
    select c.key from contacts c where c.effective_contact group by c.key union select other_contact.key from public.school_other_contact_subjects() other_contact
  ), latest_contacts as (
    select distinct on(c.key) c.key,c.outcome from contacts c where c.visible order by c.key,c.occurred_at desc nulls last,c.contact_order desc,c.id
  ), subject_sources as materialized (
    select ref.key,h.id from lead_refs ref join public.history_import_records h on h.lead_id=ref.id
    union select ref.key,h.id from lead_refs ref join public.history_import_records h on h.id=ref.source_record_id
  ), registration_refs as materialized (
    select s.key,r.id from subjects s join public.activity_registrations r on r.student_id=s.student_id where s.full_facts
    union select ref.key,r.id from lead_refs ref join subjects s using(key) join public.activity_registrations r on r.lead_id=ref.id where s.full_facts
    union select ref.key,r.id from subject_sources ref join subjects s using(key) join public.activity_registrations r on r.source_record_id=ref.id where s.full_facts
  ), registrations as materialized (
    select ref.key,r.id,r.activity_id,r.status,r.assessment_started_at,r.assessment_completed_at,r.created_at,r.record_state,r.source_enrollment_facts
      from registration_refs ref join directory_business_activity_registrations r on r.id=ref.id
  ), registration_flags as (
    select r.key,bool_or(false /* 到访表报名由独立正式报名和入班事实交叉验证 */) as enrolled,
      bool_or(r.record_state='current' and false /* 到访表报名由独立正式报名和入班事实交叉验证 */) as active,
      bool_or(r.status='attended' and a.id is not null and a.deleted_at is null) as attended
      from registrations r left join directory_business_activities a on a.id=r.activity_id group by r.key
  ), stage_assessments as materialized (
    select distinct on(r.key) r.key,r.id as registration_id,a.score,a.assessment_band,
      coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) as completed_at
      from registrations r join directory_business_assessment_results a on a.activity_registration_id=r.id
      where public.student_assessment_is_complete(r.status,r.assessment_completed_at,a.result_finalized_at,
        a.result_source,a.score,a.assessment_band,a.strengths,
        concat_ws(E'\n',a.strengths,a.focus_areas,a.parent_concerns,a.teacher_recommendation,a.teacher_observation))
      order by r.key,coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) desc,a.id
  ), appointments as (
    select distinct on(r.key) r.key,r.status,r.assessment_started_at from registrations r join directory_business_activities a on a.id=r.activity_id
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
    select distinct on(s.key) s.key,o.stage,o.opportunity_type from subjects s join directory_business_course_opportunities o on
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
      from assessment_refs ref join directory_business_assessment_results a on a.id=ref.id
      join directory_business_activity_registrations r on r.id=a.activity_registration_id join directory_business_activities act on act.id=r.activity_id
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
$function$
;

CREATE OR REPLACE FUNCTION public.read_student_record_with_enrollments(p_student_id uuid, p_lead_id uuid, p_enrollments business_course_enrollment_subjects[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_variable
declare
  actor uuid := auth.uid();
  student public.students%rowtype;
  lead public.leads%rowtype;
  lead_ids uuid[];
  visible_lead_ids uuid[];
  contact record;
  assessment record;
  appointment record;
  invitation public.lead_invitation_threads%rowtype;
  enrollment record;
  opportunity record;
  latest_note record;
  has_enrollment boolean;
  has_active_enrollment boolean;
  has_source_enrollment boolean;
  has_current_source_enrollment boolean;
  has_contact boolean;
  has_attendance boolean;
  has_assessment boolean;
  has_membership boolean;
  stage text;
  detail text;
  owner_id uuid;
  owner_name text;
  next_at timestamptz;
  can_followup boolean;
  today date;
  background jsonb;
  subject_source_ids text[];
  subject_registration_ids uuid[];
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) then raise exception 'FORBIDDEN'; end if;
  today:=(now() at time zone public.get_organization_timezone_v2())::date;
  if p_student_id is not null then
    select * into student from public.students s where s.id=p_student_id and s.deleted_at is null;
    if student.id is null or not public.can_view_school_student(student.id,actor) then raise exception 'FORBIDDEN_SCOPE'; end if;
  end if;
  if p_lead_id is not null then
    select * into lead from public.leads l where l.id=p_lead_id;
    if lead.id is null then raise exception 'NOT_FOUND'; end if;
    if p_student_id is not null and lead.student_id is distinct from p_student_id then raise exception 'SUBJECT_MISMATCH'; end if;
    if not (public.has_perm(actor,'followup.view') and
      public.can_view_school_lead(lead.id,actor)) then raise exception 'FORBIDDEN_SCOPE'; end if;
    if student.id is null and lead.student_id is not null then
      select * into student from public.students s where s.id=lead.student_id and s.deleted_at is null;
      if student.id is null or not public.can_view_school_student(student.id,actor) then raise exception 'FORBIDDEN_SCOPE'; end if;
    end if;
  elsif student.id is not null and public.has_perm(actor,'followup.view') then
    select * into lead from public.leads l where l.student_id=student.id
      and public.can_view_school_lead(l.id,actor)
      order by (l.status not in ('invalid','converted')) desc, l.created_at desc, l.id limit 1;
  end if;
  if student.id is null and lead.id is null then raise exception 'NOT_FOUND'; end if;
  select coalesce(array_agg(l.id),'{}'::uuid[]) into lead_ids from public.leads l
    where l.id=lead.id or (student.id is not null and l.student_id=student.id);
  select coalesce(array_agg(l.id),'{}'::uuid[]) into visible_lead_ids from public.leads l
    where l.id=any(lead_ids) and public.has_perm(actor,'followup.view')
      and public.can_view_school_lead(l.id,actor);
  -- 以稳定身份与来源索引读取此人的全部经历；在读和待办继续采用实际有效事实。
  select coalesce(array_agg(distinct h.id),'{}'::text[]) into subject_source_ids from public.history_import_records h
    where h.lead_id=any(lead_ids) or h.id=any(array(select l.source_record_id from public.leads l where l.id=any(lead_ids)));
  select coalesce(array_agg(r.id),'{}'::uuid[]) into subject_registration_ids from public.activity_registrations r
    where r.student_id=student.id or r.lead_id=any(lead_ids) or r.source_record_id=any(subject_source_ids);
  select exists(select 1 from public.business_activity_registrations r join public.business_activities a on a.id=r.activity_id
    where r.id=any(subject_registration_ids) and r.status='attended' and a.deleted_at is null) into has_attendance;
  owner_id := coalesce(student.assigned_to,lead.owner_id);
  select display_name into owner_name from public.profiles where id=owner_id;
  can_followup := public.has_perm(actor,'followup.view');

  select c.*, coalesce(r.effective_patch->>'outcome',c.outcome) as effective_outcome,
    coalesce(r.effective_patch->>'note',c.note) as effective_note into contact
    from public.business_lead_communications c left join lateral (
      select effective_patch from public.communication_record_revisions r
      where r.source='contact' and r.event_id=c.id order by revision_no desc limit 1
    ) r on true where c.lead_id=any(visible_lead_ids)
    order by c.occurred_at desc nulls last,public.school_contact_sort_key(c.occurred_at,c.occurred_on,c.source_metric_facts,c.source_key) desc,c.id limit 1;
  select exists(select 1 from public.business_lead_communications c left join lateral (
      select effective_patch from public.communication_record_revisions r
      where r.source='contact' and r.event_id=c.id order by revision_no desc limit 1
    ) r on true where c.lead_id=any(lead_ids)
      and public.school_contact_is_effective(to_jsonb(c),r.effective_patch)) into has_contact;
  has_contact:=has_contact or exists(select 1 from public.school_other_contact_subjects() x where x.key=coalesce('student:'||student.id,'lead:'||lead.id));

  select exists(select 1 from public.business_activity_registrations r
      where r.id=any(subject_registration_ids)
        and false /* 到访表报名由独立正式报名和入班事实交叉验证 */),
    exists(select 1 from public.business_activity_registrations r
      where r.id=any(subject_registration_ids) and r.record_state='current'
        and false /* 到访表报名由独立正式报名和入班事实交叉验证 */)
    into has_source_enrollment,has_current_source_enrollment;
  select exists(select 1 from unnest(p_enrollments) e where (e.subject_key=coalesce('student:'||student.id,'lead:'||lead.id) or e.source_record_id=any(subject_source_ids)))
      or exists(select 1 from public.enrollments e join public.classrooms c on c.id=e.classroom_id left join public.school_terms t on t.id=c.term_id
        where e.student_id=student.id)
      or has_source_enrollment,
    exists(select 1 from unnest(p_enrollments) e left join public.school_terms t on t.id=e.term_id
      where (e.subject_key=coalesce('student:'||student.id,'lead:'||lead.id) or e.source_record_id=any(subject_source_ids)) and e.status='active' and e.record_state='current'
        and (t.ends_on is null or t.ends_on >= today))
      or exists(select 1 from public.enrollments e join public.classrooms c on c.id=e.classroom_id
        left join public.school_terms t on t.id=c.term_id
        where e.student_id=student.id and e.status='active' and e.left_at is null
          and (t.ends_on is null or t.ends_on >= today))
      or (has_current_source_enrollment and not exists(select 1 from unnest(p_enrollments) e where (e.subject_key=coalesce('student:'||student.id,'lead:'||lead.id) or e.source_record_id=any(subject_source_ids)) and e.record_state='current'))
    into has_enrollment,has_active_enrollment;
  select exists(select 1 from public.enrollments e join public.classrooms c on c.id=e.classroom_id
    left join public.school_terms t on t.id=c.term_id
    where e.student_id=student.id and e.status='active' and e.left_at is null
      and (t.ends_on is null or t.ends_on >= today)) into has_membership;

  -- 空记录和未到场均不代表测评完成；专业结果仍采用现有定稿事实。
  select a.score,a.assessment_band,a.teacher_recommendation,a.source_record_id,r.id as registration_id,
    coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) as completed_at into assessment
    from public.business_assessment_results a join public.business_activity_registrations r on r.id=a.activity_registration_id
    where r.id=any(subject_registration_ids) and public.student_assessment_is_complete(r.status,r.assessment_completed_at,a.result_finalized_at,
        a.result_source,a.score,a.assessment_band,a.strengths,
        concat_ws(E'\n',a.strengths,a.focus_areas,a.parent_concerns,a.teacher_recommendation,a.teacher_observation))
    order by coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) desc,a.id limit 1;
  has_assessment := assessment.registration_id is not null;
  select r.id,r.status,r.assessment_started_at,a.scheduled_at into appointment
    from public.business_activity_registrations r join public.business_activities a on a.id=r.activity_id
    where r.id=any(subject_registration_ids) and r.record_state='current' and a.record_state='current' and a.deleted_at is null
      and a.kind in ('assessment_1v1','assessment')
    order by coalesce(a.scheduled_at,r.created_at) desc,r.id limit 1;
  select * into invitation from public.lead_invitation_threads i
    where i.lead_id=lead.id and i.state not in ('completed','cancelled')
    order by i.updated_at desc,i.id limit 1;
  select e.id,e.status,c.title,t.name as term_name,e.course_id,e.term_id into enrollment
    from unnest(p_enrollments) e left join public.courses c on c.id=e.course_id left join public.school_terms t on t.id=e.term_id
    where (e.subject_key=coalesce('student:'||student.id,'lead:'||lead.id) or e.source_record_id=any(subject_source_ids)) order by (e.status='active' and e.record_state='current') desc,e.confirmed_at desc,e.id limit 1;
  select o.id,o.stage,o.opportunity_type,c.title,t.name as term_name,o.course_id,o.term_id into opportunity
    from public.business_course_opportunities o left join public.courses c on c.id=o.course_id left join public.school_terms t on t.id=o.term_id
    where (o.student_id=student.id or o.lead_id=any(lead_ids)) and o.record_state='current'
    order by o.updated_at desc,o.id limit 1;

  stage := case when has_active_enrollment then 'awaiting_renewal'
    when has_enrollment then 'former_student' when has_assessment then 'awaiting_enrollment'
    when has_contact or has_attendance then 'awaiting_assessment' else 'awaiting_first_contact' end;
  detail := case stage
    when 'awaiting_first_contact' then case when lead.status='invalid' then 'invalid_number'
      when owner_id is null then 'unassigned' when contact.effective_outcome='unreachable' then 'unreachable' else 'not_contacted' end
    when 'awaiting_assessment' then case
      when invitation.kind='assessment_1v1' and invitation.state='confirmed' then 'booked'
      when invitation.kind='assessment_1v1' then 'coordinating'
      when appointment.status='no_show' then 'no_show' when appointment.status='cancelled' then 'cancelled'
      when appointment.assessment_started_at is not null then 'in_progress' when appointment.status='attended' then 'attended_without_result'
      when appointment.status='booked' then 'booked' when has_attendance then 'attended_without_result' else 'not_booked' end
    when 'awaiting_enrollment' then 'assessed'
    when 'awaiting_renewal' then case when has_membership then 'attending' else 'awaiting_class' end
    else case when enrollment.status='cancelled' then 'withdrawn' else 'ended' end end;
  if stage='awaiting_enrollment' then
    select coalesce(w.classification,'assessed') into detail from public.assessment_workflow_states w
      where w.registration_id=assessment.registration_id;
    detail := coalesce(detail,'assessed');
    if opportunity.id is not null and opportunity.stage<>'enrolled' then
      detail:=case opportunity.stage when 'committed' then 'ready_to_enroll' when 'not_enrolled' then 'not_enrolling'
        when 'considering' then 'considering' when 'payment_pending' then 'payment_pending' when 'nurturing' then 'nurturing' else detail end;
    end if;
  elsif stage='awaiting_renewal' and opportunity.opportunity_type='renewal' then
    detail:=case opportunity.stage when 'not_enrolled' then 'not_renewing' when 'considering' then 'renewal_considering'
      when 'committed' then 'renewal_committed' when 'enrolled' then 'renewal_confirmed' else detail end;
  end if;

  select n.content,n.occurred_at into latest_note from (
    select f.content,f.created_at as occurred_at,f.id,1 as priority from public.business_student_follow_ups f
      where f.student_id=student.id
    union all select contact.effective_note,contact.occurred_at,contact.id,0 where contact.id is not null
  ) n where nullif(trim(n.content),'') is not null order by n.occurred_at desc,n.priority desc,n.id limit 1;
  select min(a.due_at) into next_at from public.lead_next_actions a
    where a.lead_id=any(visible_lead_ids) and a.status='open' and a.kind<>'initial_contact';
  next_at := least(student.next_follow_up_at,next_at);
  background:=public.student_stage_learning_background(student.id,lead.id,stage,
    case when stage='awaiting_assessment' then contact.source_record_id else assessment.source_record_id end);
  return public.school_collaboration_row(jsonb_build_object(
    'key',case when student.id is not null then 'student:'||student.id else 'lead:'||lead.id end,
    'studentId',student.id,'leadId',lead.id,'name',coalesce(student.name,lead.provisional_student_name),
    'phone',coalesce(nullif(student.parent_phone,''),nullif(student.phone,''),lead.phone,''),
    'grade',coalesce(student.grade,lead.grade_hint),'gradeText',coalesce(lead.grade_text,''),
    'ownerId',owner_id,'ownerName',coalesce(owner_name,background->>'ownerName',''),'stage',stage,'detail',case when stage='awaiting_first_contact' then public.student_first_contact_detail(owner_id,coalesce(owner_name,background->>'ownerName'),lead.status,contact.effective_outcome) else detail end,
    'note',case when can_followup then coalesce(latest_note.content,'') else '' end,
    'lastContactAt',case when can_followup then latest_note.occurred_at else null end,
    'nextContactAt',case when can_followup then next_at else null end,
    'score',assessment.score,'assessmentBand',assessment.assessment_band,'assessmentAt',assessment.completed_at,
    'registrationId',assessment.registration_id,'courseTitle',coalesce(enrollment.title,opportunity.title,''),'termName',coalesce(enrollment.term_name,opportunity.term_name,''),
    'courseId',coalesce(enrollment.course_id,opportunity.course_id),'termId',coalesce(enrollment.term_id,opportunity.term_id),
    'createdAt',coalesce(student.created_at,lead.created_at),
    'canWrite',public.has_perm(actor,'followup.write') and
      ((student.id is not null and public.can_access_student(student.id,actor))
        or (lead.id is not null and public.can_edit_school_lead(lead.id,actor))),
    'canContact',public.has_perm(actor,'followup.write') and
      ((lead.id is not null and lead.status not in ('invalid','converted')
        and public.can_edit_school_lead(lead.id,actor))
        or (lead.id is null and student.id is not null and public.can_access_student(student.id,actor))),
    'invitation',case when can_followup and invitation.id is not null then jsonb_build_object(
      'id',invitation.id,'leadId',invitation.lead_id,'kind',invitation.kind,'state',invitation.state,
      'activityId',invitation.activity_id,'assessorId',invitation.assessor_id,'parentTimeOptions',invitation.parent_time_options,
      'assessorTimeOptions',invitation.assessor_time_options,'scheduledAt',invitation.scheduled_at,
      'locationText',invitation.location_text,'nextContactAt',next_at,'updatedAt',invitation.updated_at)
      else null end) || (background - 'ownerName' - 'score' - 'assessmentBand' - 'assessmentAt')
    || case when background->>'assessmentSource' is not null then jsonb_build_object(
      'score',background->'score','assessmentBand',background->'assessmentBand','assessmentAt',background->'assessmentAt') else '{}'::jsonb end);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.student_record_list_rows(p_subjects jsonb, p_enrollments business_course_enrollment_subjects[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare actor uuid:=auth.uid(); view_followup boolean:=public.has_perm(auth.uid(),'followup.view');
  write_followup boolean:=public.has_perm(auth.uid(),'followup.write'); view_all boolean:=public.has_perm(auth.uid(),'student.view.all'); result jsonb;
begin
  if actor is null or not public.is_staff(actor) then raise exception 'FORBIDDEN'; end if;
  with subjects as materialized (select * from jsonb_to_recordset(p_subjects)
    as s(student_id uuid,lead_id uuid,key text,stage text,detail text,created_at timestamptz)),
  lead_refs as materialized (select l.id,s.key from public.leads l join subjects s on
    l.id=s.lead_id or s.student_id is not null and l.student_id=s.student_id
    where view_followup and case when view_all or l.owner_id is null or l.owner_id=actor then true else public.can_view_school_lead(l.id,actor) end),
  contacts as materialized (select ref.key,c.id,c.source_record_id,c.occurred_at,coalesce(r.effective_patch->>'note',c.note) as note,coalesce(r.effective_patch->>'outcome',c.outcome) as outcome,public.school_contact_is_effective(to_jsonb(c),r.effective_patch) as effective_contact,public.school_contact_sort_key(c.occurred_at,c.occurred_on,c.source_metric_facts,c.source_key) as contact_order
    from public.business_lead_communications c join lead_refs ref on ref.id=c.lead_id
    left join lateral (select effective_patch from public.communication_record_revisions r
      where r.source='contact' and r.event_id=c.id order by r.revision_no desc limit 1) r on true),
  recent_contact as (select distinct on(key) key,source_record_id,occurred_at,outcome from contacts order by key,occurred_at desc nulls last,contact_order desc,id),
  source_refs as materialized (
    select s.key,h.id from subjects s join public.history_import_records h on h.student_id=s.student_id
    union select l.key,h.id from lead_refs l join public.history_import_records h on h.lead_id=l.id
    union select s.key,a.record_id from subjects s join public.history_import_associations a on a.student_id=s.student_id
    union select ref.key,l.source_record_id from lead_refs ref join public.leads l on l.id=ref.id
    union select ref.key,c.source_record_id from lead_refs ref join public.lead_communications c on c.lead_id=ref.id
    union select s.key,r.source_record_id from subjects s join public.activity_registrations r on r.student_id=s.student_id
    union select ref.key,r.source_record_id from lead_refs ref join public.activity_registrations r on r.lead_id=ref.id
    union select s.key,a.source_record_id from subjects s join public.assessment_results a on a.student_id=s.student_id
    union select ref.key,a.source_record_id from lead_refs ref join public.assessment_results a on a.lead_id=ref.id
    union select s.key,e.source_record_id from subjects s join public.course_enrollments e on e.student_id=s.student_id
  ), source_names as materialized (
    select h.id,public.business_source_is_current(h.id) as current_source,
      coalesce(f.fields->>'报名服务老师',f.fields->>'学服老师',f.fields->>'确认人员') as owner_name
    from public.history_import_records h cross join lateral (
      select jsonb_object_agg(c->>'fieldName',btrim(c->>'text')) as fields from jsonb_array_elements(h.record_data->'cells') c
      where c->>'fieldName' in ('报名服务老师','学服老师','确认人员') and nullif(btrim(c->>'text'),'') is not null
    ) f where h.source_data->>'format'='feishu-base' and exists(select 1 from source_refs ref where ref.id=h.id)
  ), source_owners as (
    select distinct on(ref.key) ref.key,n.owner_name from source_refs ref join source_names n on n.id=ref.id
      join subjects s on s.key=ref.key left join recent_contact c on c.key=ref.key where n.owner_name is not null
      order by ref.key,case when s.stage='awaiting_assessment' and c.source_record_id=ref.id then 1 when n.current_source then 2 else 3 end,ref.id
  ),
  notes as (select s.key,f.id,f.content,f.created_at as occurred_at,1 as priority
      from public.business_student_follow_ups f join subjects s on s.student_id=f.student_id where view_followup
    union all select key,id,note,occurred_at,0 from contacts),
  recent_note as (select distinct on(key) key,content,occurred_at from notes where nullif(btrim(content),'') is not null
    order by key,occurred_at desc,priority desc,id),
  reminders as (select ref.key,min(a.due_at) as due_at from public.lead_next_actions a join lead_refs ref on ref.id=a.lead_id
    where a.status='open' and a.kind<>'initial_contact' group by ref.key)
  select coalesce(jsonb_agg(case when s.stage not in ('awaiting_first_contact','awaiting_assessment')
      or exists(select 1 from public.lead_invitation_threads i where i.lead_id=s.lead_id and i.state not in ('completed','cancelled')) then
      public.read_student_record_with_enrollments(s.student_id,s.lead_id,p_enrollments)
    else jsonb_build_object(
      'key',s.key,'studentId',s.student_id,'leadId',s.lead_id,'name',coalesce(st.name,l.provisional_student_name),
      'phone',coalesce(nullif(st.parent_phone,''),nullif(st.phone,''),l.phone,''),'grade',coalesce(st.grade,l.grade_hint),'gradeText',coalesce(l.grade_text,''),
      'ownerId',coalesce(st.assigned_to,l.owner_id),'ownerName',coalesce(p.display_name,so.owner_name,''),'stage',s.stage,'detail',case when s.stage='awaiting_first_contact' then public.student_first_contact_detail(coalesce(st.assigned_to,l.owner_id),coalesce(p.display_name,so.owner_name),l.status,c.outcome) else s.detail end,
      'note',coalesce(n.content,''),'lastContactAt',coalesce(n.occurred_at,c.occurred_at),
      'nextContactAt',case when view_followup then least(st.next_follow_up_at,a.due_at) else null end,
      'score',null,'assessmentBand',null,'assessmentAt',null,'registrationId',null,
      'courseTitle','','termName','','courseId',null,'termId',null,'createdAt',s.created_at,
      'canWrite',write_followup and ((s.student_id is not null and case when view_all then true else public.can_access_student(s.student_id,actor) end)
        or (l.id is not null and case when view_all or l.owner_id=actor then true else public.can_edit_school_lead(l.id,actor) end)),
      'canContact',write_followup and ((l.id is not null and l.status not in ('invalid','converted') and case when view_all or l.owner_id=actor then true else public.can_edit_school_lead(l.id,actor) end)
        or (l.id is null and st.id is not null and case when view_all then true else public.can_access_student(st.id,actor) end)),
      'invitation',null)
    end order by s.created_at desc,s.key),'[]'::jsonb) into result
    from subjects s left join public.students st on st.id=s.student_id left join public.leads l on l.id=s.lead_id
    left join public.profiles p on p.id=coalesce(st.assigned_to,l.owner_id)
    left join recent_note n on n.key=s.key left join recent_contact c on c.key=s.key left join reminders a on a.key=s.key
    left join source_owners so on so.key=s.key;
  return (select coalesce(jsonb_agg(public.school_list_apply_collaboration(r.value,c.projection) order by r.ordinal),'[]'::jsonb)
    from jsonb_array_elements(result) with ordinality r(value,ordinal)
    join public.school_list_collaboration(coalesce((select jsonb_agg(jsonb_build_object('key',v->>'key','student_id',v->>'studentId','lead_id',v->>'leadId')) from jsonb_array_elements(result) v),'[]'::jsonb),actor) c on c.key=r.value->>'key');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.student_stage_index_with_enrollments(p_scope text, p_search text, p_enrollments business_course_enrollment_subjects[])
 RETURNS TABLE(student_id uuid, lead_id uuid, key text, stage text, detail text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 return query select * from public.student_record_index_for_population(p_scope,p_search,p_enrollments,false);
end;$function$;

CREATE OR REPLACE FUNCTION public.read_student_stage_subject_with_enrollments(p_student_id uuid, p_lead_id uuid, p_enrollments business_course_enrollment_subjects[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 return public.read_student_record_with_enrollments(p_student_id,p_lead_id,p_enrollments);
end;$function$;

CREATE OR REPLACE FUNCTION public.list_student_records_page(p_stage text, p_scope text, p_search text, p_population text, p_page integer, p_page_size integer, p_query jsonb, p_locale text, p_labels jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); zone text; allowed text[]; enum_fields text[]; date_fields text[]; item record; kind text; sort_field text; direction text; result jsonb;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not (public.has_perm(actor,'student.view.all') or public.has_perm(actor,'student.view.assigned')
    or public.has_perm(actor,'followup.view')) then raise exception 'FORBIDDEN'; end if;
  if p_page is null or p_page<1 or p_page>1000000 or p_page_size is null or p_page_size not in (20,50,100)
    or p_locale is null or p_locale not in ('zh','en') or p_query is null or jsonb_typeof(p_query)<>'object'
    or p_query->>'version' is distinct from '2' or jsonb_typeof(p_query->'filters') is distinct from 'object'
    or pg_column_size(p_query)>32768 or p_labels is null or jsonb_typeof(p_labels)<>'object' or pg_column_size(p_labels)>32768 then raise exception 'VALIDATION'; end if;
  zone:=public.get_organization_timezone_v2();
  enum_fields:=array['grade','detail','scope','owner','group','sourceReview','sourceArrangement']; date_fields:=array['lastContactAt'];
  if p_stage not in ('awaiting_first_contact','awaiting_assessment') then
    enum_fields:=enum_fields||array['teacher','course','term','assessmentBand']; date_fields:=date_fields||array['assessmentAt'];
  end if;
  allowed:=array['name','phone','note']||enum_fields||date_fields;
  for item in select * from jsonb_each(p_query->'filters') loop
    kind:=item.value->>'kind';
    if not item.key=any(allowed) or jsonb_typeof(item.value)<>'object' or kind is null then raise exception 'VALIDATION'; end if;
    if kind='presence' then
      if item.value->>'value' is null or item.value->>'value' not in ('present','missing') then raise exception 'VALIDATION'; end if;
    elsif kind='enum' and item.key=any(enum_fields) then
      if jsonb_typeof(item.value->'values') is distinct from 'array' then raise exception 'VALIDATION'; end if;
      if jsonb_array_length(item.value->'values') not between 1 and 100 then raise exception 'VALIDATION'; end if;
      if exists(select 1 from jsonb_array_elements(item.value->'values') v where jsonb_typeof(v)<>'string' or length(v#>>'{}') not between 1 and 160) then raise exception 'VALIDATION'; end if;
    elsif kind='text' and item.key=any(array['name','phone','note']) then
      if jsonb_typeof(item.value->'query') is distinct from 'string' or length(item.value->>'query')>160 then raise exception 'VALIDATION'; end if;
    elsif kind='date' and item.key=any(date_fields) then
      if coalesce(item.value->>'from','')!~'^\d{4}-\d{2}-\d{2}$' or coalesce(item.value->>'to','')!~'^\d{4}-\d{2}-\d{2}$'
        or item.value->>'from'>item.value->>'to' then raise exception 'VALIDATION'; end if;
      begin perform (item.value->>'from')::date; perform (item.value->>'to')::date;
        exception when invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION'; end;
    else raise exception 'VALIDATION'; end if;
  end loop;
  sort_field:=p_query->'sort'->>'field'; direction:=p_query->'sort'->>'direction';
  if p_query->'sort' is distinct from 'null'::jsonb and p_query->'sort' is not null and
    (sort_field is null or not sort_field=any(allowed) or sort_field in ('note','scope') or direction is null or direction not in ('asc','desc')) then raise exception 'VALIDATION'; end if;

  if p_query->'includeFacets'='false'::jsonb and p_stage='awaiting_first_contact' and p_population='records'
    and coalesce(p_search,'')='' and (p_query->'sort' is null or p_query->'sort'='null'::jsonb)
    and ((p_query->'filters')-'scope')='{}'::jsonb
    and ((p_query->'filters'->'scope' is null and p_scope='all')
      or p_query->'filters'->'scope'=jsonb_build_object('kind','enum','values',jsonb_build_array(p_scope))) then
    with facts as materialized (select * from public.student_first_contact_page_facts(p_scope,p_page,p_page_size)),
    rows as materialized (select row_data as payload from facts where row_data is not null),
    totals as (select count(*)::integer as count,greatest(1,ceil(count(*)::numeric/p_page_size)::integer) as pages from facts where index_stage=p_stage),
    page_rows as (select payload from rows order by (payload->>'createdAt')::timestamptz desc,payload->>'key')
    select jsonb_build_object(
      'rows',coalesce((select jsonb_agg(public.student_list_row_permissions(payload,actor,
        (select public.has_perm(actor,'student.view.all')),(select public.has_perm(actor,'followup.write')))
        order by (payload->>'createdAt')::timestamptz desc,payload->>'key') from page_rows),'[]'::jsonb),
      'count',t.count,'page',least(p_page,t.pages),'pageSize',p_page_size,'totalPages',t.pages,
      'counts',coalesce((select jsonb_object_agg(index_stage,n) from(select index_stage,count(*) n from facts group by index_stage) c),'{}'::jsonb),
      'facets','{}'::jsonb) into result from totals t;
    return result;
  end if;
  with facts as materialized (select * from public.student_list_base_facts(p_scope,p_search,p_population,p_stage)),
  rows as materialized (select row_data as payload,row_data->>'key' as key,(row_data->>'createdAt')::timestamptz as created_at,
    row_number() over(order by (row_data->>'createdAt')::timestamptz desc,row_data->>'key') as default_ordinal from facts where row_data is not null),
  required_fields as materialized (
    select unnest(enum_fields||date_fields) as id
    union select jsonb_object_keys(p_query->'filters') union select sort_field where sort_field is not null
  ), field_values as materialized (
    select r.key,v.fields from rows r cross join lateral (
      select jsonb_object_agg(f.id,public.student_list_field(r.payload,f.id,p_labels,actor,zone)) as fields
        from required_fields f
    ) v
  ), evaluated as materialized (
    select r.key,r.created_at,r.default_ordinal,f.fields,array(select filter.key from jsonb_each(p_query->'filters') filter
      where not public.student_list_field_matches(f.fields->filter.key,filter.value)) as misses
      from rows r join field_values f using(key)
  ), filtered as materialized (select * from evaluated where cardinality(misses)=0),
  totals as (select count(*)::integer as count,greatest(1,ceil(count(*)::numeric/p_page_size)::integer) as pages from filtered),
  ordered as (
    select f.*,row_number() over(order by
      case when sort_field is not null then coalesce((fields->sort_field->>'sortMissing')::boolean,(fields->sort_field->>'missing')::boolean,true) end,
      case when sort_field=any(date_fields) and direction='asc' then (fields->sort_field->>'sort')::numeric end asc,
      case when sort_field=any(date_fields) and direction='desc' then (fields->sort_field->>'sort')::numeric end desc,
      case when not sort_field=any(date_fields) and direction='asc' and p_locale='zh' then fields->sort_field->>'sort' end collate public.student_list_sort_zh asc,
      case when not sort_field=any(date_fields) and direction='desc' and p_locale='zh' then fields->sort_field->>'sort' end collate public.student_list_sort_zh desc,
      case when not sort_field=any(date_fields) and direction='asc' and p_locale='en' then fields->sort_field->>'sort' end collate public.student_list_sort_en asc,
      case when not sort_field=any(date_fields) and direction='desc' and p_locale='en' then fields->sort_field->>'sort' end collate public.student_list_sort_en desc,
      created_at desc,key) as ordinal from filtered f
  ), page_keys as materialized (
    select key,ordinal from ordered order by ordinal limit p_page_size offset (least(p_page,(select pages from totals))-1)*p_page_size
  ), page_rows as materialized (
    select public.student_list_row_permissions(r.payload,actor,
      (select public.has_perm(actor,'student.view.all')),(select public.has_perm(actor,'followup.write'))) as payload,p.ordinal
      from page_keys p join rows r using(key)
  ),
  all_options as materialized (
    select distinct on(f.id,v.value) f.id,v.value,
      coalesce(p_labels->f.id->>v.value,case when f.id='group' then (select name from public.school_business_groups where id::text=v.value)
          when f.id in ('owner','teacher') then (select display_name from public.profiles where id::text=v.value) end,e.fields->f.id->>'label',v.value) as label
      from evaluated e cross join unnest(enum_fields) f(id) cross join lateral jsonb_array_elements_text(e.fields->f.id->'values') v(value)
      order by f.id,v.value,e.created_at desc,e.key
  ), available_option_refs as (
    select f.id,v.value,e.default_ordinal as ordinal from evaluated e cross join unnest(enum_fields) f(id)
      cross join lateral jsonb_array_elements_text(e.fields->f.id->'values') v(value) where e.misses<@array[f.id]
    union all select f.key,v.value,(select count(*) from evaluated)+v.ordinal from jsonb_each(p_query->'filters') f cross join lateral
      jsonb_array_elements_text(case when f.value->>'kind'='enum' then f.value->'values' else '[]'::jsonb end) with ordinality v(value,ordinal)
  ), available_options as (
    select id,value,min(ordinal) as ordinal from available_option_refs group by id,value
  ), option_facets as (
    select f.id,jsonb_build_object('options',coalesce(jsonb_agg(jsonb_build_object('value',a.value,'label',coalesce(o.label,a.value)) order by a.ordinal,a.value)
      filter(where a.value is not null),'[]'::jsonb),'days','[]'::jsonb) as data
      from unnest(enum_fields) f(id) left join available_options a on a.id=f.id left join all_options o on o.id=a.id and o.value=a.value group by f.id
  ), date_facets as (
    select f.id,jsonb_build_object('options','[]'::jsonb,'days',coalesce(jsonb_agg(distinct e.fields->f.id->>'day' order by e.fields->f.id->>'day' desc)
      filter(where e.fields->f.id->>'day' is not null),'[]'::jsonb)) as data
      from unnest(date_fields) f(id) left join evaluated e on e.misses<@array[f.id] group by f.id
  ) select jsonb_build_object('rows',coalesce((select jsonb_agg(payload order by ordinal) from page_rows),'[]'::jsonb),
    'count',t.count,'page',least(p_page,t.pages),'pageSize',p_page_size,'totalPages',t.pages,
    'counts',coalesce((select jsonb_object_agg(index_stage,n) from(select index_stage,count(*) n from facts group by index_stage) c),'{}'::jsonb),
    'facets',(select jsonb_object_agg(id,data) from(select * from option_facets union all select * from date_facets
      union all select id,jsonb_build_object('options','[]'::jsonb,'days','[]'::jsonb) from unnest(array['name','phone','note']) id) f))
    into result from totals t;
  return result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.student_list_field(p_row jsonb, p_field text, p_labels jsonb, p_actor uuid, p_zone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare value text; label text; sort_value jsonb; values jsonb; day text; moment timestamptz;
begin
  case p_field
    when 'name','phone','note' then
      value:=coalesce(p_row->>p_field,''); label:=value; sort_value:=to_jsonb(value);
      return jsonb_build_object('text',value,'sort',sort_value,'missing',public.student_list_is_blank(value));
    when 'grade' then
      value:=case when coalesce((p_row->>'grade')::integer,0)<>0 then p_row->>'grade' else p_row->>'gradeText' end;
      label:=coalesce(nullif(p_row->>'gradeText',''),p_row->>'grade',''); sort_value:=coalesce(nullif(p_row->'grade','null'::jsonb),p_row->'gradeText');
    when 'sourceReview' then value:=case when coalesce((p_row->>'sourceReviewCount')::integer,0)>0 then 'required' else 'clear' end; label:=coalesce(p_labels->p_field->>value,value); sort_value:=to_jsonb(label);
      when 'sourceArrangement' then value:=case when nullif(p_row->>'sourceArrangement','') is not null then 'planned' else 'none' end; label:=coalesce(p_labels->p_field->>value,value); sort_value:=to_jsonb(label);
      when 'detail' then
      value:=p_row->>'detail'; label:=coalesce(p_labels->'detail'->>value,value); sort_value:=to_jsonb(label);
    when 'owner','teacher' then

      value:=case when p_field='owner' and coalesce(p_row->>'ownerName','')='' then null else coalesce(nullif(p_row->>(p_field||'Id'),''),case when nullif(p_row->>(p_field||'Name'),'') is not null then 'source:'||(p_row->>(p_field||'Name')) end) end;
      label:=coalesce(nullif(p_row->>(p_field||'Name'),''),value); sort_value:=to_jsonb(nullif(p_row->>(p_field||'Name'),''));
    when 'course' then value:=p_row->>'courseId'; label:=coalesce(nullif(p_row->>'courseTitle',''),value); sort_value:=to_jsonb(label);
    when 'term' then value:=p_row->>'termId'; label:=coalesce(nullif(p_row->>'termName',''),value); sort_value:=to_jsonb(label);
    when 'assessmentBand' then value:=p_row->>'assessmentBand'; label:=replace(upper(value),'_PLUS','+'); sort_value:=to_jsonb(label);
    when 'group' then
      values:=coalesce((select jsonb_agg(g->>'id') from jsonb_array_elements(p_row->'groups') g),'[]'::jsonb);
      label:=(select string_agg(g->>'name','、' order by g->>'name') from jsonb_array_elements(p_row->'groups') g);
      return jsonb_build_object('values',values,'label',label,'sort',label,'missing',jsonb_array_length(values)=0);
    when 'scope' then
      values:=jsonb_build_array('all');
      if coalesce((p_row->>'inMyGroups')::boolean,false) then values:=values||jsonb_build_array('group'); end if;
      if coalesce((p_row->>'isParticipant')::boolean,p_row->>'ownerId'=p_actor::text,false) then values:=values||jsonb_build_array('mine');
      end if; if p_row->>'ownerId' is null then values:=values||jsonb_build_array('unassigned'); end if;
      return jsonb_build_object('values',values,'missing',false);
    when 'assessmentAt','lastContactAt' then
      value:=p_row->>p_field;
      if nullif(value,'') is not null then
        begin
          if value ~ '^\d{4}-\d{2}-\d{2}$' then day:=value; moment:=(value::date::timestamp at time zone p_zone);
          else moment:=value::timestamptz; day:=(moment at time zone p_zone)::date::text; end if;
        exception when invalid_datetime_format or datetime_field_overflow then day:=null; moment:=null; end;
      end if;
      return jsonb_build_object('day',day,'sort',extract(epoch from moment)*1000,'missing',day is null);
    else raise exception 'VALIDATION';
  end case;
  return jsonb_build_object('values',case when nullif(value,'') is null then '[]'::jsonb else jsonb_build_array(value) end,
    'label',label,'sort',sort_value,'missing',nullif(value,'') is null,
    'sortMissing',sort_value is null or sort_value='null'::jsonb or public.student_list_is_blank(sort_value#>>'{}'));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_imported_lead_contact_status(p_lead_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  update public.leads l set status='contacted' where l.id=p_lead_id and l.status in ('unassigned','uncontacted') and (
    exists(select 1 from public.business_lead_communications c left join lateral (
      select effective_patch from public.communication_record_revisions v where v.source='contact' and v.event_id=c.id order by v.revision_no desc limit 1
    ) revision on true where c.lead_id=l.id and public.school_contact_is_effective(to_jsonb(c),revision.effective_patch))
    or exists(select 1 from public.business_activity_registrations r join public.business_activities a on a.id=r.activity_id
      where (r.lead_id=l.id or l.student_id is not null and r.student_id=l.student_id)
        and r.status='attended' and a.deleted_at is null));
end;
$function$
;
