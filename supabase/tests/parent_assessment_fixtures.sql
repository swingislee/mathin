-- 仅嵌入 runner 的 BEGIN / ROLLBACK；使用当前固定身份，不创建账号。
do $scope$ begin
  if has_function_privilege('anon','public.parent_assessment_overview(uuid)','execute')
    or has_function_privilege('anon','public.request_parent_assessment(uuid,uuid,uuid,text[])','execute')
    or has_table_privilege('authenticated','public.lead_invitation_threads','insert')
    then raise exception 'PREVIEW_ASSESSMENT_ACL_FAILED';end if;
  if not exists(select 1 from jsonb_array_elements(public.miniapp_public_activities()) a
      where a->>'id'='b39b0b02-7000-4000-8000-000000000004')
    and exists(select 1 from public.activities where id='b39b0b02-7000-4000-8000-000000000004' and scheduled_at>now() and deleted_at is null)
    and exists(select 1 from public.miniapp_activity_publications where activity_id='b39b0b02-7000-4000-8000-000000000004' and enabled)
    then raise exception 'PREVIEW_PUBLIC_ACTIVITY_MISSING';end if;
  perform set_config('test.parent_preview.expected_schedule_count',(select (count(*)*2)::text from public.class_sessions
    where id in('b39b0b02-7000-4000-8000-000000000005','b39b0b02-7000-4000-8000-000000000006')
      and deleted_at is null and scheduled_at is not null),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.parent_user_id'),'role','authenticated','aal','aal2')::text,true);
end $scope$;

set local role authenticated;
do $parent$
declare
  v_first uuid:=current_setting('test.parent_preview.first_student_id')::uuid;
  v_second uuid:=current_setting('test.parent_preview.second_student_id')::uuid;
  v_teacher uuid:=current_setting('test.parent_preview.teacher_user_id')::uuid;
  v_overview jsonb;
  v_request jsonb;
  v_confirmed jsonb;
  v_original_time timestamptz;
  v_option text;
  v_id uuid:=gen_random_uuid();
  v_options text[]:=array[to_char((now() at time zone 'Asia/Shanghai')::date+3,'YYYY-MM-DD')||'@10:00'];
begin
  v_overview:=public.parent_assessment_overview(v_first);
  if not exists(select 1 from jsonb_array_elements(v_overview->'teachers') p where p->>'id'=v_teacher::text)
    then raise exception 'PREVIEW_CURRENT_TEACHER_MISSING';end if;
  if (select count(*) from public.get_my_schedule(now()-interval '100 years',now()+interval '100 years')
      where session_id in('b39b0b02-7000-4000-8000-000000000005','b39b0b02-7000-4000-8000-000000000006'))
      <>current_setting('test.parent_preview.expected_schedule_count')::integer
    then raise exception 'PREVIEW_FAMILY_SCHEDULE_MISSING';end if;
  if jsonb_array_length(public.miniapp_assessment_reports())=0 then raise exception 'PREVIEW_EXISTING_SENT_REPORT_REQUIRED';end if;

  select r into v_request from jsonb_array_elements(public.parent_assessment_overview(v_second)->'requests') r
    where r->>'id'='b39b0b02-7000-4000-8000-000000000003';
  if v_request is null then raise exception 'PREVIEW_SECOND_REQUEST_MISSING';end if;
  if (v_request->>'canConfirm')::boolean then
    v_option:=v_request->'sharedTimeOptions'->>0;
    v_original_time:=(v_request->>'updatedAt')::timestamptz;
    begin
      perform public.confirm_parent_assessment((v_request->>'id')::uuid,v_second,v_option,v_original_time+interval '1 second');
      raise exception 'PREVIEW_STALE_CONFIRM_ACCEPTED';
    exception when raise_exception then
      if sqlerrm<>'CONFLICT' then raise;end if;
    end;
    v_confirmed:=public.confirm_parent_assessment((v_request->>'id')::uuid,v_second,v_option,v_original_time);
    if v_confirmed->>'state'<>'confirmed' or v_confirmed->>'scheduledAt' is null then raise exception 'PREVIEW_CONFIRM_FAILED';end if;
    if public.confirm_parent_assessment((v_request->>'id')::uuid,v_second,v_option,v_original_time)<>v_confirmed
      then raise exception 'PREVIEW_CONFIRM_REPLAY_CHANGED';end if;
  end if;

  -- 未有人工申请时才运行完整新申请合同；现有业务操作保留并由外层回滚保护。
  if (v_overview->'eligibility'->>'canRequest')::boolean then
    v_request:=public.request_parent_assessment(v_id,v_first,v_teacher,v_options);
    if v_request->>'state'<>'awaiting_teacher' then raise exception 'PREVIEW_REQUEST_FAILED';end if;
    if public.request_parent_assessment(v_id,v_first,v_teacher,v_options)<>v_request then raise exception 'PREVIEW_REQUEST_REPLAY_CHANGED';end if;
    begin
      perform public.request_parent_assessment(v_id,v_first,v_teacher,array[replace(v_options[1],'@10:00','@16:00')]);
      raise exception 'PREVIEW_DIFFERENT_PAYLOAD_ACCEPTED';
    exception when raise_exception then
      if sqlerrm<>'IDEMPOTENCY_CONFLICT' then raise;end if;
    end;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',v_teacher,'role','authenticated','aal','aal2')::text,true);
    perform public.set_invitation_assessor_availability(v_id,v_options);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.parent_user_id'),'role','authenticated','aal','aal2')::text,true);
    select r into v_request from jsonb_array_elements(public.parent_assessment_overview(v_first)->'requests') r where r->>'id'=v_id::text;
    if not (v_request->>'canConfirm')::boolean then raise exception 'PREVIEW_TEACHER_RESPONSE_MISSING';end if;
    v_confirmed:=public.confirm_parent_assessment(v_id,v_first,v_options[1],(v_request->>'updatedAt')::timestamptz);
    if v_confirmed->>'state'<>'confirmed' then raise exception 'PREVIEW_FLOW_CONFIRM_FAILED';end if;
    if public.request_parent_assessment(v_id,v_first,v_teacher,v_options)<>v_confirmed
      then raise exception 'PREVIEW_FINAL_REQUEST_REPLAY_CHANGED';end if;
  end if;
end $parent$;

do $outsider$
declare v_student uuid:=current_setting('test.parent_preview.first_student_id')::uuid;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.outsider_user_id'),'role','authenticated','aal','aal2')::text,true);
  begin
    perform public.parent_assessment_overview(v_student);
    raise exception 'PREVIEW_OUTSIDER_READ_ACCEPTED';
  exception when raise_exception then
    if sqlerrm<>'FORBIDDEN' then raise;end if;
  end;
  begin
    perform public.request_parent_assessment(gen_random_uuid(),v_student,current_setting('test.parent_preview.teacher_user_id')::uuid,
      array[to_char((now() at time zone 'Asia/Shanghai')::date+3,'YYYY-MM-DD')||'@10:00']);
    raise exception 'PREVIEW_OUTSIDER_WRITE_ACCEPTED';
  exception when raise_exception then
    if sqlerrm<>'FORBIDDEN' then raise;end if;
  end;
end $outsider$;
reset role;
