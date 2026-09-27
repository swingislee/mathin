-- 独立装盒映射策略；旧 v1/v2 场景保持原 wire identity 与严格字段边界。
begin;
create function public.tool_place_value_mapping_scene_is_valid(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog,public as $$
declare presentation jsonb:=s#>'{payload,initial,presentation}'; original jsonb;
begin
  if s->>'contentVersion' is distinct from 'place-value-lesson-v3'
    or octet_length(s::text)>512000
    or not public.tool_space_keys(presentation,array['strategy','contents'],array['strategy','contents'])
    or not coalesce(presentation->>'strategy' in ('rods','boxes') and presentation->>'contents' in ('inside','outside','both'),false) then return false; end if;
  original:=jsonb_set(s,'{contentVersion}','"place-value-lesson-v2"'::jsonb);
  original:=jsonb_set(original,'{payload,initial}',(s#>'{payload,initial}')-'presentation');
  return public.tool_place_value_radix_scene_is_valid(original);
exception when others then return false; end;
$$;
revoke all on function public.tool_place_value_mapping_scene_is_valid(jsonb) from public,anon,authenticated,service_role;

do $$ declare source text; needle text; begin
  source:=pg_get_functiondef('public.tool_scene_is_valid(jsonb)'::regprocedure);
  needle:='or public.tool_place_value_radix_scene_is_valid(p_scene)';
  if strpos(source,needle)=0 then raise exception 'PLACE_VALUE_MAPPING_DISPATCH_PRECONDITION'; end if;
  execute replace(source,needle,needle||' or public.tool_place_value_mapping_scene_is_valid(p_scene)');
  source:=pg_get_functiondef('public.tool_scene_catalog_id(jsonb)'::regprocedure);
  needle:='when ''place-value-lesson-v2'' then ''place-value''';
  if strpos(source,needle)=0 then raise exception 'PLACE_VALUE_MAPPING_CATALOG_PRECONDITION'; end if;
  execute replace(source,needle,needle||' when ''place-value-lesson-v3'' then ''place-value''');
end $$;
notify pgrst, 'reload schema';
commit;
