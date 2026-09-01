\set ON_ERROR_STOP on
-- SML-0：讲次 capability 的真实 PostgreSQL 正/负向断言。全程回滚。
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
select id as other_staff_id from public.profiles where display_name = '测试-学辅' limit 1 \gset
select
  lecture_value.id as lecture_id,
  course_value.id as course_id,
  family_value.id as family_id
from public.course_lectures lecture_value
join public.courses course_value on course_value.id = lecture_value.course_id
join public.course_families family_value on family_value.id = course_value.family_id
where lecture_value.status = 'active'
  and lecture_value.archived_at is null
  and course_value.status = 'enabled'
  and course_value.trashed_at is null
  and family_value.status = 'enabled'
order by lecture_value.id
limit 1 \gset

\if :{?admin_id}
\else
  \echo SML-0 fixtures missing: 测试-管理员
  select 1 / 0;
\endif
\if :{?teacher_id}
\else
  \echo SML-0 fixtures missing: 测试-教师
  select 1 / 0;
\endif
\if :{?other_staff_id}
\else
  \echo SML-0 fixtures missing: 测试-学辅
  select 1 / 0;
\endif
\if :{?lecture_id}
\else
  \echo SML-0 fixtures missing: active lecture in enabled family/course
  select 1 / 0;
\endif

do $$
declare failures text[] := '{}';
begin
  if to_regprocedure('public.resolve_cw_lecture_capability_for(uuid,uuid,text,timestamp with time zone)') is null
     or to_regprocedure('public.resolve_my_cw_lecture_capability(uuid,text)') is null
     or to_regprocedure('public.assert_cw_lecture_capability(uuid,text)') is null then
    failures := array_append(failures, 'capability functions missing');
  end if;
  if not has_function_privilege('authenticated', 'public.resolve_my_cw_lecture_capability(uuid,text)', 'EXECUTE') then
    failures := array_append(failures, 'authenticated resolver grant missing');
  end if;
  if has_function_privilege('anon', 'public.resolve_my_cw_lecture_capability(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.resolve_cw_lecture_capability_for(uuid,uuid,text,timestamp with time zone)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.assert_cw_lecture_capability(uuid,text)', 'EXECUTE') then
    failures := array_append(failures, 'internal or anonymous execute grant leaked');
  end if;
  if exists (
    select 1
    from pg_proc procedure_value
    join pg_namespace namespace_value on namespace_value.oid = procedure_value.pronamespace
    where namespace_value.nspname = 'public'
      and procedure_value.proname in (
        'resolve_cw_lecture_capability_for',
        'resolve_my_cw_lecture_capability',
        'assert_cw_lecture_capability'
      )
      and (not procedure_value.prosecdef or procedure_value.provolatile <> 's')
  ) then failures := array_append(failures, 'resolver security or volatility contract drifted'); end if;
  if cardinality(failures) > 0 then
    raise exception 'SML0_CAPABILITY_STRUCTURE_FAILED: %', array_to_string(failures, ', ');
  end if;
end
$$;

-- 清空选中对象继承链上的责任，确保本断言不依赖开发库已有分配。
delete from public.course_staff_assignments assignment_value
where assignment_value.lecture_id = :'lecture_id'::uuid
   or assignment_value.course_id = :'course_id'::uuid
   or assignment_value.family_id = :'family_id'::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select set_config('sml.lecture_id', :'lecture_id', true);

-- active admin 通过平台对象级豁免，不需要伪造课程责任关系。
select (
  allowed
  and denial_code is null
  and required_permission = 'courseware.page.edit'
  and responsibility = 'admin'
  and assignment_scope_type = 'platform'
  and assignment_source_id is null
) as admin_object_bypass
from public.resolve_my_cw_lecture_capability(:'lecture_id', 'page.edit') \gset
\if :admin_object_bypass
\else
  \echo SML-0 capability failed: active admin did not receive object-level bypass
  select 1 / 0;
\endif

-- 管理员只豁免责任关系，不绕过对象生命周期。
reset role;
update public.course_lectures
set status = 'archived', archived_at = now()
where id = :'lecture_id';
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select (not allowed and denial_code = 'LECTURE_ARCHIVED') as admin_lifecycle_enforced
from public.resolve_my_cw_lecture_capability(:'lecture_id', 'page.edit') \gset
\if :admin_lifecycle_enforced
\else
  \echo SML-0 capability failed: admin bypassed lecture lifecycle
  select 1 / 0;
\endif
reset role;
update public.course_lectures
set status = 'active', archived_at = null
where id = :'lecture_id';
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);

-- 未知 capability 必须 fail closed。
do $$
begin
  begin
    perform * from public.resolve_my_cw_lecture_capability(current_setting('sml.lecture_id')::uuid, 'page.unknown');
    raise exception 'SML0_UNKNOWN_CAPABILITY_WAS_ACCEPTED';
  exception when others then
    if sqlerrm <> 'INVALID_COURSEWARE_CAPABILITY' then raise; end if;
  end;
end
$$;

reset role;

-- 普通教研继续遵守对象责任关系。临时叠加 research / principal 用于覆盖全部 capability；
-- 事务末尾回滚，不改变固定账号岗位。
insert into public.staff_role_members(user_id, role_id)
select :'teacher_id', id from public.staff_roles where key in ('research', 'principal')
on conflict do nothing;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select (not allowed and denial_code = 'RELATION_REQUIRED') as researcher_relation_required
from public.resolve_my_cw_lecture_capability(:'lecture_id', 'page.edit') \gset
\if :researcher_relation_required
\else
  \echo SML-0 capability failed: non-admin bypassed lecture relation
  select 1 / 0;
\endif
reset role;

-- 已过期关系不能授权。
insert into public.course_staff_assignments(
  user_id, scope_type, course_id, responsibility, starts_at, ends_at, created_by
) values (
  :'teacher_id', 'variant', :'course_id', 'editor', now() - interval '2 days', now() - interval '1 day', :'admin_id'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select (not allowed and denial_code = 'RELATION_REQUIRED') as expired_relation_rejected
from public.resolve_my_cw_lecture_capability(:'lecture_id', 'page.edit') \gset
\if :expired_relation_rejected
\else
  \echo SML-0 capability failed: expired assignment remained effective
  select 1 / 0;
\endif
reset role;

delete from public.course_staff_assignments
where user_id = :'teacher_id' and course_id = :'course_id' and responsibility = 'editor';
insert into public.course_staff_assignments(user_id, scope_type, course_id, responsibility, created_by)
values (:'teacher_id', 'variant', :'course_id', 'editor', :'admin_id');

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select (
  allowed
  and denial_code is null
  and responsibility = 'editor'
  and assignment_scope_type = 'variant'
  and assignment_source_id = :'course_id'::uuid
) as inherited_editor_allowed
from public.resolve_my_cw_lecture_capability(:'lecture_id', 'page.edit') \gset
\if :inherited_editor_allowed
\else
  \echo SML-0 capability failed: active variant editor was not resolved
  select 1 / 0;
\endif

select (not allowed and denial_code = 'RESPONSIBILITY_REQUIRED') as editor_cannot_review
from public.resolve_my_cw_lecture_capability(:'lecture_id', 'review.decide') \gset
\if :editor_cannot_review
\else
  \echo SML-0 capability failed: editor received reviewer capability
  select 1 / 0;
\endif
reset role;

insert into public.course_staff_assignments(user_id, scope_type, family_id, responsibility, created_by)
values (:'teacher_id', 'family', :'family_id', 'reviewer', :'admin_id');

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select (
  allowed
  and responsibility = 'reviewer'
  and assignment_scope_type = 'family'
  and required_permission = 'courseware.review'
) as inherited_reviewer_allowed
from public.resolve_my_cw_lecture_capability(:'lecture_id', 'review.decide') \gset
\if :inherited_reviewer_allowed
\else
  \echo SML-0 capability failed: family reviewer was not inherited
  select 1 / 0;
\endif

select (allowed and responsibility = 'editor') as editor_publish_allowed
from public.resolve_my_cw_lecture_capability(:'lecture_id', 'release.publish') \gset
\if :editor_publish_allowed
\else
  \echo SML-0 capability failed: scoped editor with publish permission was rejected
  select 1 / 0;
\endif

select (not allowed and denial_code = 'RESPONSIBILITY_REQUIRED') as emergency_requires_owner
from public.resolve_my_cw_lecture_capability(:'lecture_id', 'release.emergency_publish') \gset
\if :emergency_requires_owner
\else
  \echo SML-0 capability failed: emergency publish did not require owner
  select 1 / 0;
\endif
reset role;

-- owner 只取最靠近讲次的一层；下级 owner 会覆盖 family owner。
insert into public.course_staff_assignments(user_id, scope_type, family_id, responsibility, created_by)
values (:'teacher_id', 'family', :'family_id', 'owner', :'admin_id');

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select (allowed and responsibility = 'owner' and assignment_scope_type = 'family') as family_owner_allowed
from public.resolve_my_cw_lecture_capability(:'lecture_id', 'release.emergency_publish') \gset
\if :family_owner_allowed
\else
  \echo SML-0 capability failed: family owner was not effective
  select 1 / 0;
\endif
reset role;

insert into public.course_staff_assignments(user_id, scope_type, lecture_id, responsibility, created_by)
values (:'other_staff_id', 'lecture', :'lecture_id', 'owner', :'admin_id');

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select (not allowed and denial_code = 'RESPONSIBILITY_REQUIRED') as nearest_owner_overrides_family
from public.resolve_my_cw_lecture_capability(:'lecture_id', 'release.emergency_publish') \gset
\if :nearest_owner_overrides_family
\else
  \echo SML-0 capability failed: overridden family owner retained owner authority
  select 1 / 0;
\endif
reset role;

delete from public.course_staff_assignments
where lecture_id = :'lecture_id' and responsibility = 'owner';

-- 编辑允许 draft；发布要求 family/course enabled 且 lecture active。
update public.course_lectures set status = 'draft', archived_at = null where id = :'lecture_id';
set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select (allowed) as draft_edit_allowed
from public.resolve_my_cw_lecture_capability(:'lecture_id', 'page.edit') \gset
select (not allowed and denial_code = 'LECTURE_NOT_ACTIVE') as draft_publish_rejected
from public.resolve_my_cw_lecture_capability(:'lecture_id', 'release.publish') \gset
\if :draft_edit_allowed
\else
  \echo SML-0 capability failed: draft lecture edit was rejected
  select 1 / 0;
\endif
\if :draft_publish_rejected
\else
  \echo SML-0 capability failed: draft lecture publish was accepted
  select 1 / 0;
\endif
reset role;

update public.course_lectures set status = 'active', archived_at = null where id = :'lecture_id';
update public.courses set status = 'draft', trashed_at = null where id = :'course_id';
set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select (allowed) as draft_course_edit_allowed
from public.resolve_my_cw_lecture_capability(:'lecture_id', 'page.edit') \gset
select (not allowed and denial_code = 'COURSE_NOT_ENABLED') as draft_course_publish_rejected
from public.resolve_my_cw_lecture_capability(:'lecture_id', 'release.publish') \gset
\if :draft_course_edit_allowed
\else
  \echo SML-0 capability failed: draft course edit was rejected
  select 1 / 0;
\endif
\if :draft_course_publish_rejected
\else
  \echo SML-0 capability failed: draft course publish was accepted
  select 1 / 0;
\endif
reset role;

update public.courses set status = 'enabled', trashed_at = null where id = :'course_id';
update public.course_lectures set status = 'archived', archived_at = now() where id = :'lecture_id';
set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select (not allowed and denial_code = 'LECTURE_ARCHIVED') as archived_lecture_rejected
from public.resolve_my_cw_lecture_capability(:'lecture_id', 'page.edit') \gset
\if :archived_lecture_rejected
\else
  \echo SML-0 capability failed: archived lecture remained editable
  select 1 / 0;
\endif
reset role;

update public.course_lectures set status = 'active', archived_at = null where id = :'lecture_id';
update public.courses set trashed_at = now() where id = :'course_id';
set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select (not allowed and denial_code = 'COURSE_TRASHED') as trashed_course_rejected
from public.resolve_my_cw_lecture_capability(:'lecture_id', 'page.edit') \gset
\if :trashed_course_rejected
\else
  \echo SML-0 capability failed: trashed course remained editable
  select 1 / 0;
\endif
reset role;

update public.courses set trashed_at = null where id = :'course_id';

update public.profiles set account_status = 'locked' where id = :'teacher_id';
set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select (
  not allowed
  and denial_code = 'INACTIVE_ACTOR'
  and course_id is null
  and family_id is null
) as inactive_actor_rejected
from public.resolve_my_cw_lecture_capability(:'lecture_id', 'page.edit') \gset
\if :inactive_actor_rejected
\else
  \echo SML-0 capability failed: inactive actor retained courseware capability
  select 1 / 0;
\endif
reset role;
update public.profiles set account_status = 'active' where id = :'teacher_id';

-- 无 RBAC permission 时先拒绝，不泄露对象状态与关系。
set local role authenticated;
select set_config('request.jwt.claim.sub', :'other_staff_id', true);
select (
  not allowed
  and denial_code = 'MISSING_PERMISSION'
  and course_id is null
  and family_id is null
) as permission_checked_first
from public.resolve_my_cw_lecture_capability(:'lecture_id', 'release.emergency_publish') \gset
\if :permission_checked_first
\else
  \echo SML-0 capability failed: permission-first boundary drifted
  select 1 / 0;
\endif
reset role;

-- assert helper 不对 authenticated 暴露，但受控写 RPC 的 owner 可复用同一 denial code。
delete from public.course_staff_assignments assignment_value
where assignment_value.user_id = :'teacher_id'
  and (
    assignment_value.lecture_id = :'lecture_id'::uuid
    or assignment_value.course_id = :'course_id'::uuid
    or assignment_value.family_id = :'family_id'::uuid
  );
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select set_config('sml.lecture_id', :'lecture_id', true);
do $$
begin
  begin
    perform public.assert_cw_lecture_capability(current_setting('sml.lecture_id')::uuid, 'page.edit');
    raise exception 'SML0_ASSERT_ACCEPTED_MISSING_RELATION_FOR_NON_ADMIN';
  exception when others then
    if sqlerrm <> 'RELATION_REQUIRED' or sqlstate <> '42501' then raise; end if;
  end;
end
$$;

rollback;
\echo SML-0 courseware lecture capability assertions passed
