savepoint record_entry_context;
do $test$
declare actor uuid; teacher uuid; lead uuid:=gen_random_uuid(); at_time timestamptz:=((now() at time zone 'Asia/Shanghai')::date+2+time '10:00') at time zone 'Asia/Shanghai'; slot text; result jsonb; summary jsonb;
begin
  select id into actor from auth.users where email='test-admin@mathin.local';
  select id into teacher from auth.users where email='test-teacher@mathin.local';
  if actor is null or teacher is null then raise exception 'FIXED_IDENTITIES_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,status,owner_id,created_by)
    values(lead,'entry-contract-'||lead,'entry-contract-'||lead,'600000008859','600000008859','uncontacted',actor,actor);
  slot:=to_char(at_time at time zone 'Asia/Shanghai','YYYY-MM-DD"@"HH24:MI');
  result:=public.save_student_record_entry(gen_random_uuid(),jsonb_build_object('studentId',null,'leadId',lead,'mode','invitation','note','Planned appointment',
    'invitation',jsonb_build_object('kind','assessment_1v1','state','confirmed','activityId',null,'assessorId',teacher,
      'parentTimeOptions',jsonb_build_array(slot),'assessorTimeOptions',jsonb_build_array(slot),'scheduledAt',at_time,'locationText','')));
  summary:=public.list_student_record_summaries('awaiting_assessment','all',result->'subject'->>'studentId','records');
  if summary->'rows'->0->'invitation' is distinct from result->'subject'->'invitation'
    or summary->'rows'->0->'invitation'->>'id' is null then raise exception 'EXISTING_INVITATION_CONTEXT_LOST'; end if;
end;
$test$;
rollback to savepoint record_entry_context;
