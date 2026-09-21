-- 仅保存可由原始档案重建的总览字段；每次导入/更新由 PostgreSQL 同步维护。
do $guard$
begin
  if not exists (
    select 1 from pg_proc where oid='public.list_current_staff_overview_acquisition_sources(text,integer)'::regprocedure
      and md5(replace(prosrc,chr(13),''))='59781cb68887e179e4919674541daee6' and not prosecdef and provolatile='s'
  ) or (select count(*) from pg_policy where polrelid='public.history_import_records'::regclass)<>1
    or not exists (
      select 1 from pg_policy where polrelid='public.history_import_records'::regclass
        and polname='history_import_records_admin_read' and polcmd='r' and polpermissive
        and polroles=array['authenticated'::regrole::oid] and polwithcheck is null
        and replace(replace(pg_get_expr(polqual,polrelid),'public.',''),'auth.','')='is_admin(uid())'
    ) then raise exception 'OVERVIEW_ACQUISITION_READ_CONTRACT_CHANGED';end if;
end;
$guard$;

create function public.project_staff_overview_acquisition_cells(p_record_data jsonb)
returns jsonb language sql immutable parallel safe security invoker
set search_path=public,pg_temp as $project$
  select coalesce((
        select jsonb_agg(jsonb_build_object('fieldName', c.value->'fieldName', 'text', c.value->'text') order by c.position)
        from jsonb_array_elements(case when jsonb_typeof(p_record_data->'cells') = 'array'
          then p_record_data->'cells' else '[]'::jsonb end) with ordinality as c(value, position)
        where c.value->>'fieldName' = any(array['获取日期', '登记日期（此列不用填，自动生成）',
          '学员姓名', '家长电话', '确认人员', '跟进人', '沟通人员'])
  ), '[]'::jsonb);
$project$;
revoke all on function public.project_staff_overview_acquisition_cells(jsonb) from public,anon,authenticated,service_role;
alter table public.history_import_records add column overview_acquisition_cells jsonb
generated always as (
  case when source_data->>'format'='feishu-base'
    and coalesce(source_data->>'logicalSourceId',source_data->>'id')=
      'feishu-base:28a6f6af56504cab716f01eead37d73b5098d0830ed4b02b55c06dc93e135dc6'
    and record_data->>'tableId'='tblzwPK2XgJa14EC'
  then public.project_staff_overview_acquisition_cells(record_data) end
) stored;

comment on column public.history_import_records.overview_acquisition_cells is
  '原始档案的同步生成投影，仅用于总览读取；来源条件不匹配为 NULL，原文仍是数据权威。';

-- 标量子查询保留原管理员检查，每个读取语句求值；不跨请求缓存身份。
alter policy history_import_records_admin_read on public.history_import_records
  using ((select public.is_admin(auth.uid())));

-- 新列首次生成后提供 NULL 比例，供优化器估计实际读取范围。
analyze public.history_import_records (overview_acquisition_cells);

create or replace function public.list_current_staff_overview_acquisition_sources(
  p_after text default null, p_limit integer default 1000
) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
  with versions as materialized (
    select h.id, h.lead_id, h.overview_acquisition_cells, h.imported_at, h.source_record_id,
      coalesce(
        substring(h.source_data->>'snapshotDate' from '^([0-9]{4}-[0-9]{2}-[0-9]{2})$'),
        substring(h.source_data->>'filename' from '^([0-9]{4}-[0-9]{2}-[0-9]{2})'),
        to_char(h.imported_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD')
      ) as snapshot_date
    from public.history_import_records h
    where h.overview_acquisition_cells is not null
  ), latest as materialized (
    select distinct on (source_record_id) id, lead_id, overview_acquisition_cells, source_record_id,
      case when source_record_id is not null then
        jsonb_agg(id) over (partition by source_record_id order by id
          rows between unbounded preceding and unbounded following)
      end as source_alias_ids
    from versions order by source_record_id, snapshot_date desc, imported_at desc, id desc
  ), bounds as (
    select greatest(1, least(coalesce(p_limit, 1000), 10000)) as page_size
  ), candidates as materialized (
    select * from latest where p_after is null or id > p_after
    order by id limit (select page_size + 1 from bounds)
  ), page as materialized (
    select * from candidates order by id limit (select page_size from bounds)
  ), projected as (
    select p.id, jsonb_build_object('id', p.id, 'lead_id', p.lead_id,
      'source_alias_ids', p.source_alias_ids,
      'record_data', jsonb_build_object('cells', p.overview_acquisition_cells)) as record
    from page p
  )
  select jsonb_build_object('records', coalesce((select jsonb_agg(record order by id) from projected), '[]'::jsonb),
    'hasMore', (select count(*) > (select page_size from bounds) from candidates),
    'revision', (select md5(coalesce(string_agg(id, ',' order by id), '')) from versions));
$$;
