\set ON_ERROR_STOP on
-- 在隔离测试库执行。依赖 verify-p4d-db.sql 使用的“测试-*”固定账号；全程回滚。
begin;

do $$ begin
  if not exists(select 1 from public.profiles where display_name='测试-学辅')
     or not exists(select 1 from public.profiles where display_name='测试-学生') then
    raise exception 'P4E_FIXTURES_MISSING: seed the fixed 测试-* accounts first';
  end if;
end $$;

select id as sales_id from public.profiles where display_name='测试-学辅' limit 1 \gset
select id as admin_id from public.profiles where display_name='测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name='测试-教师' limit 1 \gset
select id as student_user_id from public.profiles where display_name='测试-学生' limit 1 \gset
insert into public.students(name,assigned_to,created_by,bind_code,follow_up_status)
values('__P4E_FOREIGN_SCOPE__',:'teacher_id',:'admin_id','p4e'||substr(replace(gen_random_uuid()::text,'-',''),1,12),'pending')
returning id as foreign_student_id \gset
insert into public.notes(owner_id,title,document)
values(:'admin_id','__P4E_PRIVATE_NOTE__','[]'::jsonb)
returning id as private_note_id \gset
insert into public.posts(note_id,author_id,title,content,content_html,excerpt)
values(:'private_note_id',:'admin_id','__P4E_POST__','[]'::jsonb,'<p>P4E</p>','P4E')
returning id as foreign_post_id \gset
insert into storage.objects(bucket_id,name,owner_id)
values('session-videos','00000000-0000-0000-0000-000000000000/'||gen_random_uuid()::text||'.mp4',:'admin_id'::text)
returning name as foreign_storage_path \gset
insert into public.operational_errors(event,message,environment)
values('p4e.audit','__P4E_OPERATIONAL_ERROR__','test')
returning id as operational_error_id \gset
select set_config('p4e.private_note_id',:'private_note_id',true);
select set_config('p4e.foreign_post_id',:'foreign_post_id',true);
select set_config('p4e.admin_id',:'admin_id',true);
select cs.id as member_session_id from public.class_sessions cs
 join public.classroom_members cm on cm.classroom_id=cs.classroom_id
 where cm.user_id=:'student_user_id' and cm.role='student' and cs.deleted_at is null limit 1 \gset
\if :{?foreign_student_id}
\else
  \echo P4E fixtures missing: no foreign student for 测试-学辅
  \quit 1
\endif
\if :{?member_session_id}
\else
  \echo P4E fixtures missing: 测试-学生 has no classroom session
  \quit 1
\endif

-- 结构授权：append-only、敏感写、私有表与 Storage 不得被宽授。
do $$
declare failures text[] := '{}';
begin
  if has_table_privilege('authenticated','public.domain_events','UPDATE') then failures:=array_append(failures,'domain_events UPDATE granted'); end if;
  if has_table_privilege('authenticated','public.domain_events','DELETE') then failures:=array_append(failures,'domain_events DELETE granted'); end if;
  if has_column_privilege('authenticated','public.whiteboards','snapshot','UPDATE') then failures:=array_append(failures,'whiteboards.snapshot direct UPDATE granted'); end if;
  if has_table_privilege('anon','public.students','SELECT') then failures:=array_append(failures,'anon can SELECT students'); end if;
  if has_table_privilege('anon','public.notes','SELECT') then failures:=array_append(failures,'anon can SELECT private notes'); end if;
  if has_table_privilege('anon','public.post_likes','INSERT') then failures:=array_append(failures,'anon can INSERT likes'); end if;
  if has_table_privilege('authenticated','public.role_permissions','INSERT') then failures:=array_append(failures,'role_permissions direct INSERT granted'); end if;
  if has_table_privilege('authenticated','public.operational_errors','INSERT') then failures:=array_append(failures,'operational_errors INSERT granted'); end if;
  if has_table_privilege('authenticated','public.operational_errors','UPDATE') then failures:=array_append(failures,'operational_errors UPDATE granted'); end if;
  if has_table_privilege('authenticated','public.operational_errors','DELETE') then failures:=array_append(failures,'operational_errors DELETE granted'); end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.operational_errors'::regclass and tgname='operational_errors_immutable' and not tgisinternal) then failures:=array_append(failures,'operational_errors append-only trigger missing'); end if;
  if not exists(select 1 from pg_policies where schemaname='realtime' and tablename='messages' and policyname='session_broadcast_send_authoritative_teacher' and with_check like '%is_session_teacher%') then failures:=array_append(failures,'authoritative realtime teacher policy missing'); end if;
  if exists(select 1 from pg_policies where schemaname='realtime' and tablename='messages' and policyname='session_broadcast_send_member') then failures:=array_append(failures,'legacy broad broadcast policy remains'); end if;
  if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'session_videos_storage_select%') then failures:=array_append(failures,'private video SELECT policy missing'); end if;
  if cardinality(failures)>0 then raise exception 'P4E security assertions failed: %',array_to_string(failures,', '); end if;
end $$;

-- anon 对私人笔记必须是“无权限”或 0 行，绝不能读到真实行。
set local role anon;
do $$
declare visible_count integer;
begin
  begin
    select count(*) into visible_count from public.notes where id=current_setting('p4e.private_note_id')::uuid;
    if visible_count <> 0 then raise exception 'ANON_PRIVATE_NOTE_WAS_VISIBLE'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- view.assigned 学辅读取非名下、非任课学生必须得到 0 行。
set local role authenticated;
select set_config('request.jwt.claim.sub',:'sales_id',true);
select (count(*)=0) as assigned_scope_ok from public.students where id=:'foreign_student_id' \gset
\if :assigned_scope_ok
\else
  \echo P4E security failed: view.assigned user read a foreign student
  \quit 1
\endif

select (count(*)=0) as operational_error_scope_ok
from public.operational_errors where id=:'operational_error_id' \gset
\if :operational_error_scope_ok
\else
  \echo P4E security failed: student read operational errors
  \quit 1
\endif

-- 顾客侧学生不得直接读取财务表，即使猜中自己的学生档案也只能走白名单 RPC。
select set_config('request.jwt.claim.sub',:'student_user_id',true);
select (count(*)=0) as customer_finance_ok from public.orders \gset
\if :customer_finance_ok
\else
  \echo P4E security failed: student read orders directly
  \quit 1
\endif

-- 反作弊对局表即使存在 Supabase 默认表级 grant，也必须被“零 RLS 策略”全拒。
select (count(*)=0) as game_session_read_ok from public.game_sessions \gset
\if :game_session_read_ok
\else
  \echo P4E security failed: student read game session credentials
  \quit 1
\endif
do $$
begin
  begin
    insert into public.game_sessions(user_id,game_id,difficulty,seed)
    values(auth.uid(),'p4e-audit','easy','forbidden');
    raise exception 'GAME_SESSION_INSERT_WAS_ACCEPTED';
  exception
    when insufficient_privilege then null;
    when check_violation then null;
  end;
end $$;

-- 普通用户不能冒用另一个用户的 user_id 点赞。
do $$
begin
  begin
    insert into public.post_likes(post_id,user_id)
    values(current_setting('p4e.foreign_post_id')::uuid,current_setting('p4e.admin_id')::uuid);
    raise exception 'FOREIGN_LIKE_WAS_ACCEPTED';
  exception
    when insufficient_privilege then null;
    when check_violation then null;
  end;
end $$;

-- 猜中私有视频对象路径仍必须返回 0 行。
select (count(*)=0) as cross_storage_read_ok
from storage.objects where bucket_id='session-videos' and name=:'foreign_storage_path' \gset
\if :cross_storage_read_ok
\else
  \echo P4E security failed: student read a foreign Storage object
  \quit 1
\endif

-- 学生向 authoritative topic 写业务广播必须被 RLS 拒。
select set_config('realtime.topic','session:'||:'member_session_id'||':authoritative',true);
do $$
begin
  begin
    insert into realtime.messages(topic,extension,event,payload,private)
    values(current_setting('realtime.topic'),'broadcast','audit-forbidden','{}'::jsonb,true);
    raise exception 'AUTHORITATIVE_BROADCAST_WAS_ACCEPTED';
  exception
    when insufficient_privilege then null;
    when check_violation then null;
  end;
end $$;

-- 学生向不属于自己的 session-videos 路径插入对象元数据必须被拒。
do $$
begin
  begin
    insert into storage.objects(bucket_id,name,owner_id)
    values('session-videos','00000000-0000-0000-0000-000000000000/p4e-cross-scope-audit.mp4',auth.uid()::text);
    raise exception 'CROSS_SCOPE_STORAGE_INSERT_WAS_ACCEPTED';
  exception
    when insufficient_privilege then null;
    when check_violation then null;
  end;
end $$;

rollback;
\echo P4E database security assertions passed
