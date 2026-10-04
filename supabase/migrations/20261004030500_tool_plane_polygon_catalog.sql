-- 多边形 v2 的新建入口与历史 06/07/08 分别按自己的合同保存。
begin;
do $$ declare source text; needle text; begin
  source:=pg_get_functiondef('public.tool_scene_is_valid(jsonb)'::regprocedure);
  needle:='or public.tool_plane_routes_scene_is_valid(p_scene)';
  if strpos(source,needle)=0 or strpos(source,'public.tool_plane_polygon_workbench_scene_is_valid(p_scene)')>0 then raise exception 'PLANE_POLYGON_DISPATCH_PRECONDITION'; end if;
  execute replace(source,needle,needle||' or public.tool_plane_polygon_workbench_scene_is_valid(p_scene)');
  source:=pg_get_functiondef('public.tool_scene_catalog_id(jsonb)'::regprocedure);
  needle:='when ''plane-reflection-path-lesson-v2'' then ''plane-reflection-path''';
  if strpos(source,needle)=0 or strpos(source,'''plane-polygons-lesson-v2''')>0 then raise exception 'PLANE_POLYGON_CATALOG_PRECONDITION'; end if;
  execute replace(source,needle,needle||' when ''plane-polygons-lesson-v2'' then ''plane-polygons''');
end $$;
notify pgrst,'reload schema';
commit;
