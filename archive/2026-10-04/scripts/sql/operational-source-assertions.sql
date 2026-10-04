-- 在导入事务内核对工作台读取和原有访问边界，试跑整体回滚。
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from public.profiles where role='admin' limit 1),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare source_result uuid;payload jsonb;
begin
  if not public.is_admin(auth.uid()) then raise exception 'FIXED_ADMIN_REQUIRED';end if;
  if not exists(select 1 from public.leads where source_record_id is not null) then raise exception 'LEAD_WORKBENCH_SOURCE_MISSING';end if;
  if not exists(select 1 from public.activity_registrations where source_record_id is not null and record_state='current') then raise exception 'ASSESSMENT_WORKBENCH_SOURCE_MISSING';end if;
  if not exists(select 1 from public.course_enrollments where student_id is null and source_record_id is not null) then raise exception 'PENDING_ENROLLMENT_NOT_READABLE';end if;
  payload:=public.get_enrollment_placement_board();
  if payload is null then raise exception 'PLACEMENT_BOARD_MISSING';end if;
  select id into source_result from public.assessment_results where source_record_id is not null limit 1;
  payload:=public.get_business_record_revision('assessment',source_result);
  if payload->'sections' is null then raise exception 'SOURCE_REVISION_UNAVAILABLE';end if;
  begin
    update public.assessment_results set assessment_band='below_a' where id=source_result;
    raise exception 'LEGACY_BAND_WRITE_ALLOWED';
  exception when check_violation or insufficient_privilege then null;end;
end;
$$;
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$
begin
  begin
    perform 1 from public.course_enrollments where source_record_id is not null;
    if found then raise exception 'ANONYMOUS_SOURCE_READ_ALLOWED';end if;
  exception when insufficient_privilege then null;end;
end;
$$;
reset role;
select set_config('request.jwt.claims','{}',true);
set local role postgres;
