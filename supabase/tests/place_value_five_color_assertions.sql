begin;
do $$ declare b jsonb:='{"radix":2,"places":[[[{"start":0,"count":1,"phase":5}]],[],[]],"nextId":1}'; begin
  if public.tool_place_value_radix_board_is_valid(b) is not true then raise exception 'FIXED_COLOR_PHASE_REJECTED'; end if;
  if public.tool_place_value_radix_board_is_valid(jsonb_set(b,'{places,0,0,0,phase}','15')) is not true then raise exception 'OLD_COLOR_PHASE_REJECTED'; end if;
  if public.tool_place_value_radix_board_is_valid(jsonb_set(b,'{places,0,0,0,phase}','16')) is not false then raise exception 'INVALID_COLOR_PHASE_ACCEPTED'; end if;
  if public.tool_place_value_radix_board_is_valid(jsonb_set(b,'{places,0,0,0,count}','2')) is not false then raise exception 'COLOR_CHANGED_WEIGHT_CHECK'; end if;
  if public.tool_place_value_radix_board_is_valid(jsonb_set(b,'{places,0,0,0,start}','1')) is not false then raise exception 'COLOR_CHANGED_ID_CHECK'; end if;
end $$;
rollback;
