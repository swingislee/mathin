-- 多进制和紧凑单位区间；v1 冻结副本、草稿所有权和课堂权限保持原合同。
begin;
create function public.tool_place_value_radix_board_is_valid(b jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare radix int; digits int; level int:=0; groups jsonb; g jsonb; span jsonb;
  weight bigint; members bigint; total bigint:=0; group_count int:=0; span_count int:=0;
  first_id bigint; count_units bigint; last_id bigint; allocated bigint; seen int8range[]:=array[]::int8range[]; interval int8range;
begin
  if not public.tool_space_keys(b,array['radix','places','nextId'],array['radix','places','nextId'])
    or not public.tool_space_number(b->'radix',2,16,true)
    or not public.tool_space_number(b->'nextId',0,1000000000000,true)
    or jsonb_typeof(b->'places') is distinct from 'array' then return false; end if;
  radix:=(b->>'radix')::int; digits:=jsonb_array_length(b->'places'); allocated:=(b->>'nextId')::bigint;
  if radix not in (2,3,4,5,7,8,9,10,16) or digits not between 3 and 6 then return false; end if;
  for groups in select value from jsonb_array_elements(b->'places') loop
    if jsonb_typeof(groups) is distinct from 'array' or jsonb_array_length(groups)>2048 then return false; end if;
    weight:=power(radix,level)::bigint; group_count:=group_count+jsonb_array_length(groups);
    total:=total+jsonb_array_length(groups)*weight;
    if group_count>2048 or total>=power(radix,digits) then return false; end if;
    for g in select value from jsonb_array_elements(groups) loop
      if jsonb_typeof(g) is distinct from 'array' or jsonb_array_length(g) not between 1 and 2048 then return false; end if;
      members:=0;
      for span in select value from jsonb_array_elements(g) loop
        span_count:=span_count+1;
        if span_count>4096 or not public.tool_space_keys(span,array['start','count','phase'],array['start','count','phase'])
          or not public.tool_space_number(span->'start',0,1000000000000,true)
          or not public.tool_space_number(span->'count',1,16777216,true)
          or not public.tool_space_number(span->'phase',0,radix-1,true) then return false; end if;
        first_id:=(span->>'start')::bigint; count_units:=(span->>'count')::bigint; last_id:=first_id+count_units;
        if last_id>allocated then return false; end if;
        interval:=int8range(first_id,last_id,'[)');
        if exists(select 1 from unnest(seen) r where r && interval) then return false; end if;
        seen:=array_append(seen,interval); members:=members+count_units;
      end loop;
      if members<>weight then return false; end if;
    end loop;
    level:=level+1;
  end loop;
  return true;
exception when others then return false; end;
$$;
create function public.tool_place_value_radix_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare i jsonb:=s#>'{payload,initial}'; key text; selection jsonb; groups jsonb; g jsonb; span jsonb; unit_id bigint; found boolean:=false; digits int;
begin
  if not coalesce(s->>'toolId'='place-value' and s->>'contentVersion'='place-value-lesson-v2'
    and i->>'mode' in ('single','compare') and i->>'active' in ('left','right')
    and i->>'comparison' in ('hidden','<','=','>') and i->>'speed' in ('slow','normal','fast')
    and i->>'view' in ('angle','front','left','right','top'),false) then return false; end if;
  if not public.tool_space_keys(s,array['toolId','contentVersion','payload'],array['toolId','contentVersion','payload'])
    or not public.tool_space_keys(s->'payload',array['title','initial'],array['title','initial'])
    or jsonb_typeof(s#>'{payload,title}') is distinct from 'string' or char_length(btrim(s#>>'{payload,title}')) not between 1 and 80
    or not public.tool_space_keys(i,array['mode','left','right','active','selection','highlight','comparison','autoCarry','speed','showDigits','showLabels','grid','axes','view','frame'],
      array['mode','left','right','active','selection','highlight','comparison','autoCarry','speed','showDigits','showLabels','grid','axes','view','frame'])
    or not public.tool_place_value_radix_board_is_valid(i->'left') or not public.tool_place_value_radix_board_is_valid(i->'right')
    or i#>'{left,radix}'<>i#>'{right,radix}' or jsonb_array_length(i#>'{left,places}')<>jsonb_array_length(i#>'{right,places}')
    or not public.tool_space_keys(i->'frame',array['center','radius'],array['center','radius'])
    or not public.tool_space_vector(i#>'{frame,center}',50) or not public.tool_space_number(i#>'{frame,radius}',1,10000000)
    or octet_length(s::text)>512000 then return false; end if;
  digits:=jsonb_array_length(i#>'{left,places}');
  if i->'highlight'<>'"all"'::jsonb and not public.tool_space_number(i->'highlight',0,digits-1,true) then return false; end if;
  foreach key in array array['autoCarry','showDigits','showLabels','grid','axes'] loop
    if jsonb_typeof(i->key) is distinct from 'boolean' then return false; end if;
  end loop;
  selection:=i->'selection';
  if selection<>'null'::jsonb then
    if not public.tool_space_keys(selection,array['side','unit'],array['side','unit'])
      or not coalesce(selection->>'side' in ('left','right'),false) or not public.tool_space_number(selection->'unit',0,1000000000000,true) then return false; end if;
    unit_id:=(selection->>'unit')::bigint;
    for groups in select value from jsonb_array_elements(i->(selection->>'side')->'places') loop
      for g in select value from jsonb_array_elements(groups) loop
        for span in select value from jsonb_array_elements(g) loop
          found:=found or unit_id >= (span->>'start')::bigint and unit_id < (span->>'start')::bigint+(span->>'count')::bigint;
        end loop;
      end loop;
    end loop;
    if not found then return false; end if;
  end if;
  return true;
exception when others then return false; end;
$$;
revoke all on function public.tool_place_value_radix_board_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.tool_place_value_radix_scene_is_valid(jsonb) from public,anon,authenticated,service_role;

-- 只扩展此版本分支，保留本轮其它教具对共用分发器的已登记增量。
do $$ declare source text; needle text; begin
  source:=pg_get_functiondef('public.tool_scene_is_valid(jsonb)'::regprocedure);
  needle:='or public.tool_place_value_scene_is_valid(p_scene)';
  if strpos(source,needle)=0 then raise exception 'PLACE_VALUE_DISPATCH_PRECONDITION'; end if;
  execute replace(source,needle,needle||' or public.tool_place_value_radix_scene_is_valid(p_scene)');
  source:=pg_get_functiondef('public.tool_scene_catalog_id(jsonb)'::regprocedure);
  needle:='when ''place-value-lesson-v1'' then ''place-value''';
  if strpos(source,needle)=0 then raise exception 'PLACE_VALUE_CATALOG_PRECONDITION'; end if;
  execute replace(source,needle,needle||' when ''place-value-lesson-v2'' then ''place-value''');
end $$;
notify pgrst, 'reload schema';
commit;
