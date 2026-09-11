-- 复用固定账号，逐行归属、权限和来源保护使用可回滚的业务样本。
savepoint source_fragment_contract;
do $test$
declare admin_id uuid; teacher uuid; child uuid; person uuid:=gen_random_uuid(); lead uuid:=gen_random_uuid(); hidden uuid:=gen_random_uuid();
  prefix text:='__source_fragment__'||gen_random_uuid(); result jsonb; err text; total bigint; fields jsonb;
begin
  select id into admin_id from auth.users where email='test-admin@mathin.local';
  select id into teacher from auth.users where email='test-teacher@mathin.local';
  select id into child from auth.users where email='test-student@mathin.local';
  if num_nonnulls(admin_id,teacher,child)<>3 then raise exception 'FIXED_IDENTITIES_REQUIRED';end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  execute 'set local role postgres';
  insert into public.students(id,name,phone,parent_phone,assigned_to,created_by,bind_code)
    values(person,prefix,'','',teacher,admin_id,public.generate_student_bind_code());
  insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,status,owner_id,created_by,note) values
    (lead,prefix,prefix,'13800007771','13800007771','uncontacted',teacher,admin_id,''),
    (hidden,prefix||'-hidden',prefix||'-hidden','13800007772','13800007772','uncontacted',admin_id,admin_id,'');
  insert into public.history_import_records(id,source_sha256,source_table_id,source_record_id,payload_sha256,source_data,record_data,match_status,match_data,search_text)
    values(prefix,repeat('a',64),'fragment-contract',prefix,repeat('b',64),'{"format":"feishu-base","filename":"original.base"}',
      jsonb_build_object('hasContent',true,'tableName','多人安排','cells',jsonb_build_array(jsonb_build_object('fieldId','arrangements','fieldName','就读学校','kind','context','text',E'示例甲周六10:00\n示例乙周六14:00\n示例丙周六09:30'))),'unmatched','{}','source fragments');
  fields:='[{"fieldId":"arrangements:entry:1","name":"就读学校","label":"活动安排","section":"notes","key":"activity_arrangements","kind":"text","value":"安排","display":"示例甲周六10:00","originalText":"示例甲周六10:00","sourceType":"Text","status":"text","rawHasContent":true}]';
  insert into public.history_source_fragments(id,source_record_id,source_payload_sha256,source_field_id,entry_index,original_text,lead_id,student_id,match_reason,business_fields,event_date) values
    (prefix||'-1',prefix,repeat('b',64),'arrangements',1,'示例甲周六10:00',lead,null,'{"method":"test"}',fields,'2026-08-22'),
    (prefix||'-2',prefix,repeat('b',64),'arrangements',2,'示例乙周六14:00',hidden,null,'{"method":"test"}','[]','2026-08-22'),
    (prefix||'-3',prefix,repeat('b',64),'arrangements',3,'示例丙周六09:30',null,person,'{"method":"test"}','[]','2026-08-22');
  begin
    insert into public.history_source_fragments(id,source_record_id,source_payload_sha256,source_field_id,entry_index,original_text,lead_id,match_reason,business_fields)
      values(prefix||'-bad',prefix,repeat('b',64),'arrangements',4,'来源里没有这一行',lead,'{}','[]');
    raise exception 'FORGED_SOURCE_FRAGMENT_ACCEPTED';
  exception when others then get stacked diagnostics err=message_text;if err<>'SOURCE_FRAGMENT_ORIGINAL_CHANGED' then raise;end if;end;
  begin update public.history_source_fragments set business_fields='[]' where id=prefix||'-1';raise exception 'ORIGINAL_FIELDS_CHANGED';
    exception when others then get stacked diagnostics err=message_text;if err<>'SOURCE_FRAGMENT_IMMUTABLE' then raise;end if;end;
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  result:=public.read_school_record_source_context(null,lead,1);
  if result->>'sourceCount'<>'1' or result->'sources'->0->>'id'<>prefix||'-1' or result->'sources'->0->>'association'<>'inferred'
    or result->'sources'->0->'cells'->0->>'text'<>'示例甲周六10:00' or result::text like '%示例乙%' or result::text like '%示例丙%'
    or result->'sources'->0->'businessFields'<>fields then raise exception 'FRAGMENT_SCOPE_OR_DISPLAY';end if;
  select count(*) into total from public.history_source_fragments where source_record_id=prefix;
  if total<>2 then raise exception 'FRAGMENT_RLS_SCOPE';end if;
  result:=public.read_school_record_source_context(person,null,1);
  if result->>'sourceCount'<>'1' or result->'sources'->0->>'id'<>prefix||'-3' then raise exception 'FRAGMENT_STUDENT_SCOPE';end if;
  begin perform public.read_school_record_source_context(null,hidden,1);raise exception 'HIDDEN_FRAGMENT_EXPOSED';
    exception when others then get stacked diagnostics err=message_text;if err<>'FORBIDDEN' then raise;end if;end;
  begin update public.history_source_fragments set match_state='confirmed' where id=prefix||'-1';raise exception 'FRAGMENT_DIRECT_WRITE';
    exception when insufficient_privilege then null;end;
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  execute 'set local role postgres';
  update public.leads set student_id=person,identity_confirmed_by=admin_id,identity_confirmed_at=now() where id=lead;
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  result:=public.read_school_record_source_context(person,null,1);
  if result->>'sourceCount'<>'2' then raise exception 'FRAGMENT_CONVERTED_LEAD_CONTINUITY';end if;
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',child,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  select count(*) into total from public.history_source_fragments where source_record_id=prefix;
  if total<>0 then raise exception 'FRAGMENT_NONSTAFF_RLS';end if;
  begin perform public.read_school_record_source_context(person,null,1);raise exception 'FRAGMENT_NONSTAFF_RPC';
    exception when others then get stacked diagnostics err=message_text;if err<>'FORBIDDEN' then raise;end if;end;
  execute 'reset role';
  perform set_config('request.jwt.claims','{}',true);
  execute 'set local role authenticated';
  begin perform public.read_school_record_source_context(person,null,1);raise exception 'FRAGMENT_ANONYMOUS_RPC';
    exception when others then get stacked diagnostics err=message_text;if err<>'UNAUTHENTICATED' then raise;end if;end;
  execute 'reset role';
end;
$test$;
rollback to savepoint source_fragment_contract;
release savepoint source_fragment_contract;
