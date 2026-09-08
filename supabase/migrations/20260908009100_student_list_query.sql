-- 列表在一次请求中汇总所需事实，登记上下文通过已有单人入口按需读取。
create function public.student_list_facts(p_scope text,p_search text,p_population text,p_stage text)
returns table(row_data jsonb,index_stage text) language plpgsql stable security definer set search_path=public,pg_temp as $$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); view_all boolean; view_followup boolean; write_followup boolean; today date; zone text;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not (public.has_perm(actor,'student.view.all') or public.has_perm(actor,'student.view.assigned')
    or public.has_perm(actor,'followup.view')) then raise exception 'FORBIDDEN'; end if;
  if p_scope is null or p_scope not in ('all','mine','unassigned') or p_population is null or p_population not in ('work','records')
    or p_stage is null or p_stage not in ('awaiting_first_contact','awaiting_assessment','awaiting_enrollment','awaiting_renewal','former_student')
    or length(coalesce(p_search,''))>80 then raise exception 'VALIDATION'; end if;
  view_all:=public.has_perm(actor,'student.view.all'); view_followup:=public.has_perm(actor,'followup.view');
  write_followup:=public.has_perm(actor,'followup.write'); zone:=public.get_organization_timezone_v2(); today:=(now() at time zone zone)::date;
  return query with
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
  identities as materialized (
    select 'student:'||s.id as key,s.id as student_id,null::uuid as original_lead_id,s.created_at,s.assigned_to as owner_id
    from public.students s where s.deleted_at is null and (view_all or public.can_access_student(s.id,actor))
      and (p_scope='all' or p_scope='mine' and s.assigned_to=actor or p_scope='unassigned' and s.assigned_to is null)
      and (coalesce(p_search,'')='' or s.id::text=p_search or position(lower(p_search) in lower(s.name||' '||s.school||' '||s.phone||' '||s.parent_phone))>0
        or length(regexp_replace(p_search,'\D','','g'))>=3 and position(regexp_replace(p_search,'\D','','g') in regexp_replace(s.phone||' '||s.parent_phone,'\D','','g'))>0)
    union all
    select 'lead:'||l.id,null,l.id,l.created_at,l.owner_id from public.leads l
    where l.student_id is null and view_followup and (l.owner_id is null or l.owner_id=actor or view_all)
      and (p_scope='all' or p_scope='mine' and l.owner_id=actor or p_scope='unassigned' and l.owner_id is null)
      and (coalesce(p_search,'')='' or l.id::text=p_search or position(lower(p_search) in lower(l.provisional_student_name||' '||l.phone))>0
        or length(regexp_replace(p_search,'\D','','g'))>=3 and position(regexp_replace(p_search,'\D','','g') in l.phone_normalized)>0)
  ), lead_refs as materialized (
    select s.key,l.*,view_followup and (l.owner_id is null or l.owner_id=actor or view_all) as visible
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
      where r.source_enrollment_facts @> '{"confirmed":true}'::jsonb group by ref.key
  ), memberships as materialized (
    select s.key,e.classroom_id,e.status='active' and e.left_at is null and (t.ends_on is null or t.ends_on>=today) as active
      from subjects s join public.enrollments e on e.student_id=s.student_id join public.classrooms c on c.id=e.classroom_id
      left join public.school_terms t on t.id=c.term_id
  ), membership_flags as (select key,bool_or(active) as active from memberships group by key),
  contacts as materialized (
    select l.key,l.visible,c.id,c.source_record_id,c.occurred_at,coalesce(r.effective_patch->>'note',c.note) as note,
      coalesce(r.effective_patch->>'outcome',c.outcome) as outcome from lead_refs l join subjects s using(key)
      join public.business_lead_communications c on c.lead_id=l.id left join lateral (
        select effective_patch from public.communication_record_revisions r where r.source='contact' and r.event_id=c.id order by revision_no desc limit 1
      ) r on true
  ), contact_flags as (select key from contacts where outcome in ('connected','declined') group by key),
  latest_contacts as (select distinct on(key) key,id,source_record_id,occurred_at,note,outcome from contacts where visible order by key,occurred_at desc,id),
  completed_assessments as materialized (
    select a.id,a.student_id,a.lead_id,a.source_record_id,a.activity_registration_id,a.score,a.assessment_band,a.assessed_by,a.updated_at,
      r.student_id as registration_student_id,r.lead_id as registration_lead_id,r.source_record_id as registration_source_id,
      coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) as completed_at,
      coalesce(a.assessed_on,(coalesce(r.assessment_completed_at,a.result_finalized_at) at time zone zone)::date,
        act.occurred_on,(act.scheduled_at at time zone zone)::date) as assessed_on,
      nullif(substring(a.strengths from '(?:^|[\r\n])学习力测评等级：([^\r\n]+)'),'') as learning_band,act.deleted_at,act.id as activity_id
    from public.business_assessment_results a join registrations r on r.id=a.activity_registration_id
      left join public.business_activities act on act.id=r.activity_id
    where r.status not in ('no_show','cancelled') and (r.assessment_completed_at is not null or a.result_finalized_at is not null
      or a.result_source='legacy' and (a.score is not null or a.assessment_band is not null or a.strengths ~ '(^|[\r\n])(原测评等级|学习力测评等级)：'))
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
  ), listed as materialized (select * from stages where coalesce(p_search,'')<>'' or stage=p_stage),
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
    union select l.key,h.id from lead_refs l join listed s using(key) join public.history_import_records h on h.lead_id=l.id
    union select s.key,a.record_id from listed s join public.history_import_associations a on a.student_id=s.student_id
    union select l.key,l.source_record_id from lead_refs l join listed s using(key) where l.source_record_id is not null
    union select l.key,c.source_record_id from lead_refs l join listed s using(key) join public.lead_communications c on c.lead_id=l.id where c.source_record_id is not null
    union select s.key,r.source_record_id from listed s join public.activity_registrations r on r.student_id=s.student_id where r.source_record_id is not null
    union select l.key,r.source_record_id from lead_refs l join listed s using(key) join public.activity_registrations r on r.lead_id=l.id where r.source_record_id is not null
    union select s.key,a.source_record_id from listed s join public.assessment_results a on a.student_id=s.student_id where a.source_record_id is not null
    union select l.key,a.source_record_id from lead_refs l join listed s using(key) join public.assessment_results a on a.lead_id=l.id where a.source_record_id is not null
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
      'stage',s.stage,'detail',case s.stage when 'awaiting_first_contact' then case when l.status='invalid' then 'invalid_number'
        when coalesce(st.assigned_to,l.owner_id) is null then 'unassigned' when lc.outcome='unreachable' then 'unreachable' else 'not_contacted' end
        when 'awaiting_assessment' then case when i.kind='assessment_1v1' and i.state='confirmed' then 'booked' when i.kind='assessment_1v1' then 'coordinating'
          when a.status='no_show' then 'no_show' when a.status='cancelled' then 'cancelled' when a.status='attended' or a.assessment_started_at is not null then 'in_progress'
          when a.status='booked' then 'booked' else 'not_booked' end
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
      'createdAt',s.created_at,'canWrite',write_followup and (s.student_id is not null or l.owner_id is not null and (l.owner_id=actor or view_all)),
      'canContact',write_followup and (l.id is not null and l.owner_id is not null and l.status not in ('invalid','converted') and (l.owner_id=actor or view_all)
        or l.id is null and s.student_id is not null and (st.assigned_to=actor or view_all))) as payload
    from listed s left join public.students st on st.id=s.student_id left join public.leads l on l.id=s.lead_id
      left join public.profiles p on p.id=coalesce(st.assigned_to,l.owner_id) left join backgrounds b using(key) left join teacher_ids ti on ti.display_name=b.teacher_name
      left join latest_contacts lc using(key) left join notes n using(key) left join latest_enrollments e using(key) left join opportunities o using(key)
      left join appointments a using(key) left join invitations i using(key) left join latest_assessments ca using(key)
      left join public.assessment_workflow_states w on w.registration_id=s.registration_id
      left join public.courses ec on ec.id=e.course_id left join public.courses oc on oc.id=o.course_id
      left join public.school_terms et on et.id=e.term_id left join public.school_terms ot on ot.id=o.term_id
      left join candidate_counts cc using(key) left join inferred inf using(key)
  ) select r.payload,r.stage from rows r
    union all select null::jsonb,s.stage from stages s where not (coalesce(p_search,'')<>'' or s.stage=p_stage);
end;
$$;
revoke all on function public.student_list_facts(text,text,text,text) from public,anon,authenticated,service_role;

-- 与列表现有的自然数字、忽略大小写/重音排序保持相同的语言设置。
create collation public.student_list_sort_zh (provider=icu,locale='zh-u-kn-true-ks-level1',deterministic=false);
create collation public.student_list_sort_en (provider=icu,locale='en-u-kn-true-ks-level1',deterministic=false);

create function public.student_list_field(p_row jsonb,p_field text,p_labels jsonb,p_actor uuid,p_zone text)
returns jsonb language plpgsql immutable set search_path=public,pg_temp as $$
declare value text; label text; sort_value jsonb; values jsonb; day text; moment timestamptz;
begin
  case p_field
    when 'name','phone','note' then
      value:=coalesce(p_row->>p_field,''); label:=value; sort_value:=to_jsonb(value);
      return jsonb_build_object('text',value,'sort',sort_value,'missing',btrim(value)='');
    when 'grade' then
      value:=case when coalesce((p_row->>'grade')::integer,0)<>0 then p_row->>'grade' else p_row->>'gradeText' end;
      label:=coalesce(nullif(p_row->>'gradeText',''),p_row->>'grade',''); sort_value:=coalesce(nullif(p_row->'grade','null'::jsonb),p_row->'gradeText');
    when 'detail' then
      value:=p_row->>'detail'; label:=coalesce(p_labels->'detail'->>value,value); sort_value:=to_jsonb(label);
    when 'owner','teacher' then
      value:=coalesce(nullif(p_row->>(p_field||'Id'),''),case when nullif(p_row->>(p_field||'Name'),'') is not null then 'source:'||(p_row->>(p_field||'Name')) end);
      label:=coalesce(nullif(p_row->>(p_field||'Name'),''),value); sort_value:=to_jsonb(nullif(p_row->>(p_field||'Name'),''));
    when 'course' then value:=p_row->>'courseId'; label:=coalesce(nullif(p_row->>'courseTitle',''),value); sort_value:=to_jsonb(label);
    when 'term' then value:=p_row->>'termId'; label:=coalesce(nullif(p_row->>'termName',''),value); sort_value:=to_jsonb(label);
    when 'assessmentBand' then value:=p_row->>'assessmentBand'; label:=replace(upper(value),'_PLUS','+'); sort_value:=to_jsonb(label);
    when 'scope' then
      values:=jsonb_build_array('all');
      if p_row->>'ownerId'=p_actor::text then values:=values||jsonb_build_array('mine');
      elsif p_row->>'ownerId' is null then values:=values||jsonb_build_array('unassigned'); end if;
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
    'sortMissing',sort_value is null or sort_value='null'::jsonb or btrim(sort_value#>>'{}')='');
end;
$$;

create function public.student_list_field_matches(p_value jsonb,p_filter jsonb)
returns boolean language sql immutable set search_path=public,pg_temp as $$
  select coalesce(case p_filter->>'kind'
    when 'presence' then (p_value->>'missing')::boolean=(p_filter->>'value'='missing')
    when 'text' then position(lower(p_filter->>'query') in lower(coalesce(p_value->>'text','')))>0
    when 'enum' then p_value->'values' ?| array(select jsonb_array_elements_text(p_filter->'values'))
    when 'date' then p_value->>'day'>=p_filter->>'from' and p_value->>'day'<=p_filter->>'to'
    else false end,false);
$$;
revoke all on function public.student_list_field(jsonb,text,jsonb,uuid,text),public.student_list_field_matches(jsonb,jsonb) from public,anon,authenticated,service_role;

create function public.list_student_records_page(p_stage text,p_scope text,p_search text,p_population text,
  p_page integer,p_page_size integer,p_query jsonb,p_locale text,p_labels jsonb)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
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
  enum_fields:=array['grade','detail','scope','owner']; date_fields:=array['lastContactAt'];
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
  with facts as materialized (select * from public.student_list_facts(p_scope,p_search,p_population,p_stage)),
  rows as materialized (select row_data as payload,row_data->>'key' as key,(row_data->>'createdAt')::timestamptz as created_at,
    row_number() over(order by (row_data->>'createdAt')::timestamptz desc,row_data->>'key') as default_ordinal from facts where row_data is not null),
  required_fields as materialized (
    select unnest(enum_fields||date_fields) as id
    union select jsonb_object_keys(p_query->'filters') union select sort_field where sort_field is not null
  ), field_values as materialized (
    select r.key,jsonb_object_agg(f.id,public.student_list_field(r.payload,f.id,p_labels,actor,zone)) as fields
      from rows r cross join required_fields f group by r.key
  ), evaluated as materialized (
    select r.*,f.fields,array(select filter.key from jsonb_each(p_query->'filters') filter
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
  ), page_rows as (select * from ordered order by ordinal limit p_page_size offset (least(p_page,(select pages from totals))-1)*p_page_size),
  all_options as materialized (
    select distinct on(f.id,v.value) f.id,v.value,
      coalesce(p_labels->f.id->>v.value,e.fields->f.id->>'label',v.value) as label
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
$$;
revoke all on function public.list_student_records_page(text,text,text,text,integer,integer,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.list_student_records_page(text,text,text,text,integer,integer,jsonb,text,jsonb) to authenticated;
notify pgrst,'reload schema';
