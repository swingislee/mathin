-- P6 审校修复：课堂教师读讲次模板不应依赖学校端 course.view 权限。
-- 班级里有课次挂了某讲时，该班的 teacher 成员即可读该讲（备课/试讲/开课冻结
-- 都要读 courseware_template 与 current_release_id）。学生不放开：课堂内容
-- 一律走开课冻结进 class_sessions.courseware 的路径。
create policy "lectures_select_classroom_teacher" on public.course_lectures
  for select to authenticated
  using (
    exists (
      select 1
        from public.class_sessions s
        join public.classroom_members m on m.classroom_id = s.classroom_id
       where s.lecture_id = course_lectures.id
         and s.deleted_at is null
         and m.user_id = (select auth.uid())
         and m.role = 'teacher'
    )
  );
