-- ============================================================================
-- CI 断言夹具（docs/plan/15-§5）。
--
-- supabase/tests/p4e_security_assertions.sql 依赖一组固定的「测试-*」账号：一个
-- 管理员、一个教师、一个学辅（岗位角色 sales，作用域 view.assigned）、一个学生
-- （在某教室的某课次里）。开发库里这些账号由注册流程产生；一次性 CI 库里必须由
-- 本文件种出来，否则断言拿不到主体、也就证明不了越权被拒。
--
-- 只在一次性 CI 容器里执行。
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data)
values
  ('00000000-0000-4000-8000-000000000001', 'ci-admin@mathin.local',   jsonb_build_object('display_name', '测试-管理员')),
  ('00000000-0000-4000-8000-000000000002', 'ci-teacher@mathin.local', jsonb_build_object('display_name', '测试-教师')),
  ('00000000-0000-4000-8000-000000000003', 'ci-sales@mathin.local',   jsonb_build_object('display_name', '测试-学辅')),
  ('00000000-0000-4000-8000-000000000004', 'ci-student@mathin.local', jsonb_build_object('display_name', '测试-学生'))
on conflict (id) do nothing;

-- handle_new_user 触发器已按 display_name 建好 profiles；这里只补身份类角色。
update public.profiles set role = 'admin'   where id = '00000000-0000-4000-8000-000000000001';
update public.profiles set role = 'staff'   where id in ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003');
update public.profiles set role = 'student' where id = '00000000-0000-4000-8000-000000000004';

-- 岗位角色：教师、学辅。学辅的 student.view.assigned 是「读不到非名下学生」断言的前提。
insert into public.staff_role_members (user_id, role_id)
select '00000000-0000-4000-8000-000000000002', id from public.staff_roles where key = 'teacher'
on conflict do nothing;
insert into public.staff_role_members (user_id, role_id)
select '00000000-0000-4000-8000-000000000003', id from public.staff_roles where key = 'sales'
on conflict do nothing;

-- 学生所属教室与课次：authoritative 广播越权断言需要一个「我是成员」的课次。
insert into public.classrooms (id, owner_id, name, invite_code)
values ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000002', 'CI 教室', 'CI0001')
on conflict (id) do nothing;

insert into public.classroom_members (classroom_id, user_id, role)
values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000002', 'teacher'),
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000004', 'student')
on conflict do nothing;

insert into public.class_sessions (id, classroom_id, title)
values ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000101', 'CI 课次')
on conflict (id) do nothing;
