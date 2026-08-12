\set ON_ERROR_STOP on
-- SML-0：生产课件编辑/评审 RPC 的 lecture capability 接线断言。全程回滚。
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as student_id from public.profiles where display_name = '测试-学生' limit 1 \gset
select id as reviewer_id from public.profiles where display_name = '测试-教务' limit 1 \gset

\if :{?admin_id}
\else
  \echo SML-0 lifecycle fixtures missing: 测试-管理员
  select 1 / 0;
\endif
\if :{?student_id}
\else
  \echo SML-0 lifecycle fixtures missing: 测试-学生
  select 1 / 0;
\endif
\if :{?reviewer_id}
\else
  \echo SML-0 lifecycle fixtures missing: 测试-教务
  select 1 / 0;
\endif

select role_id as reviewer_role_id
from public.staff_role_members
where user_id = :'reviewer_id'
order by role_id
limit 1 \gset
\if :{?reviewer_role_id}
\else
  \echo SML-0 lifecycle fixtures missing: 测试-教务 staff role
  select 1 / 0;
\endif

-- 构造只有 review、没有 page.edit 的 reviewer，验证旧 adapt review 不会二次要求编辑权限。
delete from public.role_permissions
where role_id = :'reviewer_role_id' and perm_key = 'courseware.page.edit';
insert into public.role_permissions(role_id, perm_key)
values(:'reviewer_role_id', 'courseware.review')
on conflict do nothing;

insert into public.courses(title, product_code, grade, term, class_type, status, created_by)
values (
  '__SML0_LIFECYCLE__',
  '__SML0_LIFECYCLE__' || replace(gen_random_uuid()::text, '-', ''),
  1,
  1,
  'audit',
  'enabled',
  :'admin_id'
)
returning id as course_id, family_id \gset

insert into public.course_lectures(course_id, no, name, status)
values (:'course_id', 1, '__SML0_LIFECYCLE_LECTURE__', 'active')
returning id as lecture_id \gset

do $$
declare failures text[] := '{}';
begin
  if to_regprocedure('public.assert_cw_page_capability(uuid,text)') is null
     or to_regprocedure('public.assert_cw_review_cycle_capability(uuid,text)') is null then
    failures := array_append(failures, 'resource capability helpers missing');
  end if;
  if not has_function_privilege('authenticated', 'public.create_blank_cw_page(uuid,uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.submit_cw_review(uuid,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.approve_cw_review(uuid,text,integer[])', 'EXECUTE') then
    failures := array_append(failures, 'public wrapper execute grant missing');
  end if;
  if has_function_privilege('authenticated', 'public.assert_cw_page_capability(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.assert_cw_review_cycle_capability(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.create_blank_cw_page_pre_sml0_impl(uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.save_cw_track_page_draft_pre_sml0_impl(uuid,text,jsonb,integer,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.approve_cw_review_pre_sml0_impl(uuid,text,integer[])', 'EXECUTE') then
    failures := array_append(failures, 'internal implementation execute grant leaked');
  end if;
  if cardinality(failures) > 0 then
    raise exception 'SML0_LIFECYCLE_STRUCTURE_FAILED: %', array_to_string(failures, ', ');
  end if;
end
$$;

-- 有平台权限的管理员也不能在没有课程责任时创建页面。
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select set_config('sml.lifecycle.lecture_id', :'lecture_id', true);
do $$
begin
  begin
    perform public.create_blank_cw_page(
      current_setting('sml.lifecycle.lecture_id')::uuid,
      null,
      'missing relation'
    );
    raise exception 'SML0_MISSING_RELATION_WRITE_ACCEPTED';
  exception when others then
    if sqlerrm <> 'RELATION_REQUIRED' or sqlstate <> '42501' then raise; end if;
  end;
end
$$;
reset role;

-- 非 staff 身份在对象解析前被拒绝。
set local role authenticated;
select set_config('request.jwt.claim.sub', :'student_id', true);
select set_config('sml.lifecycle.lecture_id', :'lecture_id', true);
do $$
begin
  begin
    perform public.create_blank_cw_page(
      current_setting('sml.lifecycle.lecture_id')::uuid,
      null,
      'student'
    );
    raise exception 'SML0_STUDENT_WRITE_ACCEPTED';
  exception when others then
    if sqlerrm <> 'INACTIVE_ACTOR' or sqlstate <> '42501' then raise; end if;
  end;
end
$$;
reset role;

insert into public.course_staff_assignments(
  user_id, scope_type, course_id, responsibility, created_by
) values
  (:'admin_id', 'variant', :'course_id', 'editor', :'admin_id'),
  (:'admin_id', 'variant', :'course_id', 'reviewer', :'admin_id'),
  (:'reviewer_id', 'variant', :'course_id', 'reviewer', :'admin_id');

-- 编辑者在同一 capability 下完成创建、排序、保存、回退与学习检查标记。
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.create_blank_cw_page(:'lecture_id', null, 'page one') as page_one \gset
select public.create_blank_cw_page(:'lecture_id', :'page_one', 'page two') as page_two \gset
reset role;

insert into public.cw_page_track_heads(page_doc_id, track, current_revision_id)
select page_value.id, 'adapted-4x3', page_value.draft_revision_id
from public.cw_page_docs page_value
where page_value.id in (:'page_one'::uuid, :'page_two'::uuid);

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.reorder_cw_pages(
  :'lecture_id',
  array[:'page_two'::uuid, :'page_one'::uuid]
);
select revision_id as saved_revision_id, revision_no as saved_revision_no
from public.save_cw_track_page_draft(
  :'page_one',
  'adapted-4x3',
  (
    select revision_value.doc
    from public.cw_page_revisions revision_value
    join public.cw_page_docs page_value on page_value.draft_revision_id = revision_value.id
    where page_value.id = :'page_one'
  ),
  1,
  'save through capability wrapper'
) \gset
select revision_id as reverted_revision_id, revision_no as reverted_revision_no
from public.revert_cw_track_page_revision(
  :'page_one',
  'adapted-4x3',
  :'saved_revision_id',
  :'saved_revision_no',
  'revert through capability wrapper'
) \gset
select public.set_cw_page_learning_check_flag(:'page_one', 'adapted-4x3', true);
select (
  (select array_agg(id order by page_no) from public.cw_page_docs where lecture_id = :'lecture_id' and deleted_at is null)
    = array[:'page_two'::uuid, :'page_one'::uuid]
  and (select origin = 'revert' from public.cw_page_revisions where id = :'reverted_revision_id')
  and (select draft_enabled from public.cw_page_learning_check_flags where page_doc_id = :'page_one' and track = 'adapted-4x3')
) as editor_page_flow_ok \gset
\if :editor_page_flow_ok
\else
  \echo SML-0 lifecycle failed: editor page flow
  select 1 / 0;
\endif
reset role;

insert into public.cw_adapt_reviews(page_doc_id, classification, report, status)
values(:'page_one', 'A', '{}'::jsonb, 'pending');

set local role authenticated;
select set_config('request.jwt.claim.sub', :'reviewer_id', true);
select public.review_cw_adapt_page(:'page_one', 'approved', 'review-only actor');
reset role;
select (
  (select status = 'approved' and reviewed_by = :'reviewer_id'::uuid
   from public.cw_adapt_reviews where page_doc_id = :'page_one')
  and not public.has_perm(:'reviewer_id', 'courseware.page.edit')
) as review_only_adapt_allowed \gset
\if :review_only_adapt_allowed
\else
  \echo SML-0 lifecycle failed: review-only adapt decision
  select 1 / 0;
\endif

-- 同一讲次的 submit/withdraw/approve/reject 分别走 submit/decide capability。
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.submit_cw_review(:'lecture_id', 'adapted-4x3', 'first submit') as first_cycle \gset
select public.withdraw_cw_review(:'first_cycle');
select public.submit_cw_review(:'lecture_id', 'adapted-4x3', 'second submit') as approve_cycle \gset
select public.approve_cw_review(:'approve_cycle', 'approved', null) as approved_cycle \gset
select (
  :'approved_cycle'::uuid = :'approve_cycle'::uuid
  and (select status = 'passed' from public.cw_review_cycles where id = :'approve_cycle')
) as review_approved \gset
\if :review_approved
\else
  \echo SML-0 lifecycle failed: review approve
  select 1 / 0;
\endif

select public.publish_cw_review_cycle(:'lecture_id', 'adapted-4x3', 'audit release') as audit_release \gset
select public.submit_cw_review(:'lecture_id', 'adapted-4x3', 'third submit') as reject_cycle \gset
select public.reject_cw_review(:'reject_cycle', 'needs changes', null);
select (
  (select status = 'changes_requested' from public.cw_review_cycles where id = :'reject_cycle')
  and (select stage = 'changes_requested' from public.cw_lecture_workflows where lecture_id = :'lecture_id' and track = 'adapted-4x3')
) as review_rejected \gset
\if :review_rejected
\else
  \echo SML-0 lifecycle failed: review reject
  select 1 / 0;
\endif
reset role;

-- lifecycle 状态变化在旧实现执行前 fail closed。
update public.course_lectures
set status = 'archived', archived_at = now()
where id = :'lecture_id';

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select set_config('sml.lifecycle.page_id', :'page_one', true);
do $$
begin
  begin
    perform public.set_cw_page_learning_check_flag(
      current_setting('sml.lifecycle.page_id')::uuid,
      'adapted-4x3',
      false
    );
    raise exception 'SML0_ARCHIVED_PAGE_WRITE_ACCEPTED';
  exception when others then
    if sqlerrm <> 'LECTURE_ARCHIVED' or sqlstate <> '42501' then raise; end if;
  end;
end
$$;
reset role;

rollback;
\echo SML-0 courseware lifecycle capability assertions passed
