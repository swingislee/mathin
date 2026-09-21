-- 同一 Base 的增量档案按稳定来源行取最新版本；文件名仅兼容旧档案的版本日期。
-- 先合并版本再分页，未变化的旧行继续保留，旧来源编号继续用于业务关联。
create function public.list_current_staff_overview_acquisition_sources(
  p_after text default null, p_limit integer default 1000
) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with versions as materialized (
    select h.id, h.lead_id, h.imported_at, h.source_record_id,
      coalesce(
        substring(h.source_data->>'snapshotDate' from '^([0-9]{4}-[0-9]{2}-[0-9]{2})$'),
        substring(h.source_data->>'filename' from '^([0-9]{4}-[0-9]{2}-[0-9]{2})'),
        to_char(h.imported_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD')
      ) as snapshot_date
    from public.history_import_records h
    where h.source_data->>'format' = 'feishu-base'
      and coalesce(h.source_data->>'logicalSourceId', h.source_data->>'id') =
        'feishu-base:28a6f6af56504cab716f01eead37d73b5098d0830ed4b02b55c06dc93e135dc6'
      and h.record_data->>'tableId' = 'tblzwPK2XgJa14EC'
  ), latest as materialized (
    select distinct on (source_record_id) id, lead_id, source_record_id
    from versions order by source_record_id, snapshot_date desc, imported_at desc, id desc
  ), bounds as (
    select greatest(1, least(coalesce(p_limit, 1000), 1000)) as page_size
  ), candidates as materialized (
    select * from latest where p_after is null or id > p_after
    order by id limit (select page_size + 1 from bounds)
  ), page as materialized (
    select * from candidates order by id limit (select page_size from bounds)
  ), projected as (
    select p.id, jsonb_build_object('id', p.id, 'lead_id', p.lead_id,
      'source_alias_ids', (select jsonb_agg(v.id order by v.id) from versions v where v.source_record_id = p.source_record_id),
      'record_data', jsonb_build_object('cells', coalesce((
        select jsonb_agg(jsonb_build_object('fieldName', c.value->'fieldName', 'text', c.value->'text') order by c.position)
        from jsonb_array_elements(case when jsonb_typeof(h.record_data->'cells') = 'array'
          then h.record_data->'cells' else '[]'::jsonb end) with ordinality as c(value, position)
        where c.value->>'fieldName' = any(array['获取日期', '登记日期（此列不用填，自动生成）',
          '学员姓名', '家长电话', '确认人员', '跟进人', '沟通人员'])
      ), '[]'::jsonb))) as record
    from page p join public.history_import_records h on h.id = p.id
  )
  select jsonb_build_object('records', coalesce((select jsonb_agg(record order by id) from projected), '[]'::jsonb),
    'hasMore', (select count(*) > (select page_size from bounds) from candidates),
    'revision', (select md5(coalesce(string_agg(id, ',' order by id), '')) from versions));
$$;

revoke all on function public.list_current_staff_overview_acquisition_sources(text,integer) from public, anon, authenticated, service_role;
grant execute on function public.list_current_staff_overview_acquisition_sources(text,integer) to authenticated;
comment on function public.list_current_staff_overview_acquisition_sources(text,integer) is
  '总览当前获客来源：同一 Base/table/source row 合并增量版本，保留调用者 RLS；不改原始档案和业务事实。';
