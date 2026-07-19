-- P4H-1：教学运营生命周期与班级责任关系地基。
-- classroom_staff_assignments 表达运营责任；classroom_members 继续只表达真实课堂成员身份。

alter table public.courses
  add column if not exists purpose text not null default 'production'
    check (purpose in ('production','test')),
  add column if not exists trashed_at timestamptz,
  add column if not exists trashed_by uuid references public.profiles(id) on delete set null;

alter table public.courses drop constraint if exists courses_status_check;
alter table public.courses add constraint courses_status_check
  check (status in ('draft','enabled','disabled'));

alter table public.course_lectures
  add column if not exists status text not null default 'active'
    check (status in ('draft','active','archived')),
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null;

alter table public.classrooms
  add column if not exists purpose text not null default 'production'
    check (purpose in ('production','test')),
  add column if not exists operational_status text not null default 'active'
    check (operational_status in ('planning','active','completed')),
  add column if not exists trashed_at timestamptz,
  add column if not exists trashed_by uuid references public.profiles(id) on delete set null;

alter table public.class_sessions
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null,
  add column if not exists cancel_reason text not null default '',
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles(id) on delete set null,
  add column if not exists void_reason text not null default '';

create table if not exists public.classroom_staff_assignments (
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  responsibility text not null
    check (responsibility in ('primary_teacher','assistant_teacher','learning_support')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (classroom_id,user_id,responsibility)
);

create index if not exists classroom_staff_assignments_user_responsibility_classroom_idx
  on public.classroom_staff_assignments (user_id,responsibility,classroom_id);

create unique index if not exists classroom_staff_assignments_one_primary_teacher_idx
  on public.classroom_staff_assignments (classroom_id)
  where responsibility = 'primary_teacher';

-- 已归档班级视为已结班；其他既有班级保留新增列的 active 默认值。
update public.classrooms
   set operational_status = 'completed'
 where archived_at is not null;

-- 新列默认值已原位回填全部既有讲次；显式更新用于保证历史库也收敛到 active。
update public.course_lectures
   set status = 'active'
 where status is null;

-- 只回填真实 staff/admin 的教学关系，不猜测 learning_support。
insert into public.classroom_staff_assignments (classroom_id,user_id,responsibility,created_by)
select c.id,c.owner_id,'primary_teacher',c.owner_id
  from public.classrooms c
  join public.profiles p on p.id = c.owner_id
 where p.role in ('staff','admin')
on conflict (classroom_id,user_id,responsibility) do nothing;

insert into public.classroom_staff_assignments (classroom_id,user_id,responsibility,created_by)
select m.classroom_id,m.user_id,'assistant_teacher',c.owner_id
  from public.classroom_members m
  join public.classrooms c on c.id = m.classroom_id
  join public.profiles p on p.id = m.user_id
 where m.role = 'teacher'
   and m.user_id is distinct from c.owner_id
   and p.role in ('staff','admin')
on conflict (classroom_id,user_id,responsibility) do nothing;

comment on table public.classroom_staff_assignments is
  'P4H 运营责任关系；与 classroom_members 的真实课堂成员/直播权限语义严格分离。';
comment on column public.classroom_staff_assignments.responsibility is
  'primary_teacher 与 assistant_teacher 对应真实教学责任；learning_support 不写入 classroom_members。';

alter table public.classroom_staff_assignments enable row level security;

drop policy if exists "classroom_staff_assignments_select_scope" on public.classroom_staff_assignments;
create policy "classroom_staff_assignments_select_scope" on public.classroom_staff_assignments
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_admin((select auth.uid()))
    or public.has_perm((select auth.uid()), 'class.view.all')
  );

drop policy if exists "classroom_staff_assignments_insert_manage" on public.classroom_staff_assignments;
create policy "classroom_staff_assignments_insert_manage" on public.classroom_staff_assignments
  for insert to authenticated
  with check (
    public.has_perm((select auth.uid()), 'class.manage')
    and public.can_manage_classroom(classroom_id, (select auth.uid()))
  );

drop policy if exists "classroom_staff_assignments_update_manage" on public.classroom_staff_assignments;
create policy "classroom_staff_assignments_update_manage" on public.classroom_staff_assignments
  for update to authenticated
  using (
    public.has_perm((select auth.uid()), 'class.manage')
    and public.can_manage_classroom(classroom_id, (select auth.uid()))
  )
  with check (
    public.has_perm((select auth.uid()), 'class.manage')
    and public.can_manage_classroom(classroom_id, (select auth.uid()))
  );

drop policy if exists "classroom_staff_assignments_delete_manage" on public.classroom_staff_assignments;
create policy "classroom_staff_assignments_delete_manage" on public.classroom_staff_assignments
  for delete to authenticated
  using (
    public.has_perm((select auth.uid()), 'class.manage')
    and public.can_manage_classroom(classroom_id, (select auth.uid()))
  );

revoke all on table public.classroom_staff_assignments from anon,authenticated;
grant select,insert,update,delete on table public.classroom_staff_assignments to authenticated;

create or replace function public.is_classroom_staff_assigned(
  cid uuid,
  uid uuid,
  required_responsibility text default null
)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.classroom_staff_assignments assignment
     where assignment.classroom_id = cid
       and assignment.user_id = uid
       and (required_responsibility is null or assignment.responsibility = required_responsibility)
  );
$$;

revoke all on function public.is_classroom_staff_assigned(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.is_classroom_staff_assigned(uuid,uuid,text) to authenticated;

-- assignment 仅扩大后台班级/课次摘要的读取范围，不授予课堂事件、Realtime 或 Storage 访问权。
drop policy if exists "classrooms_select_assignment_scope" on public.classrooms;
create policy "classrooms_select_assignment_scope" on public.classrooms
  for select to authenticated
  using (public.is_classroom_staff_assigned(id, (select auth.uid())));

drop policy if exists "sessions_select_assignment_scope" on public.class_sessions;
create policy "sessions_select_assignment_scope" on public.class_sessions
  for select to authenticated
  using (public.is_classroom_staff_assigned(classroom_id, (select auth.uid())));

grant select (purpose,operational_status,trashed_at,trashed_by) on public.classrooms to authenticated;

-- P4H-0 的数据安全止血在后续 migration 中继续保持，RLS delete policy 不等于表级 delete grant。
revoke delete on table public.courses,public.course_lectures,public.classrooms,public.class_sessions from authenticated;

-- P4H 新增权限键；岗位视角仍由权限键 × 对象责任 × 当前状态推导。
create or replace function public.school_permission_keys()
returns text[]
language sql
immutable
as $$
  select array[
    'student.view.all','student.view.assigned','student.edit','student.create','student.assign','student.import','student.delete',
    'followup.view','followup.write','activity.manage','activity.register','review.write','video.review',
    'course.view','course.manage','courseware.template.edit','courseware.overlay.edit',
    'courseware.page.edit','courseware.asset.manage','courseware.release.publish',
    'class.view.all','class.view.mine','class.create','class.manage','enrollment.manage',
    'schedule.view.all','schedule.manage','attendance.mark','grading.write','report.view.all','session.void',
    'finance.order.view','finance.order.create','finance.payment.record','finance.refund.request','finance.refund.approve',
    'finance.coupon.manage','finance.scholarship.grant','finance.account.adjust','finance.report.view',
    'staff.manage','permission.configure','audit.view','testdata.purge'
  ]::text[];
$$;

insert into public.role_permissions (role_id,perm_key)
select r.id,p.perm_key
  from public.staff_roles r
 cross join (values ('schedule.manage'),('session.void')) as p(perm_key)
 where r.key = 'principal'
on conflict do nothing;
