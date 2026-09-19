-- 课件概览只返回年级汇总，避免两次拉取讲次清单及 REST 行数上限造成的截断。
-- SECURITY INVOKER 保持课程、讲次原有 RLS 与当前调用者范围。
create function public.get_courseware_template_progress()
returns table (grade integer, ready bigint, total bigint)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select course.grade,
    count(*) filter (where lecture.courseware_template <> '[]'::jsonb) as ready,
    count(*) as total
  from public.course_lectures lecture
  join public.courses course on course.id = lecture.course_id
  group by course.grade
  order by course.grade;
$$;
revoke all on function public.get_courseware_template_progress() from public, anon;
grant execute on function public.get_courseware_template_progress() to authenticated;
