-- 与 JavaScript trim 保持一致，包含制表符、换行和 Unicode 空白。
create or replace function public.assessment_list_trim(p_value text) returns text
language sql immutable set search_path=public,pg_temp as $$
  select btrim(p_value,E'\t\n\r '||chr(11)||chr(12)||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;
revoke all on function public.assessment_list_trim(text) from public,anon;
grant execute on function public.assessment_list_trim(text) to authenticated;

-- 测评列表在数据库内完成可见范围、筛选和分页。所有关系继续以调用者身份执行 RLS。
-- 列表不读取逐题备注、来源完成历史和操作人历史；展开时按具体身份读取。
create or replace function public.assessment_list_notes(variadic p_values text[]) returns text
language sql immutable set search_path=public,pg_temp as $$
  select coalesce(string_agg(line,E'\n' order by ordinal),'') from (
    select public.assessment_list_trim(line) as line,min(ordinal) as ordinal
    from unnest(string_to_array(array_to_string(p_values,E'\n'),E'\n')) with ordinality t(line,ordinal)
    where public.assessment_list_trim(line)<>'' group by public.assessment_list_trim(line)
  ) n;
$$;

create or replace function public.assessment_list_source_name(p_note text) returns text
language sql immutable set search_path=public,pg_temp as $$
  select case when count(distinct name)=1 then min(name) else '' end from (
    select nullif(public.assessment_list_trim(substr(line,6)),'') as name from unnest(string_to_array(p_note,E'\n')) line where line like '学服老师：%'
  ) n;
$$;

create or replace function public.assessment_list_rows(p_state text default 'current') returns table(payload jsonb,assessment_at timestamptz)
language plpgsql stable security invoker set search_path=public,pg_temp set plan_cache_mode=force_custom_plan as $$
declare selected_activity_ids uuid[];
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not (public.has_perm(auth.uid(),'review.write') or public.has_perm(auth.uid(),'followup.view')) then raise exception 'FORBIDDEN'; end if;
  if p_state is null or p_state not in ('current','historical','all') then raise exception 'VALIDATION'; end if;
  -- 先将当前/历史范围解析为稳定键，让后续连接获得真实基数，避免权限视图的低估变成平方次嵌套循环。
  select coalesce(array_agg(id),'{}'::uuid[]) into selected_activity_ids from public.business_activities
    where deleted_at is null and (p_state='all' or record_state=p_state);
  return query
  with activities as materialized (
    select id,kind,title,scheduled_at,occurred_on,record_state,location,remark,source_invitation_id,rescheduled_at
      from public.business_activities where id=any(selected_activity_ids)
  ), registrations as materialized (
    select r.id,r.activity_id,r.student_id,r.lead_id,r.source_record_id,r.source_enrollment_facts,r.status,r.outcome,
      r.assessment_paper_version_id,r.assessment_started_at,r.assessment_completed_at,r.updated_at
      from public.business_activity_registrations r join activities a on a.id=r.activity_id
  ), invitations as materialized (
    select i.* from public.lead_invitation_threads i where i.id in (select source_invitation_id from activities)
      or p_state<>'historical' and i.kind='assessment_1v1' and i.state in ('confirmed','cancelled') and i.scheduled_at is not null
  ), leads as materialized (
    select l.* from public.leads l where l.id in (select lead_id from registrations union select lead_id from invitations)
  ), students as materialized (
    select s.* from public.students s where s.id in (select student_id from registrations union select student_id from leads)
  ), results as materialized (
    select r.* from public.business_assessment_results r where r.activity_registration_id in(select id from registrations)
  ), profiles as materialized (select id,display_name,role,is_active,account_status from public.profiles),
  source_ids as materialized (
    select id,(row_number() over(order by id)-1)/100 as batch from (
      select distinct r.source_record_id as id from registrations r join activities a on a.id=r.activity_id
      where r.source_record_id is not null and public.assessment_list_source_name(a.remark)=''
    ) ids
  ), source_names as materialized (
    select s.id,case when count(distinct nullif(public.assessment_list_trim(cell->>'text'),''))=1 then min(nullif(public.assessment_list_trim(cell->>'text'),'')) else '' end as name
    from (select array_agg(id) as ids from source_ids group by batch) b
      cross join lateral public.get_business_source_records(b.ids) s
      left join lateral jsonb_array_elements(coalesce(s.record_data->'cells','[]'::jsonb)) cell on cell->>'fieldName'='学服老师'
    group by s.id
  ), activity_support as materialized (
    select distinct on(a.id) a.id,coalesce(nullif(public.assessment_list_source_name(a.remark),''),s.name,'') as name
      from activities a left join registrations r on r.activity_id=a.id left join source_names s on s.id=r.source_record_id
      order by a.id,(nullif(s.name,'') is null),r.id
  ), support_names as materialized (
    select display_name,case when count(*)=1 then min(id::text)::uuid end as id from profiles
      where role in ('staff','admin') and is_active and account_status<>'locked' group by display_name
  ), versions as materialized (
    select v.id,v.question_count,v.total_score,p.title from public.assessment_paper_versions v
      left join public.assessment_papers p on p.id=v.paper_id where v.id in(select assessment_paper_version_id from registrations)
  ), question_counts as materialized (
    select q.activity_registration_id,count(*) filter(where q.outcome is not null) as answered
      from public.assessment_question_results q where q.activity_registration_id in(select id from registrations) group by q.activity_registration_id
  ), routes as materialized (
    select distinct on(r.activity_registration_id) r.*,case when e.status='active' then e.id end as enrollment_id
      from public.activity_routes r left join public.course_enrollments e on e.id=r.course_enrollment_id
      where r.activity_registration_id in(select id from registrations) order by r.activity_registration_id,r.id desc
  ), workflows as materialized (
    select w.registration_id,jsonb_build_object('id',w.id,'registrationId',w.registration_id,'stage',w.stage,'revision',w.revision,
      'arrivedAt',w.arrived_at,'report',case when report.id is not null then jsonb_build_object('id',report.id,'version',report.version,'payload',report.payload,'created_at',report.created_at) end,
      'sentReportId',w.sent_report_id,'sentAt',w.sent_at,'sentByName',coalesce(sender.display_name,''),'classification',w.classification,
      'parentResponse',w.parent_response,'reasons',w.reasons,'nextContactAt',w.next_contact_at,'trialIntent',w.trial_intent,'contactedAt',w.contacted_at,
      'finalizedAt',w.finalized_at,'revisionReason',w.revision_reason,'updatedAt',w.updated_at,'updatedByName',coalesce(recorder.display_name,'')) as data,w.updated_at
      from public.assessment_workflow_states w left join public.assessment_reports report on report.id=w.report_id
      left join profiles sender on sender.id=w.sent_by left join profiles recorder on recorder.id=w.updated_by
      where w.registration_id in(select id from registrations)
  ), quick_entries as materialized (
    select q.registration_id,jsonb_build_object('id',q.id,'values',q.entry,'revision',q.revision,'recordedBy',q.recorded_by,
      'recordedByName',coalesce(p.display_name,''),'updatedAt',q.updated_at,'finalizedAt',q.finalized_at) as data,q.updated_at
      from public.assessment_quick_entries q left join profiles p on p.id=q.recorded_by where q.registration_id in(select id from registrations)
  ), followups as materialized (
    select distinct on(f.student_id) f.student_id,jsonb_build_object('id',f.id,'content',f.content,'kind',f.kind,'createdAt',f.created_at,
      'nextFollowUpAt',f.next_follow_up_at,'statusAfter',f.status_after) as data
      from public.business_student_follow_ups f where f.record_state<>'historical'
      and f.student_id in(select student_id from registrations union select student_id from leads)
      order by f.student_id,f.created_at desc,f.id
  ), base as materialized (
    select r.id as registration_id,a.id as activity_id,a.kind,a.source_invitation_id,
      coalesce(a.scheduled_at,coalesce(result.assessed_on,a.occurred_on)::timestamp at time zone public.get_organization_timezone_v2()) as assessment_at,
      jsonb_build_object(
        'id',case when a.source_invitation_id is not null then 'invitation:'||a.source_invitation_id else 'registration:'||r.id end,
        'assessmentKind',case when a.kind='assessment_1v1' then 'one_to_one' else 'activity' end,'activityId',a.id,'activityTitle',a.title,
        'publicClassRecord',null,'invitationId',a.source_invitation_id,'registrationId',r.id,'enrollmentId',route.enrollment_id,
        'paperVersionId',r.assessment_paper_version_id,'sourceRecordId',r.source_record_id,
        'sourceEnrollmentFacts',case when r.source_enrollment_facts @> '{"version":1,"confirmed":true}' then r.source_enrollment_facts end,
        'studentId',coalesce(r.student_id,l.student_id),'leadId',r.lead_id,'name',coalesce(s.name,l.provisional_student_name,'-'),
        'phone',coalesce(nullif(s.parent_phone,''),nullif(s.phone,''),l.phone,''),'grade',coalesce(s.grade,l.grade_hint),'gradeText',coalesce(l.grade_text,''),
        'scheduledAt',coalesce(to_jsonb(a.scheduled_at),'""'::jsonb),'rescheduledAt',greatest(a.rescheduled_at,i.rescheduled_at),
        'recordState',a.record_state,'occurredOn',coalesce(result.assessed_on,a.occurred_on),'location',a.location,
        'assessorId',case when completed.value and actual.id is not null then actual.id else coalesce(i.assessor_id,actual.id) end,
        'assessorName',case when completed.value and nullif(actual.display_name,'') is not null then actual.display_name else coalesce(nullif(assigned.display_name,''),actual.display_name,'') end,
        'assessorSource',case when completed.value and nullif(actual.display_name,'') is not null then 'actual' else 'assigned' end,
        'supportOwnerId',owner.id,'supportOwnerName',coalesce(nullif(owner_profile.display_name,''),support.name,''),
        'background',public.assessment_list_notes(i.summary,r.outcome,a.remark,s.remark),'participationStatus',r.status,
        'assessmentStartedAt',r.assessment_started_at,'assessmentCompletedAt',r.assessment_completed_at,
        'assessment',case when result.id is not null then jsonb_build_object('id',result.id,'assessmentBand',case when result.assessment_band='below_a' then 'x_plus' else result.assessment_band end,
          'score',result.score,'scoreMax',result.score_max,'strengths',public.assessment_list_notes(result.strengths,case when result.assessment_band='below_a' then '原测评等级：未达A' end),
          'focusAreas',result.focus_areas,'parentConcerns',result.parent_concerns,'teacherRecommendation',result.teacher_recommendation,'recommendedClass',result.recommended_class,
          'teacherObservation',result.teacher_observation,'updatedAt',result.updated_at,'resultSource',result.result_source,'finalizedAt',result.result_finalized_at,'recordedByName',coalesce(recorder.display_name,'')) end,
        'quickEntry',quick.data,'workflow',workflow.data,'teacherRequired',(select public.is_feature_enabled('assessment.require_teacher_completion')),
        'questionSummary',case when version.id is not null then jsonb_build_object('paperVersionId',version.id,'paperTitle',coalesce(version.title,''),'answeredCount',coalesce(q.answered,0),
          'questionCount',version.question_count,'totalScore',version.total_score,'outcomeCounts','{}'::jsonb,'keyNotes','[]'::jsonb) end,
        'route',case when route.id is not null then jsonb_build_object('id',route.id,'route',route.route,'note',route.note,'updatedAt',route.updated_at) end,
        'latestFollowUp',f.data,'updatedAt',greatest(result.updated_at,route.updated_at,quick.updated_at,workflow.updated_at,r.updated_at),'listSummary',true
      ) as payload
    from registrations r join activities a on a.id=r.activity_id
      left join invitations i on i.id=a.source_invitation_id left join students s on s.id=r.student_id left join leads l on l.id=coalesce(r.lead_id,i.lead_id)
      left join students linked on linked.id=l.student_id left join results result on result.activity_registration_id=r.id
      left join profiles actual on actual.id=result.assessed_by and result.result_source<>'quick_entry'
      left join profiles recorder on recorder.id=result.assessed_by left join profiles assigned on assigned.id=i.assessor_id
      left join activity_support support on support.id=a.id left join support_names named on named.display_name=support.name
      cross join lateral (select coalesce(s.assigned_to,linked.assigned_to,l.owner_id,named.id) as id) owner
      left join profiles owner_profile on owner_profile.id=owner.id left join versions version on version.id=r.assessment_paper_version_id
      left join question_counts q on q.activity_registration_id=r.id left join routes route on route.activity_registration_id=r.id
      left join workflows workflow on workflow.registration_id=r.id left join quick_entries quick on quick.registration_id=r.id left join followups f on f.student_id=r.student_id
      cross join lateral (select r.assessment_completed_at is not null or result.id is not null and result.result_source<>'quick_entry' and r.assessment_started_at is null
        and (r.source_record_id is null or r.status='attended' and (result.assessment_band is not null or result.score is not null
          or result.strengths ~ '(原测评等级|学习力测评等级)：' or result.result_source='legacy' and public.assessment_list_trim(concat(result.strengths,result.focus_areas,result.parent_concerns,result.teacher_recommendation,result.teacher_observation))<>'')) as value) completed
  ), segments as materialized (
    select b.registration_id,s.scheduled_at as assessment_at,b.payload||jsonb_build_object('id','segment:'||s.id||':'||b.registration_id,
      'scheduledAt',s.scheduled_at,'location',coalesce(nullif(s.location,''),b.payload->>'location'),'assessorId',s.primary_teacher_id,
      'assessorName',coalesce(p.display_name,b.payload->>'assessorName'),'assessorSource','assigned','assessmentStartedAt',null,
      'assessmentCompletedAt',case when public.assessment_list_trim(coalesce(r.assessment_summary,''))<>'' then r.updated_at end,
      'assessment',case when public.assessment_list_trim(coalesce(r.assessment_summary,''))<>'' then jsonb_build_object('id',r.id,'assessmentBand',null,'score',null,
        'strengths',r.learning_observation,'focusAreas','','parentConcerns',r.parent_feedback,'teacherRecommendation',r.recommendation,'recommendedClass','',
        'teacherObservation',r.assessment_summary,'updatedAt',r.updated_at) end,'questionSummary',null,
      'publicClassRecord',jsonb_build_object('id',r.id,'segmentId',s.id,'segmentTitle',s.title,'studentPresence',coalesce(r.student_presence,case when s.kind='parent_talk' then 'not_applicable' else 'expected' end),
        'guardianPresence',coalesce(r.guardian_presence,case when s.kind='parent_talk' then 'expected' else 'not_applicable' end),'learningObservation',coalesce(r.learning_observation,''),
        'assessmentSummary',coalesce(r.assessment_summary,''),'parentFeedback',coalesce(r.parent_feedback,''),'recommendation',coalesce(r.recommendation,'')),
      'updatedAt',coalesce(to_jsonb(r.updated_at),b.payload->'updatedAt')) as payload
      from base b join public.public_class_segments s on s.activity_id=b.activity_id and b.kind='public_class'
      left join public.public_class_participant_records r on r.segment_id=s.id and r.registration_id=b.registration_id
      left join profiles p on p.id=s.primary_teacher_id where s.kind='group_assessment' or public.assessment_list_trim(coalesce(r.assessment_summary,''))<>''
  ), pending as (
    select jsonb_build_object('id','invitation:'||i.id,'assessmentKind','one_to_one','activityId',null,'activityTitle','','publicClassRecord',null,
      'invitationId',i.id,'registrationId',null,'studentId',l.student_id,'leadId',l.id,'name',l.provisional_student_name,'phone',l.phone,'grade',l.grade_hint,'gradeText',l.grade_text,
      'scheduledAt',i.scheduled_at,'rescheduledAt',i.rescheduled_at,'location',i.location_text,'assessorId',i.assessor_id,'assessorName',coalesce(p.display_name,''),'assessorSource','assigned',
      'supportOwnerId',coalesce(s.assigned_to,l.owner_id),'supportOwnerName',coalesce(owner.display_name,''),'background',i.summary,
      'participationStatus',case when i.state='cancelled' then 'cancelled' else 'booked' end,'assessmentStartedAt',null,'assessmentCompletedAt',null,'assessment',null,
      'teacherRequired',(select public.is_feature_enabled('assessment.require_teacher_completion')),'quickEntry',null,'questionSummary',null,'route',null,'latestFollowUp',f.data,'updatedAt',i.updated_at,'listSummary',true) as payload,i.scheduled_at as assessment_at
      from invitations i join leads l on l.id=i.lead_id left join students s on s.id=l.student_id left join profiles owner on owner.id=coalesce(s.assigned_to,l.owner_id)
      left join profiles p on p.id=i.assessor_id left join followups f on f.student_id=l.student_id
      where p_state<>'historical' and i.kind='assessment_1v1' and i.state in ('confirmed','cancelled') and i.scheduled_at is not null
      and not exists(select 1 from public.business_activities a where a.source_invitation_id=i.id and a.deleted_at is null)
  )
  select b.payload,b.assessment_at from base b where not exists(select 1 from segments s where s.registration_id=b.registration_id)
  union all select s.payload,s.assessment_at from segments s union all select p.payload,p.assessment_at from pending p;
end;
$$;

revoke all on function public.assessment_list_notes(text[]),public.assessment_list_source_name(text),public.assessment_list_rows(text) from public,anon;
grant execute on function public.assessment_list_notes(text[]),public.assessment_list_source_name(text),public.assessment_list_rows(text) to authenticated;

-- 与 assessment-table-fields 的业务值对应；标签由现有双语字段合同提供。
create or replace function public.assessment_list_fields(r jsonb,labels jsonb,zone text) returns jsonb
language plpgsql immutable set search_path=public,pg_temp as $$
declare a jsonb:=nullif(r->'assessment','null'); w jsonb:=nullif(r->'workflow','null'); q jsonb:=nullif(r->'questionSummary','null');
  final boolean; enrolled boolean; stage text; page_stage text; primary_status text; statuses text[]; decision text:=w->>'classification';
  score numeric; maximum numeric; rate numeric; paper text:=coalesce(r->>'paperVersionId',q->>'paperVersionId');
  value text; label text; sort_value jsonb; field text; vals jsonb; result jsonb:='{}'; day text; moment timestamptz; numeric_value numeric;
begin
  final:=not (r->>'sourceRecordId' is not null and r->>'participationStatus' in ('no_show','cancelled')) and (
    r->>'assessmentCompletedAt' is not null or a->>'finalizedAt' is not null or a is not null and coalesce(a->>'resultSource','legacy')='legacy'
      and r->>'assessmentStartedAt' is null and (r->>'sourceRecordId' is null or a->>'assessmentBand' is not null or a->>'score' is not null
        or a->>'strengths' ~ '(原测评等级|学习力测评等级)：' or r->>'participationStatus'='attended'
          and public.assessment_list_trim(concat(a->>'strengths',a->>'focusAreas',a->>'parentConcerns',a->>'teacherRecommendation',a->>'teacherObservation'))<>''));
  enrolled:=r->>'enrollmentId' is not null or coalesce((r->'sourceEnrollmentFacts'->>'confirmed')::boolean,false);
  stage:=case when coalesce((r->'sourceEnrollmentFacts'->>'confirmed')::boolean,false) then 'handled'
    when final then case when r->>'enrollmentId' is not null or coalesce((w->>'trialIntent')::boolean,false) or decision<>'awaiting_reply'
      or w is null and nullif(r->'route','null') is not null then 'handled' else 'feedback' end
    when w is null and nullif(r->'route','null') is not null then 'handled'
    when nullif(r->'quickEntry','null') is not null or a->>'resultSource'='teacher' or r->>'participationStatus'='attended'
      or w->>'arrivedAt' is not null or r->>'assessmentStartedAt' is not null or a is not null then 'in_progress' else 'pending' end;
  primary_status:=case when r->>'participationStatus' in ('no_show','cancelled') then r->>'participationStatus'
    when enrolled and (final or coalesce((r->'sourceEnrollmentFacts'->>'confirmed')::boolean,false)) then 'enrolled'
    when stage='pending' then 'pending' when stage='in_progress' then 'continue_entry'
    when decision<>'awaiting_reply' then decision when coalesce((w->>'trialIntent')::boolean,false) then 'trial'
    when w->>'contactedAt' is not null or decision is not null or w->'report'->>'id' is not null and w->>'sentAt' is not null and w->>'sentReportId'=w->'report'->>'id' then 'contacting'
    when stage='handled' then 'handled' when nullif(w->'report','null') is not null then 'give_feedback' else 'prepare_report' end;
  statuses:=array[primary_status];
  if r->>'participationStatus' not in ('no_show','cancelled') then
    if enrolled then statuses:=statuses||'enrolled'::text;
    else
      if decision is not null then statuses:=statuses||decision; end if;
      if coalesce((w->>'trialIntent')::boolean,false) then statuses:=statuses||'trial'::text; end if;
    end if;
    if stage='pending' and r->>'rescheduledAt' is not null then statuses:=statuses||'rescheduled'::text; end if;
  end if;
  if final then score:=(a->>'score')::numeric; end if;
  maximum:=coalesce((a->>'scoreMax')::numeric,case when a->>'resultSource'='teacher' then (q->>'totalScore')::numeric end);
  if score>=0 and maximum>0 and score<=maximum then rate:=score*100/maximum; end if;
  foreach field in array array['name','phone','grade','kind','scheduledAt','location','assessor','supportOwner','assessorSource','paper','score','scoreRate','band','progress','resultSource','conclusion','status','substatus','recordedAt'] loop
    value:=null;label:=null;sort_value:=null;vals:=null;numeric_value:=null;
    if field in ('name','phone','conclusion') then
      value:=case when field<>'conclusion' then r->>field else concat_ws(E'\n',
        nullif(case when a->>'resultSource'='quick_entry' then coalesce(nullif(a->>'teacherRecommendation',''),a->>'strengths','')
          when a->>'resultSource'='teacher' then a->>'teacherObservation'
          else coalesce(nullif(a->>'teacherObservation',''),nullif(a->>'teacherRecommendation',''),a->>'strengths','') end,''),
        nullif(a->>'strengths',''),nullif(a->>'focusAreas',''),nullif(a->>'parentConcerns','')) end;
      result:=result||jsonb_build_object(field,jsonb_build_object('text',coalesce(value,''),'sort',value,'missing',public.assessment_list_trim(coalesce(value,''))=''));
    elsif field in ('scheduledAt','recordedAt') then
      value:=case when field='scheduledAt' then coalesce(nullif(r->>'scheduledAt',''),r->>'occurredOn')
        when r->>'sourceRecordId' is not null or r->>'recordState'='historical' then r->>'occurredOn' else r->>'updatedAt' end;
      day:=null;moment:=null;
      if nullif(value,'') is not null then
        if value ~ '^\d{4}-\d{2}-\d{2}$' then day:=value;moment:=value::date::timestamp at time zone zone;
        else moment:=value::timestamptz;day:=(moment at time zone zone)::date::text; end if;
      end if;
      result:=result||jsonb_build_object(field,jsonb_build_object('day',day,'sort',extract(epoch from moment)*1000,'missing',day is null));
    elsif field in ('score','scoreRate','progress') then
      numeric_value:=case when field='score' and paper is not null and a->>'resultSource'='teacher' and rate is not null then score
        when field='scoreRate' then rate when field='progress' and (q->>'questionCount')::numeric>0 then (q->>'answeredCount')::numeric*100/(q->>'questionCount')::numeric end;
      result:=result||jsonb_build_object(field,jsonb_build_object('number',numeric_value,'sort',numeric_value,'missing',numeric_value is null));
    else
      case field
        when 'grade' then value:=nullif(r->>'grade','0');sort_value:=r->'grade';
        when 'kind' then value:=r->>'assessmentKind';
        when 'location' then value:=nullif(public.assessment_list_trim(r->>'location'),'');sort_value:=r->'location';
        when 'assessor' then value:=r->>'assessorId';label:=nullif(r->>'assessorName','');sort_value:=r->'assessorName';
        when 'supportOwner' then value:=coalesce(r->>'supportOwnerId','source:'||nullif(r->>'supportOwnerName',''));label:=nullif(r->>'supportOwnerName','');sort_value:=to_jsonb(label);
        when 'assessorSource' then value:=r->>'assessorSource';
        when 'paper' then value:=paper;label:=coalesce(nullif(q->>'paperTitle',''),labels->>'unknownPaper','')||' · '||left(paper,8);sort_value:=q->'paperTitle';
        when 'band' then value:=a->>'assessmentBand';sort_value:=to_jsonb(array_position(array['x_plus','g_plus','a','a_plus','s','c'],value)-1);
        when 'resultSource' then if a is not null then value:=coalesce(a->>'resultSource','legacy'); end if;
        when 'status' then
          page_stage:=case when w is null and (nullif(r->'route','null') is not null or stage in ('feedback','handled'))
            then case when nullif(r->'route','null') is not null then 'handled' else 'feedback' end else stage end;
          value:=case when r->>'participationStatus' in ('no_show','cancelled') then r->>'participationStatus' when r->>'recordState' is distinct from 'historical' then page_stage end;
          sort_value:=to_jsonb(case when r->>'recordState' is distinct from 'historical' then array_position(array['pending','in_progress','feedback','handled'],page_stage)-1 end);
        when 'substatus' then vals:=case when r->>'recordState'='historical' and r->>'participationStatus' not in ('no_show','cancelled') and not coalesce((r->'sourceEnrollmentFacts'->>'confirmed')::boolean,false) then '[]'::jsonb else to_jsonb(statuses) end;
          sort_value:=to_jsonb(array_position(array['pending','continue_entry','prepare_report','give_feedback','contacting','awaiting_reply','considering','ready_to_enroll','awaiting_class','trial','enrolled','not_enrolling','rescheduled','no_show','cancelled','handled'],primary_status)-1);
      end case;
      label:=coalesce(labels->field->>value,label,value);
      if field in ('kind','assessorSource','resultSource') then sort_value:=to_jsonb(label); end if;
      vals:=coalesce(vals,case when nullif(value,'') is not null then jsonb_build_array(value) else '[]'::jsonb end);
      result:=result||jsonb_build_object(field,jsonb_build_object('values',vals,'label',label,'sort',sort_value,'missing',jsonb_array_length(vals)=0,
        'sortMissing',sort_value is null or sort_value='null'::jsonb or public.assessment_list_trim(sort_value#>>'{}')=''));
    end if;
  end loop;
  return result;
end;
$$;

create or replace function public.dashboard_list_field_matches(v jsonb,f jsonb) returns boolean
language sql immutable set search_path=public,pg_temp as $$
  select coalesce(case f->>'kind'
    when 'presence' then (v->>'missing')::boolean=(f->>'value'='missing')
    when 'text' then position(lower(public.assessment_list_trim(f->>'query')) in lower(coalesce(v->>'text','')))>0
    when 'enum' then v->'values' ?| array(select jsonb_array_elements_text(f->'values'))
    when 'number' then (v->>'number')::numeric is not null and (f->>'min' is null or (v->>'number')::numeric>=(f->>'min')::numeric)
      and (f->>'max' is null or (v->>'number')::numeric<=(f->>'max')::numeric)
    when 'date' then v->>'day'>=f->>'from' and v->>'day'<=f->>'to' else false end,false);
$$;

create or replace function public.list_assessment_workbench_page(p_state text,p_search text,p_page integer,p_page_size integer,p_query jsonb,p_locale text,p_labels jsonb)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp set plan_cache_mode=force_custom_plan as $$
declare zone text; item record; kind text; sort_field text:=p_query->'sort'->>'field'; direction text:=p_query->'sort'->>'direction';result jsonb;
  enum_fields text[]:=array['grade','kind','location','assessor','supportOwner','assessorSource','paper','band','resultSource','status','substatus'];
  date_fields text[]:=array['scheduledAt','recordedAt'];numeric_fields text[]:=array['grade','score','scoreRate','progress','band','status','substatus'];
  allowed text[]:=array['name','phone','grade','kind','scheduledAt','location','assessor','supportOwner','assessorSource','paper','score','scoreRate','band','progress','resultSource','conclusion','status','substatus','recordedAt'];
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not (public.has_perm(auth.uid(),'review.write') or public.has_perm(auth.uid(),'followup.view')) then raise exception 'FORBIDDEN'; end if;
  if p_state is null or p_state not in ('current','historical','all') or p_page is null or p_page not between 1 and 1000000 or p_page_size is null or p_page_size not in (20,50,100)
    or p_locale is null or p_locale not in ('zh','en') or length(coalesce(p_search,''))>100 or p_query is null or p_query->>'version' is distinct from '2'
    or jsonb_typeof(p_query->'filters') is distinct from 'object' or pg_column_size(p_query)>32768
    or p_labels is null or jsonb_typeof(p_labels)<>'object' or pg_column_size(p_labels)>32768 then raise exception 'VALIDATION'; end if;
  for item in select * from jsonb_each(p_query->'filters') loop
    kind:=item.value->>'kind';
    if not item.key=any(allowed) or kind is null then raise exception 'VALIDATION'; end if;
    if kind='presence' then
      if item.value->>'value' is null or item.value->>'value' not in ('present','missing') then raise exception 'VALIDATION'; end if;
    elsif kind='enum' and item.key=any(enum_fields) then
      if jsonb_typeof(item.value->'values') is distinct from 'array' then raise exception 'VALIDATION'; end if;
      if jsonb_array_length(item.value->'values') not between 1 and 100 or exists(select 1 from jsonb_array_elements(item.value->'values') v where jsonb_typeof(v)<>'string' or length(v#>>'{}') not between 1 and 160) then raise exception 'VALIDATION'; end if;
    elsif kind='text' and item.key in ('name','phone','conclusion') then
      if jsonb_typeof(item.value->'query') is distinct from 'string' or length(item.value->>'query')>160 then raise exception 'VALIDATION'; end if;
    elsif kind='number' and item.key in ('score','scoreRate','progress') then
      if (item.value->>'min' is null and item.value->>'max' is null) or (item.value->>'min' is not null and jsonb_typeof(item.value->'min')<>'number')
        or (item.value->>'max' is not null and jsonb_typeof(item.value->'max')<>'number') or (item.value->>'min')::numeric>(item.value->>'max')::numeric then raise exception 'VALIDATION'; end if;
    elsif kind='date' and item.key=any(date_fields) then
      if coalesce(item.value->>'from','')!~'^\d{4}-\d{2}-\d{2}$' or coalesce(item.value->>'to','')!~'^\d{4}-\d{2}-\d{2}$' or item.value->>'from'>item.value->>'to' then raise exception 'VALIDATION'; end if;
      begin perform (item.value->>'from')::date,(item.value->>'to')::date;
        exception when invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION'; end;
    else raise exception 'VALIDATION'; end if;
  end loop;
  if p_query->'sort' is not null and p_query->'sort'<>'null'::jsonb and
    (sort_field is null or not sort_field=any(allowed) or sort_field='conclusion' or direction is null or direction not in ('asc','desc')) then raise exception 'VALIDATION'; end if;
  -- 原分只有选中单一试卷后才可比较，与前端字段合同一致。
  if coalesce(p_query->'filters'->'paper'->>'kind','')<>'enum' or jsonb_array_length(coalesce(p_query->'filters'->'paper'->'values','[]'::jsonb))<>1 then
    p_query:=jsonb_set(p_query,'{filters}',(p_query->'filters')-'score'); if sort_field='score' then sort_field:=null; end if;
  end if;
  if sort_field='scheduledAt' and direction='desc' then sort_field:=null; end if;
  zone:=public.get_organization_timezone_v2();
  with rows as materialized (
    select r.*,row_number() over(order by assessment_at desc nulls last,payload->>'id') as default_ordinal
      from public.assessment_list_rows(p_state) r
      where coalesce(public.assessment_list_trim(p_search),'')='' or exists(select 1 from unnest(array[
        payload->>'name',payload->>'phone',payload->>'gradeText',payload->>'location',payload->>'assessorName',payload->>'background',payload->>'activityTitle',
        payload->'assessment'->>'teacherObservation',payload->'assessment'->>'teacherRecommendation',payload->'assessment'->>'strengths',payload->'assessment'->>'focusAreas',payload->'assessment'->>'parentConcerns',payload->'questionSummary'->>'paperTitle'
      ]) value where position(lower(public.assessment_list_trim(p_search)) in lower(value))>0)
  ), fields as materialized (select payload->>'id' as key,default_ordinal,public.assessment_list_fields(payload,p_labels,zone) as fields from rows r),
  evaluated as materialized (select r.*,array(select f.key from jsonb_each(p_query->'filters') f where not public.dashboard_list_field_matches(r.fields->f.key,f.value)) as misses from fields r),
  filtered as not materialized (select * from evaluated where cardinality(misses)=0),
  totals as (select count(*)::integer as count,greatest(1,ceil(count(*)::numeric/p_page_size)::integer) as pages from filtered),
  ordered as (
    select f.*,row_number() over(order by
      case when sort_field is not null then coalesce((fields->sort_field->>'sortMissing')::boolean,(fields->sort_field->>'missing')::boolean,true) end,
      case when sort_field=any(numeric_fields||date_fields) and direction='asc' then (fields->sort_field->>'sort')::numeric end asc,
      case when sort_field=any(numeric_fields||date_fields) and direction='desc' then (fields->sort_field->>'sort')::numeric end desc,
      case when not sort_field=any(numeric_fields||date_fields) and direction='asc' and p_locale='zh' then fields->sort_field->>'sort' end collate public.student_list_sort_zh asc,
      case when not sort_field=any(numeric_fields||date_fields) and direction='desc' and p_locale='zh' then fields->sort_field->>'sort' end collate public.student_list_sort_zh desc,
      case when not sort_field=any(numeric_fields||date_fields) and direction='asc' and p_locale='en' then fields->sort_field->>'sort' end collate public.student_list_sort_en asc,
      case when not sort_field=any(numeric_fields||date_fields) and direction='desc' and p_locale='en' then fields->sort_field->>'sort' end collate public.student_list_sort_en desc,
      default_ordinal) as ordinal from filtered f
  ), page_keys as materialized (select key,ordinal from ordered order by ordinal limit p_page_size offset (least(p_page,(select pages from totals))-1)*p_page_size),
  page_rows as (select r.payload,p.ordinal from page_keys p join rows r on r.payload->>'id'=p.key),
  all_options as materialized (
    select distinct on(f.id,v.value) f.id,v.value,coalesce(p_labels->f.id->>v.value,e.fields->f.id->>'label',v.value) as label
    from evaluated e cross join unnest(enum_fields) f(id) cross join lateral jsonb_array_elements_text(e.fields->f.id->'values') v(value) order by f.id,v.value,e.default_ordinal
  ), option_refs as (
    select f.id,v.value from evaluated e cross join unnest(enum_fields) f(id) cross join lateral jsonb_array_elements_text(e.fields->f.id->'values') v(value) where e.misses<@array[f.id]
    union select f.key,v.value from jsonb_each(p_query->'filters') f cross join lateral jsonb_array_elements_text(case when f.value->>'kind'='enum' then f.value->'values' else '[]'::jsonb end) v(value)
  ), option_facets as (
    select f.id,jsonb_build_object('options',coalesce(jsonb_agg(jsonb_build_object('value',a.value,'label',coalesce(o.label,a.value))) filter(where a.value is not null),'[]'::jsonb),'days','[]'::jsonb) as data
      from unnest(enum_fields) f(id) left join option_refs a on a.id=f.id left join all_options o on o.id=a.id and o.value=a.value group by f.id
  ), date_facets as (
    select f.id,jsonb_build_object('options','[]'::jsonb,'days',coalesce(jsonb_agg(distinct e.fields->f.id->>'day' order by e.fields->f.id->>'day' desc) filter(where e.fields->f.id->>'day' is not null),'[]'::jsonb)) as data
    from unnest(date_fields) f(id) left join evaluated e on e.misses<@array[f.id] group by f.id
  ) select jsonb_build_object('rows',coalesce((select jsonb_agg(payload order by ordinal) from page_rows),'[]'::jsonb),
    'count',t.count,'page',least(p_page,t.pages),'pageSize',p_page_size,'totalPages',t.pages,
    'facets',coalesce((select jsonb_object_agg(id,data) from(select * from option_facets union all select * from date_facets) f),'{}'::jsonb)) into result from totals t;
  return result;
end;
$$;
revoke all on function public.assessment_list_fields(jsonb,jsonb,text),public.dashboard_list_field_matches(jsonb,jsonb),public.list_assessment_workbench_page(text,text,integer,integer,jsonb,text,jsonb) from public,anon;
grant execute on function public.assessment_list_fields(jsonb,jsonb,text),public.dashboard_list_field_matches(jsonb,jsonb),public.list_assessment_workbench_page(text,text,integer,integer,jsonb,text,jsonb) to authenticated;
