-- 同一 BASE 行只让最新来源版本参与当前标签；旧载荷继续留作历史依据。
create index if not exists history_import_base_logical_version_idx
on public.history_import_records (
  (record_data->>'tableId'), (record_data->>'sourceRecordId'),
  (coalesce(left(source_data->>'filename',10),'')), imported_at, id
) where source_data->>'format'='feishu-base';

create or replace view public.school_source_status_subjects with (security_invoker=true) as
select coalesce('student:'||coalesce(l.student_id,h.student_id),'lead:'||h.lead_id) as key,
  h.id as source_id,
  case when f.value->>'type' in ('assessment','assessment_band','assessment_score','learning_band')
    and exists (
      select 1 from public.assessment_results revised
      join public.history_import_records previous on previous.id=revised.source_record_id
      where revised.history_revision>0 and (revised.source_record_id=h.id
        or previous.record_data->>'tableId'=h.record_data->>'tableId'
          and previous.record_data->>'sourceRecordId'=h.record_data->>'sourceRecordId')
    ) then f.value||jsonb_build_object('certainty','review','priority',20) else f.value end as fact
from public.school_source_status_evidence e join public.history_import_records h
  on h.id=e.source_record_id and h.payload_sha256=e.payload_sha256
left join public.leads l on l.id=h.lead_id
cross join lateral jsonb_array_elements(e.facts) f
where coalesce(l.student_id,h.student_id,h.lead_id) is not null
  and not exists (
    select 1 from public.history_import_records newer
    where newer.source_data->>'format'='feishu-base'
      and newer.record_data->>'tableId'=h.record_data->>'tableId'
      and newer.record_data->>'sourceRecordId'=h.record_data->>'sourceRecordId'
      and (coalesce(left(newer.source_data->>'filename',10),''),newer.imported_at,newer.id)
        >(coalesce(left(h.source_data->>'filename',10),''),h.imported_at,h.id)
  );
revoke all on public.school_source_status_subjects from public,anon,authenticated;

-- 人工修订关联旧来源版本时，同样不再用新版来源补出被人工取消的测评结果。
create or replace function public.school_source_completed_assessments() returns table(key text)
language sql stable security definer set search_path=public,pg_temp as $$
  select distinct s.key from public.school_source_status_subjects s
  join public.history_import_records h on h.id=s.source_id
  where s.fact->>'type'='assessment' and s.fact->>'value'='complete' and s.fact->>'certainty'='confirmed'
    and not exists (
      select 1 from public.assessment_results a
      join public.history_import_records previous on previous.id=a.source_record_id
      where a.history_revision>0 and (a.source_record_id=s.source_id
        or previous.record_data->>'tableId'=h.record_data->>'tableId'
          and previous.record_data->>'sourceRecordId'=h.record_data->>'sourceRecordId')
    )
$$;
revoke all on function public.school_source_completed_assessments() from public,anon,authenticated;
grant execute on function public.school_source_completed_assessments() to postgres;
