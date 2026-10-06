-- Run inside an identified local transaction; the caller always rolls it back.
create function pg_temp.expect_short_course_error(statement text, expected text)
returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if position(expected in sqlerrm)>0 then return; end if;
    raise exception 'SHORT_COURSE_EXPECTED_%,GOT_%',expected,sqlerrm;
  end;
  raise exception 'SHORT_COURSE_EXPECTED_ERROR_%',expected;
end $$;

do $setup$
declare actor uuid:=current_setting('test.parent_preview.admin_user_id')::uuid;
  teacher uuid:=current_setting('test.parent_preview.teacher_user_id')::uuid;
  term uuid; payload jsonb; result jsonb; before_count integer; bad jsonb; request_id uuid:=gen_random_uuid();
begin
  if not exists(select 1 from public.profiles where id=actor and purpose='test' and role='admin')
    or not exists(select 1 from public.profiles where id=teacher and purpose='test') then raise exception 'FIXED_DEVELOPMENT_ACTORS_REQUIRED'; end if;
  select id into term from public.school_terms where is_current limit 1;
  if term is null then raise exception 'CURRENT_TERM_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  payload:=jsonb_build_object('requestId',request_id,'topic','Short-course permission check','name','Transactional batch',
    'termId',term,'startsOn','2026-10-13','sessionCount',2,'durationMin',90,
    'classes',jsonb_build_array(
      jsonb_build_object('key',gen_random_uuid(),'name','Short-course check A','level','beginner','grades',jsonb_build_array(2),
        'teacherId',teacher,'roomId',null,'capacity',20,'plannedStudents',9,
        'weeklySlots',jsonb_build_array(jsonb_build_object('weekday',2,'time','17:00'),jsonb_build_object('weekday',6,'time','14:00')),
        'sessions',jsonb_build_array(jsonb_build_object('name','Lesson 1','scheduledAt','2026-10-13T09:00:00Z'),jsonb_build_object('name','Lesson 2','scheduledAt','2026-10-17T06:00:00Z'))),
      jsonb_build_object('key',gen_random_uuid(),'name','Short-course check B','level','advanced','grades',jsonb_build_array(5,6),
        'teacherId',actor,'roomId',null,'capacity',20,'plannedStudents',8,
        'weeklySlots',jsonb_build_array(jsonb_build_object('weekday',2,'time','14:00'),jsonb_build_object('weekday',6,'time','16:30')),
        'sessions',jsonb_build_array(jsonb_build_object('name','Lesson 1','scheduledAt','2026-10-13T06:00:00Z'),jsonb_build_object('name','Lesson 2','scheduledAt','2026-10-17T08:30:00Z')))
    ));
  result:=public.create_short_course_batch(payload);
  if jsonb_array_length(result->'classroomIds')<>2 then raise exception 'CLASS_COUNT'; end if;
  if (select count(*) from public.class_sessions s join public.short_course_class_details d on d.classroom_id=s.classroom_id where d.batch_id=request_id)<>4 then raise exception 'SESSION_COUNT'; end if;
  if exists(select 1 from public.enrollments e join public.short_course_class_details d on d.classroom_id=e.classroom_id where d.batch_id=request_id) then raise exception 'PLANNED_COUNT_CREATED_ROSTER'; end if;
  if public.create_short_course_batch(payload) is distinct from result then raise exception 'RETRY_DUPLICATED_BATCH'; end if;
  perform set_config('test.short_course.payload',payload::text,true);
  perform set_config('test.short_course.batch',request_id::text,true);
  perform set_config('test.short_course.class_a',result#>>'{classroomIds,0}',true);
  perform set_config('test.short_course.class_b',result#>>'{classroomIds,1}',true);
  select count(*) into before_count from public.classrooms;
  bad:=jsonb_set(jsonb_set(payload,'{requestId}',to_jsonb(gen_random_uuid())),'{classes,1,teacherId}',to_jsonb(gen_random_uuid()));
  perform pg_temp.expect_short_course_error(format('select public.create_short_course_batch(%L::jsonb)',bad::text),'INVALID_STAFF');
  if (select count(*) from public.classrooms)<>before_count then raise exception 'PARTIAL_BATCH_CREATED'; end if;
  if exists(select 1 from public.short_course_batches where id=(bad->>'requestId')::uuid) then raise exception 'PARTIAL_BATCH_METADATA_CREATED'; end if;
  bad:=jsonb_set(payload,'{name}','"Changed after save"'::jsonb);
  perform pg_temp.expect_short_course_error(format('select public.create_short_course_batch(%L::jsonb)',bad::text),'REQUEST_ALREADY_SAVED');
end $setup$;

set local role authenticated;
do $admin_read$
declare payload jsonb:=current_setting('test.short_course.payload')::jsonb; draft jsonb; receipt jsonb; listed jsonb;
begin
  select jsonb_set(payload,'{classes}',jsonb_agg(item-'sessions' order by ordinal)) into draft
    from jsonb_array_elements(payload->'classes') with ordinality rows(item,ordinal);
  receipt:=public.get_short_course_batch_receipt(draft);
  if receipt->>'batchId'<>current_setting('test.short_course.batch') then raise exception 'LOST_RESPONSE_NOT_RECOVERED'; end if;
  listed:=public.list_short_courses(jsonb_build_object('batchId',current_setting('test.short_course.batch')));
  if (listed->>'total')::integer<>2 or jsonb_array_length(listed->'classes')<>2 then raise exception 'ADMIN_BATCH_COUNT'; end if;
  if (public.list_short_courses(jsonb_build_object('batchId',current_setting('test.short_course.batch')),2)->>'total')::integer<>2 then raise exception 'PAGINATION_TOTAL_CHANGED'; end if;
  if exists(select 1 from public.list_classrooms_for_scope('all','{"offeringType":"long_term_formal","q":"Short-course check"}'::jsonb,1)) then raise exception 'SHORT_CLASS_IN_LONG_LIST'; end if;
  if not exists(select 1 from public.list_classrooms_for_scope('all','{"offeringType":"short_term_topic","q":"Short-course check"}'::jsonb,1)) then raise exception 'SHORT_LIST_FILTER_MISSING'; end if;
end $admin_read$;

do $teacher_read$
declare listed jsonb;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.teacher_user_id'),'role','authenticated','aal','aal2')::text,true);
  listed:=public.list_short_courses(jsonb_build_object('batchId',current_setting('test.short_course.batch')));
  if (listed->>'total')::integer<>1 or listed#>>'{classes,0,id}'<>current_setting('test.short_course.class_a') then raise exception 'TEACHER_CLASS_SCOPE_LEAK'; end if;
  if public.get_short_course_metadata(current_setting('test.short_course.class_b')::uuid) is not null then raise exception 'TEACHER_METADATA_SCOPE_LEAK'; end if;
end $teacher_read$;

do $parent_read$
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.outsider_user_id'),'role','authenticated','aal','aal2')::text,true);
  perform pg_temp.expect_short_course_error('select public.list_short_courses()','FORBIDDEN');
  perform pg_temp.expect_short_course_error(format('select public.create_short_course_batch(%L::jsonb)',current_setting('test.short_course.payload')),'FORBIDDEN');
  if exists(select 1 from public.short_course_class_details) then raise exception 'PARENT_METADATA_LEAK'; end if;
end $parent_read$;
reset role;
