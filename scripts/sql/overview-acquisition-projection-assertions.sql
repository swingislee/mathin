-- 使用当前事务内已插入的隔离来源夹具；原文变动后派生字段必须在同一语句内更新。
do $check$
declare cells jsonb; projected jsonb; response jsonb; expected jsonb;
begin
  if exists (
    select 1 from public.history_import_records h
    where (h.overview_acquisition_cells is not null) is distinct from coalesce(
      h.source_data->>'format'='feishu-base'
      and coalesce(h.source_data->>'logicalSourceId',h.source_data->>'id')=
        'feishu-base:28a6f6af56504cab716f01eead37d73b5098d0830ed4b02b55c06dc93e135dc6'
      and h.record_data->>'tableId'='tblzwPK2XgJa14EC',false)
      or h.overview_acquisition_cells is not null and h.overview_acquisition_cells<>
        public.project_staff_overview_acquisition_cells(h.record_data)
  ) then raise exception 'PROJECTION_BACKFILL_CHANGED';end if;

  -- 保留原顺序、重复字段、缺失/非字符串 text；无效 cells 与非目标字段均沿用原语义。
  for cells in select value from jsonb_array_elements(
    '[null,{},"scalar",[],[null,3,[],{}, {"fieldName":"忽略","text":"x"}],
      [{"fieldName":"家长电话","text":"fictional","raw":"discard"},
       {"fieldName":"获取日期","text":"2050-01-01"},
       {"fieldName":"获取日期","text":"2050-01-02"},
       {"fieldName":"学员姓名"},{"fieldName":"确认人员","text":null},
       {"fieldName":"跟进人","text":7},{"fieldName":"沟通人员","text":["x"]}]]'::jsonb)
  loop
    select coalesce(jsonb_agg(jsonb_build_object('fieldName',c.value->'fieldName','text',c.value->'text') order by c.n),'[]'::jsonb)
    into expected from jsonb_array_elements(case when jsonb_typeof(cells)='array' then cells else '[]'::jsonb end) with ordinality c(value,n)
    where c.value->>'fieldName'=any(array['获取日期','登记日期（此列不用填，自动生成）','学员姓名','家长电话','确认人员','跟进人','沟通人员']);
    update public.history_import_records set record_data=jsonb_set(record_data,'{cells}',cells)
      where id='zz-acquisition-check-version-current' returning overview_acquisition_cells into projected;
    if not found or projected is distinct from expected then raise exception 'PROJECTION_UPDATE_CHANGED';end if;
  end loop;

  -- JSON source 范围变更立即退出和重新进入，不依赖定时刷新或应用失效通知。
  update public.history_import_records set source_data=source_data||'{"logicalSourceId":"unrelated"}'::jsonb
    where id='zz-acquisition-check-version-current' returning overview_acquisition_cells into projected;
  if projected is not null then raise exception 'PROJECTION_SOURCE_EXIT_FAILED';end if;
  update public.history_import_records set source_data=source_data-'logicalSourceId'
    where id='zz-acquisition-check-version-current' returning overview_acquisition_cells into projected;
  if projected is distinct from expected then raise exception 'PROJECTION_SOURCE_REENTRY_FAILED';end if;
  update public.history_import_records set record_data=jsonb_set(record_data,'{tableId}','"unrelated"'::jsonb)
    where id='zz-acquisition-check-version-current' returning overview_acquisition_cells into projected;
  if projected is not null then raise exception 'PROJECTION_TABLE_EXIT_FAILED';end if;
  update public.history_import_records set record_data=jsonb_set(record_data,'{tableId}','"tblzwPK2XgJa14EC"'::jsonb)
    where id='zz-acquisition-check-version-current' returning overview_acquisition_cells into projected;
  if projected is distinct from expected then raise exception 'PROJECTION_TABLE_REENTRY_FAILED';end if;

  if exists(select 1 from pg_proc where oid='public.list_current_staff_overview_acquisition_sources(text,integer)'::regprocedure and (prosecdef or provolatile<>'s'))
    or not exists(select 1 from pg_attribute where attrelid='public.history_import_records'::regclass and attname='overview_acquisition_cells' and attgenerated='s')
    or not exists(select 1 from pg_class where oid='public.history_import_records'::regclass and relrowsecurity)
    or not exists(select 1 from pg_proc where oid='public.project_staff_overview_acquisition_cells(jsonb)'::regprocedure and not prosecdef and provolatile='i')
    or has_function_privilege('anon','public.list_current_staff_overview_acquisition_sources(text,integer)','execute')
    or has_function_privilege('service_role','public.list_current_staff_overview_acquisition_sources(text,integer)','execute')
    or has_function_privilege('authenticated','public.project_staff_overview_acquisition_cells(jsonb)','execute')
    or has_function_privilege('anon','public.project_staff_overview_acquisition_cells(jsonb)','execute')
    or has_function_privilege('service_role','public.project_staff_overview_acquisition_cells(jsonb)','execute')
    or has_table_privilege('authenticated','public.history_import_records','INSERT,UPDATE,DELETE')
  then raise exception 'PROJECTION_ACCESS_CHANGED';end if;
end;
$check$;
