-- work/records、阶段及列条件的选择率差异较大。默认第六次调用开始复用通用计划，
-- 本机同一输入由约 150 ms 增至 680 ms；按参数规划保持约 150 ms。
-- 仅这两个列表函数使用参数计划，其他查询继续使用数据库默认策略。
alter function public.student_list_facts(text,text,text,text) set plan_cache_mode=force_custom_plan;
alter function public.list_student_records_page(text,text,text,text,integer,integer,jsonb,text,jsonb) set plan_cache_mode=force_custom_plan;
notify pgrst,'reload schema';
