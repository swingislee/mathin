-- 班级概览复用教学工作台的课次授权和时间窗口，集中读取真实记录摘要。
create function public.get_teaching_class_overview(p_from timestamptz, p_to timestamptz, p_scope text default 'mine')
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  workbench jsonb;
  output jsonb;
  uid uuid := auth.uid();
begin
  workbench := public.get_teaching_workbench(p_from, p_to, p_scope);
  with selected as materialized (
    select s.id, s.classroom_id, s.roster_revision
    from jsonb_array_elements(workbench->'sessions') item
    join public.class_sessions s on s.id = (item->>'id')::uuid
  ), roster as materialized (
    select s.id session_id, s.classroom_id, r.student_id, r.name
    from selected s join public.session_roster_entries r on r.session_id = s.id and r.revision = s.roster_revision
    where s.roster_revision > 0
    union all
    select s.id, s.classroom_id, r.student_id, r.name
    from selected s cross join lateral public.current_session_roster_source(s.id) r
    where s.roster_revision = 0
  ), attendance as materialized (
    select a.* from public.session_attendance a join roster r on r.session_id = a.session_id and r.student_id = a.student_id
  ), checks as materialized (
    select c.id, c.session_id from public.session_learning_checks c join selected s on s.id = c.session_id
  ), results as materialized (
    select c.session_id, r.student_id, r.name, result.status
    from checks c join public.session_learning_check_results result on result.check_id = c.id
    join roster r on r.session_id = c.session_id and r.student_id = result.student_id
  ), reviews as materialized (
    select review.*, r.name, p.display_name author
    from public.session_reviews review join roster r on r.session_id = review.session_id and r.student_id = review.student_id
    left join public.profiles p on p.id = review.created_by
    where btrim(review.comment) <> '' or review.entry_score is not null or review.exit_score is not null
      or review.focus is not null or review.participation is not null or review.mastery is not null
  ), class_students as materialized (
    select distinct classroom_id, student_id from roster
  ), contacts as materialized (
    select cs.classroom_id, f.id, f.student_id, f.content, f.created_at,
      coalesce(nullif(f.author_label, ''), p.display_name) author, student.name student_name
    from class_students cs join public.student_follow_ups f on f.student_id = cs.student_id
    join public.students student on student.id = f.student_id
    left join public.profiles p on p.id = f.author_id
    where public.has_perm(uid, 'followup.view') and public.can_access_student(f.student_id, uid)
      and f.created_at >= p_from and f.created_at < p_to
  )
  select jsonb_build_object('workbench', workbench,
    'metrics', coalesce((select jsonb_agg(jsonb_build_object(
      'sessionId', s.id,
      'studentIds', coalesce((select jsonb_agg(r.student_id order by r.student_id) from roster r where r.session_id = s.id), '[]'),
      'attendance', jsonb_build_object(
        'marked', (select count(*) from attendance a where a.session_id = s.id),
        'present', (select count(*) from attendance a where a.session_id = s.id and a.status in ('present','late')),
        'late', (select count(*) from attendance a where a.session_id = s.id and a.status = 'late'),
        'absent', (select count(*) from attendance a where a.session_id = s.id and a.status = 'absent'),
        'leave', (select count(*) from attendance a where a.session_id = s.id and a.status = 'leave')),
      'checkCount', (select count(*) from checks c where c.session_id = s.id),
      'ratedCount', (select count(*) from results r where r.session_id = s.id),
      'attentionStudents', coalesce((select jsonb_agg(jsonb_build_object('id', r.student_id, 'name', r.name) order by r.name, r.student_id)
        from (select distinct student_id, name from results where session_id = s.id and status in ('prompted','imitated','incomplete')) r), '[]'),
      'reviewCount', (select count(*) from reviews r where r.session_id = s.id),
      'latestReview', (select jsonb_build_object('content', r.comment, 'studentName', r.name, 'author', r.author, 'at', r.updated_at)
        from reviews r where r.session_id = s.id and btrim(r.comment) <> '' order by r.updated_at desc, r.student_id limit 1)
    ) order by s.id) from selected s), '[]'),
    'canReadContacts', public.has_perm(uid, 'followup.view'),
    'classContacts', coalesce((select jsonb_agg(jsonb_build_object(
      'classroomId', classes.classroom_id,
      'count', (select count(*) from contacts c where c.classroom_id = classes.classroom_id),
      'studentCount', (select count(distinct c.student_id) from contacts c where c.classroom_id = classes.classroom_id),
      'latest', (select jsonb_build_object('content', c.content, 'studentName', c.student_name, 'author', c.author, 'at', c.created_at)
        from contacts c where c.classroom_id = classes.classroom_id order by c.created_at desc, c.id desc limit 1)
    ) order by classes.classroom_id) from (select distinct classroom_id from selected) classes), '[]')
  ) into output;
  return output;
end;
$$;
revoke all on function public.get_teaching_class_overview(timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.get_teaching_class_overview(timestamptz, timestamptz, text) to authenticated;
comment on function public.get_teaching_class_overview(timestamptz, timestamptz, text) is
  '教学班级只读概览；课次范围复用 get_teaching_workbench，沟通按录入日期和学生权限读取，本期同一班级内去重。';
