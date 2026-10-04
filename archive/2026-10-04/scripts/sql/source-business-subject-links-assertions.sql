select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from public.profiles where role='admin' limit 1),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare target uuid;source text;version integer;
begin
  select id into target from public.students where deleted_at is null limit 1;
  select h.id into source from public.history_import_records h
    join public.activity_registrations r on r.source_record_id=h.id join public.assessment_results result on result.activity_registration_id=r.id
    where h.student_id is null and h.lead_id is null and r.student_id is null
      and h.record_data->>'tableName'='到访数据与信息表1.0-总' and jsonb_array_length(h.record_data->'names')=1
      and not exists(select 1 from public.history_import_associations a where a.record_id=h.id) limit 1;
  if source is null or target is null then raise exception 'SOURCE_SUBJECT_FIXTURE_REQUIRED';end if;
  begin
    version:=public.confirm_history_source(source,target,0,'assessment');
    if version<>1 or exists(select 1 from public.activity_registrations where source_record_id=source and (student_id is distinct from target or lead_id is not null))
      or exists(select 1 from public.assessment_results where source_record_id=source and (student_id is distinct from target or lead_id is not null)) then raise exception 'ASSESSMENT_SUBJECT_NOT_BOUND';end if;
    if public.confirm_history_source(source,target,0,'assessment')<>1 then raise exception 'SUBJECT_CONFIRM_NOT_IDEMPOTENT';end if;
    raise sqlstate 'PZ011';
  exception when sqlstate 'PZ011' then null;end;
  select h.id into source from public.history_import_records h join public.course_opportunities o on o.source_record_id=h.id
    where h.student_id is null and h.lead_id is null and o.student_id is null and o.opportunity_type='renewal' and jsonb_array_length(h.record_data->'names')=1
      and not exists(select 1 from public.history_import_associations a where a.record_id=h.id) limit 1;
  if source is null then raise exception 'SOURCE_RENEWAL_FIXTURE_REQUIRED';end if;
  begin
    perform public.confirm_history_source(source,target,0,'renewal');
    if exists(select 1 from public.course_opportunities where source_record_id=source and (student_id is distinct from target or lead_id is not null))
      or exists(select 1 from public.course_enrollments where source_record_id=source and student_id is distinct from target) then raise exception 'RENEWAL_SUBJECT_NOT_BOUND';end if;
    raise sqlstate 'PZ012';
  exception when sqlstate 'PZ012' then null;end;
end;
$$;
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ begin
  begin perform public.confirm_history_source('no-source','00000000-0000-0000-0000-000000000001',0,'renewal');raise exception 'ANON_CONFIRM_ALLOWED';
  exception when insufficient_privilege then null;end;
end;$$;
reset role;
select set_config('request.jwt.claims','{}',true);
