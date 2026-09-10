-- 读取当前支持的最新整理版本；旧版本逐条保留。原有身份与权限范围继续由既有 RPC 判定。
do $patch$
declare definition text; before_text text; after_text text; target regprocedure;
begin
  target:='public.read_base_source_business_fields(text)'::regprocedure;
  definition:=pg_get_functiondef(target);
  before_text:='where source_record_id=p_source_id and mapping_version=1';
  after_text:='where source_record_id=p_source_id and mapping_version<=2 order by mapping_version desc limit 1';
  if position(before_text in definition)=0 then raise exception 'BASE_SOURCE_VERSION_CONTRACT_CHANGED'; end if;
  execute replace(definition,before_text,after_text);

  target:='public.read_school_record_source_context(uuid,uuid,integer)'::regprocedure;
  definition:=pg_get_functiondef(target);
  before_text:='b.source_record_id=paged.id and b.mapping_version=1';
  after_text:='b.source_record_id=paged.id and b.mapping_version=(select max(v.mapping_version) from public.history_source_business_facts v where v.source_record_id=paged.id and v.mapping_version<=2)';
  if position(before_text in definition)=0 then raise exception 'BASE_CONTEXT_VERSION_CONTRACT_CHANGED'; end if;
  execute replace(definition,before_text,after_text);

  target:='public.read_base_lead_acquisition(uuid[])'::regprocedure;
  definition:=pg_get_functiondef(target);
  before_text:='b.source_record_id=h.id and b.mapping_version=1';
  after_text:='b.source_record_id=h.id and b.mapping_version=(select max(v.mapping_version) from public.history_source_business_facts v where v.source_record_id=h.id and v.mapping_version<=2)';
  if position(before_text in definition)=0 then raise exception 'BASE_ACQUISITION_VERSION_CONTRACT_CHANGED'; end if;
  execute replace(definition,before_text,after_text);
end;
$patch$;
notify pgrst,'reload schema';
