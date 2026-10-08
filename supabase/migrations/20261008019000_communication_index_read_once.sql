-- 阶段索引复用已限定的来源集合；同次读取只计算一次阶段判定。
do $migration$
declare original text; anchor text; authority text;
begin
  select pg_get_functiondef('public.business_source_is_authoritative(text)'::regprocedure) into authority;
  if position('p_record_id is null or exists' in authority)=0
    or position('r.id=p_record_id and r.source_data->>''format''=''feishu-base''' in authority)=0
    or position('NOT COALESCE((lead_communications.source_metric_facts -> ''supersededProjection''::text) = ''true''::jsonb, false)' in pg_get_viewdef('public.business_lead_communications'::regclass,true))=0 then
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
