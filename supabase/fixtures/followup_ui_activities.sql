-- 只新增带批次标记的活动课，不创建身份、学生、班级、课次或报名。
do $seed$
declare
  seed_key constant text := 'FOLLOWUP-UI-20260906';
  subjects constant text[] := array['数字积木与找规律','图形拼搭与空间观察','数独入门与有序推理','行程初步与路线规划',
    '分数模型与图解应用','比例数感与衔接体验','有理数与数轴实验','几何探究与全等拼图',
    '函数图像与综合应用','函数建模与图像变换','解析几何与轨迹探索','导数应用与综合梳理'];
  first_monday date := date_trunc('week', now() at time zone 'Asia/Shanghai')::date + 7;
  g integer; session_no integer; aid uuid; activity_time timestamptz; extra record;
  existing_count integer; before_accounts bigint; before_students bigint; before_classes bigint;
begin
  if (select system_identifier::text from pg_control_system()) <> current_setting('mathin.seed_expected_system_id') then raise exception 'LOCAL_DATABASE_FINGERPRINT_MISMATCH'; end if;
  if auth.uid() is null or not public.has_perm(auth.uid(), 'activity.manage') then raise exception 'FIXED_ACTIVITY_MANAGER_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext(seed_key));
  select count(*) into existing_count from public.activities where remark like seed_key || ':%';
  if existing_count > 0 then
    if existing_count <> 30 then raise exception 'EXISTING_ACTIVITY_DEMO_REQUIRES_REVIEW'; end if;
    return; -- 保留人工验收后的修改；重复运行复用整批活动，不重排时间或还原内容。
  end if;
  select count(*) into before_accounts from auth.users;
  select count(*) into before_students from public.students;
  select count(*) into before_classes from public.classrooms;
  for g in 1..12 loop
    for session_no in 1..2 loop
      activity_time := (first_monday + ((g - 1) / 3) + ((session_no - 1) * 7)
        + case when session_no=1 then time '16:30' else time '10:00' end) at time zone 'Asia/Shanghai';
      aid := public.create_activity('trial_class', '验收课 · ' || subjects[g] || case when session_no=2 then '（第二场）' else '' end,
        activity_time, 60::smallint, '验收教室 ' || case when g<=6 then 'A' else 'B' end, 12::smallint,
        seed_key || ':grade-' || g || '-session-' || session_no || '；虚构活动，仅用于跟进周课表人工验收。');
      perform public.set_activity_target_grades(aid,array[g::smallint]);
    end loop;
  end loop;
  for extra in select * from (values
    (1,'数学游戏开放课',0,time '14:00','{}'::smallint[]),
    (2,'空间拼搭体验课',0,time '17:00','{}'::smallint[]),
    (3,'低段数独挑战',2,time '10:00','{1,2,3}'::smallint[]),
    (4,'高段数学阅读',5,time '14:00','{4,5,6}'::smallint[]),
    (5,'中学问题探索',5,time '19:00','{7,8,9,10,11,12}'::smallint[]),
    (6,'生活数学应用：从购物清单到路线规划的合作探究',4,time '17:00','{1,2,3,4,5,6}'::smallint[])
  ) as examples(n,title,day_offset,starts_at,grades) loop
    aid := public.create_activity('trial_class','验收课 · ' || extra.title,
      (first_monday + extra.day_offset + extra.starts_at) at time zone 'Asia/Shanghai',
      45::smallint,'验收教室 C',16::smallint, seed_key || ':extra-' || extra.n || '；虚构活动，用于同日多场、跨年级和长标题验收。');
    perform public.set_activity_target_grades(aid,extra.grades);
  end loop;
  if (select count(*) from public.activities where remark like seed_key || ':%') <> 30
    or (select count(*) from auth.users) <> before_accounts
    or (select count(*) from public.students) <> before_students
    or (select count(*) from public.classrooms) <> before_classes then raise exception 'ACTIVITY_FIXTURE_COUNT_MISMATCH'; end if;
end $seed$;

select jsonb_build_object('dataset','FOLLOWUP-UI-20260906','activities',jsonb_agg(jsonb_build_object(
  'id',id,'title',title,'scheduledAt',scheduled_at,'targetGrades',target_grades,'location',location) order by scheduled_at,id))
from public.activities where remark like 'FOLLOWUP-UI-20260906:%';
