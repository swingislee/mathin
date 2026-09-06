-- 本机增量合同：仅操作临时表，事务结束回滚，不读取或修改学生／活动业务记录。
begin;
do $$
declare constraint_sql text; rejected boolean;
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='activities'
    and column_name='target_grades' and is_nullable='YES') then raise exception 'Missing nullable target grades'; end if;
  if has_function_privilege('anon','public.set_activity_target_grades(uuid,smallint[])','EXECUTE')
    or not has_function_privilege('authenticated','public.set_activity_target_grades(uuid,smallint[])','EXECUTE')
    or has_column_privilege('authenticated','public.activities','target_grades','UPDATE') then
    raise exception 'Invalid target-grade access contract';
  end if;
  create temporary table activity_grade_probe (target_grades smallint[]);
  select pg_get_constraintdef(oid) into constraint_sql from pg_constraint
    where conrelid='public.activities'::regclass and conname='activities_target_grades_check';
  if constraint_sql is null then raise exception 'Missing grade constraint'; end if;
  execute 'alter table activity_grade_probe add constraint grade_probe_check ' || constraint_sql;
  insert into activity_grade_probe values (null), ('{}'), ('{1,3,12}');
  rejected := false;
  begin insert into activity_grade_probe values ('{0,13}'); exception when check_violation then rejected := true; end;
  if not rejected then raise exception 'Out of range grades accepted'; end if;
  rejected := false;
  begin insert into activity_grade_probe values ('{1,NULL}'); exception when check_violation then rejected := true; end;
  if not rejected then raise exception 'Null array member accepted'; end if;
  rejected := false;
  begin insert into activity_grade_probe values (array_fill(1::smallint,array[13])); exception when check_violation then rejected := true; end;
  if not rejected then raise exception 'Oversized list accepted'; end if;
  rejected := false;
  begin perform public.set_activity_target_grades(null, '{3}'::smallint[]);
  exception when raise_exception then
    if sqlerrm <> 'FORBIDDEN' then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'Anonymous configuration accepted'; end if;
end $$;
rollback;
