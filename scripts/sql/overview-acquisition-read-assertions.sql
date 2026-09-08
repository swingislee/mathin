-- 调用者为固定开发管理员；完整来源投影逐行比对，输出只含数量和布尔结论。
do $$
declare
  result jsonb; actual jsonb := '[]'; expected jsonb; cursor_id text := null;
  pages integer := 0; started timestamptz := clock_timestamp(); total_rows integer;
begin
  loop
    result := public.list_staff_overview_acquisition_sources(
      '2026-09-07【思维】用户与产品运营表.base', '获客&私域信息登记表1.0-总', cursor_id, 1000);
    pages := pages + 1;
    if pages > 20 then raise exception 'ACQUISITION_CURSOR_LOOP'; end if;
    actual := actual || (result->'records');
    exit when not (result->>'hasMore')::boolean;
    if jsonb_array_length(result->'records') <> 1000 then raise exception 'ACQUISITION_SHORT_PAGE'; end if;
    cursor_id := result->'records'->-1->>'id';
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'lead_id', h.lead_id,
    'record_data', jsonb_build_object('cells', coalesce((
      select jsonb_agg(jsonb_build_object('fieldName', c.value->'fieldName', 'text', c.value->'text') order by c.position)
      from jsonb_array_elements(h.record_data->'cells') with ordinality c(value, position)
      where c.value->>'fieldName' = any(array['获取日期', '登记日期（此列不用填，自动生成）',
        '学员姓名', '家长电话', '确认人员', '跟进人', '沟通人员'])
    ), '[]'::jsonb))) order by h.id), '[]'::jsonb) into expected
  from public.history_import_records h
  where h.source_data->>'filename' = '2026-09-07【思维】用户与产品运营表.base'
    and h.record_data->>'tableName' = '获客&私域信息登记表1.0-总';
  if actual <> expected then raise exception 'ACQUISITION_PROJECTION_CHANGED'; end if;
  total_rows := jsonb_array_length(actual);
  if total_rows = 0 then raise exception 'ACQUISITION_BASELINE_REQUIRED'; end if;
  result := public.list_staff_overview_acquisition_sources(
    '2026-09-07【思维】用户与产品运营表.base', '获客&私域信息登记表1.0-总', null, 1);
  if jsonb_array_length(result->'records') <> 1 or result->'records'->0 <> actual->0
    then raise exception 'ACQUISITION_PAGE_SIZE_CHANGED'; end if;
  result := public.list_staff_overview_acquisition_sources('missing-source', 'missing-table', null, 1000);
  if result <> '{"records":[],"hasMore":false}'::jsonb then raise exception 'ACQUISITION_EMPTY_SCOPE'; end if;
  perform set_config('overview.check.rows', total_rows::text, true);
  perform set_config('overview.check.pages', pages::text, true);
  perform set_config('overview.check.ms', (extract(epoch from clock_timestamp() - started) * 1000)::integer::text, true);
end;
$$;

select jsonb_build_object('sourceRows', current_setting('overview.check.rows')::integer,
  'cursorPages', current_setting('overview.check.pages')::integer,
  'projectionAndPaginationEqual', true, 'checkMs', current_setting('overview.check.ms')::integer);
