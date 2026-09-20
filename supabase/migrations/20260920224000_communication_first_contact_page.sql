-- 内嵌首联使用自己的列筛选；没有额外列条件时仅返回外层名单和阶段数量。
-- 完整字段查询沿用原分支，权限与入参校验仍在两个分支之前执行。
do $migration$
declare definition text; body text;
begin
  select pg_get_functiondef(oid),prosrc into definition,body from pg_proc
    where oid='public.list_student_records_page(text,text,text,text,integer,integer,jsonb,text,jsonb)'::regprocedure;
  if md5(body)<>'0bbac292f88774fb657b1e8ae701ce6b' then raise exception 'STUDENT_LIST_PAGE_DEFINITION_CHANGED'; end if;
  definition:=replace(definition,'  with facts as materialized (select * from public.student_list_base_facts(p_scope,p_search,p_population,p_stage)),',$page$
  if p_query->'includeFacets'='false'::jsonb and p_stage='awaiting_first_contact' and p_population='records'
    and coalesce(p_search,'')='' and (p_query->'sort' is null or p_query->'sort'='null'::jsonb)
    and ((p_query->'filters')-'scope')='{}'::jsonb
    and ((p_query->'filters'->'scope' is null and p_scope='all')
      or p_query->'filters'->'scope'=jsonb_build_object('kind','enum','values',jsonb_build_array(p_scope))) then
    with facts as materialized (select * from public.student_list_base_facts(p_scope,p_search,p_population,p_stage)),
    rows as materialized (select row_data as payload from facts where row_data is not null),
    totals as (select count(*)::integer as count,greatest(1,ceil(count(*)::numeric/p_page_size)::integer) as pages from rows),
    page_rows as (select payload from rows order by (payload->>'createdAt')::timestamptz desc,payload->>'key'
      limit p_page_size offset (least(p_page,(select pages from totals))-1)*p_page_size)
    select jsonb_build_object(
      'rows',coalesce((select jsonb_agg(public.student_list_row_permissions(payload,actor,
        (select public.has_perm(actor,'student.view.all')),(select public.has_perm(actor,'followup.write')))
        order by (payload->>'createdAt')::timestamptz desc,payload->>'key') from page_rows),'[]'::jsonb),
      'count',t.count,'page',least(p_page,t.pages),'pageSize',p_page_size,'totalPages',t.pages,
      'counts',coalesce((select jsonb_object_agg(index_stage,n) from(select index_stage,count(*) n from facts group by index_stage) c),'{}'::jsonb),
      'facets','{}'::jsonb) into result from totals t;
    return result;
  end if;
  with facts as materialized (select * from public.student_list_base_facts(p_scope,p_search,p_population,p_stage)),$page$);
  execute definition;
end;
$migration$;
