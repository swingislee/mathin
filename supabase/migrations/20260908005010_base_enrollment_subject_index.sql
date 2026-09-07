-- 按来源一次汇总明确关联，避免每张学生卡片对每条报名重复扫描全部来源。
create or replace view public.business_course_enrollment_subjects with (security_invoker=true) as
with source_refs as materialized (
  select record_id,count(distinct key) as subject_count,min(key) as subject_key from (
    select a.record_id,'student:'||a.student_id as key from public.history_import_associations a
    union all select l.source_record_id,coalesce('student:'||l.student_id,'lead:'||l.id) from public.leads l
    union all select o.source_record_id,coalesce('student:'||o.student_id,'student:'||l.student_id,'lead:'||o.lead_id)
      from public.course_opportunities o left join public.leads l on l.id=o.lead_id
    union all select r.source_record_id,coalesce('student:'||r.student_id,'student:'||l.student_id,'lead:'||r.lead_id)
      from public.activity_registrations r left join public.leads l on l.id=r.lead_id
  ) candidates where record_id is not null and key is not null group by record_id
)
select e.*,coalesce('student:'||e.student_id,
  case when coalesce(refs.subject_count,0)<=1
    and coalesce(refs.subject_key,coalesce('student:'||o.student_id,'student:'||l.student_id,'lead:'||o.lead_id))
      =coalesce(coalesce('student:'||o.student_id,'student:'||l.student_id,'lead:'||o.lead_id),refs.subject_key)
    then coalesce(refs.subject_key,'student:'||o.student_id,'student:'||l.student_id,'lead:'||o.lead_id) end) as subject_key
from public.business_course_enrollments e
left join source_refs refs on refs.record_id=e.source_record_id
left join public.course_opportunities o on o.id=e.opportunity_id
left join public.leads l on l.id=o.lead_id;
notify pgrst,'reload schema';
