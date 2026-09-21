-- 仅在已核对的隔离开发事务内执行，全部夹具随事务回滚。
do $check$
declare relation text; columns text; signature text;
begin
  if has_function_privilege('anon','public.business_authoritative_source_ids_v2(text[])','execute')
    or not has_function_privilege('authenticated','public.business_authoritative_source_ids_v2(text[])','execute')
    or (select proowner from pg_proc where oid='public.business_authoritative_source_ids_v2(text[])'::regprocedure)<>
       (select proowner from pg_proc where oid='public.business_source_is_authoritative(text)'::regprocedure)
    then raise exception 'BATCH_AUTHORITY_ACCESS_CHANGED';end if;
  if (select array_agg(id order by id) from public.history_import_records where public.business_source_is_authoritative(id)) is distinct from
    (select array_agg(id order by id) from public.business_authoritative_source_ids_v2(array(select id from public.history_import_records)||array[null,'missing-source-id']) id)
    then raise exception 'BATCH_AUTHORITY_RESULTS_CHANGED';end if;
  foreach signature in array array['public.staff_overview_acquisition_contact_facts_v2(text,text)','public.get_staff_overview_acquisition_contacts_v2(jsonb)'] loop
    if exists(select 1 from pg_proc where oid=signature::regprocedure and (prosecdef or provolatile<>'s'))
      or has_function_privilege('anon',signature,'execute') or has_function_privilege('service_role',signature,'execute')
      or not has_function_privilege('authenticated',signature,'execute') then raise exception 'AGGREGATE_ACCESS_CHANGED';end if;
  end loop;
  foreach relation in array array['lead_communications','activity_registrations'] loop
    if not exists(select 1 from pg_class where oid=('public.business_'||relation)::regclass and reloptions @> array['security_invoker=true'])
      or not exists(select 1 from pg_attribute where attrelid=('public.'||relation)::regclass and attname='overview_contact_v2' and attgenerated='s')
      or not exists(select 1 from pg_class where oid=('public.'||relation)::regclass and relrowsecurity)
      then raise exception 'AGGREGATE_TABLE_ACCESS_CHANGED';end if;
    -- 使用真正的生成表达式核对普通写入角色；临时表没有业务触发器，不修改原表。
    execute format('create temporary table check_%I (like public.%I including generated)',relation,relation);
    select string_agg(quote_ident(attname),',' order by attnum) into columns from pg_attribute
      where attrelid=('public.'||relation)::regclass and attnum>0 and not attisdropped and attgenerated='';
    execute format('insert into check_%I (%s) select %s from public.%I limit 1',relation,columns,columns,relation);
    execute format('grant select,update on check_%I to authenticated,service_role',relation);
  end loop;
end;
$check$;

set local role authenticated;
do $writes$
declare relation text; projected public.overview_contact_fields_v2;
  facts jsonb:='{"version":1,"sourceKey":"fixture","sourceName":"fixture","sourceTable":"fixture","sourceVersion":"2050-01-01","scope":"selection","confirmed":{"contacts":true},"months":{"contacts":"2050-01"},"staff":{"contacts":"fixture"},"evidence":[]}'::jsonb;
begin
  foreach relation in array array['lead_communications','activity_registrations'] loop
    execute format('update check_%I set source_metric_facts=$1 returning (overview_contact_v2).*',relation) into projected using facts;
    if projected.confirmed is distinct from true or projected.month_state<>2 or projected.reporting_month<>'2050-01' then raise exception 'GENERATED_WRITE_FAILED';end if;
    execute format('update check_%I set source_metric_facts=$1 returning (overview_contact_v2).*',relation) into projected using jsonb_set(facts,'{months,contacts}','null'::jsonb);
    if projected.month_state<>1 or projected.reporting_month is not null then raise exception 'GENERATED_NULL_MONTH_FAILED';end if;
    execute format('update check_%I set source_metric_facts=$1 returning (overview_contact_v2).*',relation) into projected using facts#-'{months,contacts}';
    if projected.month_state<>0 then raise exception 'GENERATED_ABSENT_MONTH_FAILED';end if;
    execute format('update check_%I set source_metric_facts=$1 returning (overview_contact_v2).*',relation) into projected using jsonb_set(facts,'{confirmed,arrivals}','null'::jsonb);
    if not (projected is null) then raise exception 'GENERATED_VALIDATION_FAILED';end if;
  end loop;
end;
$writes$;
reset role;
set local role service_role;
update check_lead_communications set source_metric_facts=null;
update check_activity_registrations set source_metric_facts=null;
reset role;

-- 使用现有首联 RPC 验证真实业务写入，主体完全属于本次回滚夹具。
select set_config('mathin.aggregate_fixture_lead',gen_random_uuid()::text,true) is not null;
insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,owner_id,created_by)
  values(current_setting('mathin.aggregate_fixture_lead')::uuid,'aggregate rollback fixture','aggregate rollback fixture','00000000000','00000000000',auth.uid(),auth.uid());
set local role authenticated;
do $native_write$
begin
  perform public.record_lead_contact_v2(current_setting('mathin.aggregate_fixture_lead')::uuid,'connected','aggregate rollback fixture',false,null,null,null,null,null,'','');
  if not exists(select 1 from public.lead_communications where lead_id=current_setting('mathin.aggregate_fixture_lead')::uuid and outcome='connected' and overview_contact_v2 is null)
    then raise exception 'NATIVE_CONTACT_WRITE_FAILED';end if;
end;
$native_write$;
reset role;

do $freshness$
declare value public.overview_acquisition_fields_v2; n integer;
begin
  -- 复用来源版本夹具，核对晚到旧版本、来源别名以及非目标来源。
  select count(*) into n from public.staff_overview_acquisition_contact_facts_v2('month','Asia/Shanghai') where id like 'zz-acquisition-check-%';
  if n<>1003 then raise exception 'AGGREGATE_LATEST_VERSION_FAILED';end if;
  update public.history_import_records set record_data=jsonb_set(record_data,'{cells}',
    '[{"fieldName":"获取日期","text":"1/3"},{"fieldName":"登记日期（此列不用填，自动生成）","text":"2050-01-05"},{"fieldName":"确认人员","text":" fixture "}]')
    where id='zz-acquisition-check-version-current' returning (overview_acquisition_v2).* into value;
  if value.acquired_on<>'2050-01-03'::date or value.staff_label<>'fixture' then raise exception 'GENERATED_ACQUISITION_WRITE_FAILED';end if;
  if not exists(select 1 from public.staff_overview_acquisition_contact_facts_v2('month','Asia/Shanghai')
    where id='zz-acquisition-check-version-current' and event_at='2050-01-02T16:00:00Z' and person_id='source-staff:fixture') then raise exception 'FRESH_ACQUISITION_READ_FAILED';end if;
  update public.history_import_records set source_data=source_data||'{"logicalSourceId":"unrelated"}'::jsonb
    where id='zz-acquisition-check-version-current' returning (overview_acquisition_v2).* into value;
  if not (value is null) then raise exception 'GENERATED_SOURCE_SCOPE_FAILED';end if;
  if not exists(select 1 from public.staff_overview_acquisition_contact_facts_v2('month','Asia/Shanghai') where id='zz-acquisition-check-version-old') then raise exception 'VERSION_RESELECTION_FAILED';end if;
  update public.history_import_records set source_data=source_data-'logicalSourceId',record_data=jsonb_set(record_data,'{cells}','[{"fieldName":"获取日期","text":7}]'::jsonb)
    where id='zz-acquisition-check-version-current' returning (overview_acquisition_v2).* into value;
  if value.valid is distinct from false then raise exception 'MALFORMED_SOURCE_COERCED';end if;
  begin
    perform public.get_staff_overview_acquisition_contacts_v2(current_setting('mathin.aggregate_window')::jsonb);
    raise exception 'MALFORMED_SOURCE_NOT_REPORTED';
  exception when raise_exception then
    if sqlerrm<>'OVERVIEW_ACQUISITION_SOURCE_INVALID' then raise;end if;
  end;
end;
$freshness$;
