-- 调用方先在同一事务内写入转换样本，完成断言后 rollback；复用既有身份。
do $test$
declare
  admin_id uuid;
  other_id uuid;
  relation_name text;
  expected_count integer;
  visible_count integer;
  write_rejected boolean;
  mismatch_rejected boolean := false;
  target_student uuid;
  another_student uuid;
begin
  select id into strict admin_id from public.profiles where role='admin' order by id limit 1;
  select id into strict other_id from public.profiles where role<>'admin' order by id limit 1;
  foreach relation_name in array array['student_renewal_history','student_activity_history','student_assessment_history','student_enrollment_history','student_communication_history'] loop
    if not (select relrowsecurity from pg_class where oid=('public.'||relation_name)::regclass) then raise exception 'HISTORY_BUSINESS_RLS_REQUIRED'; end if;
    if has_table_privilege('anon','public.'||relation_name,'SELECT')
      or has_table_privilege('authenticated','public.'||relation_name,'INSERT,UPDATE,DELETE')
      or has_table_privilege('service_role','public.'||relation_name,'INSERT,UPDATE,DELETE') then raise exception 'HISTORY_BUSINESS_GRANTS'; end if;
    execute format('select count(*) from public.%I',relation_name) into expected_count;
    if expected_count=0 then raise exception 'HISTORY_BUSINESS_SAMPLE_REQUIRED'; end if;
    perform set_config('request.jwt.claim.sub',admin_id::text,true);
    set local role authenticated;
    execute format('select count(*) from public.%I',relation_name) into visible_count;
    if visible_count<>expected_count then raise exception 'HISTORY_BUSINESS_ADMIN_READ'; end if;
    write_rejected:=false;
    begin
      execute format('update public.%I set source_field_ids=source_field_ids',relation_name);
    exception when insufficient_privilege then write_rejected:=true;
    end;
    if not write_rejected then raise exception 'HISTORY_BUSINESS_WEB_WRITE_ALLOWED'; end if;
    reset role;
    perform set_config('request.jwt.claim.sub',other_id::text,true);
    set local role authenticated;
    execute format('select count(*) from public.%I',relation_name) into visible_count;
    if visible_count<>0 then raise exception 'HISTORY_BUSINESS_NONADMIN_LEAK'; end if;
    reset role;
  end loop;
  select student_id into strict target_student from public.student_renewal_history order by id limit 1;
  select id into strict another_student from public.students where id<>target_student order by id limit 1;
  begin
    insert into public.student_renewal_history(id,student_id,import_batch_id,source_record_id,source_field_ids,payload_sha256,period_key,decision_note)
      select '__mismatched_history_identity__',another_student,import_batch_id,source_record_id,source_field_ids,payload_sha256,period_key,decision_note
      from public.student_renewal_history order by id limit 1;
  exception when foreign_key_violation then mismatch_rejected:=true;
  end;
  if not mismatch_rejected then raise exception 'HISTORY_BUSINESS_IDENTITY_MISMATCH_ALLOWED'; end if;
end $test$;
