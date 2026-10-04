select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from public.profiles where role='admin' limit 1),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare registration uuid;report uuid;payload jsonb;enrollment uuid;student uuid;classroom uuid;membership uuid;
begin
  select r.id into registration from public.activity_registrations r join public.assessment_results a on a.activity_registration_id=r.id where a.source_record_id is not null and a.score_max is null and a.result_source='legacy' and a.assessment_band is not null and r.status='attended' and not exists(select 1 from public.assessment_workflow_states w where w.registration_id=r.id) limit 1;
  if registration is null then raise exception 'SOURCE_ASSESSMENT_FIXTURE_REQUIRED';end if;
  payload:=public.get_activity_enrollment_context(registration,null);
  if jsonb_typeof(payload->'activityAt')<>'string' then raise exception 'SOURCE_ACTIVITY_DATE_INVALID';end if;
  begin
    perform public.save_assessment_workflow(registration,null,'visit',0,jsonb_build_object('stage','feedback'));
    select id into report from public.assessment_reports where registration_id=registration order by version desc limit 1;
    select a.payload into payload from public.assessment_reports a where id=report;
    if payload is null or payload->'totalScore'<>'null'::jsonb then raise exception 'SOURCE_REPORT_SCALE_INVENTED';end if;
    raise sqlstate 'PZ001';
  exception when sqlstate 'PZ001' then null;end;
  select e.id,e.student_id,c.id into enrollment,student,classroom from public.course_enrollments e
    join public.students s on s.id=e.student_id cross join jsonb_to_recordset(public.get_enrollment_workflow_options()->'classrooms') c(id uuid,"courseId" uuid,"termId" uuid,capacity integer,"activeCount" integer)
    join public.courses course on course.id=c."courseId"
    where e.source_record_id is not null and e.course_id is null and e.status='active' and s.deleted_at is null
      and course.grade=s.grade
      and not exists(select 1 from public.course_enrollments existing where existing.student_id=e.student_id and existing.course_id=c."courseId" and existing.term_id=c."termId" and existing.status='active')
      and not exists(select 1 from public.course_opportunities existing where existing.student_id=e.student_id and existing.course_id=c."courseId" and existing.term_id=c."termId" and existing.opportunity_type='new')
      and (c.capacity is null or c."activeCount"<c.capacity) limit 1;
  if enrollment is null then raise exception 'SOURCE_PLACEMENT_FIXTURE_REQUIRED';end if;
  begin
    membership:=public.prepare_source_enrollment(enrollment,student,classroom);
    if not exists(select 1 from public.enrollments where id=membership and student_id=student and classroom_id=classroom and status='active') then raise exception 'SOURCE_PLACEMENT_NOT_CREATED';end if;
    if not exists(select 1 from public.course_enrollments where id=enrollment and history_revision>0 and opportunity_id is not null) then raise exception 'SOURCE_MANUAL_REVISION_NOT_PROTECTED';end if;
    raise sqlstate 'PZ002';
  exception when sqlstate 'PZ002' then null;end;
end;
$$;
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$
begin
  begin
    perform public.get_business_source_records(array['not-a-record']);
    raise exception 'ANONYMOUS_SOURCE_ACCESS_ALLOWED';
  exception when insufficient_privilege then null;end;
end;
$$;
reset role;
select set_config('request.jwt.claims','{}',true);
