-- 复用隔离开发库已有员工；只创建事务内业务夹具，所有变更回滚。
begin;
do $$
declare
  actor uuid; outsider uuid; target_course uuid; target_term uuid;
  student_a uuid; student_b uuid; student_legacy uuid;
  activity_id uuid; registration_a uuid; registration_b uuid;
  class_a uuid:=gen_random_uuid(); class_b uuid:=gen_random_uuid(); class_other uuid:=gen_random_uuid();
  enrollment_a uuid; enrollment_b uuid; enrollment_legacy uuid; member_a uuid; member_b uuid; legacy_member uuid;
  contact_id uuid:=gen_random_uuid(); context jsonb; board jsonb; rejected boolean; next_at timestamptz:=now()+interval '1 day';
  lead_id uuid:=gen_random_uuid(); lead_registration uuid; segment_id uuid; public_activity uuid; public_registration uuid;
begin
  select id into actor from public.profiles where role='admin' and is_active order by created_at limit 1;
  select id into outsider from public.profiles where role in ('student','parent') and is_active order by created_at limit 1;
  if actor is null or outsider is null then raise exception 'FIXED_DEVELOPMENT_ACCOUNTS_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  select id into target_course from public.courses where status='enabled' and purpose='production'
    and course_kind='curriculum' and trashed_at is null order by created_at,id limit 1;
  select id into target_term from public.school_terms order by is_current desc,starts_on desc nulls last,id limit 1;
  student_a:=public.create_student('Contextual assertion A',4::smallint,'','','context-enroll-a','','','');
  student_b:=public.create_student('Contextual assertion B',4::smallint,'','','context-enroll-b','','','');
  student_legacy:=public.create_student('Contextual legacy assertion',4::smallint,'','','context-enroll-legacy','','','');
  insert into public.classrooms(id,owner_id,name,invite_code,course_id,term_id,grade,capacity,purpose,offering_type,operational_status)
    select class_a,actor,'Contextual assertion A',class_a::text,target_course,target_term,grade,1,'production','long_term_formal','active' from public.courses where id=target_course;
  insert into public.classrooms(id,owner_id,name,invite_code,course_id,term_id,grade,capacity,purpose,offering_type,operational_status)
    select class_b,actor,'Contextual assertion B',class_b::text,target_course,target_term,grade,4,'production','long_term_formal','active' from public.courses where id=target_course;
  insert into public.activities(kind,title,scheduled_at,created_by) values('assessment_1v1','Contextual assessment assertion',now(),actor) returning id into activity_id;
  insert into public.activity_registrations(activity_id,student_id,status,operated_by)
    values(activity_id,student_a,'attended',actor) returning id into registration_a;
  rejected:=false;
  begin perform public.confirm_activity_enrollment(registration_a,target_course,target_term,class_a,'');
    exception when others then if sqlerrm<>'PARTICIPATION_NOT_COMPLETED' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'UNFINISHED_ASSESSMENT_ALLOWED'; end if;
  update public.activity_registrations set assessment_started_at=now(),assessment_completed_at=now() where id=registration_a;
  perform public.save_post_activity_contact(registration_a,contact_id,'phone','unreachable','continue_follow_up','Call tomorrow',next_at);
  perform public.save_post_activity_contact(registration_a,contact_id,'phone','unreachable','continue_follow_up','Call tomorrow',next_at);
  if (select count(*) from public.activity_followup_contacts where registration_id=registration_a)<>1 then raise exception 'CONTACT_NOT_IDEMPOTENT'; end if;
  if exists(select 1 from public.course_opportunities where student_id=student_a) then raise exception 'CONTACT_FORCED_COURSE_OPPORTUNITY'; end if;
  context:=public.get_activity_enrollment_context(registration_a,null);
  if context#>>'{contacts,0,note}' is distinct from 'Call tomorrow'
    or (context#>>'{contacts,0,nextContactAt}')::timestamptz is distinct from next_at then raise exception 'CONTACT_RELOAD_FAILED'; end if;
  if not exists(select 1 from jsonb_array_elements(public.get_post_activity_followups()) item where item->>'registrationId'=registration_a::text) then raise exception 'FOLLOWUP_QUEUE_MISSING'; end if;
  rejected:=false;
  begin perform public.save_post_activity_contact(registration_a,contact_id,'wechat','connected','continue_follow_up','Changed request',next_at);
    exception when others then if sqlerrm<>'IDEMPOTENCY_CONFLICT' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'CONTACT_ID_REUSE_ALLOWED'; end if;
  enrollment_a:=public.confirm_activity_enrollment(registration_a,target_course,target_term,class_a,'Agreed class');
  if public.confirm_activity_enrollment(registration_a,target_course,target_term,class_a,'Agreed class') is distinct from enrollment_a then raise exception 'ENROLLMENT_NOT_IDEMPOTENT'; end if;
  select classroom_membership_id into member_a from public.course_enrollment_assignments where course_enrollment_id=enrollment_a and status='active';
  context:=public.get_activity_enrollment_context(registration_a,null);
  if context->>'enrollmentId' is distinct from enrollment_a::text or context->>'classroomName' is distinct from 'Contextual assertion A' then raise exception 'DIRECT_ENROLLMENT_ASSIGNMENT_FAILED'; end if;
  insert into public.activity_registrations(activity_id,student_id,status,operated_by,assessment_started_at,assessment_completed_at)
    values(activity_id,student_b,'attended',actor,now(),now()) returning id into registration_b;
  rejected:=false;
  begin perform public.confirm_activity_enrollment(registration_b,target_course,target_term,class_a,'Full class');
    exception when others then if sqlerrm<>'CLASS_FULL' then raise; end if; rejected:=true; end;
  if not rejected or exists(select 1 from public.course_enrollments where student_id=student_b)
    or exists(select 1 from public.course_opportunities where student_id=student_b) then raise exception 'DIRECT_ASSIGNMENT_NOT_ATOMIC'; end if;
  enrollment_b:=public.confirm_activity_enrollment(registration_b,target_course,target_term,null,'Availability agreed');
  if exists(select 1 from public.enrollments where student_id=student_b) then raise exception 'PENDING_ENROLLMENT_CREATED_ROSTER'; end if;
  perform public.move_enrollment_placement(enrollment_b,null,null,class_b);
  perform public.move_enrollment_placement(enrollment_a,member_a,class_a,class_b);
  if (select status from public.enrollments where id=member_a) is distinct from 'transferred_out' then raise exception 'TRANSFER_HISTORY_LOST'; end if;
  select classroom_membership_id into member_b from public.course_enrollment_assignments where course_enrollment_id=enrollment_a and status='active';
  perform public.move_enrollment_placement(enrollment_a,member_b,class_b,null);
  if (select status from public.course_enrollments where id=enrollment_a) is distinct from 'active'
    or exists(select 1 from public.course_enrollment_assignments where course_enrollment_id=enrollment_a and status='active') then raise exception 'RETURN_PENDING_CANCELLED_ENROLLMENT'; end if;
  perform public.move_enrollment_placement(enrollment_a,null,null,class_a);
  rejected:=false;
  begin perform public.move_enrollment_placement(enrollment_a,null,class_b,null);
    exception when others then if sqlerrm<>'PLACEMENT_CHANGED' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'STALE_PLACEMENT_ALLOWED'; end if;
  insert into public.enrollments(classroom_id,student_id,term_id,status,joined_at,operated_by)
    values(class_b,student_legacy,target_term,'active',now(),actor) returning id into legacy_member;
  perform public.save_course_opportunity(null,null,student_legacy,null,'new',target_course,target_term,'planning',null,'',null,'Legacy context');
  board:=public.get_enrollment_placement_board();
  if not exists(select 1 from jsonb_array_elements(board->'members') item where item->>'membershipId'=legacy_member::text and item->>'enrollmentId' is null) then raise exception 'LEGACY_ROSTER_HIDDEN'; end if;
  enrollment_legacy:=public.move_enrollment_placement(null,legacy_member,class_b,null);
  if not exists(select 1 from public.course_enrollments where id=enrollment_legacy and student_id=student_legacy and status='active') then raise exception 'LEGACY_ROSTER_BRIDGE_FAILED'; end if;

  insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,grade_hint,owner_id,status,created_by)
    values(lead_id,'Contextual lead assertion','contextual lead assertion','19999999091','19999999091',4,actor,'contacted',actor);
  insert into public.activity_registrations(activity_id,lead_id,status,operated_by,assessment_started_at,assessment_completed_at)
    values(activity_id,lead_id,'attended',actor,now(),now()) returning id into lead_registration;
  perform public.save_post_activity_contact(lead_registration,gen_random_uuid(),'wechat','connected','await_product','Waiting for course',null);
  rejected:=false;
  begin perform public.confirm_activity_enrollment(lead_registration,target_course,target_term,null,'');
    exception when others then if sqlerrm<>'IDENTITY_NOT_CONFIRMED' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'IMPLICIT_IDENTITY_CREATED'; end if;

  insert into public.activities(kind,title,scheduled_at,created_by) values('public_class','Contextual public class assertion',now(),actor) returning id into public_activity;
  insert into public.activity_registrations(activity_id,student_id,status,operated_by) values(public_activity,student_b,'booked',actor) returning id into public_registration;
  insert into public.public_class_segments(activity_id,kind,title,scheduled_at,duration_min,position)
    values(public_activity,'trial_lesson','Trial',now(),60,1) returning id into segment_id;
  insert into public.public_class_participant_records(activity_id,segment_id,registration_id,student_presence)
    values(public_activity,segment_id,public_registration,'attended')
    on conflict on constraint public_class_participant_records_segment_id_registration_id_key do update set student_presence='attended';
  if (public.get_activity_enrollment_context(public_registration,null)->>'eligible')::boolean is distinct from true then raise exception 'PUBLIC_CLASS_ATTENDANCE_NOT_RECOGNIZED'; end if;
  if public.confirm_activity_enrollment(public_registration,target_course,target_term,null,'Second source, existing enrollment') is distinct from enrollment_b then raise exception 'SECOND_SOURCE_DUPLICATED_ENROLLMENT'; end if;

  rejected:=false;
  begin update public.activity_followup_contacts set note='overwrite' where id=contact_id;
    exception when others then if sqlerrm<>'ENROLLMENT_HISTORY_APPEND_ONLY' then raise; end if; rejected:=true; end;
  if not rejected or has_table_privilege('authenticated','public.activity_followup_contacts','INSERT') then raise exception 'CONTACT_HISTORY_MUTABLE'; end if;
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  rejected:=false;
  begin perform public.confirm_activity_enrollment(registration_a,target_course,target_term,null,'');
    exception when others then if sqlerrm<>'FORBIDDEN' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'UNAUTHORIZED_ENROLLMENT_ALLOWED'; end if;
  rejected:=false;
  begin perform public.save_post_activity_contact(registration_a,gen_random_uuid(),'phone','connected','closed','',null);
    exception when others then if sqlerrm<>'FORBIDDEN' then raise; end if; rejected:=true; end;
  if not rejected then raise exception 'UNAUTHORIZED_CONTACT_ALLOWED'; end if;
  execute 'set local role authenticated';
  if exists(select 1 from public.activity_followup_contacts where id=contact_id) then raise exception 'CONTACT_RLS_LEAK'; end if;
  execute 'reset role';
  if has_function_privilege('anon','public.confirm_activity_enrollment(uuid,uuid,uuid,uuid,text)','EXECUTE')
    or has_function_privilege('anon','public.get_activity_enrollment_context(uuid,uuid)','EXECUTE') then raise exception 'ANON_EXECUTE_GRANTED'; end if;
  raise notice 'Contextual enrollment: source eligibility, contact persistence/idempotency, direct/pending enrollment, full-class rollback, transfer/unassign, legacy roster, identity gate, public-class source, and RLS passed';
end $$;
rollback;
