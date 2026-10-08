-- 来源归档可能只保存原文，正式业务表保存稳定主体关系；沿已有关系读取标签。
-- 人工确认优先；其余关系只有指向同一主体时才采用，避免跨学生拼接证据。
create or replace view public.school_source_status_subjects with (security_invoker=true) as
with versions as materialized (
  select h.id, h.student_id, h.lead_id, h.payload_sha256, h.imported_at,
    h.record_data->>'tableId' as table_key, h.record_data->>'sourceRecordId' as row_key,
    coalesce(left(h.source_data->>'filename',10),'') as source_date
  from public.history_import_records h where h.source_data->>'format'='feishu-base'
), raw_subjects as (
  select h.id as source_id, coalesce('student:'||coalesce(l.student_id,h.student_id),'lead:'||h.lead_id) as subject_key, 1 as priority
    from versions h left join public.leads l on l.id=h.lead_id
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
), candidates as materialized (
  select v.table_key, v.row_key, r.subject_key, r.priority
  from raw_subjects r join versions v on v.id=r.source_id where r.subject_key is not null
), preferred as (
  select table_key,row_key,min(priority) as priority from candidates group by table_key,row_key
), resolved as (
  select c.table_key,c.row_key,min(c.subject_key) as subject_key
  from candidates c join preferred p using(table_key,row_key,priority)
  group by c.table_key,c.row_key having count(distinct c.subject_key)=1
)
select r.subject_key as key, h.id as source_id,
  case when f.value->>'type' in ('assessment','assessment_band','assessment_score','learning_band')
    and exists (
      select 1 from public.assessment_results revised
      join public.history_import_records previous on previous.id=revised.source_record_id
      where revised.history_revision>0 and (revised.source_record_id=h.id
        or previous.record_data->>'tableId'=h.table_key and previous.record_data->>'sourceRecordId'=h.row_key)
    ) then f.value||jsonb_build_object('certainty','review','priority',20) else f.value end as fact
from versions h join resolved r using(table_key,row_key)
join public.school_source_status_evidence e on e.source_record_id=h.id and e.payload_sha256=h.payload_sha256
cross join lateral jsonb_array_elements(e.facts) f
where not exists (
  select 1 from public.history_import_records newer
  where newer.source_data->>'format'='feishu-base'
    and newer.record_data->>'tableId'=h.table_key and newer.record_data->>'sourceRecordId'=h.row_key
    and (coalesce(left(newer.source_data->>'filename',10),''),newer.imported_at,newer.id)>(h.source_date,h.imported_at,h.id)
);
revoke all on public.school_source_status_subjects from public,anon,authenticated;

-- 主体已由受控关联解析，并在 RPC 入口检查读取权限；旧归档的 lead_id 不再挡住正式主体。
do $migration$
declare original text;
begin
  select pg_get_functiondef('public.school_record_status_evidence(uuid,uuid)'::regprocedure) into original;
  if position('where s.key=subject_key and (h.lead_id is null or h.lead_id=any(lead_ids))' in original)=0 then
    raise exception 'SOURCE_EVIDENCE_READER_DEFINITION_CHANGED';
  end if;
  execute replace(original,
    'where s.key=subject_key and (h.lead_id is null or h.lead_id=any(lead_ids))',
    'where s.key=subject_key');
end
$migration$;
