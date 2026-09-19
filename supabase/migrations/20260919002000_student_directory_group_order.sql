-- 已有班级、年级或负责关系排在前面，缺少分组的学生保留在名录末尾。
do $$
declare definition text; needle text:=$needle$case when p_group_by<>'none' then s.items->0->>'name' end$needle$;
begin
  select pg_get_functiondef('public.list_student_directory(text,text,text,text,text,integer,integer,uuid[])'::regprocedure) into definition;
  if position(needle in definition)=0 then raise exception 'DIRECTORY_GROUP_ORDER_BASELINE'; end if;
  execute replace(definition,needle,$replacement$case when s.items->0->>'id'='unassigned' then 1 else 0 end,
      case when p_group_by<>'none' then s.items->0->>'name' end$replacement$);
end $$;
notify pgrst,'reload schema';
