-- 组合周长新版接入既有保存 API；原纸片和固定旧版保持可读。
begin;
do $$ declare source text; needle text; begin
  source:=pg_get_functiondef('public.tool_scene_is_valid(jsonb)'::regprocedure);
  needle:='or public.tool_plane_overlap_curves_scene_is_valid(p_scene)';
  if strpos(source,needle)=0 or strpos(source,'public.tool_plane_perimeter_boundary_scene_is_valid(p_scene)')>0 then raise exception 'PLANE_PERIMETER_BOUNDARY_DISPATCH_PRECONDITION'; end if;
  execute replace(source,needle,needle||' or public.tool_plane_perimeter_boundary_scene_is_valid(p_scene)');
  source:=pg_get_functiondef('public.tool_scene_catalog_id(jsonb)'::regprocedure);
  needle:='when ''plane-overlap-lesson-v4'' then ''plane-overlap''';
  if strpos(source,needle)=0 or strpos(source,'''plane-perimeter-lesson-v3''')>0 then raise exception 'PLANE_PERIMETER_BOUNDARY_CATALOG_PRECONDITION'; end if;
  execute replace(source,needle,needle||' when ''plane-perimeter-lesson-v3'' then ''plane-perimeter''');
end $$;
notify pgrst,'reload schema';
commit;
