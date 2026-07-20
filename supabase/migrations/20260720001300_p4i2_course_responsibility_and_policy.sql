-- P4I-2：课程责任（course_staff_assignments）与校对政策（cw_workflow_policies）地基。
-- 与 classroom_staff_assignments 严格分离：本任务的 assignment 只表达课程研发责任
-- （owner/editor/reviewer），不进入 classroom_members，不授予任何课堂/直播权限。

-- ---------------------------------------------------------------------------
-- 1. 权限键：school_permission_keys() 是整体声明，新增键必须连同旧键一起重放。
-- ---------------------------------------------------------------------------
create or replace function public.school_permission_keys()
returns text[]
language sql
immutable
as $$
  select array[
    'student.view.all','student.view.assigned','student.edit','student.create','student.assign','student.import','student.delete',
    'followup.view','followup.write','activity.manage','activity.register','review.write','video.review',
    'course.view','course.manage','course.view.all','course.product.create','course.assignment.manage',
    'courseware.template.edit','courseware.overlay.edit',
    'courseware.page.edit','courseware.asset.manage','courseware.release.publish','courseware.review','courseware.emergency_publish',
    'class.view.all','class.view.mine','class.create','class.manage','enrollment.manage',
    'schedule.view.all','schedule.manage','attendance.mark','grading.write','report.view.all','session.void','session.postwork.manage',
    'finance.order.view','finance.order.create','finance.payment.record','finance.refund.request','finance.refund.approve',
    'finance.coupon.manage','finance.scholarship.grant','finance.account.adjust','finance.report.view',
    'staff.manage','permission.configure','audit.view','testdata.purge'
  ]::text[];
$$;

-- 角色种子：延续现有 course/courseware 域的既有分工（principal+research 编内容，
-- principal 独占最高授权动作，director 保持"广泛只读、不经手内容"的既有定位）。
insert into public.role_permissions (role_id, perm_key)
select r.id, seed.perm_key
  from public.staff_roles r
  cross join (values
    ('principal', 'course.view.all'),
    ('director', 'course.view.all'),
    ('principal', 'course.product.create'),
    ('research', 'course.product.create'),
    ('principal', 'course.assignment.manage'),
    ('principal', 'courseware.review'),
    ('research', 'courseware.review'),
    ('principal', 'courseware.emergency_publish'),
    ('principal', 'session.postwork.manage'),
    ('teacher', 'session.postwork.manage')
  ) as seed(role_key, perm_key)
 where r.key = seed.role_key
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. course_staff_assignments：课程责任，family/variant/lecture 三级 scope。
-- ---------------------------------------------------------------------------
create table if not exists public.course_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  scope_type text not null check (scope_type in ('family', 'variant', 'lecture')),
  family_id uuid references public.course_families(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  lecture_id uuid references public.course_lectures(id) on delete cascade,
  responsibility text not null check (responsibility in ('owner', 'editor', 'reviewer')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  check (
    (scope_type = 'family' and family_id is not null and course_id is null and lecture_id is null) or
    (scope_type = 'variant' and course_id is not null and family_id is null and lecture_id is null) or
    (scope_type = 'lecture' and lecture_id is not null and family_id is null and course_id is null)
  )
);

comment on table public.course_staff_assignments is
  'P4I-2 课程研发责任关系（owner/editor/reviewer，按 family/variant/lecture 就近继承）；与 classroom_staff_assignments 的教学运营责任严格分离，不进入 classroom_members，不授予课堂/直播权限。';
comment on column public.course_staff_assignments.responsibility is
  'owner 每个 scope 实例至多一个未归档记录（就近继承）；editor/reviewer 可多人，且上级向下继承、子级可追加协作者。';

create index if not exists course_staff_assignments_user_idx
  on public.course_staff_assignments (user_id, responsibility);
create index if not exists course_staff_assignments_family_idx
  on public.course_staff_assignments (family_id) where family_id is not null;
create index if not exists course_staff_assignments_course_idx
  on public.course_staff_assignments (course_id) where course_id is not null;
create index if not exists course_staff_assignments_lecture_idx
  on public.course_staff_assignments (lecture_id) where lecture_id is not null;

create unique index if not exists course_staff_assignments_one_owner_family_idx
  on public.course_staff_assignments (family_id)
  where responsibility = 'owner' and archived_at is null and scope_type = 'family';
create unique index if not exists course_staff_assignments_one_owner_variant_idx
  on public.course_staff_assignments (course_id)
  where responsibility = 'owner' and archived_at is null and scope_type = 'variant';
create unique index if not exists course_staff_assignments_one_owner_lecture_idx
  on public.course_staff_assignments (lecture_id)
  where responsibility = 'owner' and archived_at is null and scope_type = 'lecture';

-- 同一人同一职责在同一 scope 实例不能重复挂着（防重复指派）。
create unique index if not exists course_staff_assignments_no_dup_active_idx
  on public.course_staff_assignments (
    scope_type, coalesce(family_id, course_id, lecture_id), user_id, responsibility
  )
  where archived_at is null;

alter table public.course_staff_assignments enable row level security;

drop policy if exists "course_staff_assignments_select_scope" on public.course_staff_assignments;
create policy "course_staff_assignments_select_scope" on public.course_staff_assignments
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_admin((select auth.uid()))
    or public.has_perm((select auth.uid()), 'course.view.all')
    or public.has_perm((select auth.uid()), 'course.view')
  );

drop policy if exists "course_staff_assignments_insert_manage" on public.course_staff_assignments;
create policy "course_staff_assignments_insert_manage" on public.course_staff_assignments
  for insert to authenticated
  with check (public.has_perm((select auth.uid()), 'course.assignment.manage'));

drop policy if exists "course_staff_assignments_update_manage" on public.course_staff_assignments;
create policy "course_staff_assignments_update_manage" on public.course_staff_assignments
  for update to authenticated
  using (public.has_perm((select auth.uid()), 'course.assignment.manage'))
  with check (public.has_perm((select auth.uid()), 'course.assignment.manage'));

revoke all on table public.course_staff_assignments from anon, authenticated;
grant select, insert, update on table public.course_staff_assignments to authenticated;

-- ---------------------------------------------------------------------------
-- 3. cw_workflow_policies：校对政策，organization/family/variant/lecture 就近覆盖。
-- ---------------------------------------------------------------------------
create table if not exists public.cw_workflow_policies (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('organization', 'family', 'variant', 'lecture')),
  family_id uuid references public.course_families(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  lecture_id uuid references public.course_lectures(id) on delete cascade,
  required_review_rounds smallint not null default 1 check (required_review_rounds between 1 and 3),
  allow_creator_as_reviewer boolean not null default true,
  emergency_publish_enabled boolean not null default true,
  default_review_sla_hours integer,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (
    (scope_type = 'organization' and family_id is null and course_id is null and lecture_id is null) or
    (scope_type = 'family' and family_id is not null and course_id is null and lecture_id is null) or
    (scope_type = 'variant' and course_id is not null and family_id is null and lecture_id is null) or
    (scope_type = 'lecture' and lecture_id is not null and family_id is null and course_id is null)
  )
);

comment on table public.cw_workflow_policies is
  'P4I-2 课程制作校对政策：organization 默认可被 family/variant/lecture 就近覆盖，最近层级生效。';
comment on column public.cw_workflow_policies.required_review_rounds is
  '需要几校（1..3）；当前机构默认 1 校，主管可在任意层级覆盖为 2/3 校。';
comment on column public.cw_workflow_policies.allow_creator_as_reviewer is
  '是否允许制作人自校；当前机构默认允许，主管可在任意层级覆盖为不允许（此时该轮必须由他人领取）。';

create unique index if not exists cw_workflow_policies_one_organization_idx
  on public.cw_workflow_policies (scope_type) where scope_type = 'organization';
create unique index if not exists cw_workflow_policies_one_family_idx
  on public.cw_workflow_policies (family_id) where scope_type = 'family';
create unique index if not exists cw_workflow_policies_one_variant_idx
  on public.cw_workflow_policies (course_id) where scope_type = 'variant';
create unique index if not exists cw_workflow_policies_one_lecture_idx
  on public.cw_workflow_policies (lecture_id) where scope_type = 'lecture';

alter table public.cw_workflow_policies enable row level security;

drop policy if exists "cw_workflow_policies_select_scope" on public.cw_workflow_policies;
create policy "cw_workflow_policies_select_scope" on public.cw_workflow_policies
  for select to authenticated
  using (
    public.is_admin((select auth.uid()))
    or public.has_perm((select auth.uid()), 'course.view.all')
    or public.has_perm((select auth.uid()), 'course.view')
  );

drop policy if exists "cw_workflow_policies_insert_manage" on public.cw_workflow_policies;
create policy "cw_workflow_policies_insert_manage" on public.cw_workflow_policies
  for insert to authenticated
  with check (public.has_perm((select auth.uid()), 'course.assignment.manage'));

drop policy if exists "cw_workflow_policies_update_manage" on public.cw_workflow_policies;
create policy "cw_workflow_policies_update_manage" on public.cw_workflow_policies
  for update to authenticated
  using (public.has_perm((select auth.uid()), 'course.assignment.manage'))
  with check (public.has_perm((select auth.uid()), 'course.assignment.manage'));

revoke all on table public.cw_workflow_policies from anon, authenticated;
grant select, insert, update on table public.cw_workflow_policies to authenticated;

-- doc19 §19.3 当前默认种子：机构级 1 校 + 允许自校 + 允许紧急发布。
insert into public.cw_workflow_policies (scope_type, required_review_rounds, allow_creator_as_reviewer, emergency_publish_enabled)
values ('organization', 1, true, true)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. 继承解析函数：给 P4I-3 工作流状态机与后续 UI 复用，本任务不接线。
--    security invoker（非 definer）——调用者已能通过上面的 select RLS 广泛读到
--    两张表，函数只是封装"就近取值/向下继承"的拼接逻辑，不需要提权。
-- ---------------------------------------------------------------------------
create or replace function public.resolve_course_assignments(p_lecture_id uuid)
returns table (responsibility text, user_id uuid, scope_type text, source_id uuid)
language sql
stable
set search_path = public, pg_temp
as $$
  with lecture as (
    select cl.id as lecture_id, c.id as course_id, c.family_id as family_id
      from public.course_lectures cl
      join public.courses c on c.id = cl.course_id
     where cl.id = p_lecture_id
  ),
  owner_candidates as (
    select a.responsibility, a.user_id, a.scope_type,
           coalesce(a.lecture_id, a.course_id, a.family_id) as source_id,
           case a.scope_type when 'lecture' then 1 when 'variant' then 2 when 'family' then 3 end as rank
      from public.course_staff_assignments a, lecture l
     where a.responsibility = 'owner'
       and a.archived_at is null
       and (
         (a.scope_type = 'lecture' and a.lecture_id = l.lecture_id) or
         (a.scope_type = 'variant' and a.course_id = l.course_id) or
         (a.scope_type = 'family' and a.family_id = l.family_id)
       )
  ),
  owner_row as (
    select responsibility, user_id, scope_type, source_id
      from owner_candidates
     order by rank
     limit 1
  ),
  collaborator_rows as (
    select a.responsibility, a.user_id, a.scope_type,
           coalesce(a.lecture_id, a.course_id, a.family_id) as source_id
      from public.course_staff_assignments a, lecture l
     where a.responsibility in ('editor', 'reviewer')
       and a.archived_at is null
       and (
         (a.scope_type = 'lecture' and a.lecture_id = l.lecture_id) or
         (a.scope_type = 'variant' and a.course_id = l.course_id) or
         (a.scope_type = 'family' and a.family_id = l.family_id)
       )
  )
  select * from owner_row
  union all
  select * from collaborator_rows;
$$;

revoke all on function public.resolve_course_assignments(uuid) from public, anon, authenticated;
grant execute on function public.resolve_course_assignments(uuid) to authenticated;

create or replace function public.resolve_cw_workflow_policy(p_lecture_id uuid)
returns public.cw_workflow_policies
language sql
stable
set search_path = public, pg_temp
as $$
  with lecture as (
    select cl.id as lecture_id, c.id as course_id, c.family_id as family_id
      from public.course_lectures cl
      join public.courses c on c.id = cl.course_id
     where cl.id = p_lecture_id
  )
  select p.*
    from public.cw_workflow_policies p, lecture l
   where (
     (p.scope_type = 'lecture' and p.lecture_id = l.lecture_id) or
     (p.scope_type = 'variant' and p.course_id = l.course_id) or
     (p.scope_type = 'family' and p.family_id = l.family_id) or
     (p.scope_type = 'organization')
   )
   order by case p.scope_type when 'lecture' then 1 when 'variant' then 2 when 'family' then 3 when 'organization' then 4 end
   limit 1;
$$;

revoke all on function public.resolve_cw_workflow_policy(uuid) from public, anon, authenticated;
grant execute on function public.resolve_cw_workflow_policy(uuid) to authenticated;
