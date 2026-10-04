-- 新版凹纸片和完整格覆盖只追加分发；原版本、保存 API、RLS 及冻结副本保持。
begin;
do $$ declare source text; needle text; begin
  source:=pg_get_functiondef('public.tool_scene_is_valid(jsonb)'::regprocedure);
  needle:='or public.tool_plane_strips_scene_is_valid(p_scene)';
  if strpos(source,needle)=0
    or strpos(source,'public.tool_plane_overlap_concave_scene_is_valid(p_scene)')>0
    or strpos(source,'public.tool_plane_cell_coverage_scene_is_valid(p_scene)')>0 then
    raise exception 'PLANE_DEPTH_DISPATCH_PRECONDITION';
  end if;
  execute replace(source,needle,needle
    ||' or public.tool_plane_overlap_concave_scene_is_valid(p_scene)'
    ||' or public.tool_plane_cell_coverage_scene_is_valid(p_scene)');
  source:=pg_get_functiondef('public.tool_scene_catalog_id(jsonb)'::regprocedure);
  needle:='when ''plane-area-relations-lesson-v4'' then ''plane-area-relations''';
  if strpos(source,needle)=0 or strpos(source,'''plane-area-relations-lesson-v5''')>0
    or strpos(source,'''plane-overlap-lesson-v3''')>0 then
    raise exception 'PLANE_DEPTH_CATALOG_PRECONDITION';
  end if;
  execute replace(source,needle,needle
    ||' when ''plane-area-relations-lesson-v5'' then ''plane-area-relations'''
    ||' when ''plane-overlap-lesson-v3'' then ''plane-overlap''');
end $$;
notify pgrst, 'reload schema';
commit;
