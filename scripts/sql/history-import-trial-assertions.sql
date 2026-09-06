-- 在调用方的事务中执行，结束后由调用方 rollback。只插入本功能的合成档案。
do $test$
declare
  admin_id uuid;
  other_id uuid;
  batch_id uuid;
  visible_count integer;
  expected_count integer;
  write_rejected boolean := false;
begin
  select id into strict admin_id from public.profiles where role='admin' order by id limit 1;
  select id into strict other_id from public.profiles where role<>'admin' order by id limit 1;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('history_import_batches','history_import_records','history_import_batch_records') and not c.relrowsecurity) then
    raise exception 'HISTORY_ARCHIVE_RLS_REQUIRED';
  end if;
  if has_table_privilege('anon','public.history_import_records','SELECT')
    or has_table_privilege('authenticated','public.history_import_records','INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.history_import_batches','INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.history_import_batch_records','INSERT,UPDATE,DELETE') then
    raise exception 'HISTORY_ARCHIVE_GRANT_BOUNDARY';
  end if;
  insert into public.history_import_batches(batch_key,payload_sha256,manifest)
    values('__history_assertion__',repeat('a',64),'{}') returning id into batch_id;
  insert into public.history_import_records(id,source_sha256,source_table_id,source_record_id,payload_sha256,source_data,record_data,match_status,match_data,search_text)
    values('__history_assertion__',repeat('a',64),'test-table','test-record',repeat('b',64),'{}','{"original":"synthetic"}','unmatched','{}','synthetic');
  insert into public.history_import_batch_records(batch_id,record_id,case_key) values(batch_id,'__history_assertion__','test');
  select count(*) into expected_count from public.history_import_records;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  set local role authenticated;
  select count(*) into visible_count from public.history_import_records;
  if visible_count<>expected_count then raise exception 'HISTORY_ARCHIVE_ADMIN_READ'; end if;
  begin
    update public.history_import_records set search_text='changed' where id='__history_assertion__';
  exception when insufficient_privilege then write_rejected:=true;
  end;
  if not write_rejected then raise exception 'HISTORY_ARCHIVE_WEB_WRITE_ALLOWED'; end if;
  reset role;
  perform set_config('request.jwt.claim.sub',other_id::text,true);
  set local role authenticated;
  select count(*) into visible_count from public.history_import_records;
  if visible_count<>0 then raise exception 'HISTORY_ARCHIVE_NONADMIN_RECORD_LEAK'; end if;
  select count(*) into visible_count from public.history_import_batches;
  if visible_count<>0 then raise exception 'HISTORY_ARCHIVE_NONADMIN_BATCH_LEAK'; end if;
  select count(*) into visible_count from public.history_import_batch_records;
  if visible_count<>0 then raise exception 'HISTORY_ARCHIVE_NONADMIN_LINK_LEAK'; end if;
  reset role;
end $test$;
