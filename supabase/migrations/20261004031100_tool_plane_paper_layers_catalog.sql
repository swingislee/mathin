-- 新建双折 v3 与历史单折、固定双折分别保存，原业务 API 保持。
begin;
do $$ declare source text; needle text; begin
  source:=pg_get_functiondef('public.tool_scene_is_valid(jsonb)'::regprocedure);
  needle:='or public.tool_plane_circle_dissection_scene_is_valid(p_scene)';
  if strpos(source,needle)=0 or strpos(source,'public.tool_plane_paper_layers_scene_is_valid(p_scene)')>0 then raise exception 'PLANE_PAPER_LAYERS_DISPATCH_PRECONDITION'; end if;
  execute replace(source,needle,needle||' or public.tool_plane_paper_layers_scene_is_valid(p_scene)');
  source:=pg_get_functiondef('public.tool_scene_catalog_id(jsonb)'::regprocedure);
  needle:='when ''plane-circle-area-lesson-v2'' then ''plane-circle-area''';
  if strpos(source,needle)=0 or strpos(source,'''plane-folding-lesson-v3''')>0 then raise exception 'PLANE_PAPER_LAYERS_CATALOG_PRECONDITION'; end if;
  execute replace(source,needle,needle||' when ''plane-folding-lesson-v3'' then ''plane-folding''');
end $$;
notify pgrst,'reload schema';
commit;
