-- 在已有回滚夹具上核对生产摘要与逐题事实；不创建测试身份。
do $$
declare
  target_session uuid := current_setting('teaching.test.session')::uuid;
  teacher_id uuid := current_setting('teaching.test.teacher')::uuid;
  target_student uuid;
  rating text;
  response jsonb;
  metric jsonb;
  observations jsonb;
begin
  perform set_config('request.jwt.claim.sub',teacher_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher_id,'role','authenticated')::text,true);
  select r.student_id into target_student from public.session_learning_check_results r
    join public.session_learning_checks c on c.id=r.check_id where c.session_id=target_session limit 1;
  insert into public.session_learning_checks(session_id,title,position,created_by)
    values(target_session,'Unrecorded question',1,teacher_id);
  foreach rating in array array['explained','independent','prompted','imitated','incomplete'] loop
    update public.session_learning_check_results r set status=rating
      where r.check_id in(select id from public.session_learning_checks c where c.session_id=target_session);
    response := public.get_teaching_class_overview('2040-01-01Z','2040-02-01Z','mine');
    select value into metric from jsonb_array_elements(response->'metrics') where value->>'sessionId'=target_session::text;
    observations := metric->'observations';
    if (observations->>rating)::int<>1 or (observations->>'recordedChecks')::int<>1 or (observations->>'totalChecks')::int<>2
      or (select sum((observations->>key)::int) from unnest(array['explained','independent','prompted','imitated','incomplete']) key)<>1
      then raise exception 'LIVE_OBSERVATIONS_MISMATCH'; end if;
    if jsonb_array_length(observations->'focusChecks')<>(case when rating in('prompted','imitated','incomplete') then 1 else 0 end)
      then raise exception 'LIVE_FOCUS_MISMATCH'; end if;
    if rating='prompted' and observations #>> '{focusChecks,0,title}'<>'Actual question' then raise exception 'LIVE_FOCUS_TITLE_MISMATCH'; end if;
  end loop;
  insert into public.student_follow_ups(student_id,author_id,content,kind,created_at,occurred_on)
    values(target_student,teacher_id,'Earlier entry with explicit event date','class','2039-12-30Z','2040-01-08');
  response := public.get_teaching_class_overview('2040-01-05Z','2040-02-01Z','mine');
  if response #>> '{classContacts,0,count}'<>'1' or response #>> '{classContacts,0,latest,eventDate}'<>'2040-01-08'
    then raise exception 'LIVE_CONTACT_EVENT_DATE_MISMATCH'; end if;
end;
$$;
