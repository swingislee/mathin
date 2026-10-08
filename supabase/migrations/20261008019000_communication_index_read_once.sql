-- 阶段索引复用已限定的来源集合；同次读取只计算一次阶段判定。
do $migration$
declare original text; anchor text; authority text;
begin
  select pg_get_functiondef('public.business_source_is_authoritative(text)'::regprocedure) into authority;
  -- pg_get_viewdef 在不同版本中可能省略表名前缀；规范化后核对完整定义。
  if md5(authority)<>'6f00dd0f248084fe1598262c2a460d5d'
    or md5(replace(pg_get_viewdef('public.business_lead_communications'::regclass,true),'lead_communications.',''))<>'013180eff860d25cf38a702620f25311' then
    raise exception 'COMMUNICATION_SOURCE_CONTRACT_CHANGED';
  end if;
  select pg_get_functiondef('public.student_record_index_for_population(text,text,public.business_course_enrollment_subjects[],boolean)'::regprocedure) into original;
  anchor:=$old$from public.business_lead_communications r
      where r.source_record_id is null or r.source_record_id in(select id from directory_sources)$old$;
  if position(anchor in original)=0 or position('), stages as (' in original)=0 then
    raise exception 'COMMUNICATION_INDEX_READER_ANCHOR_MISSING';
  end if;
  original:=replace(original,anchor,$new$from public.lead_communications r
      where not coalesce(r.source_metric_facts->'supersededProjection'='true'::jsonb,false)
        and (r.source_record_id is null or r.source_record_id in(select id from directory_sources))$new$);
  original:=replace(original,'), stages as (','), stages as materialized (');
  execute original;
end
$migration$;
