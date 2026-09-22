-- 总览在调用者 RLS 下读取窄候选，每个请求统一执行一次身份分类与来源权威判断。
-- 最新版本、归属、去重及 current/historical 语义保持原口径；关联资格显式复用同一批结果。
do $guard$
declare relation text;
begin
  if md5(replace((select prosrc from pg_proc where oid='public.staff_overview_acquisition_contact_facts_v2(text,text)'::regprocedure),chr(13),''))<>'e3f7be0adc4df46195e7e9d0f5394ae5'
    then raise exception 'OVERVIEW_FACTS_CONTRACT_CHANGED';end if;
  foreach relation in array array['lead_communications','activity_registrations','assessment_results','activities'] loop
    -- PostgreSQL 会省略无歧义列的表别名；两种输出要求同一个完整权威过滤条件。
    if pg_get_viewdef(('public.business_'||relation)::regclass,true) !~ 'WHERE business_source_is_authoritative\((r\.)?source_record_id\);$'
      or not exists(select 1 from pg_class where oid=('public.business_'||relation)::regclass and reloptions @> array['security_invoker=true'])
      then raise exception 'OVERVIEW_BUSINESS_SCOPE_CHANGED';end if;
  end loop;
end;
$guard$;

CREATE OR REPLACE FUNCTION public.staff_overview_acquisition_contact_facts_v2(p_grain text, p_zone text)
 RETURNS TABLE(metric text, id text, event_at timestamp with time zone, month_state smallint, reporting_month text, person_id text, subject_id text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
with actor as materialized (select public.is_staff(auth.uid()) as allowed),
versions as materialized (
  select h.id,h.lead_id,h.source_record_id,h.imported_at,h.overview_acquisition_v2,
    coalesce(substring(h.source_data->>'snapshotDate' from '^([0-9]{4}-[0-9]{2}-[0-9]{2})$'),
      substring(h.source_data->>'filename' from '^([0-9]{4}-[0-9]{2}-[0-9]{2})'),to_char(h.imported_at at time zone 'Asia/Shanghai','YYYY-MM-DD')) as version
  from public.history_import_records h where (h.overview_acquisition_v2).valid is not null and (select allowed from actor)
), latest as materialized (
  select distinct on(source_record_id) * from versions order by source_record_id,version desc,imported_at desc,id desc
), raw_leads as materialized (
  select l.id,l.student_id,l.owner_id,l.source_record_id,l.created_at from public.leads l where (select allowed from actor)
), raw_communications as materialized (
  select c.id,c.lead_id,c.occurred_at,c.occurred_on,c.outcome,c.owner_id_at_contact,c.recorded_by,c.source_record_id,c.source_key,
    c.overview_contact_v2,c.source_metric_facts->'staff' as staff_labels
  from public.lead_communications c where (select allowed from actor)
), raw_registrations as materialized (
  select r.id,r.activity_id,r.lead_id,r.student_id,r.source_record_id,r.registered_on,r.overview_contact_v2,r.source_metric_facts->'staff' as staff_labels
  from public.activity_registrations r where (select allowed from actor)
), raw_assessments as materialized (
  select a.id,a.source_record_id,a.lead_id,a.student_id,a.assessed_by,a.activity_registration_id
  from public.assessment_results a where (select allowed from actor)
), raw_activities as materialized (
  select a.id,a.source_record_id,a.source_invitation_id,a.deleted_at from public.activities a where (select allowed from actor)
), raw_threads as materialized (
  select t.id,t.lead_id,t.owner_id_at_open,t.assessor_id from public.lead_invitation_threads t where (select allowed from actor)
), raw_submissions as materialized (
  select s.id,s.lead_id,s.submitted_at from public.lead_source_records s where (select allowed from actor)
), candidates as materialized (
  select 'lead:'||id as id,null::uuid as student_id,id as lead_id,null::uuid[] as staff_ids,null::text as source_id,null::jsonb as staff_labels from raw_leads
  union all select 'communication:'||id,null,lead_id,array[owner_id_at_contact],source_record_id,staff_labels from raw_communications
  union all select 'registration:'||id,student_id,lead_id,null,source_record_id,staff_labels from raw_registrations
  union all select 'assessment:'||id,student_id,lead_id,array[assessed_by],source_record_id,null from raw_assessments
  union all select 'activity:'||id,null,null,null,source_record_id,null from raw_activities
  union all select 'thread:'||id,null,lead_id,array[owner_id_at_open,assessor_id],null,null from raw_threads
  union all select 'submission:'||id,null,lead_id,null,null,null from raw_submissions
  union all select 'source:'||id,null,null,null,id,null from latest
), eligible as materialized (
  select public.statistics_included_candidates_v2(coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb)) as id from candidates c
), authoritative as materialized (
  select public.business_authoritative_source_ids_v2(array(select distinct source_id from candidates where source_id is not null)) as id
), lead_rows as materialized (
  select * from raw_leads where 'lead:'||id in(select id from eligible)
), included_activities as materialized (
  select a.* from raw_activities a where 'activity:'||a.id in(select id from eligible)
    and (a.source_record_id is null or a.source_record_id in(select id from authoritative))
    and (a.source_invitation_id is null or 'thread:'||a.source_invitation_id in(select id from eligible))
), activity_candidates as materialized (
  select * from included_activities where deleted_at is null
), communications as materialized (
  select c.* from raw_communications c where 'communication:'||c.id in(select id from eligible)
    and (c.source_record_id is null or c.source_record_id in(select id from authoritative))
), registrations as materialized (
  select r.* from raw_registrations r where 'registration:'||r.id in(select id from eligible)
    and (r.source_record_id is null or r.source_record_id in(select id from authoritative))
    and r.activity_id in(select id from included_activities)
), assessment_candidates as materialized (
  select a.* from raw_assessments a where 'assessment:'||a.id in(select id from eligible)
    and (a.source_record_id is null or a.source_record_id in(select id from authoritative))
    and (a.activity_registration_id is null or a.activity_registration_id in(select id from registrations))
), aliases as materialized (
  select v.id,l.id as current_id from versions v join latest l on l.source_record_id=v.source_record_id
  union select id,id from latest
), links as materialized (
  select source_record_id as source_id,id as lead_id from lead_rows
  union select id,lead_id from latest
  union select source_record_id,lead_id from communications
  union select source_record_id,lead_id from registrations
  union select source_record_id,lead_id from assessment_candidates
), source_leads as materialized (
  select distinct coalesce(a.current_id,k.source_id) as source_id,l.id as lead_id,l.owner_id
  from links k join lead_rows l on l.id=k.lead_id left join aliases a on a.id=k.source_id where k.source_id is not null
), primary_leads as materialized (select distinct source_leads.lead_id from source_leads join latest on latest.id=source_leads.source_id),
submissions as materialized (
  select s.lead_id,min(s.submitted_at) as submitted_at from raw_submissions s where 'submission:'||s.id in(select id from eligible) group by s.lead_id
), acquisition as (
  select case when (h.overview_acquisition_v2).valid then 'leads' else 'invalid-source' end as metric,h.id,(h.overview_acquisition_v2).acquired_on::timestamp at time zone p_zone as event_at,
    0::smallint as month_state,null::text as reporting_month,(h.overview_acquisition_v2).staff_label as label,
    case when count(sl.lead_id)=1 then min(sl.owner_id::text) end as fallback_person,null::text as subject_id
  from (select * from latest where 'source:'||id in(select id from eligible)) h left join source_leads sl on sl.source_id=h.id where (h.overview_acquisition_v2).meaningful or not (h.overview_acquisition_v2).valid
  group by h.id,h.overview_acquisition_v2
  union all
  select 'leads','submission:'||l.id,s.submitted_at,0::smallint,null,null,l.owner_id::text,null
  from submissions s join lead_rows l on l.id=s.lead_id where not exists(select 1 from primary_leads p where p.lead_id=l.id)
  union all
  select 'leads',l.id::text,case when l.source_record_id is null then l.created_at end,0::smallint,null,null,l.owner_id::text,null
  from lead_rows l where not exists(select 1 from primary_leads p where p.lead_id=l.id) and not exists(select 1 from submissions s where s.lead_id=l.id)
), contact_ranked as materialized (
  select c.*,row_number() over(partition by coalesce((overview_contact_v2).source_key,id::text)
    order by coalesce((overview_contact_v2).source_version,'') collate "C" desc,id) as ordinal
  from communications c where p_grain<>'month' or coalesce(source_key,'') not like '%:followup'
), contact as (
  select 'contacts'::text as metric,c.id::text,coalesce(c.occurred_at,c.occurred_on::timestamp at time zone p_zone) as event_at,
    coalesce((c.overview_contact_v2).month_state,0)::smallint as month_state,(c.overview_contact_v2).reporting_month,
    (c.overview_contact_v2).staff_label as label,
    case when (c.overview_contact_v2).source_key is null then coalesce(c.owner_id_at_contact,
      case when c.source_record_id is not null then coalesce(c.recorded_by,l.owner_id) end)::text end as fallback_person,
    coalesce(l.student_id::text,'lead:'||c.lead_id) as subject_id
  from contact_ranked c left join lead_rows l on l.id=c.lead_id
  where (p_grain<>'month' or ordinal=1) and case when p_grain='month' and (c.overview_contact_v2).source_key is not null
    then (c.overview_contact_v2).confirmed is true else c.outcome in ('connected','declined') end
), tagged as materialized (
  select distinct on((overview_contact_v2).source_key) * from registrations where (overview_contact_v2).source_key is not null
  order by (overview_contact_v2).source_key,(overview_contact_v2).source_version collate "C" desc,id
), confirmed as (
  select 'contacts'::text as metric,'source-contacts:'||(r.overview_contact_v2).source_key as id,r.registered_on::timestamp at time zone p_zone as event_at,
    (r.overview_contact_v2).month_state,(r.overview_contact_v2).reporting_month,(r.overview_contact_v2).staff_label as label,
    null::text as fallback_person,coalesce(r.student_id::text,l.student_id::text,case when r.lead_id is not null then 'lead:'||r.lead_id end,
      'record:source-contacts:'||(r.overview_contact_v2).source_key) as subject_id
  from tagged r left join lead_rows l on l.id=r.lead_id
  where (r.overview_contact_v2).confirmed is true and r.activity_id in(select id from activity_candidates)
), raw as materialized (
  select *,false as supplement from acquisition union all select *,false from contact union all select *,true from confirmed
), labels as materialized (
  select label,case when count(p.id)=1 then min(p.id::text) else 'source-staff:'||public.overview_encode_component_v2(label) end as person_id
  from (select distinct label from raw where label is not null and label<>'') names
  left join public.statistics_profiles p on (public.overview_trim_v2(p.display_name)=public.overview_trim_v2(names.label) or public.overview_trim_v2(names.label)=any(p.staff_aliases))
    and p.role in ('staff','admin') and p.is_active and public.overview_trim_v2(names.label)<>'' group by label
), attributed as materialized (
  select r.*,case when r.label is not null then l.person_id else r.fallback_person end as person_id,
    case when p_grain='month' then coalesce(r.reporting_month,to_char(r.event_at at time zone p_zone,'YYYY-MM'))
      else to_char(r.event_at at time zone p_zone,'YYYY-MM-DD') end as contact_period
  from raw r left join labels l on l.label=r.label
)
select a.metric,a.id,a.event_at,a.month_state,a.reporting_month,a.person_id,a.subject_id from attributed a
where not a.supplement or not exists(select 1 from attributed c where c.metric='contacts' and not c.supplement
  and c.subject_id=a.subject_id and c.person_id=a.person_id and c.contact_period=a.contact_period);
$function$
;

-- 人员选择需要历史范围内的署名目录；只补齐去重 ID，不返回逐条事实。
do $summary$
declare body text;original text;
begin
  if md5(replace((select prosrc from pg_proc where oid='public.get_staff_overview_acquisition_contacts_v2(jsonb)'::regprocedure),chr(13),''))<>'424c703bb5d864eeb6dba8800aaa39f7'
    then raise exception 'OVERVIEW_SUMMARY_CONTRACT_CHANGED';end if;
  body:=pg_get_functiondef('public.get_staff_overview_acquisition_contacts_v2(jsonb)'::regprocedure);original:=body;
  body:=replace(body,$old$select jsonb_build_object('schemaVersion',2,'integrityValid',$old$,
    $new$select jsonb_build_object('schemaVersion',2,'leadPersonIds',
      (select coalesce(jsonb_agg(person_id order by person_id nulls last),'[]'::jsonb) from people where metric='leads'),
      'sourceStaffIds',
      (select coalesce(jsonb_agg(person_id order by person_id),'[]'::jsonb) from
        (select distinct person_id from facts where person_id like 'source-staff:%' and (metric='contacts' or metric='leads' and event_at is not null)) names),
      'integrityValid',$new$);
  if body=original then raise exception 'OVERVIEW_SUMMARY_SHAPE_CHANGED';end if;
  execute body;
end;
$summary$;
