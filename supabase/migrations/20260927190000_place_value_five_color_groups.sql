-- 颜色相位独立于数学进制；保留已有 v2 相位 0～15 的可读范围，不改分组与数量。
begin;
do $$ declare source text; needle text; begin
  source:=pg_get_functiondef('public.tool_place_value_radix_board_is_valid(jsonb)'::regprocedure);
  needle:='public.tool_space_number(span->''phase'',0,radix-1,true)';
  if strpos(source,needle)=0 then raise exception 'PLACE_VALUE_COLOR_PRECONDITION'; end if;
  execute replace(source,needle,'public.tool_space_number(span->''phase'',0,15,true)');
end $$;
notify pgrst, 'reload schema';
commit;
