-- 列表字段按共享页面合同处理空白，并保留首联/待测评来源的可见范围。
create function public.student_list_is_blank(p_value text)
returns boolean language sql immutable set search_path=public,pg_temp as $$
  select p_value is null or btrim(p_value,E' \t\n\r\f\013'||U&'\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')='';
$$;
revoke all on function public.student_list_is_blank(text) from public,anon,authenticated,service_role;

do $compatibility$
declare definition text; before_text text; after_text text; patch record;
begin
  definition:=pg_get_functiondef('public.student_list_field(jsonb,text,jsonb,uuid,text)'::regprocedure);
  before_text:='''missing'',btrim(value)=''''';
  if position(before_text in definition)=0 then raise exception 'LIST_FIELD_CONTRACT_CHANGED'; end if;
  definition:=replace(definition,before_text,'''missing'',public.student_list_is_blank(value)');
  before_text:='btrim(sort_value#>>''{}'')=''''';
  if position(before_text in definition)=0 then raise exception 'LIST_SORT_CONTRACT_CHANGED'; end if;
  execute replace(definition,before_text,'public.student_list_is_blank(sort_value#>>''{}'')');

  definition:=pg_get_functiondef('public.student_list_facts(text,text,text,text)'::regprocedure);
  for patch in select * from (values
    ('from lead_refs l join listed s using(key) join public.history_import_records h on h.lead_id=l.id',
      'from lead_refs l join listed s using(key) join public.history_import_records h on h.lead_id=l.id where l.visible or s.stage not in (''awaiting_first_contact'',''awaiting_assessment'')'),
    ('from lead_refs l join listed s using(key) where l.source_record_id is not null',
      'from lead_refs l join listed s using(key) where l.source_record_id is not null and (l.visible or s.stage not in (''awaiting_first_contact'',''awaiting_assessment''))'),
    ('from lead_refs l join listed s using(key) join public.lead_communications c on c.lead_id=l.id where c.source_record_id is not null',
      'from lead_refs l join listed s using(key) join public.lead_communications c on c.lead_id=l.id where c.source_record_id is not null and (l.visible or s.stage not in (''awaiting_first_contact'',''awaiting_assessment''))'),
    ('from lead_refs l join listed s using(key) join public.activity_registrations r on r.lead_id=l.id where r.source_record_id is not null',
      'from lead_refs l join listed s using(key) join public.activity_registrations r on r.lead_id=l.id where r.source_record_id is not null and (l.visible or s.stage not in (''awaiting_first_contact'',''awaiting_assessment''))'),
    ('from lead_refs l join listed s using(key) join public.assessment_results a on a.lead_id=l.id where a.source_record_id is not null',
      'from lead_refs l join listed s using(key) join public.assessment_results a on a.lead_id=l.id where a.source_record_id is not null and (l.visible or s.stage not in (''awaiting_first_contact'',''awaiting_assessment''))')
  ) p(before_text,after_text) loop
    if position(patch.before_text in definition)=0 then raise exception 'LIST_SOURCE_CONTRACT_CHANGED'; end if;
    definition:=replace(definition,patch.before_text,patch.after_text);
  end loop;
  execute definition;
end;
$compatibility$;
notify pgrst,'reload schema';
