-- 定向覆盖缺少历史名单位置的地推数据、跨页条件、全量候选与对象权限；外层事务回滚。
begin;
set local statement_timeout='60s';
do $check$
declare actor uuid; outsider uuid; role_id uuid:=gen_random_uuid(); batch uuid:=gen_random_uuid(); lid uuid;
  keys text[]:='{}'; result jsonb; page2 jsonb; label text:='来源筛选事务 '||gen_random_uuid(); i integer; before_count integer;
begin
  select id into actor from public.profiles where role='staff' and purpose='test' and is_active and account_status='active'
    and not password_change_required order by id limit 1;
  select id into outsider from public.profiles where role='staff' and purpose='test' and is_active and account_status='active'
    and not password_change_required and id<>actor order by id limit 1;
  if actor is null or outsider is null then raise exception 'FIXED_DEVELOPMENT_STAFF_REQUIRED'; end if;
  delete from public.staff_role_members where user_id=actor;
  update public.school_business_group_members set removed_at=now() where user_id in (actor,outsider);
  insert into public.staff_roles(id,key,name) values(role_id,'worklist_fixture_'||role_id,label);
  insert into public.role_permissions(role_id,perm_key) values(role_id,'student.view.assigned'),(role_id,'followup.view'),(role_id,'followup.write');
  insert into public.staff_role_members(user_id,role_id) values(actor,role_id);
  insert into public.data_import_batches(id,import_kind,template_version,idempotency_key,input_hash,input_fingerprint,status,
    total_rows,valid_rows,inserted_rows,created_by,completed_at,batch_label)
    values(batch,'leads','test',batch::text,repeat('a',64),repeat('a',32),'completed',27,27,27,actor,now(),label);
  for i in 1..27 loop
    insert into public.leads(provisional_student_name,normalized_name,phone,phone_normalized,grade_hint,owner_id,created_by)
      values(label||' '||lpad(i::text,3,'0'),public.normalize_lead_name(label||i),'1560013'||lpad(i::text,4,'0'),'1560013'||lpad(i::text,4,'0'),
        case when i=26 then 12 when i=27 then 11 else 1 end,case when i=27 then outsider else actor end,case when i=27 then outsider else actor end) returning id into lid;
    keys:=array_append(keys,'lead:'||lid);
    insert into public.lead_source_records(lead_id,batch_id,row_no,source_system,batch_label,source_row,submitted_at,promoter,remark)
      values(lid,batch,i,'xiaoditui',label,i+1,'2026-10-12 04:00:00+00','事务推广员','来源备注 '||i);
  end loop;
  select count(*) into before_count from public.school_source_worklist_entries;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  result:=public.school_communication_workbench_page(p_stage=>'awaiting_first_contact',p_scope=>'all',p_page_size=>20,p_batch=>batch,p_subjects=>keys);
  if (result->>'count')::int<>26 or jsonb_array_length(result->'rows')<>20 or result->>'period'<>'all' then raise exception 'IMPORT_MISSING_FROM_DEFAULT_LIST'; end if;
  if result->'rows'->0->'worklist'->>'period'<>'10月' or result->'rows'->0->'worklist'->>'group'<>'小地推 · '||label
    or jsonb_array_length(result->'rows'->0->'worklist'->'context')=0 then raise exception 'IMPORT_SOURCE_CONTEXT_MISSING'; end if;
  page2:=public.school_communication_workbench_page(p_stage=>'awaiting_first_contact',p_scope=>'all',p_page_size=>20,p_page=>2,p_batch=>batch,p_subjects=>keys);
  if jsonb_array_length(page2->'rows')<>6 then raise exception 'PAGE_TWO_MISSING'; end if;
  result:=public.school_communication_workbench_page(p_stage=>'awaiting_first_contact',p_scope=>'all',p_page_size=>20,p_batch=>batch,p_subjects=>keys,
    p_query=>'{"version":2,"filters":{"name":{"kind":"text","query":"026"}},"sort":null}',p_include_facets=>true);
  if (result->>'count')::int<>1 or result->'rows'->0->>'name'<>label||' 026' then raise exception 'TEXT_FILTER_DID_NOT_SCAN_ALL_ROWS'; end if;
  if not exists(select 1 from jsonb_array_elements(result->'facets'->'grade'->'options') o where o->>'value'='1')
    or not exists(select 1 from jsonb_array_elements(result->'facets'->'grade'->'options') o where o->>'value'='12') then raise exception 'FACETS_LIMITED_TO_PAGE_OR_FILTER'; end if;
  if exists(select 1 from jsonb_array_elements(result->'facets'->'grade'->'options') o where o->>'value'='11') then raise exception 'FACET_PERMISSION_LEAK'; end if;
  if result->'facets'?'name' then raise exception 'OPEN_TEXT_VALUES_ENUMERATED'; end if;
  result:=public.school_communication_workbench_page(p_stage=>'awaiting_first_contact',p_scope=>'all',p_page_size=>20,p_batch=>batch,p_subjects=>keys,
    p_query=>'{"version":2,"filters":{"grade":{"kind":"enum","values":["12"]}},"sort":null}');
  if (result->>'count')::int<>1 or result->'rows'->0->>'name'<>label||' 026' then raise exception 'ENUM_FILTER_DID_NOT_SCAN_ALL_ROWS'; end if;
  result:=public.school_communication_workbench_page(p_stage=>'awaiting_first_contact',p_scope=>'all',p_page_size=>20,p_batch=>batch,p_subjects=>keys,
    p_query=>'{"version":2,"filters":{},"sort":{"field":"name","direction":"desc"}}');
  if result->'rows'->0->>'name'<>label||' 026' then raise exception 'SERVER_SORT_ORDER_LOST'; end if;
  result:=public.school_communication_workbench_page(p_stage=>'awaiting_first_contact',p_scope=>'all',p_batch=>batch,p_subjects=>keys,
    p_include_facets=>true,p_facets_only=>true);
  if jsonb_array_length(result->'rows')<>0 or not exists(select 1 from jsonb_array_elements(result->'facets'->'grade'->'options') o where o->>'value'='12')
    then raise exception 'FACETS_ONLY_CONTRACT_BROKEN'; end if;
  begin
    perform public.school_communication_workbench_page(p_stage=>'awaiting_first_contact',p_query=>'{"version":2,"filters":{"password":{"kind":"text","query":"x"}},"sort":null}');
    raise exception 'UNKNOWN_FILTER_ACCEPTED';
  exception when others then if sqlerrm<>'VALIDATION' then raise; end if; end;
  if (select count(*) from public.school_source_worklist_entries)<>before_count then raise exception 'READ_CREATED_WORKLIST_DATA'; end if;
end $check$;
rollback;
