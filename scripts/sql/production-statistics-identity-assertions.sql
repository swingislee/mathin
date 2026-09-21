-- 在本机已核对目标的事务中运行，最终回滚；复用现有身份和记录。
do $$ declare p uuid;s uuid;l uuid;canonical text;begin
  select id into p from public.profiles where role='staff' order by id limit 1;
  select id into s from public.students order by id limit 1;
  select id into l from public.leads order by id limit 1;
  if p is null or s is null or l is null then raise exception 'FIXED_LOCAL_DATA_REQUIRED';end if;
  update public.profiles set display_name='统计验证默认姓名',staff_aliases=array['统计验证旧称'],purpose='test' where id=p;
  update public.profiles set display_name='统计验证旧称' where id=p;
  select display_name into canonical from public.profiles where id=p;
  if canonical<>'统计验证默认姓名' then raise exception 'CANONICAL_NAME_REGRESSED';end if;
  if public.statistics_identity_included(null,null,p) or public.statistics_staff_label_included('统计验证旧称') then raise exception 'TEST_STAFF_COUNTED';end if;
  update public.students set purpose='test' where id=s;
  update public.leads set student_id=s where id=l;
  if public.statistics_identity_included(s) or public.statistics_identity_included(null,l) then raise exception 'TEST_STUDENT_COUNTED';end if;
  if exists(select 1 from public.statistics_enrollments where student_id=s)
    or exists(select 1 from public.statistics_session_attendance where student_id=s)
    or exists(select 1 from public.statistics_orders where student_id=s)
    or exists(select 1 from public.statistics_classroom_staff_assignments where user_id=p) then raise exception 'TEST_RELATION_COUNTED';end if;
  update public.students set name='回归测试学生',purpose='production' where id=s;
  if (select purpose from public.students where id=s)<>'test'
    or not (select tags @> array['测试'] from public.students where id=s) then raise exception 'TEST_NAME_CLASSIFICATION_MISSING';end if;
  update public.students set name='恢复普通称呼' where id=s;
  if public.statistics_identity_included(s) then raise exception 'IMPORT_CLASSIFICATION_REGRESSED';end if;
  if not exists(select 1 from public.students where id=s) or not exists(select 1 from public.profiles where id=p) then raise exception 'IDENTITY_REMOVED';end if;
  if exists(select 1 from pg_class where relnamespace='public'::regnamespace and relkind='v' and relname like 'statistics_%'
    and (not coalesce(reloptions @> array['security_invoker=true'],false) or has_table_privilege('anon',oid,'SELECT'))) then raise exception 'STATISTICS_RLS_CHANGED';end if;
end;$$;
