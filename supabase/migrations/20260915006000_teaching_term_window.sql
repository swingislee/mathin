-- 学期概览沿用原任课／主管授权与 1000 课次上限，只扩展可读取的时间跨度。
do $$
declare definition text;
begin
  select pg_get_functiondef('public.get_teaching_workbench(timestamptz,timestamptz,text)'::regprocedure) into definition;
  if position('p_to - p_from > interval ''32 days''' in definition)=0 then raise exception 'TEACHING_WINDOW_BASELINE_MISMATCH'; end if;
  execute replace(definition, 'p_to - p_from > interval ''32 days''', 'p_to - p_from > interval ''366 days''');
end $$;
