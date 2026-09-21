-- 在 authenticated 管理员只读事务中运行；输出仅计数和状态，适用于每次 Base 增量导入后。
do $$
declare page jsonb; records jsonb := '[]'; cursor_id text := null; revision text := null; pages integer := 0; expected integer;
begin
  if not public.is_admin(auth.uid()) then raise exception 'ADMIN_REQUIRED';end if;
  loop
    page := public.list_current_staff_overview_acquisition_sources(cursor_id,1000);
    pages := pages+1;
    if pages>100 then raise exception 'ACQUISITION_CURSOR_LOOP';end if;
    if revision is not null and revision<>page->>'revision' then raise exception 'SOURCE_CHANGED';end if;
    revision:=page->>'revision';records:=records||(page->'records');
    exit when not (page->>'hasMore')::boolean;
    if jsonb_array_length(page->'records')<>1000 then raise exception 'SHORT_PAGE';end if;
    cursor_id:=page->'records'->-1->>'id';
  end loop;
  select count(distinct h.source_record_id) into expected from public.history_import_records h
  where h.source_data->>'format'='feishu-base'
    and coalesce(h.source_data->>'logicalSourceId',h.source_data->>'id')='feishu-base:28a6f6af56504cab716f01eead37d73b5098d0830ed4b02b55c06dc93e135dc6'
    and h.record_data->>'tableId'='tblzwPK2XgJa14EC';
  if expected<>jsonb_array_length(records) then raise exception 'INCOMPLETE_CURRENT_SOURCES';end if;
  if (select count(distinct h.source_record_id) from jsonb_array_elements(records) r join public.history_import_records h on h.id=r->>'id')<>expected
    then raise exception 'DUPLICATE_SOURCE_ROWS';end if;
  if exists(select 1 from jsonb_array_elements(records) r
    where not (r->'source_alias_ids' ? (r->>'id'))) then raise exception 'CURRENT_ALIAS_MISSING';end if;
  perform set_config('overview.current.rows',expected::text,true);
  perform set_config('overview.current.pages',pages::text,true);
end;$$;
select jsonb_build_object('sourceRows',current_setting('overview.current.rows')::integer,
  'cursorPages',current_setting('overview.current.pages')::integer,'complete',true,'distinctSourceRows',true);
