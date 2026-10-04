-- 本机固定身份；全部样例、日历/时区变更和事件随调用方事务回滚。
do $$
declare
  admin_id uuid; teacher_id uuid; outsider_id uuid;
  class_id uuid := gen_random_uuid(); other_class_id uuid := gen_random_uuid();
  session_id uuid; seq integer;
begin
  select id into admin_id from auth.users where email = 'test-admin@mathin.local';
  select id into teacher_id from auth.users where email = 'test-teacher@mathin.local';
  select id into outsider_id from auth.users where email = 'test-student@mathin.local';
  if num_nonnulls(admin_id, teacher_id, outsider_id) <> 3 then raise exception 'FIXED_ACCOUNTS_REQUIRED'; end if;
  perform set_config('postpone.test.admin', admin_id::text, true);
  perform set_config('postpone.test.teacher', teacher_id::text, true);
  perform set_config('postpone.test.outsider', outsider_id::text, true);
  perform set_config('postpone.test.class', class_id::text, true);
  perform set_config('postpone.test.other', other_class_id::text, true);
  update public.organizations set timezone = 'Asia/Shanghai' where singleton_key = 1;
  insert into public.classrooms(id, owner_id, name, invite_code, purpose) values
    (class_id, admin_id, 'Postpone assertion', gen_random_uuid()::text, 'test'),
    (other_class_id, admin_id, 'Other postpone assertion', gen_random_uuid()::text, 'test');
  insert into public.classroom_members(classroom_id, user_id, role) values (class_id, teacher_id, 'teacher');
  for seq in 1..11 loop
    session_id := gen_random_uuid();
    insert into public.class_sessions(id, classroom_id, title, scheduled_at, duration_min, lecture_no)
      values(session_id, class_id, 'Postpone assertion ' || seq,
        case when seq = 11 then null else '2040-01-01 01:00:00Z'::timestamptz + (seq - 1) * interval '7 days' end,
        60 + seq, seq);
    perform set_config('postpone.test.session' || seq, session_id::text, true);
    if seq = 5 then update public.class_sessions set started_at = now() where id = session_id; end if;
    if seq = 6 then update public.class_sessions set cancelled_by = admin_id, deleted_at = now() where id = session_id; end if;
    if seq = 7 then update public.class_sessions set courseware_frozen_at = now() where id = session_id; end if;
    if seq = 8 then update public.class_sessions set started_at = now(), ended_at = now() where id = session_id; end if;
    if seq = 9 then update public.class_sessions set voided_at = now(), voided_by = admin_id where id = session_id; end if;
    if seq = 10 then update public.class_sessions set deleted_at = now() where id = session_id; end if;
  end loop;
  -- 同刻的课次也属于从本节原日期起的范围。
  insert into public.class_sessions(classroom_id, title, scheduled_at, duration_min)
    values(class_id, 'Postpone same-time assertion', '2040-01-08 01:00:00Z', 90);
  insert into public.class_sessions(classroom_id, title, scheduled_at)
    values(other_class_id, 'Other class assertion', '2040-01-08 01:00:00Z') returning id into session_id;
  perform set_config('postpone.test.other_session', session_id::text, true);
end;
$$;

set local role authenticated;
do $$
declare
  anchor uuid := current_setting('postpone.test.session2')::uuid;
  later uuid := current_setting('postpone.test.session3')::uuid;
  class_id uuid := current_setting('postpone.test.class')::uuid;
  preview jsonb; result jsonb; before_rows jsonb; after_rows jsonb; row_value jsonb;
begin
  perform set_config('request.jwt.claim.sub', current_setting('postpone.test.admin'), true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('postpone.test.admin'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
  preview := public.preview_session_schedule_postpone(anchor, 7);
  if jsonb_array_length(preview->'sessions') <> 4 or (preview->>'skippedCount')::int <> 6 then raise exception 'WRONG_POSTPONE_SCOPE'; end if;
  if (preview #>> '{sessions,0,scheduledAt}')::timestamptz <> '2040-01-15 01:00:00Z' then raise exception 'WRONG_WEEK_SHIFT'; end if;
  -- 单节临时调整只改所选行，批量旧预览随后失效。
  perform public.update_managed_class_session(later, 'Postpone assertion 3', '2040-01-16 01:30:00Z', 63::smallint);
  if (select scheduled_at from public.class_sessions where id = anchor) <> '2040-01-08 01:00:00Z' then raise exception 'SINGLE_EDIT_SHIFTED_OTHERS'; end if;
  begin
    perform public.apply_session_schedule_postpone(anchor, 7, preview->>'token');
    raise exception 'STALE_PREVIEW_ACCEPTED';
  exception when others then if sqlerrm <> 'SCHEDULE_PREVIEW_STALE' then raise; end if; end;
  preview := public.preview_session_schedule_postpone(anchor, 7);
  select jsonb_object_agg(id::text, to_jsonb(s) - 'updated_at') into before_rows
    from public.class_sessions s where classroom_id in (class_id, current_setting('postpone.test.other')::uuid);
  result := public.apply_session_schedule_postpone(anchor, 7, preview->>'token');
  if (result->>'updatedCount')::int <> 4 then raise exception 'WRONG_UPDATED_COUNT'; end if;
  select jsonb_object_agg(id::text, to_jsonb(s) - 'updated_at') into after_rows
    from public.class_sessions s where classroom_id in (class_id, current_setting('postpone.test.other')::uuid);
  for row_value in select value from jsonb_array_elements(preview->'sessions') loop
    if (after_rows->(row_value->>'id')->>'scheduled_at')::timestamptz <> (row_value->>'scheduledAt')::timestamptz then raise exception 'SHIFT_NOT_PERSISTED'; end if;
    after_rows := jsonb_set(after_rows, array[row_value->>'id', 'scheduled_at'], before_rows->(row_value->>'id')->'scheduled_at');
  end loop;
  if after_rows <> before_rows then raise exception 'UNRELATED_FACTS_CHANGED'; end if;
  if (select count(*) from public.domain_events where event_type = 'session.schedule.updated'
    and payload->>'anchorSessionId' = anchor::text and payload->>'source' = 'consecutive_postpone') <> 4 then raise exception 'AUDIT_EVENTS_MISSING'; end if;
  begin
    perform public.apply_session_schedule_postpone(anchor, 7, preview->>'token');
    raise exception 'REPLAY_ACCEPTED';
  exception when others then if sqlerrm <> 'SCHEDULE_PREVIEW_STALE' then raise; end if; end;
  -- 本班教师可预览和保存；其他班级拒绝。
  perform set_config('request.jwt.claim.sub', current_setting('postpone.test.teacher'), true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('postpone.test.teacher'), 'role', 'authenticated')::text, true);
  preview := public.preview_session_schedule_postpone(anchor, 1);
  perform public.apply_session_schedule_postpone(anchor, 1, preview->>'token');
  begin
    perform public.preview_session_schedule_postpone(current_setting('postpone.test.other_session')::uuid, 7);
    raise exception 'OUTSIDE_CLASS_ACCEPTED';
  exception when others then if sqlerrm <> 'FORBIDDEN_SCOPE' then raise; end if; end;
  perform set_config('request.jwt.claim.sub', current_setting('postpone.test.outsider'), true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('postpone.test.outsider'), 'role', 'authenticated')::text, true);
  begin
    perform public.apply_session_schedule_postpone(anchor, 7, preview->>'token');
    raise exception 'OUTSIDER_ACCEPTED';
  exception when others then if sqlerrm <> 'FORBIDDEN_SCOPE' then raise; end if; end;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.preview_session_schedule_postpone(anchor, 7);
    raise exception 'ANONYMOUS_ACCEPTED';
  exception when others then if sqlerrm <> 'UNAUTHENTICATED' then raise; end if; end;
end;
$$;
reset role;

do $$
declare
  anchor uuid := current_setting('postpone.test.session2')::uuid;
  class_id uuid := current_setting('postpone.test.class')::uuid;
  preview jsonb; before_rows jsonb; holiday_id uuid; uid text := current_setting('postpone.test.admin');
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  preview := public.preview_session_schedule_postpone(anchor, 7);
  insert into public.school_holidays(organization_id, name, kind, starts_on, ends_on)
    select id, 'Postpone closed-day assertion', 'closed', '2040-01-23', '2040-01-23'
      from public.organizations where singleton_key = 1 returning id into holiday_id;
  begin
    perform public.apply_session_schedule_postpone(anchor, 7, preview->>'token');
    raise exception 'CHANGED_CALENDAR_ACCEPTED';
  exception when others then if sqlerrm <> 'SCHEDULE_PREVIEW_STALE' then raise; end if; end;
  preview := public.preview_session_schedule_postpone(anchor, 7);
  if not exists(select 1 from jsonb_array_elements(preview->'sessions') x where x->>'closedDayId' = holiday_id::text) then raise exception 'CLOSED_DAY_NOT_SHOWN'; end if;
  select jsonb_agg(to_jsonb(s) order by id) into before_rows from public.class_sessions s where classroom_id = class_id;
  begin
    perform public.apply_session_schedule_postpone(anchor, 7, preview->>'token', true, ' ');
    raise exception 'CLOSED_DAY_WITHOUT_REASON_ACCEPTED';
  exception when others then if sqlerrm <> 'CLOSED_DAY_CONFIRMATION_REQUIRED' then raise; end if; end;
  if before_rows <> (select jsonb_agg(to_jsonb(s) order by id) from public.class_sessions s where classroom_id = class_id) then raise exception 'PARTIAL_SAVE'; end if;
  perform public.apply_session_schedule_postpone(anchor, 7, preview->>'token', true, 'Local rollback assertion');
  if not exists(select 1 from public.domain_events where event_type = 'session.closed_day.override_confirmed'
    and payload->>'calendarEntryId' = holiday_id::text and payload->>'reason' = 'Local rollback assertion') then raise exception 'CLOSED_DAY_AUDIT_MISSING'; end if;
  -- DST 以当地日历日移动：09:00 仍为 09:00，UTC 跨切换减少一小时。
  update public.organizations set timezone = 'America/New_York' where singleton_key = 1;
  update public.class_sessions set scheduled_at = '2026-03-01 14:00:00Z' where id = anchor;
  preview := public.preview_session_schedule_postpone(anchor, 7);
  if (preview #>> '{sessions,0,scheduledAt}')::timestamptz <> '2026-03-08 13:00:00Z' then raise exception 'DST_TIME_DRIFT'; end if;
  update public.class_sessions set scheduled_at = '2026-03-01 07:30:00Z' where id = anchor;
  begin
    perform public.preview_session_schedule_postpone(anchor, 7);
    raise exception 'NONEXISTENT_LOCAL_TIME_ACCEPTED';
  exception when others then if sqlerrm <> 'INVALID_SCHEDULE' then raise; end if; end;
  begin
    perform public.preview_session_schedule_postpone(current_setting('postpone.test.session5')::uuid, 7);
    raise exception 'STARTED_ANCHOR_ACCEPTED';
  exception when others then if sqlerrm <> 'SESSION_ALREADY_STARTED' then raise; end if; end;
  begin
    perform public.preview_session_schedule_postpone(current_setting('postpone.test.session11')::uuid, 7);
    raise exception 'UNSCHEDULED_ANCHOR_ACCEPTED';
  exception when others then if sqlerrm <> 'SESSION_NOT_EDITABLE' then raise; end if; end;
  if has_function_privilege('anon', 'public.preview_session_schedule_postpone(uuid,integer)', 'execute')
    or has_function_privilege('anon', 'public.apply_session_schedule_postpone(uuid,integer,text,boolean,text)', 'execute') then raise exception 'ANON_ACL_OPEN'; end if;
end;
$$;
