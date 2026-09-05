-- 虚构姓名与课堂记录，仅由本机专用 runner 执行；不改动既有样例。
do $$
declare
  v_seed constant text:='ROSTER-ACCEPTANCE-20260905';
  v_actor uuid:=current_setting('mathin.seed_principal')::uuid;
  v_teacher uuid:=current_setting('mathin.seed_teacher')::uuid;
  v_term uuid; v_courses uuid[]; v_classes uuid[]:='{}'; v_students uuid[]:='{}';
  v_class uuid; v_student uuid; v_enrollment uuid; v_member uuid; v_session uuid; v_activity uuid; v_registration uuid;
  v_grade smallint; v_class_index integer; v_before_accounts integer; v_before_students integer; v_before_classes integer;
  v_names text[]:=array['林沐','程澄','许安','周乐','苏宁','沈悦','顾言','唐欣','陆遥','宋满','江晨','陈星','叶芷','何屿','方晴','徐禾','吴悠','李然','赵可','韩枫','秦月','白露','夏橙','罗熙','杜奕','马诺','潘川','钟瑶','汪宸','魏清','金桐','蒋予','朱易','谢暖','邵泽','萧意'];
begin
  if (select system_identifier::text from pg_control_system()) is distinct from current_setting('mathin.seed_expected_system_id') then raise exception 'SEED_TARGET_MISMATCH'; end if;
  if v_actor is null or v_teacher is null or not public.has_perm(v_actor,'enrollment.manage') or not public.has_perm(v_teacher,'review.write') then raise exception 'FIXED_ACTOR_NOT_READY'; end if;
  perform pg_advisory_xact_lock(hashtext(v_seed));
  if exists(select 1 from public.students where source=v_seed) then
    if (select count(*) from public.students where source=v_seed)<>36 then raise exception 'PARTIAL_SEED_REQUIRES_REVIEW'; end if;
    return;
  end if;
  if exists(select 1 from public.classrooms where invite_code like 'roster905%') then raise exception 'DEMO_CLASS_CONFLICT'; end if;
  select id into v_term from public.school_terms where starts_on<=current_date and ends_on>=current_date order by starts_on desc,id limit 1;
  for v_grade in 4..5 loop
    select id into v_class from public.courses where grade=v_grade and status='enabled' and purpose='production' and course_kind='curriculum' and trashed_at is null and title like '%秋%' order by (class_type='A') desc,title,id limit 1;
    v_courses:=array_append(v_courses,v_class);
  end loop;
  if v_term is null or v_courses[1] is null or v_courses[2] is null then raise exception 'COURSE_AND_TERM_REQUIRED'; end if;
  select count(*) into v_before_accounts from auth.users;
  select count(*) into v_before_students from public.students;
  select count(*) into v_before_classes from public.classrooms;
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  for i in 1..4 loop
    v_class:=('f3380000-0905-4000-8001-'||lpad(i::text,12,'0'))::uuid;
    v_classes:=array_append(v_classes,v_class);
    v_grade:=case when i<=2 then 4 else 5 end;
    insert into public.classrooms(id,owner_id,name,invite_code,course_id,term_id,grade,capacity,purpose,offering_type,operational_status)
      values(v_class,v_teacher,'验收·'||v_grade||case when i%2=1 then 'A班' else 'B班' end,'roster905'||i,v_courses[v_grade-3],v_term,v_grade,case when i<=2 then 12 else 16 end,'production','long_term_formal','active');
    insert into public.classroom_staff_assignments(classroom_id,user_id,responsibility,is_primary,created_by)
      values(v_class,v_teacher,'primary_teacher',false,v_actor),(v_class,v_actor,'learning_support',true,v_actor);
    insert into public.classroom_members(classroom_id,user_id,role) values(v_class,v_teacher,'teacher');
    for j in 1..4 loop
      insert into public.class_sessions(classroom_id,term_id,title,scheduled_at,duration_min)
        values(v_class,v_term,'分班验收课次',date_trunc('week',now())+interval '5 days 1 hour'+(j-1)*interval '7 days'+(i-1)*interval '2 hours',90);
    end loop;
  end loop;
  for i in 1..36 loop
    v_grade:=case when i<=18 then 4 else 5 end;
    v_class_index:=case when i<=9 then 1 when i<=18 then 2 when i<=27 then 3 else 4 end;
    v_student:=public.create_student(v_names[i],v_grade,'','',v_seed,'','','虚构分班验收样例，姓名不对应真实学员。');
    v_students:=array_append(v_students,v_student);
    v_enrollment:=public.confirm_course_enrollment(public.save_course_opportunity(null,null,v_student,null,'new',v_courses[v_grade-3],v_term,'committed',v_actor,'',null,v_seed),v_seed);
    if i not in (9,17,18,27,35,36) then
      perform public.assign_course_enrollment(v_enrollment,v_classes[v_class_index],v_seed,now());
      update public.students set status='enrolled' where id=v_student and status='lead';
      if i%3<>0 then
        -- 仅本批虚构学生拥有过去的观察；新生从当前加入时间起计算，保持中性。
        update public.enrollments set joined_at=now()-interval '30 days' where student_id=v_student and status='active';
      end if;
      if i in (5,23) then update public.students set status='paused' where id=v_student; end if;
      if i in (8,34) then
        select id into v_member from public.enrollments where student_id=v_student and status='active';
        perform public.withdraw_student(v_member,'虚构退课样例');
        perform public.cancel_course_enrollment(v_enrollment,'虚构退课样例',now());
      end if;
    end if;
    if i%3=1 then
      insert into public.student_follow_ups(student_id,kind,content,author_id,created_at)
        values(v_student,'call','虚构验收：家长沟通已完成',v_actor,now()-interval '3 days'),(v_student,'call','虚构验收：已核对近期学习安排',v_actor,now()-interval '10 days');
    end if;
  end loop;
  for i in 1..4 loop
    for j in 1..3 loop
      insert into public.class_sessions(classroom_id,term_id,title,scheduled_at,started_at,ended_at,duration_min)
        values(v_classes[i],v_term,'虚构健康度观察课次',now()-j*interval '7 days',now()-j*interval '7 days',now()-j*interval '7 days'+interval '90 minutes',90) returning id into v_session;
      insert into public.session_attendance(session_id,student_id,status,marked_by,marked_at,note)
        select v_session,e.student_id,case when array_position(v_students,e.student_id)%3=2 then 'absent' else 'present' end,
          v_teacher,now()-j*interval '7 days',v_seed from public.enrollments e where e.classroom_id=v_classes[i] and e.status='active'
          and e.joined_at<now()-j*interval '7 days';
    end loop;
  end loop;
  v_activity:='f3380000-0905-4000-8002-000000000001';
  insert into public.activities(id,kind,title,scheduled_at,duration_min,location,capacity,remark,created_by)
    values(v_activity,'public_class','验收·公开课行内登记',now(),90,'本地验收教室',12,v_seed,v_actor);
  insert into public.public_class_segments(activity_id,kind,title,scheduled_at,duration_min,location,position,primary_teacher_id,created_by)
    values(v_activity,'trial_lesson','体验课',now(),40,'本地验收教室',1,v_teacher,v_actor),
      (v_activity,'group_assessment','课堂测评',now()+interval '40 minutes',20,'本地验收教室',2,v_teacher,v_actor),
      (v_activity,'parent_talk','家长沟通',now()+interval '60 minutes',30,'本地验收教室',3,v_teacher,v_actor);
  foreach v_student in array v_students[1:8] loop
    insert into public.activity_registrations(activity_id,student_id,status,operated_by) values(v_activity,v_student,'booked',v_actor) returning id into v_registration;
  end loop;
  if (select count(*) from auth.users)<>v_before_accounts or (select count(*) from public.students)<>v_before_students+36 or (select count(*) from public.classrooms)<>v_before_classes+4 then raise exception 'UNEXPECTED_SEED_COUNTS'; end if;
end $$;
select jsonb_build_object('dataset','ROSTER-ACCEPTANCE-20260905','students',(select count(*) from public.students where source='ROSTER-ACCEPTANCE-20260905'),
  'classes',(select count(*) from public.classrooms where invite_code like 'roster905%'),
  'paused',(select count(*) from public.students where source='ROSTER-ACCEPTANCE-20260905' and status='paused'),
  'withdrawn',(select count(*) from public.course_enrollments ce join public.students s on s.id=ce.student_id where s.source='ROSTER-ACCEPTANCE-20260905' and ce.status='cancelled'),
  'publicClassId','f3380000-0905-4000-8002-000000000001','termId',(select term_id from public.classrooms where invite_code='roster9051'));
