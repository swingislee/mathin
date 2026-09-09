-- 同一教师账号的设备使用独立试讲频道；只授权临时广播，不创建课堂业务记录。
create policy "rehearsal_broadcast_receive_own" on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and (select realtime.topic()) ~ '^rehearsal:[0-9a-f-]{36}:(session|activity):[0-9a-f-]{36}$'
    and split_part((select realtime.topic()), ':', 2) = (select auth.uid())::text
  );

create policy "rehearsal_broadcast_send_own" on realtime.messages
  for insert to authenticated
  with check (
    extension = 'broadcast'
    and (select realtime.topic()) ~ '^rehearsal:[0-9a-f-]{36}:(session|activity):[0-9a-f-]{36}$'
    and split_part((select realtime.topic()), ':', 2) = (select auth.uid())::text
  );
