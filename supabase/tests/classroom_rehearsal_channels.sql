begin;

-- 只使用事务内的 JWT 声明和广播探针；不创建身份或课堂业务数据。
set local role authenticated;
do $$
declare
  teacher_id text := '11111111-1111-4111-8111-111111111111';
  other_id text := '22222222-2222-4222-8222-222222222222';
  resource_id text := '33333333-3333-4333-8333-333333333333';
  room text;
  kind text;
begin
  perform set_config('request.jwt.claim.sub', teacher_id, true);
  foreach kind in array array['session', 'activity'] loop
    room := 'rehearsal:' || teacher_id || ':' || kind || ':' || resource_id;
    perform set_config('realtime.topic', room, true);
    insert into realtime.messages(topic, extension, event, payload, private)
      values(room, 'broadcast', 'ev', '{"probe":"rehearsal-rls"}'::jsonb, true);
    if not exists(select 1 from realtime.messages where payload->>'probe' = 'rehearsal-rls') then
      raise exception 'OWN_REHEARSAL_RECEIVE_FAILED';
    end if;
    perform set_config('realtime.topic', 'rehearsal:' || other_id || ':' || kind || ':' || resource_id, true);
    if exists(select 1 from realtime.messages where payload->>'probe' = 'rehearsal-rls') then
      raise exception 'FOREIGN_REHEARSAL_READ_ALLOWED';
    end if;
    begin
      insert into realtime.messages(topic, extension, event, payload, private)
        values(room, 'broadcast', 'ev', '{}'::jsonb, true);
      raise exception 'FOREIGN_REHEARSAL_WRITE_ALLOWED';
    exception when insufficient_privilege then null;
    end;
    perform set_config('realtime.topic', room, true);
    begin
      insert into realtime.messages(topic, extension, event, payload, private)
        values(room, 'presence', 'presence', '{}'::jsonb, true);
      raise exception 'UNREQUESTED_PRESENCE_WRITE_ALLOWED';
    exception when insufficient_privilege then null;
    end;
  end loop;
  perform set_config('realtime.topic', 'rehearsal:' || teacher_id || ':invalid:' || resource_id, true);
  begin
    insert into realtime.messages(topic, extension, event, payload, private)
      values('invalid', 'broadcast', 'ev', '{}'::jsonb, true);
    raise exception 'MALFORMED_REHEARSAL_WRITE_ALLOWED';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
set local role anon;
do $$ begin
  perform set_config('realtime.topic', 'rehearsal:11111111-1111-4111-8111-111111111111:session:33333333-3333-4333-8333-333333333333', true);
  begin
    insert into realtime.messages(topic, extension, event, payload, private)
      values('anonymous', 'broadcast', 'ev', '{}'::jsonb, true);
    raise exception 'ANONYMOUS_REHEARSAL_WRITE_ALLOWED';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
