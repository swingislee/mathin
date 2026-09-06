-- RPC 直接调用与页面输入执行相同字段合同，避免无法显示的日期和隐式金额取整。
create function public.validate_business_record_revision_values(p_values jsonb) returns void
language plpgsql set search_path=public,pg_temp as $$
declare section record; field record; value text; limit_length integer;
begin
  if p_values is null or jsonb_typeof(p_values)<>'object' then raise exception 'VALIDATION'; end if;
  for section in select * from jsonb_each(p_values) loop
    if public.business_record_revision_fields(section.key) is null or jsonb_typeof(section.value)<>'object' then raise exception 'VALIDATION'; end if;
    for field in select * from jsonb_each(section.value) loop
      if not field.key=any(public.business_record_revision_fields(section.key)) then raise exception 'VALIDATION'; end if;
      value:=field.value#>>'{}';
      if value is null then
        if field.key not in ('occurred_on','registered_on','assessed_on','assessment_band','score','period_year','amount','author_label') then raise exception 'VALIDATION'; end if;
        continue;
      end if;
      if field.key in ('score','period_year','amount') then
        if jsonb_typeof(field.value)<>'number' then raise exception 'VALIDATION'; end if;
        if field.key='score' and (value::numeric<0 or value::numeric>10000 or trunc(value::numeric)<>value::numeric)
          or field.key='period_year' and (value::numeric<1900 or value::numeric>2200 or trunc(value::numeric)<>value::numeric)
          or field.key='amount' and (value::numeric<0 or value::numeric>1000000 or trunc(value::numeric*100)<>value::numeric*100) then raise exception 'VALIDATION'; end if;
      else
        if jsonb_typeof(field.value)<>'string' then raise exception 'VALIDATION'; end if;
        if field.key in ('occurred_on','registered_on','assessed_on') and (value!~'^\d{4}-\d{2}-\d{2}$' or value::date::text<>value) then raise exception 'VALIDATION'; end if;
        limit_length:=case field.key when 'title' then 100 when 'location' then 100 when 'remark' then 1000 when 'reported_result' then 2000
          when 'strengths' then 20000 when 'note' then 20000 when 'content' then 20000 when 'schedule_label' then 500 else 200 end;
        if length(value)>limit_length or (field.key in ('title','content') and btrim(value)='') then raise exception 'VALIDATION'; end if;
        if field.key='kind' and value not in ('trial_class','public_class','assessment_1v1','sanbanfu','lecture','competition')
          or field.key='status' and value not in ('booked','attended','no_show','cancelled')
          or field.key='assessment_band' and value not in ('a_plus','a','s','c','g_plus','x_plus','below_a')
          or field.key='period_key' and value not in ('summer','autumn')
          or field.key='stage' and value not in ('unknown','enrolled','not_enrolled')
          or field.key='result_link_status' and value not in ('none','edition_unconfirmed','confirmed') then raise exception 'VALIDATION'; end if;
      end if;
    end loop;
  end loop;
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then raise exception 'VALIDATION';
end;
$$;
revoke all on function public.validate_business_record_revision_values(jsonb) from public,anon,authenticated,service_role;
do $migration$
declare definition text; signature regprocedure:='public.revise_business_record(text,uuid,text,jsonb,text)'::regprocedure;
begin
  definition:=pg_get_functiondef(signature);
  if strpos(definition,'  rows:=public.business_record_revision_rows(p_kind,p_id);')=0 then raise exception 'REVISION_FUNCTION_CHANGED'; end if;
  -- 第一次读取前验证。锁后重复验证不读取额外资源，保持既有认证与原子写入顺序。
  execute replace(definition,'  rows:=public.business_record_revision_rows(p_kind,p_id);',E'  perform public.validate_business_record_revision_values(p_values);\n  rows:=public.business_record_revision_rows(p_kind,p_id);');
end $migration$;
