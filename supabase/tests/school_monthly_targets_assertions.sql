-- 由本机开发检查器在事务中运行；使用已有9月计划，所有测试修改统一回滚。
create function pg_temp.expect_monthly_target_error(statement text, expected text)
returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'EXPECTED_ERROR_NOT_RAISED';
exception when others then
  if position(expected in sqlerrm) = 0 then raise; end if;
end $$;

select set_config('request.jwt.claim.sub', current_setting('test.monthly_target_admin'), true);
set local role authenticated;
do $$
declare original public.school_monthly_targets; saved public.school_monthly_targets; cells jsonb; invalid jsonb;
begin
  select * into strict original from public.school_monthly_targets where month = '2026-09-01';
  select jsonb_agg(jsonb_build_object('teacher', teacher, 'grade', grade, 'target', null)) into cells
    from jsonb_array_elements_text(original.source_snapshot->'teachers') teacher
    cross join jsonb_array_elements_text(original.source_snapshot->'grades') grade;
  saved := public.save_school_monthly_targets(original.month, original.revision, cells, null, null);
  if saved.enrollment_target <> (original.source_snapshot->>'enrollmentTarget')::integer or saved.target_basis <> 'source'
    or saved.arrival_target is not null or saved.invitation_target is not null then raise exception 'BLANK_TARGET_CONTRACT'; end if;
  cells := jsonb_set(cells, '{0,target}', '5'::jsonb);
  cells := jsonb_set(cells, '{1,target}', '7'::jsonb);
  saved := public.save_school_monthly_targets(original.month, saved.revision, cells, 174, 217);
  if saved.enrollment_target <> 12 or saved.target_basis <> 'teacher_grade' or saved.revision <> original.revision + 2 then raise exception 'TARGET_SUM_CONTRACT'; end if;
  if saved.source_snapshot <> original.source_snapshot then raise exception 'SOURCE_CHANGED'; end if;
  if not exists(select 1 from public.domain_events where entity_id = saved.id and event_type = 'school_monthly_target.updated'
    and (payload->>'revision')::integer = saved.revision and payload->'previousTargets' is not null) then raise exception 'AUDIT_MISSING'; end if;
  perform pg_temp.expect_monthly_target_error(format('select public.save_school_monthly_targets(%L, %s, %L::jsonb, 174, 217)', original.month, original.revision, cells), 'VERSION_CONFLICT');
  invalid := jsonb_set(cells, '{0,target}', '-1'::jsonb);
  perform pg_temp.expect_monthly_target_error(format('select public.save_school_monthly_targets(%L, %s, %L::jsonb, 174, 217)', original.month, saved.revision, invalid), 'VALIDATION');
  invalid := jsonb_set(cells, '{0,teacher}', '"unknown teacher"'::jsonb);
  perform pg_temp.expect_monthly_target_error(format('select public.save_school_monthly_targets(%L, %s, %L::jsonb, 174, 217)', original.month, saved.revision, invalid), 'VALIDATION');
  invalid := jsonb_set(cells, '{1}', cells->0);
  perform pg_temp.expect_monthly_target_error(format('select public.save_school_monthly_targets(%L, %s, %L::jsonb, 174, 217)', original.month, saved.revision, invalid), 'VALIDATION');
  perform pg_temp.expect_monthly_target_error(format('select public.initialize_school_monthly_targets(%L, %L::jsonb)', original.month, original.source_snapshot), 'duplicate key');
  cells := jsonb_set(jsonb_set(cells, '{0,target}', '0'::jsonb), '{1,target}', 'null'::jsonb);
  saved := public.save_school_monthly_targets(original.month, saved.revision, cells, 0, 0);
  if saved.enrollment_target <> 0 or saved.target_basis <> 'teacher_grade' then raise exception 'ZERO_TARGET_CONTRACT'; end if;
end $$;

select pg_temp.expect_monthly_target_error('update public.school_monthly_targets set enrollment_target = 999 where month = ''2026-09-01''', 'permission denied');
reset role;
select set_config('request.jwt.claim.sub', current_setting('test.monthly_target_parent'), true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.school_monthly_targets) then raise exception 'RLS_TARGET_LEAK'; end if;
end $$;
select pg_temp.expect_monthly_target_error('select public.save_school_monthly_targets(''2026-09-01'', 1, ''[]''::jsonb, 1, 1)', 'FORBIDDEN');
select pg_temp.expect_monthly_target_error('select public.initialize_school_monthly_targets(''2026-09-01'', ''{}''::jsonb)', 'FORBIDDEN');
reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select pg_temp.expect_monthly_target_error('select public.save_school_monthly_targets(''2026-09-01'', 1, ''[]''::jsonb, 1, 1)', 'permission denied');
reset role;
