-- Verify that source writes refresh the stored filter projection atomically.
-- Run only on an identified isolated database; every fixture rolls back.
begin;
do $check$
declare expression text; writer name; projection public.school_source_filter_values;
begin
  select pg_get_expr(d.adbin,d.adrelid) into expression
  from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid='public.history_import_records'::regclass
    and a.attname='school_filter_values' and a.attgenerated='s';
  if expression is null then raise exception 'STORED_PROJECTION_REQUIRED'; end if;
  execute format('create temporary table source_filter_fixture (
    source_data jsonb,record_data jsonb,school_filter_values public.school_source_filter_values
    generated always as (%s) stored)',expression);

  insert into source_filter_fixture(source_data,record_data) values('{"format":"feishu-base"}',
    '{"tableName":"2026秋季在读学员表格","cells":[
      {"fieldName":"年级","text":"二年级"},
      {"fieldName":"A: 当前年级","text":" 大班 "},
      {"fieldName":"获取日期","text":"2026-06-30"},
      {"fieldName":"获取人员","text":"事务兼职"},
      {"fieldName":"学服老师","text":" 事务学服 "}
    ]}');
  select (f.school_filter_values).* into projection from source_filter_fixture f;
  if projection is distinct from row('大班',0,'2026-06-30'::date,2026,'事务学服',true)::public.school_source_filter_values
    then raise exception 'SOURCE_FIELD_PRIORITY_OR_PROJECTION_CHANGED'; end if;

  update source_filter_fixture set record_data='{"cells":[
    {"fieldName":"年级","text":"待核实"},
    {"fieldName":"获取日期","text":"2026-02-31"},
    {"fieldName":"获取人员","text":"事务兼职"}
  ]}';
  select (f.school_filter_values).* into projection from source_filter_fixture f;
  if projection is distinct from row('待核实',null,null,null,null,false)::public.school_source_filter_values
    then raise exception 'SOURCE_UPDATE_MUST_REPLACE_OLD_VALUES'; end if;

  update source_filter_fixture set source_data='{"format":"other"}';
  if exists(select 1 from source_filter_fixture where school_filter_values is distinct from null)
    then raise exception 'NON_FEISHU_SOURCE_MUST_NOT_PROJECT'; end if;
  update source_filter_fixture set source_data='{"format":"feishu-base"}',record_data='{"cells":[]}';
  select (f.school_filter_values).* into projection from source_filter_fixture f;
  if projection is distinct from row(null,null,null,null,null,false)::public.school_source_filter_values
    then raise exception 'EMPTY_SOURCE_MUST_CLEAR_PROJECTION'; end if;

  -- Preserve the import writer while keeping application roles off this helper.
  select pg_get_userbyid(proowner) into writer from pg_proc
    where oid='public.project_staff_overview_acquisition_cells(jsonb)'::regprocedure;
  if not has_function_privilege(writer,'public.project_school_source_filter_values(jsonb)','execute')
    or has_function_privilege('anon','public.project_school_source_filter_values(jsonb)','execute')
    or has_function_privilege('authenticated','public.project_school_source_filter_values(jsonb)','execute')
    or has_function_privilege('service_role','public.project_school_source_filter_values(jsonb)','execute')
    then raise exception 'SOURCE_PROJECTION_EXECUTION_SCOPE_CHANGED'; end if;
end $check$;
rollback;
