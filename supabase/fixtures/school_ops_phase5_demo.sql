-- P5-DEMO-20260905：虚构验收样例。由专用 runner 在一个事务中执行。
-- 复跑保留用户已操作的样例；存在同名前缀的半套数据时停止，避免覆盖。
do $$
declare
  v_seed constant text := 'P5-DEMO-20260905';
  v_cycle_name constant text := 'P5验收 · 暑期衔接→秋季续报';
  v_owner uuid := nullif(current_setting('mathin.seed_principal',true),'')::uuid;
  v_teacher uuid := nullif(current_setting('mathin.seed_teacher',true),'')::uuid;
  v_source uuid;
  v_target uuid;
  v_history uuid;
  v_course uuid;
  v_class uuid := '50500000-0905-4500-8501-000000000001';
  v_old_class uuid := '50500000-0905-4500-8501-000000000002';
  v_student uuid;
  v_membership uuid;
  v_cycle uuid;
  v_opportunity uuid;
  v_family uuid;
  v_contact uuid;
  v_referral uuid;
  v_lead uuid;
  v_result jsonb;
  v_signals uuid[] := '{}';
  v_memberships uuid[] := '{}';
  v_students uuid[] := '{}';
  v_names text[] := array['林知夏','陈星禾','许一诺','周予安','苏沐言','沈书宁','顾景行','唐可欣','陆思远','宋小满','江晨曦'];
  v_notes text[] := array[
    '待批量建立续报意向；可与02号一起选择。',
    '待批量建立续报意向；家长希望了解秋季上课安排。',
    '教师建议继续巩固应用题，等待学辅首次续报沟通。',
    '家长正在比较周末时间，已收到课程安排，约定再次联系。',
    '家长已认可课程方案，等待确认缴费与正式报名。',
    '已确认秋季报名，保留商业报名记录，便于查看成功样例。',
    '本轮因接送时间冲突暂不报名，保留后续关系。',
    '家长希望等家庭时间确定后再报，持续关注。',
    '历史学生，暂未创建重新报读意向，可现场新增。',
    '历史学生，已主动询问秋季复学，可继续跟进。',
    '转介绍家庭已显式确认学生身份，课程意向已建立。'];
  v_stage text;
  v_before_students integer;
  v_before_classes integer;
  v_before_memberships integer;
begin
  if (select system_identifier::text from pg_control_system())
      is distinct from current_setting('mathin.seed_expected_system_id',true) then
    raise exception 'SEED_TARGET_MISMATCH';
  end if;
  if v_owner is null or v_teacher is null or not public.has_perm(v_owner,'followup.write')
      or not public.has_perm(v_owner,'enrollment.manage') or not public.has_perm(v_teacher,'review.write') then
    raise exception 'FIXED_ACTOR_NOT_READY';
  end if;
  if exists(select 1 from public.renewal_cycles where name=v_cycle_name) then
    raise notice 'Existing demo preserved; no samples reset.';
    return;
  end if;
  if exists(select 1 from public.students where source=v_seed or name like 'P5验收%')
      or exists(select 1 from public.classrooms where id in (v_class,v_old_class)) then
    raise exception 'PARTIAL_DEMO_EXISTS_REVIEW_BEFORE_WRITING';
  end if;
  select t.id into v_source from public.school_terms t join public.school_years y on y.id=t.school_year_id
    where y.start_year=2026 and t.term=1 order by t.id limit 1;
  select t.id into v_target from public.school_terms t join public.school_years y on y.id=t.school_year_id
    where y.start_year=2026 and t.term=2 and t.campus_id=(select campus_id from public.school_terms where id=v_source)
    order by t.id limit 1;
  select t.id into v_history from public.school_terms t join public.school_years y on y.id=t.school_year_id
    where y.start_year=2025 and t.term=4 and t.campus_id=(select campus_id from public.school_terms where id=v_source)
    order by t.id limit 1;
  select id into v_course from public.courses where purpose='production' and status='enabled'
    and course_kind='curriculum' and trashed_at is null and grade=3 and title like '%秋季%' and class_type='A'
    order by title,id limit 1;
  if v_source is null or v_target is null or v_history is null or v_course is null then
    raise exception 'READ_ONLY_COURSE_OR_TERMS_UNAVAILABLE';
  end if;
  if exists(select 1 from public.enrollments where term_id=v_source and status='active') then
    raise exception 'SOURCE_TERM_HAS_EXISTING_MEMBERSHIPS';
  end if;
  select count(*) into v_before_students from public.students;
  select count(*) into v_before_classes from public.classrooms;
  select count(*) into v_before_memberships from public.enrollments;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',v_owner::text,true);

  for i in 1..11 loop
    v_student := ('50500000-0905-4500-8500-'||lpad(i::text,12,'0'))::uuid;
    v_students := array_append(v_students,v_student);
    insert into public.students(id,name,grade,status,follow_up_status,source,tags,remark,assigned_to,created_by,bind_code)
      values(v_student,'P5验收'||lpad(i::text,2,'0')||'·'||v_names[i],3,
        case when i<=8 then 'enrolled' when i<=10 then 'alumni' else 'lead' end,
        case when i<=8 then 'signed' when i<=10 then 'lost' else 'following' end,
        v_seed,array[v_seed,'虚构验收数据'],v_notes[i]||'【虚构验收资料】',v_owner,v_owner,
        substr(encode(extensions.gen_random_bytes(8),'hex'),1,8));
  end loop;
  insert into public.classrooms(id,owner_id,name,invite_code,course_id,grade,capacity,term_id,purpose,operational_status)
    values
      (v_class,v_teacher,'P5验收 · 三年级暑期衔接班','p5demo01',v_course,3,12,v_source,'test','active'),
      (v_old_class,v_teacher,'P5验收 · 三年级历史班','p5demo02',v_course,3,12,v_history,'test','active');
  insert into public.classroom_staff_assignments(classroom_id,user_id,responsibility,is_primary,created_by)
    select class_id,v_teacher,'primary_teacher',false,v_owner from unnest(array[v_class,v_old_class]) class_id
    union all select class_id,v_owner,'learning_support',true,v_owner from unnest(array[v_class,v_old_class]) class_id;
  insert into public.classroom_members(classroom_id,user_id,role)
    select class_id,v_teacher,'teacher' from unnest(array[v_class,v_old_class]) class_id;
  for i in 1..10 loop
    v_membership := ('50500000-0905-4500-8502-'||lpad(i::text,12,'0'))::uuid;
    v_memberships := array_append(v_memberships,v_membership);
    insert into public.enrollments(id,classroom_id,student_id,status,joined_at,left_at,term_id,remark,operated_by)
      values(v_membership,case when i<=8 then v_class else v_old_class end,v_students[i],
        case when i<=8 then 'active' else 'completed' end,
        case when i<=8 then '2026-07-01 00:00:00+08'::timestamptz else '2026-03-01 00:00:00+08'::timestamptz end,
        case when i<=8 then null else '2026-06-29 18:00:00+08'::timestamptz end,
        case when i<=8 then v_source else v_history end,v_seed,v_owner);
  end loop;
  v_cycle := public.create_renewal_cycle(v_cycle_name,v_source,v_target,current_date-7,current_date+14);
  perform public.set_renewal_cycle_status(v_cycle,'open');
  v_result := public.snapshot_renewal_cycle_memberships(v_cycle);
  if (v_result->>'eligible')::integer <> 8 then raise exception 'UNEXPECTED_ELIGIBILITY'; end if;
  perform public.prepare_renewal_opportunities(v_cycle,v_memberships[3:8],v_owner,
    '联系家长确认秋季课程与时间安排',now()+interval '2 days');

  for i in 3..8 loop
    v_stage := case i when 3 then 'planning' when 4 then 'considering' when 5 then 'committed'
      when 6 then 'committed' when 7 then 'not_enrolled' else 'nurturing' end;
    select opportunity_id into v_opportunity from public.renewal_cycle_entries
      where renewal_cycle_id=v_cycle and source_class_membership_id=v_memberships[i];
    perform public.save_course_opportunity(v_opportunity,null,null,null,'renewal',v_course,v_target,
      v_stage,v_owner,case i when 4 then '确认周末可上课时间' when 5 then '确认缴费并完成报名' else '根据家长反馈推进下一次联系' end,
      case when i=4 then now()-interval '1 day' else now()+interval '2 days' end,v_notes[i]);
    if i=5 then
      perform public.save_course_opportunity(v_opportunity,null,null,null,'renewal',v_course,v_target,
        'payment_pending',v_owner,'确认缴费并完成报名',now()+interval '1 day',v_notes[i]);
    elsif i=6 then
      perform public.confirm_course_enrollment(v_opportunity,v_notes[i]);
    end if;
  end loop;

  -- 以固定开发教师提交专业建议，显示真实教学来源与处理状态。
  perform set_config('request.jwt.claim.sub',v_teacher::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_teacher,'role','authenticated')::text,true);
  v_signals := array_append(v_signals,public.create_teacher_professional_signal(v_students[3],v_memberships[3],null,
    'renewal_recommendation','基础掌握稳定，建议秋季继续巩固多步应用题；请学辅联系家长。',v_course,v_target));
  v_signals := array_append(v_signals,public.create_teacher_professional_signal(v_students[4],v_memberships[4],null,
    'upsell_recommendation','课堂理解快，愿意主动讲解；建议讨论更高挑战的课程安排。',v_course,v_target));
  v_signals := array_append(v_signals,public.create_teacher_professional_signal(v_students[7],v_memberships[7],null,
    'churn_risk','家长提出接送困难，请先了解可行时段，避免直接反复催报名。',v_course,v_target));
  v_signals := array_append(v_signals,public.create_teacher_professional_signal(v_students[1],v_memberships[1],null,
    'upsell_recommendation','已与家长讨论思维拓展需求，建议建立加报意向后跟进。',v_course,v_target));
  v_signals := array_append(v_signals,public.create_teacher_professional_signal(v_students[9],v_memberships[9],null,
    'reactivation_recommendation','历史阶段表现积极，现有时间调整，适合重新了解复学计划。',v_course,v_target));
  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated')::text,true);
  perform public.resolve_teacher_professional_signal(v_signals[4],'accept',v_course,v_target,v_owner,
    '向家长说明加报课程内容',now()+interval '3 days','P5验收：已接入课程意向的建议对照样例。');
  perform public.save_course_opportunity(null,null,v_students[10],null,'reactivate',v_course,v_target,
    'considering',v_owner,'回访确认复学时间',now()+interval '1 day',v_notes[10]);

  -- 给推荐家庭补充可见的家庭／联系人关系，全部使用虚构标签与空联系方式。
  insert into public.families(display_name,owner_id,created_by)
    values('P5验收·林知夏家庭',v_owner,v_owner) returning id into v_family;
  insert into public.contacts(display_name,created_by)
    values('P5验收·林家长',v_owner) returning id into v_contact;
  insert into public.family_students(family_id,student_id,created_by) values(v_family,v_students[1],v_owner);
  insert into public.family_contacts(family_id,contact_id,is_primary,created_by) values(v_family,v_contact,true,v_owner);
  insert into public.student_contacts(student_id,contact_id,relation,is_primary,is_decision_maker,created_by)
    values(v_students[1],v_contact,'家长',true,true,v_owner);
  v_referral := public.attach_student_referral_source(v_students[1],v_family,v_contact,null,null,
    'P5验收12·待确认朋友','00000505012',3::smallint,'同班朋友','待建立学生身份，可查看来源关系与身份前置提示。');
  v_referral := public.attach_student_referral_source(v_students[1],v_family,v_contact,null,null,
    'P5验收11·江晨曦','00000505011',3::smallint,'邻居朋友','已确认身份的转介绍对照样例。');
  select referred_lead_id into v_lead from public.student_referrals where id=v_referral;
  perform public.assign_leads(array[v_lead],v_owner);
  perform public.confirm_lead_identity(v_lead,v_seed||'-referral-11',jsonb_build_object(
    'student',jsonb_build_object('mode','existing','id',v_students[11]),
    'family',jsonb_build_object('mode','create','displayName','P5验收·江晨曦家庭'),
    'contact',jsonb_build_object('mode','create','displayName','P5验收·江家长','phone','00000505011','wechat',''),
    'relationship',jsonb_build_object('relation','家长','preferredChannel','phone','isPrimaryFamily',true,'isPrimaryContact',true,'isDecisionMaker',true),
    'allowPossibleDuplicate',false,'allowAdditionalRelationship',false));
  perform public.convert_student_referral_to_opportunity(v_referral,v_course,v_target,v_owner,
    '联系推荐家庭介绍课程安排',now()+interval '2 days',v_seed);
  if (select count(*) from public.students) <> v_before_students+11
    or (select count(*) from public.classrooms) <> v_before_classes+2
    or (select count(*) from public.enrollments) <> v_before_memberships+10 then
    raise exception 'UNEXPECTED_SEED_COUNTS';
  end if;
end $$;

select jsonb_build_object(
  'dataset','P5-DEMO-20260905',
  'cycle',(select jsonb_build_object('id',id,'name',name) from public.renewal_cycles where name='P5验收 · 暑期衔接→秋季续报'),
  'students',(select count(*) from public.students where source='P5-DEMO-20260905'),
  'candidates',(select count(*) from public.renewal_cycle_entries e join public.renewal_cycles c on c.id=e.renewal_cycle_id
    where c.name='P5验收 · 暑期衔接→秋季续报' and e.opportunity_id is null),
  'opportunities',(select jsonb_agg(jsonb_build_object('id',o.id,'name',s.name,'type',o.opportunity_type,'stage',o.stage) order by s.name,o.opportunity_type)
    from public.course_opportunities o join public.students s on s.id=o.student_id where s.source='P5-DEMO-20260905'),
  'signals',(select jsonb_build_object('pending',count(*) filter(where status='pending'),'accepted',count(*) filter(where status='accepted'))
    from public.teacher_professional_signals where student_id in (select id from public.students where source='P5-DEMO-20260905')),
  'referrals',(select count(*) from public.student_referrals where referrer_student_id='50500000-0905-4500-8500-000000000001')
);
