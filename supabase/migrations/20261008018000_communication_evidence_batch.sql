-- 同页来源关系只读取一次，避免 100 条沟通列表逐人扫描历史导入。
CREATE OR REPLACE FUNCTION public.school_source_status_facts_for_subjects(p_subject_keys text[])
 RETURNS TABLE(key text, source_id text, fact jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
with manual_sources as materialized (
  select revised.source_record_id,previous.record_data->>'tableId' as table_key,
    previous.record_data->>'sourceRecordId' as row_key
  from public.assessment_results revised join public.history_import_records previous on previous.id=revised.source_record_id
  where revised.history_revision>0
), raw_subjects as materialized (
  select h.id as source_id, coalesce('student:'||coalesce(l.student_id,h.student_id),'lead:'||h.lead_id) as subject_key, 1 as priority
    from public.history_import_records h left join public.leads l on l.id=h.lead_id
  union all
  select l.source_record_id, coalesce('student:'||l.student_id,'lead:'||l.id), 1 from public.leads l
  union all
  select a.record_id, 'student:'||a.student_id, 0 from public.history_import_associations a
    where a.match_state='confirmed' and a.student_id is not null
  union all
  select c.source_record_id, coalesce('student:'||l.student_id,'lead:'||l.id), 1
    from public.lead_communications c join public.leads l on l.id=c.lead_id
  union all
  select r.source_record_id, coalesce('student:'||coalesce(r.student_id,l.student_id),'lead:'||r.lead_id), 1
    from public.activity_registrations r left join public.leads l on l.id=r.lead_id
  union all
  select a.source_record_id, coalesce('student:'||coalesce(a.student_id,l.student_id),'lead:'||a.lead_id), 1
    from public.assessment_results a left join public.leads l on l.id=a.lead_id
  union all
  select e.source_record_id, 'student:'||e.student_id, 1 from public.course_enrollments e
  union all
  select o.source_record_id, coalesce('student:'||coalesce(o.student_id,l.student_id),'lead:'||o.lead_id), 1
    from public.course_opportunities o left join public.leads l on l.id=o.lead_id
  union all
  select f.source_record_id, 'student:'||f.student_id, 1 from public.student_follow_ups f

), requested_keys as materialized (
  select distinct h.record_data->>'tableId' as table_key,h.record_data->>'sourceRecordId' as row_key
  from raw_subjects requested join public.history_import_records h on h.id=requested.source_id
  where requested.subject_key=any(p_subject_keys) and h.source_data->>'format'='feishu-base'
), versions as materialized (
  select h.id, h.student_id, h.lead_id, h.payload_sha256, h.imported_at,
    h.record_data->>'tableId' as table_key, h.record_data->>'sourceRecordId' as row_key,
    coalesce(left(h.source_data->>'filename',10),'') as source_date
  from requested_keys requested join public.history_import_records h
    on h.record_data->>'tableId'=requested.table_key and h.record_data->>'sourceRecordId'=requested.row_key
  where h.source_data->>'format'='feishu-base'
), candidates as materialized (
  select v.table_key, v.row_key, r.subject_key, r.priority
  from raw_subjects r join versions v on v.id=r.source_id where r.subject_key is not null
), preferred as materialized (
  select table_key,row_key,min(priority) as priority from candidates group by table_key,row_key
), resolved as materialized (
  select c.table_key,c.row_key,min(c.subject_key) as subject_key
  from candidates c join preferred p using(table_key,row_key,priority)
  group by c.table_key,c.row_key having count(distinct c.subject_key)=1
)
select r.subject_key as key, h.id as source_id,
  case when f.value->>'type' in ('assessment','assessment_band','assessment_score','learning_band')
    and exists (
      select 1 from manual_sources revised where revised.source_record_id=h.id
      or revised.table_key=h.table_key and revised.row_key=h.row_key
    ) then f.value||jsonb_build_object('certainty','review','priority',20) else f.value end as fact
from versions h join resolved r using(table_key,row_key)
join public.school_source_status_evidence e on e.source_record_id=h.id and e.payload_sha256=h.payload_sha256
cross join lateral jsonb_array_elements(e.facts) f
where r.subject_key=any(p_subject_keys) and not exists (
  select 1 from public.history_import_records newer
  where newer.source_data->>'format'='feishu-base'
    and newer.record_data->>'tableId'=h.table_key and newer.record_data->>'sourceRecordId'=h.row_key
    and (coalesce(left(newer.source_data->>'filename',10),''),newer.imported_at,newer.id)>(h.source_date,h.imported_at,h.id)
)
$function$
;
alter function public.school_source_status_facts_for_subjects(text[]) owner to postgres;
revoke all on function public.school_source_status_facts_for_subjects(text[]) from public,anon,authenticated;
grant execute on function public.school_source_status_facts_for_subjects(text[]) to postgres;

create or replace function public.school_record_status_evidence_batch(p_subjects jsonb)
returns table(key text, facts jsonb)
language plpgsql stable security definer set search_path=public,pg_temp
set plan_cache_mode='force_custom_plan' as $batch$
declare actor uuid:=auth.uid(); subject record; v_student_id uuid; normalized jsonb:='[]'::jsonb;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not public.has_perm(actor,'followup.view') then
    return query select s.key,'[]'::jsonb from jsonb_to_recordset(p_subjects) as s(key text);
    return;
  end if;
  -- 批量读取仍逐一核对身份和范围，沿用单人证据入口的权限语义。
  for subject in select * from jsonb_to_recordset(p_subjects) as s(key text,student_id uuid,lead_id uuid) loop
    v_student_id:=subject.student_id;
    if subject.lead_id is not null then
      if not public.can_view_school_lead(subject.lead_id,actor) then raise exception 'FORBIDDEN_SCOPE'; end if;
      select coalesce(v_student_id,l.student_id) into v_student_id from public.leads l where l.id=subject.lead_id;
      if subject.student_id is not null and exists(select 1 from public.leads l where l.id=subject.lead_id and l.student_id is distinct from subject.student_id) then raise exception 'SUBJECT_MISMATCH'; end if;
    end if;
    if v_student_id is not null and not public.can_view_school_student(v_student_id,actor) then raise exception 'FORBIDDEN_SCOPE'; end if;
    if v_student_id is null and subject.lead_id is null then raise exception 'NOT_FOUND'; end if;
    normalized:=normalized||jsonb_build_array(jsonb_build_object('key',subject.key,'student_id',v_student_id,
      'lead_id',subject.lead_id,'subject_key',coalesce('student:'||v_student_id,'lead:'||subject.lead_id)));
  end loop;
  if normalized='[]'::jsonb then return; end if;
  return query
  with subjects as materialized (
    select distinct * from jsonb_to_recordset(normalized) as s(key text,student_id uuid,lead_id uuid,subject_key text)
  ), lead_refs as materialized (
    select s.key,l.id from subjects s join public.leads l on l.id=s.lead_id or l.student_id=s.student_id
    where public.can_view_school_lead(l.id,actor)
  ), source_values as materialized (
    select v.* from public.school_source_status_facts_for_subjects(array(select distinct s.subject_key from subjects s)) v
  ), source_facts as (
    select s.key,v.fact||jsonb_build_object('sourceId',v.source_id,'recordId',v.source_id)
      ||case when v.fact->>'type' in ('assessment','assessment_band','assessment_score','learning_band')
        and exists(select 1 from public.assessment_results a where a.source_record_id=v.source_id and a.history_revision>0)
        then jsonb_build_object('certainty','review','priority',20) else '{}'::jsonb end as fact
    from source_values v join subjects s on s.subject_key=v.key
  ), contacts as materialized (
    select ref.key,c.id,
      case when r.effective_patch?'occurredAt' then r.effective_patch->>'occurredAt' else coalesce(c.occurred_on::text,c.occurred_at::text) end as effective_date,
      to_jsonb(c)||coalesce(r.effective_patch,'{}'::jsonb)
        ||case when r.effective_patch?'wechatAdded' then jsonb_build_object('wechat_added',r.effective_patch->'wechatAdded') else '{}'::jsonb end
        ||case when r.effective_patch?'interestLevel' then jsonb_build_object('interest_level',r.effective_patch->'interestLevel') else '{}'::jsonb end
        ||case when r.effective_patch?'visitCommitted' then jsonb_build_object('visit_committed',r.effective_patch->'visitCommitted') else '{}'::jsonb end as data,
      r.effective_patch as patch
    from public.business_lead_communications c join lead_refs ref on ref.id=c.lead_id
    left join lateral (
      select effective_patch from public.communication_record_revisions r where r.source='contact' and r.event_id=c.id order by revision_no desc limit 1
    ) r on true where c.source_record_id is null or r.effective_patch is not null
  ), contact_facts as (
    select c.key,jsonb_build_object('type',f.type,'value',f.value,'field',f.field,'excerpt',coalesce(nullif(c.data->>'note',''),f.field),
      'priority',400,'certainty','confirmed','date',c.effective_date,'recordId',c.id::text) as fact
    from contacts c cross join lateral (values
      ('wechat',case c.data->>'wechat_added' when 'true' then 'yes' when 'false' then 'no' else case when c.patch?'wechatAdded' then 'unknown' end end,'沟通登记 · 微信'),
      ('interest',coalesce(nullif(c.data->>'interest_level',''),case when c.patch?'interestLevel' then 'unknown' end),'沟通登记 · 意向'),
      ('visit',case c.data->>'visit_committed' when 'true' then 'promised' when 'false' then 'not_promised' else case when c.patch?'visitCommitted' then 'unknown' end end,'沟通登记 · 到访'),
      ('contact',case when c.data->>'outcome' in ('connected','declined') then 'reached' end,'沟通登记 · 联系结果')
    ) f(type,value,field) where f.value is not null
  ), assessments as materialized (
    select a.*,r.student_id as registration_student_id,r.lead_id as registration_lead_id,r.assessment_completed_at
    from public.business_assessment_results a join public.business_activity_registrations r on r.id=a.activity_registration_id
    where public.student_assessment_is_complete(r.status,r.assessment_completed_at,a.result_finalized_at,
      a.result_source,a.score,a.assessment_band,a.strengths,concat_ws(E'\n',a.strengths,a.focus_areas,a.parent_concerns,a.teacher_recommendation,a.teacher_observation))
  ), assessment_facts as (
    select s.key,jsonb_build_object('type',f.type,'value',f.value,'field',f.field,
      'excerpt',concat_ws(E'\n',a.strengths,a.focus_areas,a.parent_concerns,a.teacher_recommendation,a.teacher_observation),
      'priority',case when a.source_record_id is null or a.history_revision>0 then 400 else 140 end,
      'certainty','confirmed','date',coalesce(a.assessed_on::text,a.assessment_completed_at::text,a.result_finalized_at::text),
      'sourceId',a.source_record_id,'recordId',a.id::text) as fact
    from assessments a join subjects s on a.student_id=s.student_id or a.registration_student_id=s.student_id
      or exists(select 1 from lead_refs ref where ref.key=s.key and ref.id in (a.lead_id,a.registration_lead_id))
    cross join lateral (values ('assessment','complete','测评记录 · 已完成'),('assessment_band',a.assessment_band,'测评记录 · 思维等级'),
      ('assessment_score',a.score::text,'测评记录 · 分数')) f(type,value,field) where f.value is not null
  ), all_facts as (
    select * from source_facts union all select * from contact_facts union all select * from assessment_facts
  ) select s.key,coalesce(jsonb_agg(f.fact order by (f.fact->>'priority')::integer desc,f.fact->>'date' desc nulls last)
      filter(where f.fact is not null),'[]'::jsonb)
    from subjects s left join all_facts f on f.key=s.key group by s.key;
end
$batch$;
alter function public.school_record_status_evidence_batch(jsonb) owner to postgres;
revoke all on function public.school_record_status_evidence_batch(jsonb) from public,anon,authenticated;
grant execute on function public.school_record_status_evidence_batch(jsonb) to postgres;

do $migration$
declare original text; anchor text;
begin
  select pg_get_functiondef('public.student_record_list_rows(jsonb,public.business_course_enrollment_subjects[])'::regprocedure) into original;
  anchor:=$old$as s(student_id uuid,lead_id uuid,key text,stage text,detail text,created_at timestamptz)),
  lead_refs as materialized$old$;
  if position(anchor in original)=0
    or position('public.school_record_status_evidence(s.student_id,s.lead_id)' in original)=0
    or position('left join source_owners so on so.key=s.key;' in original)=0 then
    raise exception 'SOURCE_EVIDENCE_BATCH_READER_ANCHOR_MISSING';
  end if;
  original:=replace(original,anchor,$new$as s(student_id uuid,lead_id uuid,key text,stage text,detail text,created_at timestamptz)),
  evidence as materialized (
    select e.* from public.school_record_status_evidence_batch(coalesce((select jsonb_agg(to_jsonb(s)) from subjects s
      where s.stage in ('awaiting_first_contact','awaiting_assessment') and not exists(
        select 1 from public.lead_invitation_threads i where i.lead_id=s.lead_id and i.state not in ('completed','cancelled'))),'[]'::jsonb)) e
  ),
  lead_refs as materialized$new$);
  original:=replace(original,'public.school_record_status_evidence(s.student_id,s.lead_id)','coalesce(e.facts,''[]''::jsonb)');
  original:=replace(original,'left join source_owners so on so.key=s.key;',
    'left join source_owners so on so.key=s.key left join evidence e on e.key=s.key;');
  execute original;
end
$migration$;
