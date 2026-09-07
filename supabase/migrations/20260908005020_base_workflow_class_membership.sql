-- 学生直接加入正式班级也恢复当前工作范围，沿用实际成员记录中的学生 ID。
create trigger resume_history_workflow_subject after insert on public.enrollments
  for each row execute function public.resume_history_workflow_subject();
