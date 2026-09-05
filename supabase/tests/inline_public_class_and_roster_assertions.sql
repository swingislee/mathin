-- 仅在本机隔离事务中运行，回滚全部业务夹具。
do $$
declare actor uuid; outsider uuid; v_course uuid; v_term uuid; class_a uuid:=gen_random_uuid(); class_b uuid:=gen_random_uuid();
  s1 uuid; s2 uuid; s3 uuid; e1 uuid; e2 uuid; e3 uuid; m1 uuid; m2 uuid;
  activity uuid; registration uuid; records jsonb; changed jsonb; rejected boolean; board jsonb;
begin
  select id into actor from public.profiles where role='admin' and is_active order by created_at limit 1;
  select id into outsider from public.profiles where role in ('student','parent') and is_active order by created_at limit 1;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  select id into v_course from public.courses where status='enabled' and purpose='production' and course_kind='curriculum' and trashed_at is null order by id limit 1;
  select id into v_term from public.school_terms order by is_current desc,starts_on desc nulls last limit 1;
  insert into public.classrooms(id,owner_id,name,invite_code,course_id,term_id,grade,capacity,purpose,offering_type,operational_status)
    select class_a,actor,'Seat assertion A',class_a::text,v_course,v_term,grade,4,'production','long_term_formal','active' from public.courses where id=v_course;
  insert into public.classrooms(id,owner_id,name,invite_code,course_id,term_id,grade,capacity,purpose,offering_type,operational_status)
    select class_b,actor,'Seat assertion B',class_b::text,v_course,v_term,grade,4,'production','long_term_formal','active' from public.courses where id=v_course;
  s1:=public.create_student('Seat assertion A',4::smallint,'','','seat-assertion','','','');
  s2:=public.create_student('Seat assertion B',4::smallint,'','','seat-assertion','','','');
  s3:=public.create_student('Seat assertion C',4::smallint,'','','seat-assertion','','','');
  e1:=public.confirm_course_enrollment(public.save_course_opportunity(null,null,s1,null,'new',v_course,v_term,'committed',actor,'',null,''),'');
  e2:=public.confirm_course_enrollment(public.save_course_opportunity(null,null,s2,null,'new',v_course,v_term,'committed',actor,'',null,''),'');
  e3:=public.confirm_course_enrollment(public.save_course_opportunity(null,null,s3,null,'new',v_course,v_term,'committed',actor,'',null,''),'');
  perform public.assign_course_enrollment(e1,class_a,'',now());
  perform public.assign_course_enrollment(e2,class_a,'',now());
  perform public.assign_course_enrollment(e3,class_b,'',now());
  select id into m1 from public.enrollments where student_id=s1 and status='active';
  select id into m2 from public.enrollments where student_id=s2 and status='active';
  perform public.move_enrollment_to_seat(e1,m1,class_a,class_a,2,1);
  if (select placement_seat from public.enrollments where id=m1)<>2 or (select placement_seat from public.enrollments where id=m2)<>1 then raise exception 'SEAT_SWAP_NOT_PERSISTED'; end if;
  rejected:=false; begin perform public.move_enrollment_to_seat(e1,m1,class_a,class_a,3,1);
    exception when others then if sqlerrm<>'PLACEMENT_CHANGED' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'STALE_SEAT_ALLOWED'; end if;
  rejected:=false; begin perform public.move_enrollment_to_seat(e1,m1,class_a,class_b,1,2);
    exception when others then if sqlerrm<>'SEAT_OCCUPIED' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'OCCUPIED_SEAT_ALLOWED'; end if;
  perform public.move_enrollment_to_seat(e1,m1,class_a,class_b,3,2);
  if not exists(select 1 from public.enrollments where student_id=s1 and classroom_id=class_b and status='active' and placement_seat=3) then raise exception 'TARGET_SEAT_NOT_SAVED'; end if;
  perform public.withdraw_student(m2,'Withdrawal assertion');
  perform public.cancel_course_enrollment(e2,'Withdrawal assertion',now());
  board:=public.get_enrollment_placement_board();
  if not exists(select 1 from jsonb_array_elements(board->'members') x where x->>'studentId'=s2::text and x->>'status'='withdrawn') then raise exception 'WITHDRAWAL_HIDDEN'; end if;
  insert into public.activities(kind,title,scheduled_at,created_by) values('public_class','Inline assertion',now(),actor) returning id into activity;
  insert into public.public_class_segments(activity_id,kind,title,scheduled_at,duration_min,position,created_by)
    values(activity,'trial_lesson','Trial',now(),45,1,actor),(activity,'parent_talk','Parents',now(),30,2,actor);
  insert into public.activity_registrations(activity_id,student_id,status,operated_by) values(activity,s1,'booked',actor) returning id into registration;
  select jsonb_agg(jsonb_build_object('segmentId',segment_id,'expectedUpdatedAt',updated_at,'studentPresence','attended','guardianPresence','attended',
    'learningObservation','Observation','assessmentSummary','Assessment','parentFeedback','Parent','recommendation','Ready') order by segment_id) into records
    from public.public_class_participant_records where registration_id=registration;
  if jsonb_array_length(records)<2 then raise exception 'SEGMENT_FIXTURE_MISSING'; end if;
  changed:=jsonb_set(records,array[(jsonb_array_length(records)-1)::text,'expectedUpdatedAt'],'"2001-01-01T00:00:00Z"');
  rejected:=false; begin perform public.save_public_class_registration_bundle(activity,registration,changed);
    exception when others then if sqlerrm<>'PUBLIC_CLASS_RECORD_CHANGED' then raise; end if; rejected:=true; end;
  if not rejected or exists(select 1 from public.public_class_participant_records where registration_id=registration and learning_observation='Observation') then raise exception 'PARTIAL_CLASS_RECORD_WRITE'; end if;
  perform public.save_public_class_registration_bundle(activity,registration,records);
  if (select count(*) from public.public_class_participant_records where registration_id=registration and learning_observation='Observation')<>jsonb_array_length(records) then raise exception 'BUNDLE_NOT_SAVED'; end if;
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  rejected:=false; begin perform public.save_public_class_registration_bundle(activity,registration,records);
    exception when others then if sqlerrm<>'FORBIDDEN' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'OUTSIDER_CLASS_WRITE_ALLOWED'; end if;
  rejected:=false; begin perform public.move_enrollment_to_seat(e3,null,null,class_b,4,null);
    exception when others then if sqlerrm<>'FORBIDDEN' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'OUTSIDER_SEAT_WRITE_ALLOWED'; end if;
  raise notice 'PASS: seat swaps, stale edits, occupied targets, transfer, withdrawal visibility, atomic class records, and scope.';
end $$;
