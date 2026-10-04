-- 圆弧新版与原直边、固定圆方版本分别保存；复用原业务 API 与权限。
begin;
do $$ declare source text; needle text; begin
  source:=pg_get_functiondef('public.tool_scene_is_valid(jsonb)'::regprocedure);
  needle:='or public.tool_plane_paper_layers_scene_is_valid(p_scene)';
  if strpos(source,needle)=0 or strpos(source,'public.tool_plane_overlap_curves_scene_is_valid(p_scene)')>0 then raise exception 'PLANE_OVERLAP_CURVES_DISPATCH_PRECONDITION'; end if;
  execute replace(source,needle,needle||' or public.tool_plane_overlap_curves_scene_is_valid(p_scene)');
  source:=pg_get_functiondef('public.tool_scene_catalog_id(jsonb)'::regprocedure);
  needle:='when ''plane-folding-lesson-v3'' then ''plane-folding''';
  if strpos(source,needle)=0 or strpos(source,'''plane-overlap-lesson-v4''')>0 then raise exception 'PLANE_OVERLAP_CURVES_CATALOG_PRECONDITION'; end if;
  execute replace(source,needle,needle||' when ''plane-overlap-lesson-v4'' then ''plane-overlap''');
end $$;
notify pgrst,'reload schema';
commit;
