-- 在同一显式事务内，先还原 04000 的精确输入，随后应用查询迁移并重放统计读取保护。
-- 本文件与 reconcile-statistics-readers.sql 必须成对执行，中间不得提交。
do $prepare$
declare definition text; original_source text; restored_source text;
begin
  if not exists (select 1 from public.schema_migrations
    where version='20260921110000_production_statistics_identity_scope'
      and checksum='c5b5f6ca63a247239c977b04dc769c3c22857abef7d33d5c4d1663ea82523dca')
    or exists (select 1 from public.schema_migrations
      where version='20260921004000_overview_acquisition_alias_aggregation') then
    raise exception 'STATISTICS_UPGRADE_LEDGER_MISMATCH';
  end if;
  select pg_get_functiondef(oid),prosrc into definition,original_source from pg_proc
    where oid='public.list_current_staff_overview_acquisition_sources(text,integer)'::regprocedure;
  restored_source:=replace(original_source,
    'select * from latest where public.statistics_source_included(id) and (p_after is null or id > p_after)',
    'select * from latest where p_after is null or id > p_after');
  if md5(replace(original_source,chr(13),''))<>'7f4c1b1bd8d54acac041522cf3c931dd'
    or md5(replace(restored_source,chr(13),''))<>'14fa49aa7e83a71c4e0c77c16d2f9b42' then
    raise exception 'STATISTICS_UPGRADE_READER_MISMATCH';
  end if;
  perform set_config('mathin.statistics_reader_upgrade_pending','true',true);
  execute replace(definition,original_source,restored_source);
end;
$prepare$;
