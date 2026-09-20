-- 首联无额外列条件时，阶段和范围先确定名单，再为当前页补齐列表字段。
-- 从已验证的事实函数生成私有分页分支，保留身份、来源和协作权限规则。
-- 完整列筛选/搜索仍走原有全范围候选计算；没有缓存或截取后筛选。
do $migration$
declare definition text; body text; owner_name text;
begin
  if to_regprocedure('public.student_first_contact_page_facts(text,integer,integer)') is not null then raise exception 'FIRST_CONTACT_PAGE_ALREADY_EXISTS'; end if;
  select pg_get_functiondef(oid),prosrc,pg_get_userbyid(proowner) into definition,body,owner_name from pg_proc
    where oid='public.student_list_query_facts(text,text,text,text,jsonb)'::regprocedure;
  if md5(body)<>'2c5a247395c0e7474c6e47f07fc0a80c' then raise exception 'STUDENT_LIST_QUERY_FACTS_CHANGED'; end if;
  definition:=replace(definition,$replace$public.student_list_query_facts(p_scope text, p_search text, p_population text, p_stage text, p_subjects jsonb)$replace$,$replace$public.student_first_contact_page_facts(p_scope text, p_page integer, p_page_size integer)$replace$);
  definition:=replace(definition,$replace$declare actor uuid:=auth.uid();$replace$,$replace$declare p_stage text:='awaiting_first_contact'; p_population text:='records'; p_search text:=''; p_subjects jsonb:=null; actor uuid:=auth.uid();$replace$);
  definition:=replace(definition,$replace$  if actor is null then$replace$,$replace$  if p_page is null or p_page<1 or p_page>1000000 or p_page_size is null or p_page_size not in (20,50,100) then raise exception 'VALIDATION'; end if;
  if actor is null then$replace$);
  definition:=replace(definition,$replace$listed as materialized (select * from stages where p_subjects is not null or coalesce(p_search,'')<>'' or stage=p_stage)$replace$,$replace$eligible as materialized (select * from stages where stage=p_stage),
  listed as materialized (select * from eligible order by created_at desc,key limit p_page_size
    offset (least(p_page,greatest(1,ceil((select count(*) from eligible)::numeric/p_page_size)::integer))-1)*p_page_size)$replace$);
  definition:=replace(definition,$replace$where p_subjects is null and not (coalesce(p_search,'')<>'' or s.stage=p_stage)$replace$,$replace$where not exists(select 1 from listed page where page.key=s.key)$replace$);
  execute definition;
  execute format('alter function public.student_first_contact_page_facts(text,integer,integer) owner to %I',owner_name);
  revoke all on function public.student_first_contact_page_facts(text,integer,integer) from public,anon,authenticated,service_role;
  select pg_get_functiondef(oid),prosrc into definition,body from pg_proc
    where oid='public.list_student_records_page(text,text,text,text,integer,integer,jsonb,text,jsonb)'::regprocedure;
  if md5(body)<>'9832b84b34fc5519edf39d53acde1b24' then raise exception 'STUDENT_LIST_PAGE_DEFINITION_CHANGED'; end if;
  -- 四空格只命中首联分支；通用筛选分支保持原定义。
  definition:=replace(definition,
    '    with facts as materialized (select * from public.student_list_base_facts(p_scope,p_search,p_population,p_stage)),',
    '    with facts as materialized (select * from public.student_first_contact_page_facts(p_scope,p_page,p_page_size)),');
  definition:=replace(definition,$replace$from rows),
    page_rows as (select payload from rows order by$replace$,
    $replace$from facts where index_stage=p_stage),
    page_rows as (select payload from rows order by$replace$);
  definition:=replace(definition,$replace$payload->>'key'
      limit p_page_size offset (least(p_page,(select pages from totals))-1)*p_page_size)$replace$,$replace$payload->>'key')$replace$);
  execute definition;
end;
$migration$;
