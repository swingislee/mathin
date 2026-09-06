-- 本机试验事实已逐字段迁入现有业务表；清理仅作用于五张旧试验副本。
-- 原始来源、Student 身份与规范业务记录保持原样。
do $verify$
begin
  if exists(select 1 from public.student_renewal_history h left join public.course_opportunities c on c.history_key=h.id
    where c.id is null or h.student_id<>c.student_id or h.payload_sha256<>c.source_payload_sha256 or h.import_batch_id<>c.history_batch_id or h.imported_at<>c.history_imported_at
      or h.source_record_id<>c.source_record_id or h.source_field_ids<>c.source_field_ids
      or h.period_year is distinct from c.period_year or h.period_key<>c.period_key or h.decision_note<>c.note
      or h.class_label<>c.class_label or h.teacher_label<>c.teacher_label or h.renewal_cycle_id is not null
      or h.outcome<>case c.stage when 'enrolled' then 'renewed' when 'not_enrolled' then 'not_renewed' else 'unknown' end)
    or exists(select 1 from public.student_activity_history h left join public.activity_registrations r on r.history_key=h.id left join public.activities a on a.id=r.activity_id
      where r.id is null or h.student_id<>r.student_id or h.payload_sha256<>r.source_payload_sha256 or h.import_batch_id<>r.history_batch_id or h.imported_at<>r.history_imported_at
        or h.source_record_id<>r.source_record_id or h.source_field_ids<>r.source_field_ids or h.activity_id is not null
        or h.activity_name<>a.title or h.activity_kind<>a.kind or h.registered_on is distinct from r.registered_on or h.occurred_on is distinct from a.occurred_on
        or h.reported_result<>r.reported_result or h.result_link_status<>r.result_link_status or h.result_source_record_id is distinct from r.result_source_record_id or h.result_field_ids<>r.result_field_ids
        or h.participation_status<>case r.status when 'booked' then 'registered' else r.status end)
    or exists(select 1 from public.student_assessment_history h left join public.assessment_results r on r.history_key=h.id
      where r.id is null or h.student_id<>r.student_id or h.payload_sha256<>r.source_payload_sha256 or h.import_batch_id<>r.history_batch_id or h.imported_at<>r.history_imported_at
        or h.source_record_id<>r.source_record_id or h.source_field_ids<>r.source_field_ids or h.activity_registration_id is not null
        or h.assessed_on is distinct from r.assessed_on or h.score is distinct from r.score or h.learning_notes<>r.strengths or h.parent_notes<>r.parent_concerns
        or h.assessment_band<>case r.assessment_band when 'a_plus' then 'A+' when 'a' then 'A' when 's' then 'S' when 'c' then 'C' when 'g_plus' then 'G+' when 'x_plus' then 'X+' else r.assessment_band end)
    or exists(select 1 from public.student_enrollment_history h left join public.course_enrollments e on e.history_key=h.id left join public.course_enrollment_assignments a on a.course_enrollment_id=e.id
      where e.id is null or a.id is null or h.student_id<>e.student_id or h.payload_sha256<>e.source_payload_sha256 or h.import_batch_id<>e.history_batch_id or h.imported_at<>e.history_imported_at
        or h.source_record_id<>e.source_record_id or h.source_field_ids<>e.source_field_ids or h.course_enrollment_id is not null
        or h.registered_on is distinct from e.registered_on or h.period_label<>e.period_label or h.amount is distinct from e.amount or h.amount_original<>e.amount_original
        or h.class_label<>a.class_label or h.teacher_label<>a.teacher_label or h.room_label<>a.room_label or h.schedule_label<>a.schedule_label)
    or exists(select 1 from public.student_communication_history h left join public.student_follow_ups f on f.history_key=h.id
      where f.id is null or h.student_id<>f.student_id or h.payload_sha256<>f.source_payload_sha256 or h.import_batch_id<>f.history_batch_id or h.imported_at<>f.history_imported_at
        or h.source_record_id<>f.source_record_id or h.source_field_ids<>f.source_field_ids or h.occurred_on is distinct from f.occurred_on
        or h.context_kind<>f.context_kind or h.content<>f.content or h.author_label is distinct from f.author_label or h.date_basis<>f.date_basis)
    then raise exception 'HISTORICAL_CANONICAL_MAPPING_MISMATCH'; end if;
end $verify$;

drop table public.student_renewal_history;
drop table public.student_activity_history;
drop table public.student_assessment_history;
drop table public.student_enrollment_history;
drop table public.student_communication_history;
