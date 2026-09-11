-- 第三版保存已确认的纠错与字段归位，逐条保留旧版及原始凭据。
do $patch$
declare definition text; before_text text; after_text text; target regprocedure; field_key text;
begin
  foreach target in array array[
    'public.read_base_source_business_fields(text)'::regprocedure,
    'public.read_school_record_source_context(uuid,uuid,integer)'::regprocedure,
    'public.read_base_lead_acquisition(uuid[])'::regprocedure
  ] loop
    definition:=pg_get_functiondef(target);
    if position('mapping_version<=2' in definition)=0 then raise exception 'BASE_REVIEW_VERSION_CONTRACT_CHANGED'; end if;
    definition:=replace(definition,'mapping_version<=2','mapping_version<=3');
    if target='public.read_base_lead_acquisition(uuid[])'::regprocedure then
      -- 同一条来源中可能有原获客区位和归位后的获取地址，两者共同展示。
      foreach field_key in array array['location','channel','promoter','content','group'] loop
        before_text:=format('max(f->>''display'') filter(where f->>''key''=%L)',field_key);
        after_text:=format('string_agg(distinct nullif(f->>''display'',''''),'' / '' order by nullif(f->>''display'','''')) filter(where f->>''key''=%L)',field_key);
        if position(before_text in definition)=0 then raise exception 'BASE_REVIEW_ACQUISITION_CONTRACT_CHANGED: %',field_key; end if;
        definition:=replace(definition,before_text,after_text);
      end loop;
    end if;
    execute definition;
  end loop;
end;
$patch$;
notify pgrst,'reload schema';
