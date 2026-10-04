-- 保留已执行版本；线角及面积标题对齐 JavaScript trim 与 UTF-16 长度。
begin;
do $$ declare signature text; source text; begin
  foreach signature in array array['public.tool_plane_lines_scene_is_valid(jsonb)','public.tool_plane_area_lessons_scene_is_valid(jsonb)'] loop
    source:=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
    if strpos(source,'char_length(btrim(s#>>''{payload,title}'')) between 1 and 80')=0 then raise exception 'PLANE_FOUNDATION_TITLE_PRECONDITION'; end if;
    source:=replace(source,E'begin\n',E'declare title text; title_units integer;\nbegin\n'
      ||E'  title:=btrim(s#>>''{payload,title}'',U&''\\0009\\000A\\000B\\000C\\000D\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'');\n'
      ||E'  select char_length(title)+count(*) filter(where octet_length(codepoint)=4) into title_units from regexp_split_to_table(title,'''') as chars(codepoint);\n');
    execute replace(source,'char_length(btrim(s#>>''{payload,title}'')) between 1 and 80','title_units between 1 and 80');
  end loop;
end $$;
commit;
