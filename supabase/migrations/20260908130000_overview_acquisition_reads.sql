-- 来源条件与游标顺序共用索引，避免每页扫描并解析全部档案。
create index history_import_records_source_cursor_idx on public.history_import_records
  ((source_data->>'filename'), (record_data->>'tableName'), id);

-- 以当前调用者读取原始来源；保留 history_import_records 的管理员 RLS。
-- 每个档案只展开一次 cells，保留原顺序、缺失字段及重复字段的原始语义。
create function public.list_staff_overview_acquisition_sources(
  p_source_file text, p_source_table text, p_after text default null, p_limit integer default 1000
) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with bounds as (
    select greatest(1, least(coalesce(p_limit, 1000), 1000)) as page_size
  ), candidates as materialized (
    select h.id, h.lead_id, h.record_data
    from public.history_import_records h
    where h.source_data->>'filename' = p_source_file
      and h.record_data->>'tableName' = p_source_table
      and (p_after is null or h.id > p_after)
    order by h.id limit (select page_size + 1 from bounds)
  ), page as materialized (
    select * from candidates order by id limit (select page_size from bounds)
  ), projected as (
    select p.id, jsonb_build_object('id', p.id, 'lead_id', p.lead_id,
      'record_data', jsonb_build_object('cells', coalesce((
        select jsonb_agg(jsonb_build_object('fieldName', c.value->'fieldName', 'text', c.value->'text') order by c.position)
        from jsonb_array_elements(case when jsonb_typeof(p.record_data->'cells') = 'array'
          then p.record_data->'cells' else '[]'::jsonb end) with ordinality as c(value, position)
        where c.value->>'fieldName' = any(array['获取日期', '登记日期（此列不用填，自动生成）',
          '学员姓名', '家长电话', '确认人员', '跟进人', '沟通人员'])
      ), '[]'::jsonb))) as record
    from page p
  )
  select jsonb_build_object('records', coalesce((select jsonb_agg(record order by id) from projected), '[]'::jsonb),
    'hasMore', (select count(*) > (select page_size from bounds) from candidates));
$$;

revoke all on function public.list_staff_overview_acquisition_sources(text,text,text,integer) from public, anon, authenticated, service_role;
grant execute on function public.list_staff_overview_acquisition_sources(text,text,text,integer) to authenticated;
comment on function public.list_staff_overview_acquisition_sources(text,text,text,integer) is
  '总览获客来源的游标读取；保留调用者 RLS，仅投影计数、署名和姓名字段，不修改业务事实。';
