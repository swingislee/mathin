-- 同台圆对 v2 与固定 v1 分别保存，原业务 API 与权限保持。
begin;
do $$ declare source text; needle text; begin
  source:=pg_get_functiondef('public.tool_scene_is_valid(jsonb)'::regprocedure);
  needle:='or public.tool_plane_perimeter_boundary_scene_is_valid(p_scene)';
  if strpos(source,needle)=0 or strpos(source,'public.tool_plane_rolling_workbench_scene_is_valid(p_scene)')>0 then raise exception 'PLANE_ROLLING_DISPATCH_PRECONDITION'; end if;
  execute replace(source,needle,needle||' or public.tool_plane_rolling_workbench_scene_is_valid(p_scene)');
  source:=pg_get_functiondef('public.tool_scene_catalog_id(jsonb)'::regprocedure);
  needle:='when ''plane-perimeter-lesson-v3'' then ''plane-perimeter''';
  if strpos(source,needle)=0 or strpos(source,'''plane-rolling-lesson-v2''')>0 then raise exception 'PLANE_ROLLING_CATALOG_PRECONDITION'; end if;
  execute replace(source,needle,needle||' when ''plane-rolling-lesson-v2'' then ''plane-rolling''');
end $$;
notify pgrst,'reload schema';
commit;
