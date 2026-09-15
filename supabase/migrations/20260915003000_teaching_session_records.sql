-- 教学工作台按课次读取实际记录；只读能力与开课、备课和记录写权分别检查。
create function public.get_teaching_session_records(p_session_id uuid, p_contact_page integer default 1)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  session_row public.class_sessions%rowtype;
  class_name text;
  roster jsonb;
  student_ids uuid[];
  contacts_allowed boolean;
  contact_total integer;
  contact_page integer;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(uid) then raise exception 'FORBIDDEN'; end if;
  if p_session_id is null or p_contact_page is null or p_contact_page < 1 or p_contact_page > 100000 then
    raise exception 'VALIDATION';
  end if;
  select s.* into session_row from public.class_sessions s
    join public.classrooms c on c.id = s.classroom_id
    where s.id = p_session_id and s.deleted_at is null and s.voided_at is null
      and c.purpose = 'production' and c.archived_at is null and c.trashed_at is null;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if not (public.has_perm(uid, 'class.view.all') or (
    public.has_perm(uid, 'class.view.mine') and (
      coalesce(session_row.teacher_override = uid, false) or exists (
        select 1 from public.classroom_staff_assignments a
        where a.classroom_id = session_row.classroom_id and a.user_id = uid
          and (a.responsibility = 'assistant_teacher'
            or (a.responsibility = 'primary_teacher' and session_row.teacher_override is null))
      )
    )
  )) then raise exception 'FORBIDDEN'; end if;

  select name into class_name from public.classrooms where id = session_row.classroom_id;
  -- 已冻结课次沿用当时花名册；只记录学情的课次也可以读取当前有效花名册。
  if session_row.roster_revision > 0 then
    select coalesce(jsonb_agg(jsonb_build_object('id', e.student_id, 'name', e.name) order by e.roster_order), '[]')
      into roster from public.session_roster_entries e
      where e.session_id = p_session_id and e.revision = session_row.roster_revision;
  else
    select coalesce(jsonb_agg(jsonb_build_object('id', e.student_id, 'name', e.name) order by e.roster_order), '[]')
      into roster from public.current_session_roster_source(p_session_id) e;
  end if;
  select coalesce(array_agg((value->>'id')::uuid), '{}') into student_ids from jsonb_array_elements(roster);
  contacts_allowed := public.has_perm(uid, 'followup.view');
  select count(*) into contact_total from public.student_follow_ups f
    where contacts_allowed and f.student_id = any(student_ids) and public.can_access_student(f.student_id, uid);
  contact_page := least(p_contact_page, greatest(1, (contact_total + 19) / 20));

  return jsonb_build_object(
    'session', jsonb_build_object('id', session_row.id, 'classroomId', session_row.classroom_id,
      'classroomName', class_name, 'title', session_row.title, 'scheduledAt', session_row.scheduled_at,
      'startedAt', session_row.started_at, 'endedAt', session_row.ended_at),
    'students', roster,
    'attendance', coalesce((select jsonb_agg(jsonb_build_object('studentId', a.student_id, 'status', a.status, 'note', a.note))
      from public.session_attendance a where a.session_id = p_session_id and a.student_id = any(student_ids)), '[]'),
    'checks', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title) order by c.position, c.id)
      from public.session_learning_checks c where c.session_id = p_session_id), '[]'),
    'results', coalesce((select jsonb_agg(jsonb_build_object('checkId', r.check_id, 'studentId', r.student_id,
      'status', r.status, 'markedAt', r.marked_at, 'author', p.display_name))
      from public.session_learning_check_results r join public.session_learning_checks c on c.id = r.check_id
      left join public.profiles p on p.id = r.marked_by
      where c.session_id = p_session_id and r.student_id = any(student_ids)), '[]'),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('studentId', r.student_id, 'comment', r.comment,
      'entryScore', r.entry_score, 'exitScore', r.exit_score, 'focus', r.focus, 'participation', r.participation,
      'mastery', r.mastery, 'updatedAt', r.updated_at, 'author', p.display_name))
      from public.session_reviews r left join public.profiles p on p.id = r.created_by
      where r.session_id = p_session_id and r.student_id = any(student_ids)), '[]'),
    'canReadContacts', contacts_allowed, 'contactTotal', contact_total, 'contactPage', contact_page,
    -- 日常沟通没有课次外键；按本节花名册展示并在页面明确标注其学生范围。
    'contacts', coalesce((select jsonb_agg(row_data.value order by row_data.created_at desc, row_data.id desc) from (
      select f.id, f.created_at, jsonb_build_object('id', f.id, 'studentId', f.student_id,
        'content', f.content, 'kind', f.kind, 'createdAt', f.created_at, 'occurredOn', f.occurred_on,
        'author', coalesce(nullif(f.author_label, ''), p.display_name)) as value
      from public.student_follow_ups f left join public.profiles p on p.id = f.author_id
      where contacts_allowed and f.student_id = any(student_ids) and public.can_access_student(f.student_id, uid)
      order by f.created_at desc, f.id desc limit 20 offset (contact_page - 1) * 20
    ) row_data), '[]'),
    'supportNotes', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'note', t.note,
      'status', t.status, 'author', p.display_name, 'completedAt', t.completed_at) order by t.created_at, t.id)
      from public.class_support_tasks t left join public.profiles p on p.id = t.assigned_to
      where contacts_allowed and t.session_id = p_session_id and btrim(t.note) <> ''
        and (t.student_id is null or public.can_access_student(t.student_id, uid))), '[]')
  );
end;
$$;
revoke all on function public.get_teaching_session_records(uuid, integer) from public, anon, authenticated;
grant execute on function public.get_teaching_session_records(uuid, integer) to authenticated;
comment on function public.get_teaching_session_records(uuid, integer) is
  '教学只读详情：主管或本节任教教师可见花名册、考勤、逐题学情与已保存课评；沟通正文另需 followup.view 和学生 scope。';
