-- 复用同一份集合事实查询：常规列表按阶段读取，再联系按已授权的候选 key 读取。
-- 当前页以外的对象只参与字段筛选、排序和候选统计，不逐条读取完整详情。
do $facts$
declare definition text; body text; owner_name text; updated text;
begin
  if to_regprocedure('public.student_list_query_facts(text,text,text,text,jsonb)') is not null then raise exception 'STUDENT_QUERY_FACTS_ALREADY_EXISTS'; end if;
  select pg_get_functiondef(oid),prosrc,pg_get_userbyid(proowner) into definition,body,owner_name
    from pg_proc where oid='public.student_list_base_facts(text,text,text,text)'::regprocedure;
  if md5(body)<>'891be3fab2684c4509706353894b660a' then raise exception 'STUDENT_BATCH_FACTS_CHANGED'; end if;
  updated:=replace(definition,'public.student_list_base_facts(p_scope text, p_search text, p_population text, p_stage text)',
    'public.student_list_query_facts(p_scope text, p_search text, p_population text, p_stage text, p_subjects jsonb)');
  updated:=replace(updated,'return query with',$wanted$if p_subjects is not null and jsonb_array_length(p_subjects)=0 then return; end if;
  return query with
  wanted as materialized (select w->>'key' as key,w from jsonb_array_elements(coalesce(p_subjects,'[]'::jsonb)) w),$wanted$);
  updated:=replace(updated,'select s.* from public.students s where s.deleted_at is null and (',
    'select s.* from public.students s where s.deleted_at is null and (p_subjects is null or exists(select 1 from wanted w where w.key=''student:''||s.id)) and (');
  updated:=replace(updated,'select l.* from public.leads l where l.student_id is null and (',
    'select l.* from public.leads l where l.student_id is null and (p_subjects is null or exists(select 1 from wanted w where w.key=''lead:''||l.id)) and (');
  updated:=replace(updated,'listed as materialized (select * from stages where coalesce(p_search,'''')<>'''' or stage=p_stage)',
    'listed as materialized (select * from stages where p_subjects is not null or coalesce(p_search,'''')<>'''' or stage=p_stage)');
  updated:=replace(updated,'public.school_list_apply_collaboration(r.payload,c.projection),r.stage from rows r',
    $fields$public.school_list_apply_collaboration(r.payload||case when p_subjects is not null then
      jsonb_build_object('phone',w.w->'phone','lastContactAt',w.w->'last_contact_at')||
      case when r.stage in ('awaiting_first_contact','awaiting_assessment') then
        jsonb_build_object('teacherId',null,'teacherName','','courseId',null,'termId',null,'courseTitle','','termName','','assessmentBand',null,'assessmentAt',null)
        else '{}'::jsonb end else '{}'::jsonb end,c.projection),r.stage from rows r left join wanted w on w.key=r.key$fields$);
  updated:=replace(updated,'union all select null::jsonb,s.stage from stages s where not (',
    'union all select null::jsonb,s.stage from stages s where p_subjects is null and not (');
  execute updated;
  execute format('alter function public.student_list_query_facts(text,text,text,text,jsonb) owner to %I',owner_name);
  revoke all on function public.student_list_query_facts(text,text,text,text,jsonb) from public,anon,authenticated,service_role;
  execute replace(definition,body,$wrapper$
begin
  return query select * from public.student_list_query_facts(p_scope,p_search,p_population,p_stage,null);
end;
$wrapper$);
end;
$facts$;

-- 对齐现有共享表格合同：参与人可同时属于未分配；隐藏负责人的空名不是可筛选负责人。
do $fields$
declare definition text; body text;
begin
  select pg_get_functiondef(oid),prosrc into definition,body from pg_proc where oid='public.student_list_field(jsonb,text,jsonb,uuid,text)'::regprocedure;
  if md5(body)<>'2cad8048ec6532b63b70971d3e2832cc' then raise exception 'STUDENT_FIELD_CONTRACT_CHANGED'; end if;
  definition:=replace(definition,'''sort'',p_row->>(p_field||''Name''),''missing'',false)',
    '''sort'',p_row->>(p_field||''Name''),''sortMissing'',public.student_list_is_blank(p_row->>(p_field||''Name'')),''missing'',false)');
  definition:=replace(definition,'value:=coalesce(nullif(p_row->>(p_field||''Id''),''''),case when nullif(p_row->>(p_field||''Name''),'''') is not null then ''source:''||(p_row->>(p_field||''Name'')) end);',
    'value:=case when p_field=''owner'' and coalesce(p_row->>''ownerName'','''')='''' then null else coalesce(nullif(p_row->>(p_field||''Id''),''''),case when nullif(p_row->>(p_field||''Name''),'''') is not null then ''source:''||(p_row->>(p_field||''Name'')) end) end;');
  definition:=replace(definition,'if coalesce((p_row->>''isParticipant'')::boolean,false) then',
    'if coalesce((p_row->>''isParticipant'')::boolean,p_row->>''ownerId''=p_actor::text,false) then');
  definition:=replace(definition,'elsif p_row->>''ownerId'' is null then','end if; if p_row->>''ownerId'' is null then');
  execute definition;
end;
$fields$;

-- 采用常规列表已验证的字段校验、自然排序和自排除候选统计，默认次序沿用再联系名单。
do $page$
declare definition text; body text; owner_name text; updated text;
begin
  if to_regprocedure('public.list_student_recontact_page(text,text,text,integer,integer,jsonb,text,jsonb)') is not null then raise exception 'RECONTACT_PAGE_ALREADY_EXISTS'; end if;
  select pg_get_functiondef(oid),prosrc,pg_get_userbyid(proowner) into definition,body,owner_name
    from pg_proc where oid='public.list_student_records_page(text,text,text,text,integer,integer,jsonb,text,jsonb)'::regprocedure;
  if md5(body)<>'0bbac292f88774fb657b1e8ae701ce6b' then raise exception 'STUDENT_PAGE_CONTRACT_CHANGED'; end if;
  updated:=replace(definition,
    'public.list_student_records_page(p_stage text, p_scope text, p_search text, p_population text, p_page integer, p_page_size integer, p_query jsonb, p_locale text, p_labels jsonb)',
    'public.list_student_recontact_page(p_scope text, p_search text, p_reason text, p_page integer, p_page_size integer, p_query jsonb, p_locale text, p_labels jsonb)');
  updated:=replace(updated,'direction text; result jsonb;',
    'direction text; result jsonb; p_stage text; enrollments public.business_course_enrollment_subjects[]; candidates jsonb; selected jsonb;');
  updated:=replace(updated,'if not public.is_staff(actor) or not (public.has_perm(actor,''student.view.all'') or public.has_perm(actor,''student.view.assigned'')
    or public.has_perm(actor,''followup.view'')) then raise exception ''FORBIDDEN''; end if;',
    $auth$if not public.is_staff(actor) or not public.has_perm(actor,'followup.view') then raise exception 'FORBIDDEN'; end if;
  if p_scope is null or p_scope not in ('all','mine','group','unassigned') or length(coalesce(p_search,''))>80
    or p_reason is null or p_reason not in ('unreachable','assessed','former','dormant') then raise exception 'VALIDATION'; end if;
  p_stage:=case when p_reason='unreachable' then 'awaiting_first_contact' else 'awaiting_enrollment' end;$auth$);
  updated:=replace(updated,'with facts as materialized (select * from public.student_list_base_facts(p_scope,p_search,p_population,p_stage)),',
    $facts$select coalesce(array_agg(e),'{}'::public.business_course_enrollment_subjects[]) into enrollments from public.business_course_enrollment_subjects e;
  candidates:=public.student_recontact_candidates(p_scope,p_search,enrollments);
  select coalesce(jsonb_agg(c),'[]'::jsonb) into selected from jsonb_array_elements(candidates) c where c->>'reason'=p_reason;
  with selected_subjects as materialized (select c from jsonb_array_elements(selected) c),
  fast_subjects as materialized (select coalesce(jsonb_agg(c),'[]'::jsonb) as items from selected_subjects where c->>'stage' in ('awaiting_first_contact','awaiting_assessment')),
  deep_subjects as materialized (select coalesce(jsonb_agg(c),'[]'::jsonb) as items from selected_subjects where c->>'stage' not in ('awaiting_first_contact','awaiting_assessment')),
  facts as materialized (
    select r||jsonb_build_object('phone',s.c->'phone','lastContactAt',s.c->'last_contact_at') as row_data,r->>'stage' as index_stage
      from jsonb_array_elements(public.student_record_list_rows((select items from fast_subjects),enrollments)) r
      join selected_subjects s on s.c->>'key'=r->>'key'
    union all select * from public.student_list_query_facts('all','','records','awaiting_enrollment',(select items from deep_subjects))
  ),$facts$);
  updated:=replace(updated,'row_number() over(order by (row_data->>''createdAt'')::timestamptz desc,row_data->>''key'')',
    'row_number() over(order by row_data->>''lastContactAt'' desc nulls last,row_data->>''key'')');
  updated:=replace(updated,'created_at desc,key) as ordinal from filtered f','default_ordinal) as ordinal from filtered f');
  updated:=replace(updated,'order by f.id,v.value,e.created_at desc,e.key','order by f.id,v.value,e.default_ordinal');
  -- 字段值与名单是一一对应的投影，直接携带次序，避免再次按 key 连接两份物化结果。
  updated:=replace(updated,'select r.key,v.fields from rows r cross join lateral (','select r.key,r.created_at,r.default_ordinal,v.fields from rows r cross join lateral (');
  updated:=replace(updated,'select r.key,r.created_at,r.default_ordinal,f.fields,array(','select f.key,f.created_at,f.default_ordinal,f.fields,array(');
  updated:=replace(updated,'from rows r join field_values f using(key)','from field_values f');
  -- 单次消费的投影直接流向 evaluated；无筛选/排序的列只保留候选所需的值和标签。
  updated:=replace(updated,'facts as materialized (','facts as not materialized (');
  updated:=replace(updated,'rows as materialized (select row_data','rows as not materialized (select row_data');
  updated:=replace(updated,'field_values as materialized (','field_values as not materialized (');
  updated:=replace(updated,'jsonb_object_agg(f.id,public.student_list_field(r.payload,f.id,p_labels,actor,zone))',
    'jsonb_object_agg(f.id,case when f.id=sort_field or (p_query->''filters'') ? f.id then public.student_list_field(r.payload,f.id,p_labels,actor,zone)
      else public.student_list_field(r.payload,f.id,p_labels,actor,zone)-''sort''-''sortMissing''-''missing'' end)');
  updated:=replace(updated,'filtered as materialized (select * from evaluated where cardinality(misses)=0)',
    'filtered as materialized (select key,default_ordinal,fields->sort_field as sort_value from evaluated where cardinality(misses)=0)');
  updated:=replace(updated,'then coalesce((fields->sort_field->>','then coalesce((sort_value->>');
  updated:=replace(updated,'(fields->sort_field->>','(sort_value->>');
  updated:=replace(updated,'then fields->sort_field->>','then sort_value->>');
  updated:=replace(updated,$old$page_rows as materialized (
    select public.student_list_row_permissions(r.payload,actor,
      (select public.has_perm(actor,'student.view.all')),(select public.has_perm(actor,'followup.write'))) as payload,p.ordinal
      from page_keys p join rows r using(key)
  )$old$,$new$page_details as materialized (
    select r from jsonb_array_elements(public.student_record_list_rows(coalesce((select jsonb_agg(c)
      from jsonb_array_elements(selected) c join page_keys p on p.key=c->>'key'),'[]'::jsonb),enrollments)) r
  ), page_rows as materialized (
    select d.r||jsonb_build_object('phone',c->>'phone','recontactReason',c->>'reason','lastContactAt',c->'last_contact_at','sharedPhoneCount',c->'shared_phone_count') as payload,p.ordinal
      from page_details d join page_keys p on p.key=d.r->>'key' join jsonb_array_elements(selected) c on c->>'key'=p.key
  )$new$);
  updated:=replace(updated,'''counts'',coalesce((select jsonb_object_agg(index_stage,n) from(select index_stage,count(*) n from facts group by index_stage) c),''{}''::jsonb),',
    $counts$'counts','{}'::jsonb,'reasonCounts',coalesce((select jsonb_object_agg(reason,n)
      from(select c->>'reason' as reason,count(*) as n from jsonb_array_elements(candidates) c group by 1) counts),'{}'::jsonb),$counts$);
  if position('p_population' in updated)>0 or position('page_details as materialized' in updated)=0 or position('candidates:=' in updated)=0 then raise exception 'RECONTACT_PAGE_PROJECTION_CHANGED'; end if;
  execute updated;
  execute format('alter function public.list_student_recontact_page(text,text,text,integer,integer,jsonb,text,jsonb) owner to %I',owner_name);
  revoke all on function public.list_student_recontact_page(text,text,text,integer,integer,jsonb,text,jsonb) from public,anon,authenticated,service_role;
  grant execute on function public.list_student_recontact_page(text,text,text,integer,integer,jsonb,text,jsonb) to authenticated;
  -- 这类短列表查询使用解释执行，避免高估候选数时为每次请求编译大型表达式。
  alter function public.list_student_recontact_page(text,text,text,integer,integer,jsonb,text,jsonb) set jit=off;
end;
$page$;
notify pgrst,'reload schema';
