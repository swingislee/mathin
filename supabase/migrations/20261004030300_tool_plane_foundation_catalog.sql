-- 线角、面积教学材料与两种路线的新版本只追加分发，旧冻结副本与保存 API 保持。
begin;
do $$ declare source text; needle text; begin
  source:=pg_get_functiondef('public.tool_scene_is_valid(jsonb)'::regprocedure);
  needle:='or public.tool_plane_cell_coverage_scene_is_valid(p_scene)';
  if strpos(source,needle)=0 or strpos(source,'public.tool_plane_lines_scene_is_valid(p_scene)')>0
    or strpos(source,'public.tool_plane_area_lessons_scene_is_valid(p_scene)')>0
    or strpos(source,'public.tool_plane_routes_scene_is_valid(p_scene)')>0 then raise exception 'PLANE_FOUNDATION_DISPATCH_PRECONDITION'; end if;
  execute replace(source,needle,needle
    ||' or public.tool_plane_lines_scene_is_valid(p_scene)'
    ||' or public.tool_plane_area_lessons_scene_is_valid(p_scene)'
    ||' or public.tool_plane_routes_scene_is_valid(p_scene)');
  source:=pg_get_functiondef('public.tool_scene_catalog_id(jsonb)'::regprocedure);
  needle:='when ''plane-overlap-lesson-v3'' then ''plane-overlap''';
  if strpos(source,needle)=0 or strpos(source,'''plane-geometry-lesson-v2''')>0 or strpos(source,'''plane-area-lesson-v3''')>0
    or strpos(source,'''plane-grid-path-lesson-v2''')>0 or strpos(source,'''plane-reflection-path-lesson-v2''')>0 then raise exception 'PLANE_FOUNDATION_CATALOG_PRECONDITION'; end if;
  execute replace(source,needle,needle
    ||' when ''plane-geometry-lesson-v2'' then ''plane-geometry'''
    ||' when ''plane-area-lesson-v3'' then ''plane-area'''
    ||' when ''plane-grid-path-lesson-v2'' then ''plane-grid-path'''
    ||' when ''plane-reflection-path-lesson-v2'' then ''plane-reflection-path''');
end $$;
notify pgrst,'reload schema';
commit;
