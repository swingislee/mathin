-- ============================================================================
-- CI 断言夹具（docs/plan/15-§5）。
--
-- supabase/tests/p4e_security_assertions.sql 依赖一组固定的「测试-*」账号：一个
-- 管理员、一个教师、一个学辅（岗位角色 sales，作用域 view.assigned）、一个学生
-- （在某教室的某课次里）和一个家长。开发库里这些账号由注册流程产生；一次性 CI
-- 库里必须由本文件种出来，否则断言拿不到主体、也就证明不了越权被拒。
--
-- 只在一次性 CI 容器里执行。
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data)
values
  (
    '00000000-0000-4000-8000-000000000001',
    'ci-admin@mathin.local',
    jsonb_build_object(
      'display_name', '测试-管理员',
      'registration_invite_code', (select code from public.registration_invite_settings where id = 1),
      'privacy_consent', true,
      'children_privacy_consent', true
    )
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    'ci-teacher@mathin.local',
    jsonb_build_object(
      'display_name', '测试-教师',
      'registration_invite_code', (select code from public.registration_invite_settings where id = 1),
      'privacy_consent', true,
      'children_privacy_consent', true
    )
  ),
  (
    '00000000-0000-4000-8000-000000000003',
    'ci-sales@mathin.local',
    jsonb_build_object(
      'display_name', '测试-学辅',
      'registration_invite_code', (select code from public.registration_invite_settings where id = 1),
      'privacy_consent', true,
      'children_privacy_consent', true
    )
  ),
  (
    '00000000-0000-4000-8000-000000000004',
    'ci-student@mathin.local',
    jsonb_build_object(
      'display_name', '测试-学生',
      'registration_invite_code', (select code from public.registration_invite_settings where id = 1),
      'privacy_consent', true,
      'children_privacy_consent', true
    )
  ),
  (
    '00000000-0000-4000-8000-000000000005',
    'ci-parent@mathin.local',
    jsonb_build_object(
      'display_name', '测试-家长',
      'registration_invite_code', (select code from public.registration_invite_settings where id = 1),
      'privacy_consent', true,
      'children_privacy_consent', true
    )
  )
on conflict (id) do nothing;

-- handle_new_user 触发器已按 display_name 建好 profiles；这里只补身份类角色。
update public.profiles set role = 'admin'   where id = '00000000-0000-4000-8000-000000000001';
update public.profiles set role = 'staff'   where id in ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003');
update public.profiles set role = 'student' where id = '00000000-0000-4000-8000-000000000004';
update public.profiles set role = 'parent'  where id = '00000000-0000-4000-8000-000000000005';

insert into public.students (id, name, status, user_id, bind_code, created_by)
values (
  '00000000-0000-4000-8000-000000000201', 'CI 测试学生', 'enrolled',
  '00000000-0000-4000-8000-000000000004', 'CI-STUDENT-1',
  '00000000-0000-4000-8000-000000000001'
)
on conflict (id) do nothing;

insert into public.student_guardians (student_id, guardian_id, relation, scope, is_primary)
values (
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000005',
  '家长', array['finance', 'grades', 'video']::text[], true
)
on conflict do nothing;

-- 岗位角色：教师、学辅。学辅的 student.view.assigned 是「读不到非名下学生」断言的前提。
insert into public.staff_role_members (user_id, role_id)
select '00000000-0000-4000-8000-000000000002', id from public.staff_roles where key = 'teacher'
on conflict do nothing;
insert into public.staff_role_members (user_id, role_id)
select '00000000-0000-4000-8000-000000000003', id from public.staff_roles where key = 'sales'
on conflict do nothing;

-- doc 26 需要一堂尚未开始、带正式 release 页的教师课次。
insert into public.courses (id, title, product_code, grade, term, class_type, created_by)
values (
  '00000000-0000-4000-8000-000000000301', 'CI 备课课程', 'CI-DOC26',
  1, 1, 'audit', '00000000-0000-4000-8000-000000000001'
)
on conflict (id) do nothing;

insert into public.course_lectures (id, course_id, no, name)
values (
  '00000000-0000-4000-8000-000000000302',
  '00000000-0000-4000-8000-000000000301', 1, 'CI 备课讲次'
)
on conflict (id) do nothing;

insert into public.cw_page_docs (
  id, lecture_id, page_no, title, source_courseware_id, source_page_id
)
values (
  '00000000-0000-4000-8000-000000000303',
  '00000000-0000-4000-8000-000000000302',
  1, 'CI 备课页面', 'ci-doc26', 'page-1'
)
on conflict (id) do nothing;

insert into public.cw_page_revisions (id, page_doc_id, revision_no, doc, origin, created_by)
values (
  '00000000-0000-4000-8000-000000000304',
  '00000000-0000-4000-8000-000000000303',
  1,
  jsonb_build_object(
    'docVersion', 'page-doc-v1',
    'sourceCoursewareId', 'ci-doc26',
    'sourcePageId', 'page-1',
    'sourcePageDatabaseId', 1,
    'sourceSnapshotId', 1,
    'sourceContentHash', repeat('c', 64),
    'canvas', jsonb_build_object(
      'width', 1280, 'height', 720,
      'backgroundColor', null, 'backgroundBindingKey', null
    ),
    'nodes', '[]'::jsonb,
    'interactions', '[]'::jsonb
  ),
  'import',
  '00000000-0000-4000-8000-000000000001'
)
on conflict (id) do nothing;

update public.cw_page_docs
   set current_revision_id = '00000000-0000-4000-8000-000000000304'
 where id = '00000000-0000-4000-8000-000000000303';

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);
select public.publish_cw_track_release(
  '00000000-0000-4000-8000-000000000302', 'native-16x9', 'CI doc 26 release'
);

-- 学生所属教室与课次：authoritative 广播越权断言需要一个「我是成员」的课次。
insert into public.classrooms (id, owner_id, name, invite_code)
values ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000002', 'CI 教室', 'CI0001')
on conflict (id) do nothing;

insert into public.classroom_members (classroom_id, user_id, role)
values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000002', 'teacher'),
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000004', 'student')
on conflict do nothing;

insert into public.enrollments (classroom_id, student_id, status, operated_by)
values (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000201',
  'active',
  '00000000-0000-4000-8000-000000000001'
)
on conflict do nothing;

insert into public.class_sessions (id, classroom_id, lecture_id, title, scheduled_at, duration_min)
values (
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000302',
  'CI 课次', now() + interval '1 day', 90
)
on conflict (id) do nothing;
