-- P4C-6 跟进工作台（docs/plan/11 §6）：新建学生弹窗带「来源」字段，创建后经
-- students_update_basic_staff_scope RLS 补写。原列级授权漏了 source 列，
-- 导致 update({source, remark}) 整条被拒——这里补上（行级仍由 RLS 收窄）。
grant update (source) on public.students to authenticated;
