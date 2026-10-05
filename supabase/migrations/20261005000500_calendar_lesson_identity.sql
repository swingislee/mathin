-- 与既有课表共享授权课次集合；返回实际教师身份供日历按 UUID 筛选。
create function public.get_staff_schedule_teacher_ids(
  p_from timestamptz,p_to timestamptz,p_campus_id uuid default null,p_room_id uuid default null
) returns table(session_id uuid,teacher_ids uuid[])
language sql security definer stable set search_path=public,pg_temp as $$
  select visible.session_id,array(select teacher_id
    from public.staff_calendar_session_teachers(s.classroom_id,s.teacher_override) teacher_id order by teacher_id)
  from public.get_staff_schedule_v2(p_from,p_to,p_campus_id,p_room_id) visible
  join public.class_sessions s on s.id=visible.session_id;
$$;
revoke all on function public.get_staff_schedule_teacher_ids(timestamptz,timestamptz,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_staff_schedule_teacher_ids(timestamptz,timestamptz,uuid,uuid) to authenticated;
select pg_notify('pgrst','reload schema');
