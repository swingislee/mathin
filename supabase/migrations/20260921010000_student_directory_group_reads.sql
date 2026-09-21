-- 名录先计算范围与阶段；只有负责人/协作组分组需要所有身份的协作投影。
-- 班级、年级、不分组仍由当前页详情补齐协作字段与办理权限。
do $directory$
declare definition text; previous text;
begin
  select pg_get_functiondef('public.list_student_directory(text,text,text,text,text,integer,integer,uuid[])'::regprocedure) into definition;
  if md5(definition) <> 'c2cf78af8c8d472c30447cbceca554ac' then
    raise exception 'STUDENT_DIRECTORY_DEFINITION_CHANGED'; end if;
  previous := definition;
  definition := replace(definition,
    'join public.school_list_collaboration(subjects,actor) c using(key)',
    'left join public.school_list_collaboration(case when p_group_by in (''owner'',''group'') then subjects else ''[]''::jsonb end,actor) c using(key)');
  definition := replace(definition,
    $old$select s.key,coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',coalesce(g.name,'')) order by g.name,g.id)
      from (select distinct id,name from group_refs where key=s.key) g),'[{"id":"unassigned","name":""}]'::jsonb) as items
      from identities s$old$,
    $new$select s.key,coalesce(g.items,'[{"id":"unassigned","name":""}]'::jsonb) as items
      from identities s left join (
        select refs.key,jsonb_agg(jsonb_build_object('id',refs.id,'name',coalesce(refs.name,'')) order by refs.name,refs.id) as items
        from (select distinct key,id,name from group_refs) refs group by refs.key
      ) g using(key)$new$);
  if definition = previous or definition like '%from group_refs where key=s.key%' then
    raise exception 'STUDENT_DIRECTORY_REWRITE_FAILED'; end if;
  execute definition;
end;
$directory$;

alter function public.list_student_directory(text,text,text,text,text,integer,integer,uuid[])
  set plan_cache_mode = force_custom_plan;
