-- 固定开发身份验证结构化资料的读写范围；合成来源与身份随 savepoint 撤销。
savepoint base_business_contract;
do $test$
declare admin_id uuid; teacher_id uuid; child_id uuid; lid uuid:=gen_random_uuid(); hidden uuid:=gen_random_uuid(); hidden_student uuid:=gen_random_uuid();
  source_id text:='__base_fields__'||gen_random_uuid(); result jsonb; err text; fields jsonb; original jsonb;
begin
  select id into admin_id from auth.users where email='test-admin@mathin.local';
  select id into teacher_id from auth.users where email='test-teacher@mathin.local';
  select id into child_id from auth.users where email='test-student@mathin.local';
  if num_nonnulls(admin_id,teacher_id,child_id)<>3 then raise exception 'FIXED_IDENTITIES_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,status,owner_id,created_by)
    values(lid,'Base contract','basecontract','13800001234','13800001234','uncontacted',teacher_id,admin_id),
      (hidden,'Hidden contract','hiddencontract','13900001234','13900001234','uncontacted',admin_id,admin_id);
  original:='[{"fieldId":"date","fieldName":"获取日期","text":"6/10","kind":"context","type":"Text"},
    {"fieldId":"place","fieldName":"获客区位","text":"原场地","kind":"context","type":"Text"},
    {"fieldId":"content","fieldName":"触达内容","text":"原文第一行\n原文第二行","kind":"context","type":"Text"},
    {"fieldId":"mixed","fieldName":"就读学校","text":"原获取地址\n一年级","kind":"context","type":"Text"}]';
  insert into public.history_import_records(id,source_sha256,source_table_id,source_record_id,payload_sha256,source_data,record_data,match_status,match_data,search_text,lead_id,entity_data)
    values(source_id,repeat('d',64),'contract',source_id,repeat('e',64),'{"format":"feishu-base","filename":"contract.base"}',
      jsonb_build_object('hasContent',true,'tableName','获客&私域信息登记表1.0-总','cells',original),'matched','{}','contract',lid,'{}');
  fields:='[{"fieldId":"date","name":"获取日期","section":"acquisition","key":"acquired_on","kind":"date","value":{"text":"06-10","precision":"month_day","year":null,"month":6,"day":10},"display":"06-10","originalText":"6/10","sourceType":"Text","rawHasContent":true,"status":"normalized"},
    {"fieldId":"place","name":"获客区位","section":"acquisition","key":"location","kind":"text","value":"原场地","display":"原场地","originalText":"原场地","sourceType":"Text","rawHasContent":true,"status":"text"},
    {"fieldId":"content","name":"触达内容","section":"acquisition","key":"content","kind":"text","value":"原文第一行\n原文第二行","display":"原文第一行\n原文第二行","originalText":"原文第一行\n原文第二行","sourceType":"Text","rawHasContent":true,"status":"text"},
    {"fieldId":"mixed","name":"就读学校","section":"acquisition","key":"location","kind":"text","label":"获取地址","value":"原获取地址","display":"原获取地址","originalText":"原获取地址\n一年级","sourceType":"Text","rawHasContent":true,"status":"normalized","projections":[{"section":"identity","key":"grade","kind":"grade","label":"年级","value":1,"display":"1年级","status":"normalized"}]}]';
  begin
    insert into public.history_source_business_facts(source_record_id,mapping_version,source_payload_sha256,fields)
      values(source_id,1,repeat('f',64),fields);
    raise exception 'WRONG_SOURCE_HASH_ACCEPTED';
  exception when others then get stacked diagnostics err=message_text; if err<>'BASE_SOURCE_CHANGED' then raise; end if; end;
  begin
    insert into public.history_source_business_facts(source_record_id,mapping_version,source_payload_sha256,fields)
      values(source_id,1,repeat('e',64),jsonb_set(fields,'{0,originalText}','"invented"'));
    raise exception 'WRONG_ORIGINAL_ACCEPTED';
  exception when others then get stacked diagnostics err=message_text; if err<>'BASE_FIELD_SOURCE_MISMATCH' then raise; end if; end;
  insert into public.history_source_business_facts(source_record_id,mapping_version,source_payload_sha256,fields)
    values(source_id,1,repeat('e',64),fields);
  if public.read_base_source_business_fields(source_id) is distinct from fields then raise exception 'BASE_OLD_VERSION_FALLBACK_FAILED'; end if;
  fields:=jsonb_set(jsonb_set(fields,'{1,display}','"规范场地"'),'{1,value}','"规范场地"');
  insert into public.history_source_business_facts(source_record_id,mapping_version,source_payload_sha256,fields)
    values(source_id,2,repeat('e',64),jsonb_set(fields,'{1,display}','"第二版场地"'));
  if public.read_base_source_business_fields(source_id) is distinct from jsonb_set(fields,'{1,display}','"第二版场地"') then raise exception 'BASE_SECOND_VERSION_FALLBACK_FAILED'; end if;
  insert into public.history_source_business_facts(source_record_id,mapping_version,source_payload_sha256,fields)
    values(source_id,3,repeat('e',64),fields),
      (source_id,4,repeat('e',64),jsonb_set(fields,'{1,display}','"未来版本"'));
  if public.read_base_source_business_fields(source_id) is distinct from fields then raise exception 'BASE_SUPPORTED_LATEST_VERSION_FAILED'; end if;
  if public.store_base_business_fields(jsonb_build_array(jsonb_build_object('source_record_id',source_id,'mapping_version',3,'source_payload_sha256',repeat('e',64),'fields',fields)))<>0 then raise exception 'BASE_SAME_VERSION_NOT_IDEMPOTENT'; end if;
  begin
    perform public.store_base_business_fields(jsonb_build_array(jsonb_build_object('source_record_id',source_id,'mapping_version',3,'source_payload_sha256',repeat('e',64),'fields',jsonb_set(fields,'{1,display}','"覆盖同版"'))));
    raise exception 'BASE_SAME_VERSION_OVERWRITTEN';
  exception when others then get stacked diagnostics err=message_text; if err<>'BASE_MAPPING_VERSION_CHANGED' then raise; end if; end;
  insert into public.students(id,name,phone,parent_phone,assigned_to,created_by,bind_code)
    values(hidden_student,'Hidden source subject','13900001234','',admin_id,admin_id,public.generate_student_bind_code());
  insert into public.history_import_records(id,source_sha256,source_table_id,source_record_id,payload_sha256,source_data,record_data,match_status,match_data,search_text,lead_id,entity_data)
    values(source_id||'-conflict',repeat('d',64),'contract',source_id||'-conflict',repeat('e',64),'{"format":"feishu-base","filename":"conflict.base"}',
      jsonb_build_object('hasContent',true,'tableName','获客&私域信息登记表1.0-总','cells',original),'matched','{}','contract',lid,'{}'),
    (source_id||'-shared',repeat('d',64),'contract',source_id||'-shared',repeat('e',64),'{"format":"feishu-base","filename":"shared.base"}',
      jsonb_build_object('hasContent',true,'tableName','获客&私域信息登记表1.0-总','cells',original||'[{"fieldId":"shared","fieldName":"满班人数","text":"30","kind":"context"}]'::jsonb),'matched','{}','contract',lid,'{}');
  insert into public.history_import_associations(record_id,student_id,version,context,confirmed_by)
    values(source_id||'-conflict',hidden_student,1,'student_profile',admin_id);
  insert into public.history_source_business_facts(source_record_id,mapping_version,source_payload_sha256,fields)
    values(source_id||'-conflict',1,repeat('e',64),fields),
      (source_id||'-shared',1,repeat('e',64),fields||'[{"fieldId":"shared","name":"满班人数","originalText":"30","section":"reference","key":"size","display":"30"}]'::jsonb);

  perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  result:=public.read_school_record_source_context(null,lid,1);
  if result->'sources'->0->'businessFields' is distinct from fields or jsonb_array_length(result->'sources')<>1 then raise exception 'SCOPED_BUSINESS_FIELDS_DIFFER'; end if;
  result:=public.read_base_lead_acquisition(array[lid]);
  if jsonb_array_length(result->0->'sources')<>1 or result->0->'sources'->0->>'acquiredAt' is not null or result->0->'sources'->0->>'dateLabel'<>'06-10'
    or not (string_to_array(result->0->'sources'->0->>'location',' / ') @> array['规范场地','原获取地址'])
    or cardinality(string_to_array(result->0->'sources'->0->>'location',' / '))<>2
    or result->0->'sources'->0->>'content'<>E'原文第一行\n原文第二行'
    then raise exception 'BASE_ACQUISITION_VALUE_OR_DATE_PRECISION'; end if;
  if exists(select 1 from public.history_source_business_facts where source_record_id=source_id) then raise exception 'TEACHER_ARCHIVE_TABLE_SCOPE'; end if;
  if has_table_privilege('authenticated','public.history_source_business_facts','INSERT')
    or has_table_privilege('authenticated','public.history_source_business_facts','UPDATE')
    or has_table_privilege('authenticated','public.history_source_business_facts','DELETE')
    or has_table_privilege('anon','public.history_source_business_facts','SELECT') then raise exception 'BASE_TABLE_WRITE_PRIVILEGE'; end if;
  begin perform public.read_base_lead_acquisition(array[hidden]); raise exception 'HIDDEN_BASE_ACQUISITION_EXPOSED';
  exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN_SCOPE' then raise; end if; end;
  begin perform public.read_base_source_business_fields(source_id); raise exception 'TEACHER_ADMIN_ARCHIVE_RPC';
  exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
  begin perform public.store_base_business_fields('[]'); raise exception 'DIRECT_BASE_STORE_ALLOWED';
  exception when insufficient_privilege then null; end;
  begin perform public.read_base_lead_acquisition(array_fill(lid,array[501])); raise exception 'BASE_OVERSIZED_BATCH';
  exception when others then get stacked diagnostics err=message_text; if err<>'VALIDATION' then raise; end if; end;
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if not exists(select 1 from public.history_source_business_facts where source_record_id=source_id) then raise exception 'ADMIN_BASE_ARCHIVE_READ'; end if;
  if public.read_base_source_business_fields(source_id) is distinct from fields then raise exception 'ADMIN_BASE_ARCHIVE_RPC'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',child_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  begin perform public.read_base_lead_acquisition(array[lid]); raise exception 'NONSTAFF_BASE_ACQUISITION';
  exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN' then raise; end if; end;
  execute 'reset role';
  perform set_config('request.jwt.claims','{}',true);
  execute 'set local role authenticated';
  begin perform public.read_base_lead_acquisition(array[lid]); raise exception 'ANONYMOUS_BASE_ACQUISITION';
  exception when others then get stacked diagnostics err=message_text; if err<>'UNAUTHENTICATED' then raise; end if; end;
  execute 'reset role';
end;
$test$;
rollback to base_business_contract;
