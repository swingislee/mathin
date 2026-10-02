-- 学期字段随已可读班级元数据供筛选使用；行级访问继续由 classrooms 现有 RLS 决定。
grant select (term_id) on public.classrooms to authenticated;
