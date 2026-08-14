-- 精确清理当前验收截图中的 6 个班级及其课次/学生上课记录。
--
-- 这些是班级实例，不是课程产品：课程族、课程、讲次、课件、release、
-- 页面文档和资源均不作为删除目标。学生档案也保留；只删除班级报名、
-- 课次及其级联的学生上课数据，并清掉 RESTRICT 外键历史。
-- 目标课次中的 learning_result 历史也属于本次明确指定的学生上课记录；
-- 仅对这组固定班级在同一事务内暂时停用 immutable 触发器，绝不改变通用规则。
--
-- 迁移按当前开发库中的稳定 UUID 定位，重复执行时目标已不存在即安全返回。
do $$
declare
  target_classroom_ids constant uuid[] := array[
    '92028e9e-e349-4c04-88ff-79a23702185d'::uuid,
    '0d0b19c8-4dd2-4f48-bf82-bd2c3525d147'::uuid,
    '3092174f-1b62-4c89-95aa-df58768ab09d'::uuid,
    'a90e7376-4425-419d-bf0e-feb746268d17'::uuid,
    'be46e85a-df6a-47ef-b515-ad5c252ff3d8'::uuid,
    'dace6de4-5257-4a41-90da-ad7e477c96b1'::uuid
  ];
  target_session_ids uuid[];
  target_learning_result_head_ids uuid[];
  target_order_id constant uuid := 'f385ba0d-edc9-4ee5-a7c3-6eb1e3699e90'::uuid;
  target_order_count integer;
  target_classroom_count integer;
  target_classroom_row record;
begin
  select count(*)
    into target_classroom_count
    from public.classrooms classroom_row
   where classroom_row.id = any(target_classroom_ids);

  if target_classroom_count = 0 then
    return;
  end if;

  if target_classroom_count <> cardinality(target_classroom_ids) then
    raise exception 'P6_SIX_CLASSROOM_CLEANUP_PARTIAL_TARGET';
  end if;

  -- 二次确认名称、产品码和课程族，避免 UUID 被复用后误删其他班级。
  if exists (
    select 1
      from (
        values
          ('92028e9e-e349-4c04-88ff-79a23702185d'::uuid, '测试班-P4', 'MFHK01863'::text, 'xueersi-e-primary-math-cn'::text),
          ('0d0b19c8-4dd2-4f48-bf82-bd2c3525d147'::uuid, 'E系列数学一年级暑期A[全国版]', null::text, null::text),
          ('3092174f-1b62-4c89-95aa-df58768ab09d'::uuid, 'E系列数学一年级春季B[全国版]', 'MFHK02039'::text, 'xueersi-e-primary-math-cn'::text),
          ('a90e7376-4425-419d-bf0e-feb746268d17'::uuid, 'E系列数学一年级春季B[全国版]', 'MFHK02039'::text, 'xueersi-e-primary-math-cn'::text),
          ('be46e85a-df6a-47ef-b515-ad5c252ff3d8'::uuid, 'E系列数学一年级暑期S班[全国版]', 'MFHK00632'::text, 'xueersi-e-primary-math-cn'::text),
          ('dace6de4-5257-4a41-90da-ad7e477c96b1'::uuid, 'E系列数学五年级暑期A[全国版]', 'MFHK01863'::text, 'xueersi-e-primary-math-cn'::text)
      ) expected(classroom_id, classroom_name, product_code, family_slug)
      left join public.classrooms classroom_row
        on classroom_row.id = expected.classroom_id
      left join public.courses course_row
        on course_row.id = classroom_row.course_id
      left join public.course_families family_row
        on family_row.id = course_row.family_id
     where classroom_row.id is null
        or classroom_row.name is distinct from expected.classroom_name
        or course_row.product_code is distinct from expected.product_code
        or family_row.slug is distinct from expected.family_slug
  ) then
    raise exception 'P6_SIX_CLASSROOM_CLEANUP_TARGET_MISMATCH';
  end if;

  if exists (
    select 1
      from public.classrooms classroom_row
     where classroom_row.id = any(target_classroom_ids)
       and (
         classroom_row.purpose <> 'production'
         or classroom_row.operational_status <> 'active'
       )
  ) then
    raise exception 'P6_SIX_CLASSROOM_CLEANUP_STATUS_MISMATCH';
  end if;

  -- 课程包保护：目标中的有课班只能属于 E 系列；爱学习包永远不能被本迁移命中。
  if exists (
    select 1
      from public.classrooms classroom_row
      join public.courses course_row on course_row.id = classroom_row.course_id
      join public.course_families family_row on family_row.id = course_row.family_id
     where classroom_row.id = any(target_classroom_ids)
       and family_row.slug = 'aixuexi-primary-math'
  ) then
    raise exception 'P6_SIX_CLASSROOM_CLEANUP_AIXUEXI_PROTECTED';
  end if;

  select coalesce(array_agg(session_row.id order by session_row.id), '{}'::uuid[])
    into target_session_ids
    from public.class_sessions session_row
   where session_row.classroom_id = any(target_classroom_ids);

  select coalesce(array_agg(head_row.id order by head_row.id), '{}'::uuid[])
    into target_learning_result_head_ids
    from public.learning_result_heads head_row
   where head_row.session_id = any(target_session_ids);

  -- 订单不是学生上课记录。保留这条部分支付的测试订单，只解除已删除班级的可选关联，
  -- 避免删除财务历史，同时满足 classrooms 的 RESTRICT 外键约束。
  select count(*)
    into target_order_count
    from public.orders order_row
   where order_row.classroom_id = any(target_classroom_ids);

  if target_order_count > 0 then
    if target_order_count <> 1
       or not exists (
         select 1
           from public.orders order_row
          where order_row.id = target_order_id
            and order_row.classroom_id = '92028e9e-e349-4c04-88ff-79a23702185d'::uuid
            and order_row.order_no = 'ORD2026070910B3B2'
            and order_row.status = 'partial'
       ) then
      raise exception 'P6_SIX_CLASSROOM_CLEANUP_ORDER_MISMATCH';
    end if;

    update public.orders
       set classroom_id = null,
           updated_at = now()
     where id = target_order_id;
  end if;

  -- 如果台账的 reversal 来自目标班以外的课次，不能在没有人工判断的情况下删除。
  if exists (
    select 1
      from public.lesson_ledger reversal_row
      join public.lesson_ledger original_row
        on original_row.id = reversal_row.reverses_id
     where original_row.session_id = any(target_session_ids)
       and not (reversal_row.session_id = any(target_session_ids))
  ) then
    raise exception 'P6_SIX_CLASSROOM_CLEANUP_EXTERNAL_LEDGER_REFERENCE';
  end if;

  -- session_changes / lesson_ledger 对 class_sessions 使用 RESTRICT，需先清理。
  delete from public.session_changes change_row
   where change_row.session_id = any(target_session_ids)
      or change_row.from_session = any(target_session_ids)
      or change_row.to_session = any(target_session_ids);

  delete from public.lesson_ledger ledger_row
   where ledger_row.session_id = any(target_session_ids);

  -- learning_result_revisions / learning_result_events 是不可变历史表；本次是对固定
  -- 开发验收班的整班清理，临时关闭的只是不变性触发器，事务结束即恢复。
  if cardinality(target_learning_result_head_ids) > 0 then
    alter table public.learning_result_revisions
      disable trigger learning_result_revisions_immutable;
    alter table public.learning_result_events
      disable trigger learning_result_events_immutable;

    delete from public.learning_result_heads
     where id = any(target_learning_result_head_ids);

    alter table public.learning_result_events
      enable trigger learning_result_events_immutable;
    alter table public.learning_result_revisions
      enable trigger learning_result_revisions_immutable;
  end if;

  for target_classroom_row in
    select classroom_row.id, classroom_row.name
      from public.classrooms classroom_row
     where classroom_row.id = any(target_classroom_ids)
  loop
    perform public.emit_domain_event(
      'classroom.lifecycle.purged',
      'classroom',
      target_classroom_row.id,
      jsonb_build_object(
        'name', target_classroom_row.name,
        'reason', 'manual_six_classroom_cleanup'
      ),
      null,
      null
    );
  end loop;

  -- classrooms 的级联约束负责清理报名、课次、出勤、课堂作业和课堂协作记录。
  delete from public.classrooms
   where id = any(target_classroom_ids);

  if exists (select 1 from public.classrooms where id = any(target_classroom_ids))
     or exists (select 1 from public.enrollments where classroom_id = any(target_classroom_ids))
     or exists (select 1 from public.class_sessions where id = any(target_session_ids))
     or exists (select 1 from public.session_attendance where session_id = any(target_session_ids))
     or exists (select 1 from public.lesson_ledger where session_id = any(target_session_ids))
     or exists (select 1 from public.learning_result_heads where id = any(target_learning_result_head_ids))
     or exists (select 1 from public.learning_result_revisions where head_id = any(target_learning_result_head_ids))
     or exists (select 1 from public.learning_result_events where head_id = any(target_learning_result_head_ids))
     or exists (
       select 1
         from public.session_changes
        where session_id = any(target_session_ids)
           or from_session = any(target_session_ids)
           or to_session = any(target_session_ids)
     ) then
    raise exception 'P6_SIX_CLASSROOM_CLEANUP_POSTCHECK_FAILED';
  end if;

  if exists (
    select 1
      from public.orders
     where id = target_order_id
       and classroom_id is not null
  ) then
    raise exception 'P6_SIX_CLASSROOM_CLEANUP_ORDER_NOT_DETACHED';
  end if;
end;
$$;
