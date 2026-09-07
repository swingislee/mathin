-- 实际使用时确认学生，同一来源的业务记录一起接入该学生。
create or replace function public.bind_confirmed_source_business() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' and old.student_id is distinct from new.student_id and (
    exists(select 1 from public.course_enrollment_assignments a join public.course_enrollments e on e.id=a.course_enrollment_id where e.source_record_id=new.record_id and a.classroom_id is not null)
    or exists(select 1 from public.assessment_reports report join public.activity_registrations r on r.id=report.registration_id where r.source_record_id=new.record_id)
  ) then raise exception 'SOURCE_IN_USE';end if;
  update public.activity_registrations set student_id=new.student_id,lead_id=null
    where source_record_id=new.record_id and student_id is distinct from new.student_id;
  update public.assessment_results set student_id=new.student_id,lead_id=null
    where source_record_id=new.record_id and student_id is distinct from new.student_id;
  update public.course_opportunities set student_id=new.student_id,lead_id=null
    where source_record_id=new.record_id and student_id is distinct from new.student_id;
  update public.course_enrollments set student_id=new.student_id
    where source_record_id=new.record_id and student_id is distinct from new.student_id;
  return new;
end;
$$;
