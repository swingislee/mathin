begin;

-- 预览与保存共用范围：从锚点原排期起，同班尚未开课的可编辑课次。
create or replace function public.preview_session_schedule_postpone(p_session_id uuid, p_days integer)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  anchor public.class_sessions%rowtype;
  classroom_row public.classrooms%rowtype;
  session_row public.class_sessions%rowtype;
  timezone_value text;
  next_local timestamp;
  next_instant timestamptz;
  calendar_result jsonb;
  rows jsonb := '[]'::jsonb;
  skipped integer := 0;
  result jsonb;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_days is null or p_days not between 1 and 365 then raise exception 'VALIDATION'; end if;
  select * into anchor from public.class_sessions where id = p_session_id;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if not (public.is_admin(uid) or public.can_manage_classroom(anchor.classroom_id, uid)
    or public.is_classroom_teacher(anchor.classroom_id, uid)) then raise exception 'FORBIDDEN_SCOPE'; end if;
  select * into classroom_row from public.classrooms where id = anchor.classroom_id;
  if classroom_row.trashed_at is not null or classroom_row.operational_status = 'completed' then
    raise exception 'CLASSROOM_NOT_ACTIVE';
  end if;
  if anchor.started_at is not null or anchor.ended_at is not null or anchor.courseware_frozen_at is not null then
    raise exception 'SESSION_ALREADY_STARTED';
  end if;
  if anchor.scheduled_at is null or anchor.deleted_at is not null or anchor.cancelled_by is not null
    or anchor.voided_at is not null then raise exception 'SESSION_NOT_EDITABLE'; end if;
  select timezone into timezone_value from public.organizations where singleton_key = 1;
  if timezone_value is null then raise exception 'INVALID_SCHEDULE'; end if;

  for session_row in
    select * from public.class_sessions
    where classroom_id = anchor.classroom_id and scheduled_at >= anchor.scheduled_at
    order by scheduled_at, id
  loop
    if session_row.started_at is not null or session_row.ended_at is not null
      or session_row.courseware_frozen_at is not null or session_row.deleted_at is not null
      or session_row.cancelled_by is not null or session_row.voided_at is not null then
      skipped := skipped + 1;
      continue;
    end if;
    next_local := (session_row.scheduled_at at time zone timezone_value) + make_interval(days => p_days);
    next_instant := next_local at time zone timezone_value;
    -- 夏令时跳过的当地时间需另选日期，不静默更改上课钟点。
    if (next_instant at time zone timezone_value) <> next_local then raise exception 'INVALID_SCHEDULE'; end if;
    calendar_result := public.get_effective_calendar_day_v2(next_local::date, session_row.room_id);
    rows := rows || jsonb_build_array(jsonb_build_object(
      'id', session_row.id, 'title', coalesce(session_row.title, ''), 'no', session_row.lecture_no,
      'previousScheduledAt', session_row.scheduled_at, 'scheduledAt', next_instant,
      'durationMin', session_row.duration_min, 'roomId', session_row.room_id,
      'closedDayId', case when calendar_result #>> '{entry,kind}' = 'closed' then calendar_result #>> '{entry,id}' end,
      'closedDayName', case when calendar_result #>> '{entry,kind}' = 'closed' then calendar_result #>> '{entry,name}' end
    ));
  end loop;
  result := jsonb_build_object('classroomId', anchor.classroom_id, 'sessionId', anchor.id,
    'days', p_days, 'timeZone', timezone_value, 'skippedCount', skipped, 'sessions', rows);
  return result || jsonb_build_object('token', md5(result::text));
end;
$$;

create or replace function public.apply_session_schedule_postpone(
  p_session_id uuid, p_days integer, p_expected_token text,
  p_confirm_closed_days boolean default false, p_closed_day_reason text default ''
)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  preview jsonb;
  classroom_id_value uuid;
  row_value jsonb;
begin
  -- 先核对身份与范围，再取得班级和课次锁；锁内重读预览避免部分保存和重复顺延。
  preview := public.preview_session_schedule_postpone(p_session_id, p_days);
  classroom_id_value := (preview->>'classroomId')::uuid;
  perform id from public.classrooms where id = classroom_id_value for update;
  perform id from public.class_sessions where classroom_id = classroom_id_value order by id for update;
  preview := public.preview_session_schedule_postpone(p_session_id, p_days);
  if p_expected_token is null or p_expected_token is distinct from preview->>'token' then
    raise exception 'SCHEDULE_PREVIEW_STALE';
  end if;
  if exists (select 1 from jsonb_array_elements(preview->'sessions') item where item->>'closedDayId' is not null)
    and (not coalesce(p_confirm_closed_days, false)
      or char_length(btrim(coalesce(p_closed_day_reason, ''))) not between 1 and 500) then
    raise exception 'CLOSED_DAY_CONFIRMATION_REQUIRED';
  end if;

  for row_value in select value from jsonb_array_elements(preview->'sessions') loop
    update public.class_sessions set scheduled_at = (row_value->>'scheduledAt')::timestamptz
      where id = (row_value->>'id')::uuid;
    perform public.emit_domain_event('session.schedule.updated', 'class_session', (row_value->>'id')::uuid,
      jsonb_build_object('classroomId', classroom_id_value, 'source', 'consecutive_postpone',
        'anchorSessionId', p_session_id, 'days', p_days,
        'before', jsonb_build_object('scheduledAt', row_value->>'previousScheduledAt',
          'title', row_value->>'title', 'durationMin', row_value->'durationMin'),
        'after', jsonb_build_object('scheduledAt', row_value->>'scheduledAt',
          'title', row_value->>'title', 'durationMin', row_value->'durationMin')), null, null);
    if row_value->>'closedDayId' is not null then
      perform public.emit_domain_event('session.closed_day.override_confirmed', 'class_session', (row_value->>'id')::uuid,
        jsonb_build_object('day', ((row_value->>'scheduledAt')::timestamptz at time zone (preview->>'timeZone'))::date,
          'roomId', row_value->'roomId', 'calendarEntryId', row_value->>'closedDayId',
          'reason', btrim(p_closed_day_reason), 'source', 'consecutive_postpone'), null, null);
    end if;
  end loop;
  return jsonb_build_object('updatedCount', jsonb_array_length(preview->'sessions'));
end;
$$;

revoke all on function public.preview_session_schedule_postpone(uuid, integer) from public, anon, authenticated;
revoke all on function public.apply_session_schedule_postpone(uuid, integer, text, boolean, text) from public, anon, authenticated;
grant execute on function public.preview_session_schedule_postpone(uuid, integer) to authenticated;
grant execute on function public.apply_session_schedule_postpone(uuid, integer, text, boolean, text) to authenticated;

commit;
