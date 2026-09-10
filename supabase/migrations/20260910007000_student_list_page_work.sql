-- 筛选、排序使用轻量字段；可编辑/可联系标记只为最终页计算。
-- 可见身份仍由原查询在分页前判定，原私有 student_list_facts 保持完整返回合同。
do $student_page_work$
declare facts_oid regprocedure := 'public.student_list_facts(text,text,text,text)'::regprocedure;
  page_oid regprocedure := 'public.list_student_records_page(text,text,text,text,integer,integer,jsonb,text,jsonb)'::regprocedure;
  facts_definition text; facts_body text; owner_name text; flags text; prefix text; page_definition text;
  old_fields text := E'select r.key,jsonb_object_agg(f.id,public.student_list_field(r.payload,f.id,p_labels,actor,zone)) as fields\n      from rows r cross join required_fields f group by r.key';
  old_page text := 'page_rows as (select * from ordered order by ordinal limit p_page_size offset (least(p_page,(select pages from totals))-1)*p_page_size)';
begin
  if to_regprocedure('public.student_list_base_facts(text,text,text,text)') is not null
    or to_regprocedure('public.student_list_row_permissions(jsonb,uuid,boolean,boolean)') is not null then
    raise exception 'STUDENT_LIST_PAGE_HELPER_ALREADY_EXISTS';
  end if;
  select pg_get_functiondef(oid),prosrc,pg_get_userbyid(proowner) into facts_definition,facts_body,owner_name
    from pg_proc where oid=facts_oid;
  flags := (regexp_match(facts_body,$pattern$('canWrite',.*?)\) as payload$pattern$,'s'))[1];
  if flags is null or position('''canContact'',' in flags)=0
    or array_length(string_to_array(facts_body,flags),1)<>2
    or position('''createdAt'',s.created_at,'||flags||') as payload' in facts_body)=0
    or array_length(string_to_array(facts_body,'return query with'),1)<>2 then
    raise exception 'STUDENT_LIST_PERMISSION_PROJECTION_CHANGED';
  end if;

  -- 把已有的两个标记表达式移入私有投影，沿用原有权限函数及身份关联。
  execute format($definition$
    create function public.student_list_row_permissions(p_row jsonb,p_actor uuid,p_view_all boolean,p_write_followup boolean)
    returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $permissions$
    declare actor uuid:=p_actor; view_all boolean:=p_view_all; write_followup boolean:=p_write_followup;
    begin
      if p_row is null then return null; end if;
      return (select p_row||jsonb_build_object(%s)
        from (select (p_row->>'studentId')::uuid as student_id,(p_row->>'leadId')::uuid as lead_id) s
        left join public.students st on st.id=s.student_id left join public.leads l on l.id=s.lead_id);
    end;
    $permissions$;
  $definition$,flags);
  execute replace(replace(facts_definition,'public.student_list_facts(', 'public.student_list_base_facts('),
    '''createdAt'',s.created_at,'||flags||') as payload','''createdAt'',s.created_at) as payload');
  execute format('alter function public.student_list_base_facts(text,text,text,text) owner to %I',owner_name);
  execute format('alter function public.student_list_row_permissions(jsonb,uuid,boolean,boolean) owner to %I',owner_name);
  revoke all on function public.student_list_base_facts(text,text,text,text) from public,anon,authenticated,service_role;
  revoke all on function public.student_list_row_permissions(jsonb,uuid,boolean,boolean) from public,anon,authenticated,service_role;

  -- 事实汇总只有一个实现；兼容原有内部调用时，再为全部结果补齐操作标记。
  prefix := split_part(facts_body,'return query with',1);
  execute replace(facts_definition,facts_body,prefix||$wrapper$return query
    select public.student_list_row_permissions(f.row_data,actor,view_all,write_followup),f.index_stage
      from public.student_list_base_facts(p_scope,p_search,p_population,p_stage) f;
end;
$wrapper$);

  select pg_get_functiondef(page_oid) into page_definition;
  if array_length(string_to_array(page_definition,old_fields),1)<>2
    or array_length(string_to_array(page_definition,'select r.*,f.fields,array('),1)<>2
    or array_length(string_to_array(page_definition,old_page),1)<>2
    or array_length(string_to_array(page_definition,'public.student_list_facts(p_scope,p_search,p_population,p_stage)'),1)<>2 then
    raise exception 'STUDENT_LIST_PAGE_PROJECTION_CHANGED';
  end if;
  page_definition := replace(page_definition,'public.student_list_facts(p_scope,p_search,p_population,p_stage)',
    'public.student_list_base_facts(p_scope,p_search,p_population,p_stage)');
  -- 每行聚合少量字段，避免将整行资料复制到行数×字段数的哈希聚合中。
  page_definition := replace(page_definition,old_fields,$fields$select r.key,v.fields from rows r cross join lateral (
      select jsonb_object_agg(f.id,public.student_list_field(r.payload,f.id,p_labels,actor,zone)) as fields
        from required_fields f
    ) v$fields$);
  page_definition := replace(page_definition,'select r.*,f.fields,array(',
    'select r.key,r.created_at,r.default_ordinal,f.fields,array(');
  page_definition := replace(page_definition,old_page,$page$page_keys as materialized (
    select key,ordinal from ordered order by ordinal limit p_page_size offset (least(p_page,(select pages from totals))-1)*p_page_size
  ), page_rows as materialized (
    select public.student_list_row_permissions(r.payload,actor,
      (select public.has_perm(actor,'student.view.all')),(select public.has_perm(actor,'followup.write'))) as payload,p.ordinal
      from page_keys p join rows r using(key)
  )$page$);
  execute page_definition;
end;
$student_page_work$;
