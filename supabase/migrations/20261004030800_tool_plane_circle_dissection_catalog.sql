begin;
do $$ declare source text; needle text; begin
  source:=pg_get_functiondef('public.tool_scene_is_valid(jsonb)'::regprocedure);
  needle:='or public.tool_plane_routes_scene_is_valid(p_scene)';
  if strpos(source,needle)=0 or strpos(source,'public.tool_plane_circle_dissection_scene_is_valid(p_scene)')>0 then raise exception 'PLANE_CIRCLE_DISPATCH_PRECONDITION'; end if;
  execute replace(source,needle,needle||' or public.tool_plane_circle_dissection_scene_is_valid(p_scene)');
  source:=pg_get_functiondef('public.tool_scene_catalog_id(jsonb)'::regprocedure);
  needle:='when ''plane-reflection-path-lesson-v2'' then ''plane-reflection-path''';
  if strpos(source,needle)=0 or strpos(source,'''plane-circle-area-lesson-v2''')>0 then raise exception 'PLANE_CIRCLE_CATALOG_PRECONDITION'; end if;
  execute replace(source,needle,needle||' when ''plane-circle-area-lesson-v2'' then ''plane-circle-area''');
end $$;
notify pgrst,'reload schema';
commit;
