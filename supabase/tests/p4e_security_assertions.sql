-- 在已应用全部 migration 的测试库执行：psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ...
-- 这些断言不依赖业务 fixture，先守住授权结构；带 fixture 的水平越权用应用 E2E 补充。
begin;

do $$
declare failures text[] := '{}';
begin
  if has_table_privilege('authenticated','public.domain_events','UPDATE') then failures:=array_append(failures,'domain_events UPDATE granted'); end if;
  if has_table_privilege('authenticated','public.domain_events','DELETE') then failures:=array_append(failures,'domain_events DELETE granted'); end if;
  if has_column_privilege('authenticated','public.whiteboards','snapshot','UPDATE') then failures:=array_append(failures,'whiteboards.snapshot direct UPDATE granted'); end if;
  if has_table_privilege('anon','public.students','SELECT') then failures:=array_append(failures,'anon can SELECT students'); end if;
  if has_table_privilege('anon','public.orders','SELECT') then failures:=array_append(failures,'anon can SELECT orders'); end if;
  if has_table_privilege('authenticated','public.role_permissions','INSERT') then failures:=array_append(failures,'role_permissions direct INSERT granted'); end if;
  if not exists(select 1 from pg_policies where schemaname='realtime' and tablename='messages' and policyname='session_broadcast_send_authoritative_teacher') then failures:=array_append(failures,'authoritative realtime policy missing'); end if;
  if exists(select 1 from pg_policies where schemaname='realtime' and tablename='messages' and policyname='session_broadcast_send_member') then failures:=array_append(failures,'legacy broad broadcast policy remains'); end if;
  if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'session_videos_storage_select%') then failures:=array_append(failures,'private video SELECT policy missing'); end if;
  if cardinality(failures)>0 then raise exception 'P4E security assertions failed: %',array_to_string(failures,', '); end if;
end $$;

rollback;
