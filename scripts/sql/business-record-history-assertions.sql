-- 调用方在本机事务中执行，固定开发身份只用于权限核对。
do $test$
declare admin_id uuid; other_id uuid; relation text; expected integer; visible integer;
  registration_id uuid; opportunity_id uuid; enrollment_id uuid; subject_id uuid; historical_activity_id uuid;
  command text; rejected boolean; facts jsonb;
begin
  select id into strict admin_id from public.profiles where role='admin' order by id limit 1;
  select id into strict other_id from public.profiles where role<>'admin' order by id limit 1;
  foreach relation in array array['activities','activity_registrations','assessment_results','course_opportunities','course_enrollments','course_enrollment_assignments','student_follow_ups'] loop
    execute format('select count(*) from public.%I where record_state=''historical''',relation) into expected;
    if expected=0 then raise exception 'HISTORICAL_SAMPLE_REQUIRED'; end if;
    perform set_config('request.jwt.claim.sub',admin_id::text,true);set local role authenticated;
    execute format('select count(*) from public.%I where record_state=''historical''',relation) into visible;
    if visible<>expected then raise exception 'HISTORICAL_ADMIN_READ'; end if;
    reset role;perform set_config('request.jwt.claim.sub',other_id::text,true);set local role authenticated;
    execute format('select count(*) from public.%I where record_state=''historical''',relation) into visible;
    if visible<>0 then raise exception 'HISTORICAL_NONADMIN_LEAK'; end if;
    reset role;perform set_config('request.jwt.claim.sub','',true);
    rejected:=false;
    begin execute format('update public.%I set history_key=history_key where record_state=''historical''',relation);
    exception when raise_exception then if sqlerrm='HISTORICAL_RECORD_READ_ONLY' then rejected:=true;else raise;end if;end;
    if not rejected then raise exception 'HISTORICAL_UPDATE_ALLOWED';end if;
  end loop;
  select r.id,r.student_id,r.activity_id into strict registration_id,subject_id,historical_activity_id from public.activity_registrations r where record_state='historical' order by r.id limit 1;
  select id into strict opportunity_id from public.course_opportunities where record_state='historical' order by id limit 1;
  select id into strict enrollment_id from public.course_enrollments where record_state='historical' order by id limit 1;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);set local role authenticated;
  foreach command in array array[
    format('select public.begin_activity_assessment(%L::uuid)',registration_id),
    format('select public.mark_activity_result(%L::uuid,''attended'',''test'')',registration_id),
    format('select public.save_assessment_workbench_route(%L::uuid,''closed'',''test'')',registration_id),
    format('select public.confirm_course_enrollment(%L::uuid,''test'')',opportunity_id),
    format('select public.cancel_course_enrollment(%L::uuid,''test'')',enrollment_id),
    format('select public.assign_course_enrollment(%L::uuid,null,''test'')',enrollment_id),
    format('select public.get_activity_enrollment_context(%L::uuid,null)',registration_id)
  ] loop
    rejected:=false;
    begin execute command;exception when raise_exception then if sqlerrm='HISTORICAL_RECORD_READ_ONLY' then rejected:=true;else raise;end if;end;
    if not rejected then raise exception 'HISTORICAL_RPC_WRITE_ALLOWED';end if;
  end loop;
  facts:=public.get_course_opportunity_workbench();
  if facts::text like '%'||opportunity_id::text||'%' then raise exception 'HISTORICAL_CURRENT_OPPORTUNITY_LEAK';end if;
  facts:=public.get_course_enrollment_workbench();
  if facts::text like '%'||enrollment_id::text||'%' then raise exception 'HISTORICAL_CURRENT_ENROLLMENT_LEAK';end if;
  perform public.get_enrollment_placement_board();
  reset role;perform set_config('request.jwt.claim.sub','',true);
  foreach command in array array[
    'insert into public.activities(kind,title,scheduled_at) values(''assessment_1v1'',''constraint test'',null)',
    format('insert into public.course_opportunities(student_id) values(%L::uuid)',subject_id),
    format('insert into public.course_enrollments(student_id) values(%L::uuid)',subject_id),
    format('insert into public.student_follow_ups(student_id,content) values(%L::uuid,''constraint test'')',subject_id)
  ] loop
    rejected:=false;
    begin execute command;exception when check_violation or not_null_violation then rejected:=true;end;
    if not rejected then raise exception 'CURRENT_REQUIRED_FIELDS_RELAXED';end if;
  end loop;
  rejected:=false;
  begin insert into public.activity_registrations(activity_id,student_id) values(historical_activity_id,subject_id);
  exception when raise_exception then if sqlerrm='HISTORICAL_RECORD_RELATION_MISMATCH' then rejected:=true;else raise;end if;end;
  if not rejected then raise exception 'HISTORICAL_PARENT_CURRENT_CHILD_ALLOWED';end if;
end $test$;
