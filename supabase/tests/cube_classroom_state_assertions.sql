-- 复用固定开发身份；仅新建随机课堂和事件，全部随本事务回滚。
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $test$
declare
  teacher_id uuid;
  student_id uuid;
  outsider_id uuid;
  classroom_id uuid := gen_random_uuid();
  session_id uuid := gen_random_uuid();
  event_id uuid := gen_random_uuid();
  device_id uuid := gen_random_uuid();
  state_payload jsonb := '{"schema":"mathin-classroom-tool-state","version":1,"pageId":"page-1","docId":"doc-1","instanceId":"cube-1","toolId":"spatial-lab","contentVersion":"cube-structures-lesson-v2","state":{"view":null,"cameraRevision":1,"session":{"recording":"off","preview":null,"lesson":null,"work":{"version":"cube-structures-draft-v3","cursor":0,"operations":[],"initial":{"cubes":[],"groups":[],"hiddenCubeIds":[],"origin":null,"axesVisible":true,"view":"angle","frame":{"center":{"x":0,"y":0,"z":0},"radius":1},"nextCubeId":1,"nextNumber":1,"hiddenEdgesVisible":true}}}}}'::jsonb;
begin
  state_payload := state_payload || jsonb_build_object('originHash', repeat('a', 64));
  select p.id into teacher_id from public.profiles p join auth.users u on u.id=p.id where u.email='test-teacher@mathin.local' and p.is_active;
  select p.id into student_id from public.profiles p join auth.users u on u.id=p.id where u.email='test-student@mathin.local' and p.is_active;
  select p.id into outsider_id from public.profiles p join auth.users u on u.id=p.id where u.email='test-sales@mathin.local' and p.is_active;
  if teacher_id is null or student_id is null or outsider_id is null then raise exception 'FIXED_DEVELOPMENT_ACCOUNTS_REQUIRED'; end if;
  insert into public.classrooms(id, owner_id, name, invite_code)
    values(classroom_id, teacher_id, '__CUBE_CLASSROOM_STATE_TRANSACTION__', upper(left(replace(classroom_id::text, '-', ''), 6)));
  insert into public.classroom_members(classroom_id, user_id, role) values(classroom_id, teacher_id, 'teacher'), (classroom_id, student_id, 'student');
  insert into public.class_sessions(id, classroom_id, title, started_at)
    values(session_id, classroom_id, '__CUBE_CLASSROOM_STATE_TRANSACTION__', now());

  perform set_config('request.jwt.claim.sub', teacher_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into public.session_events(id, session_id, user_id, device_id, seq, type, payload, at)
    values(event_id, session_id, teacher_id, device_id, 1, 'tool_state', state_payload, now());
  insert into public.session_events(id, session_id, user_id, device_id, seq, type, payload, at)
    values(event_id, session_id, teacher_id, device_id, 1, 'tool_state', state_payload, now()) on conflict(id) do nothing;
  if (select count(*) from public.session_events e where e.id=event_id and e.payload=state_payload) <> 1 then raise exception 'TEACHER_TOOL_STATE_ROUNDTRIP_FAILED'; end if;
  begin
    insert into public.session_events(id, session_id, user_id, device_id, seq, type, payload, at)
      values(gen_random_uuid(), session_id, student_id, device_id, 2, 'tool_state', state_payload, now());
    raise exception 'SPOOFED_AUTHOR_ACCEPTED';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.session_events(id, session_id, user_id, device_id, seq, type, payload, at)
      values(gen_random_uuid(), session_id, teacher_id, device_id, 3, 'tool_state', jsonb_build_object('oversized', repeat('x', 1048577)), now());
    raise exception 'OVERSIZED_EVENT_ACCEPTED';
  exception when check_violation then null; end;

  perform set_config('request.jwt.claim.sub', student_id::text, true);
  if (select count(*) from public.session_events e where e.id=event_id) <> 1 then raise exception 'STUDENT_TOOL_REPLAY_FAILED'; end if;
  begin
    insert into public.session_events(id, session_id, user_id, device_id, seq, type, payload, at)
      values(gen_random_uuid(), session_id, student_id, device_id, 4, 'tool_state', state_payload, now());
    raise exception 'STUDENT_TOOL_STATE_WRITE_ACCEPTED';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claim.sub', outsider_id::text, true);
  if (select count(*) from public.session_events e where e.id=event_id) <> 0 then raise exception 'OUTSIDER_TOOL_REPLAY_ACCEPTED'; end if;
  begin
    insert into public.session_events(id, session_id, user_id, device_id, seq, type, payload, at)
      values(gen_random_uuid(), session_id, outsider_id, device_id, 5, 'tool_state', state_payload, now());
    raise exception 'OUTSIDER_TOOL_STATE_WRITE_ACCEPTED';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
end;
$test$;
rollback;
