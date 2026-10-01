-- 只追加开放材料版本，保留所有既有教具（包括数位积木 v3）的分发与 ACL。
begin;
do $$ declare source text; needle text; begin
  source:=pg_get_functiondef('public.tool_scene_is_valid(jsonb)'::regprocedure);
  needle:='or public.tool_plane_open_scene_is_valid(p_scene)';
  if strpos(source,needle)=0 or strpos(source,'public.tool_plane_perimeter_scene_is_valid(p_scene)')>0 then
    raise exception 'PLANE_DEEP_DISPATCH_PRECONDITION';
  end if;
  execute replace(source,needle,needle
    ||' or public.tool_plane_perimeter_scene_is_valid(p_scene)'
    ||' or public.tool_plane_grid_measure_scene_is_valid(p_scene)'
    ||' or public.tool_plane_relations_scene_is_valid(p_scene)'
    ||' or public.tool_plane_overlap_scene_is_valid(p_scene)');
  source:=pg_get_functiondef('public.tool_scene_catalog_id(jsonb)'::regprocedure);
  needle:='when ''plane-graph-path-lesson-v2'' then ''plane-graph-path''';
  if strpos(source,needle)=0 or strpos(source,'''plane-perimeter-lesson-v2''')>0 then
    raise exception 'PLANE_DEEP_CATALOG_PRECONDITION';
  end if;
  execute replace(source,needle,needle
    ||' when ''plane-perimeter-lesson-v2'' then ''plane-perimeter'''
    ||' when ''plane-measurement-lesson-v2'' then ''plane-measurement'''
    ||' when ''plane-geoboard-lesson-v2'' then ''plane-geoboard'''
    ||' when ''plane-area-relations-lesson-v2'' then ''plane-area-relations'''
    ||' when ''plane-overlap-lesson-v2'' then ''plane-overlap''');
end $$;
notify pgrst, 'reload schema';
commit;
