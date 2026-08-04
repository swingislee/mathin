\set ON_ERROR_STOP on
-- R1-7D: allowlisted plans, stable target hashes, transactional execution and rollback.
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
select id as student_user_id from public.profiles where display_name = '测试-学生' limit 1 \gset
select id as student_id from public.students where deleted_at is null order by created_at limit 1 \gset
select id as term_id from public.school_terms where is_current order by created_at limit 1 \gset
\if :{?admin_id}
\else
  \echo R1-7D fixture missing: admin
  select 1 / 0;
\endif
\if :{?teacher_id}
\else
  \echo R1-7D fixture missing: teacher
  select 1 / 0;
\endif
\if :{?student_user_id}
\else
  \echo R1-7D fixture missing: student user
  select 1 / 0;
\endif
\if :{?student_id}
\else
  \echo R1-7D fixture missing: student record
  select 1 / 0;
\endif
\if :{?term_id}
\else
  \echo R1-7D fixture missing: current term
  select 1 / 0;
\endif

do $$
declare failures text[] := '{}'; execute_definition text; rollback_definition text;
begin
  if to_regclass('public.data_repair_capability_versions') is null
     or to_regclass('public.data_repair_plans') is null
     or to_regclass('public.data_repair_events') is null then
    failures := array_append(failures, 'repair tables missing');
  end if;
  if (select count(*) from public.data_repair_capability_versions) <> 4
     or (select count(*) from public.data_repair_capability_versions where plan_managed) <> 1
     or not exists(select 1 from public.data_repair_capability_versions
       where repair_key = 'student_merge' and recovery_class = 'backup_required')
     or not exists(select 1 from public.data_repair_capability_versions
       where repair_key = 'courseware_asset_replacement_rollback' and recovery_class = 'domain_rollback')
     or not exists(select 1 from public.data_repair_capability_versions
       where repair_key = 'order_status_recompute' and recovery_class = 'automatic_rollback') then
    failures := array_append(failures, 'capability boundary incomplete');
  end if;
  if has_table_privilege('authenticated', 'public.data_repair_capability_versions', 'INSERT')
     or has_table_privilege('authenticated', 'public.data_repair_plans', 'UPDATE')
     or has_table_privilege('authenticated', 'public.data_repair_events', 'DELETE') then
    failures := array_append(failures, 'repair ledger direct writes granted');
  end if;
  execute_definition := pg_get_functiondef('public.execute_data_repair_plan(uuid)'::regprocedure);
  rollback_definition := pg_get_functiondef('public.rollback_data_repair_plan(uuid)'::regprocedure);
  if execute_definition not ilike '%system.operations.manage%'
     or execute_definition not ilike '%REPAIR_TARGET_CHANGED%'
     or execute_definition not ilike '%REPAIR_POSTCONDITION_FAILED%'
     or execute_definition ilike '%execute %'
     or rollback_definition not ilike '%REPAIR_TARGET_CHANGED%'
     or rollback_definition not ilike '%REPAIR_ROLLBACK_POSTCONDITION_FAILED%' then
    failures := array_append(failures, 'repair execution contract incomplete');
  end if;
  if cardinality(failures) > 0 then
    raise exception 'R1-7D repair structure assertions failed: %', array_to_string(failures, ', ');
  end if;

  begin
    update public.data_repair_capability_versions set definition = definition || ' changed'
      where repair_key = 'order_status_recompute';
    raise exception 'R1_7D_CAPABILITY_UPDATE_ACCEPTED';
  exception when others then
    if SQLERRM <> 'DATA_REPAIR_LEDGER_IMMUTABLE' then raise; end if;
  end;
end
$$;

insert into public.staff_role_members(user_id, role_id, granted_by)
select :'teacher_id'::uuid, role_row.id, :'admin_id'::uuid
  from public.staff_roles role_row where role_row.key = 'principal'
on conflict do nothing;

-- BUG-R1M-025 后：order_status_recompute 登记在 finance 域，R1-8 关闭门会在
-- preview/execute/rollback 三个入口拒绝它。`finance_release_gate_open()` 是硬编码
-- `select false` 的发布门，测试不应替换它（也无法跨环境替换：开发库上该函数属主是
-- supabase_admin）。因此本文件的执行链断言按关闭态重写：
--   · 结构、账本不可变、直接写权限、越权读取 —— 与关闭无关，继续全量校验；
--   · preview/execute/rollback 的目标摘要、stale 拒绝、回滚幂等 —— 关闭期间无法驱动，
--     改为断言三个入口一律被 FINANCE_RELEASE_CLOSED 拒绝且不留半写。
-- 未来打开财务发布门的迁移必须同时恢复本文件的执行链断言（见 doc 25 财务发布门）。

insert into public.orders(order_no, student_id, amount_original, amount_discount, amount_due, status, created_by, term_id)
values('__R1_7D_ORDER__' || left(replace(gen_random_uuid()::text, '-', ''), 10), :'student_id'::uuid,
       100.00, 0.00, 100.00, 'refunding', :'admin_id'::uuid, :'term_id'::uuid)
returning id as repair_order_id \gset

insert into public.orders(order_no, student_id, amount_original, amount_discount, amount_due, status, created_by, term_id)
values('__R1_7D_DUE__' || left(replace(gen_random_uuid()::text, '-', ''), 10), :'student_id'::uuid,
       100.00, 0.00, 90.00, 'refunding', :'admin_id'::uuid, :'term_id'::uuid)
returning id as due_mismatch_order_id \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.run_data_quality_scan() ->> 'id' as quality_run_id \gset
select id as repair_finding_id from public.data_quality_findings
 where run_id = :'quality_run_id'::uuid and rule_key = 'order_amount_unbalanced' and object_id = :'repair_order_id'::uuid \gset
select id as due_mismatch_finding_id from public.data_quality_findings
 where run_id = :'quality_run_id'::uuid and rule_key = 'order_amount_unbalanced' and object_id = :'due_mismatch_order_id'::uuid \gset
select set_config('test.r17d_repair_order', :'repair_order_id', true);
select set_config('test.r17d_due_mismatch_order', :'due_mismatch_order_id', true);
select set_config('test.r17d_repair_finding', :'repair_finding_id', true);
select set_config('test.r17d_due_mismatch_finding', :'due_mismatch_finding_id', true);

do $$
declare
  v_order_status_before text;
  v_plan_count_before bigint;
begin
  if jsonb_array_length(public.list_data_repair_capabilities()) <> 4 then
    raise exception 'R1_7D_CAPABILITY_PROJECTION_INCORRECT';
  end if;

  select status into v_order_status_before from public.orders where id = current_setting('test.r17d_repair_order')::uuid;
  select count(*) into v_plan_count_before from public.data_repair_plans;

  -- 关闭门先于 finding 解析生效：可修复的异常与不可修复的异常都拿到同一个拒绝码，
  -- 不泄露该订单是否属于可修复集合。
  begin
    perform public.preview_order_status_repair(current_setting('test.r17d_repair_finding')::uuid);
    raise exception 'R1_7D_CLOSED_PREVIEW_ACCEPTED';
  exception when others then
    if SQLERRM <> 'FINANCE_RELEASE_CLOSED' then raise; end if;
  end;
  begin
    perform public.preview_order_status_repair(current_setting('test.r17d_due_mismatch_finding')::uuid);
    raise exception 'R1_7D_CLOSED_DUE_PREVIEW_ACCEPTED';
  exception when others then
    if SQLERRM <> 'FINANCE_RELEASE_CLOSED' then raise; end if;
  end;

  if (select count(*) from public.data_repair_plans) <> v_plan_count_before
     or (select status from public.orders where id = current_setting('test.r17d_repair_order')::uuid) <> v_order_status_before then
    raise exception 'R1_7D_CLOSED_PREVIEW_LEFT_WRITES';
  end if;

  -- 关闭门必须挂在三个入口上，而不是只挂在 preview。
  if pg_get_functiondef('public.preview_order_status_repair(uuid)'::regprocedure) not ilike '%assert_data_repair_release_open%'
     or pg_get_functiondef('public.execute_data_repair_plan(uuid)'::regprocedure) not ilike '%assert_data_repair_release_open%'
     or pg_get_functiondef('public.rollback_data_repair_plan(uuid)'::regprocedure) not ilike '%assert_data_repair_release_open%'
     or pg_get_functiondef('public.assert_data_repair_release_open(text, integer)'::regprocedure) not ilike '%FINANCE_RELEASE_CLOSED%' then
    raise exception 'R1_7D_RELEASE_GATE_NOT_WIRED';
  end if;
end
$$;

select set_config('request.jwt.claim.sub', :'student_user_id', true);
do $$
begin
  begin
    perform public.list_data_repair_plans();
    raise exception 'R1_7D_STUDENT_LIST_ACCEPTED';
  exception when others then
    if SQLERRM <> 'FORBIDDEN' then raise; end if;
  end;
  begin
    perform public.preview_order_status_repair(current_setting('test.r17d_repair_finding')::uuid);
    raise exception 'R1_7D_STUDENT_PREVIEW_ACCEPTED';
  exception when others then
    if SQLERRM <> 'FORBIDDEN' then raise; end if;
  end;
  if exists(select 1 from public.data_repair_capability_versions)
     or exists(select 1 from public.data_repair_plans)
     or exists(select 1 from public.data_repair_events) then
    raise exception 'R1_7D_STUDENT_READ_REPAIR_LEDGER';
  end if;
end
$$;

reset role;
rollback;
