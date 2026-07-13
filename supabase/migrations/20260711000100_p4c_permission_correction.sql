-- P4C-1 权限矫正（docs/plan/11 §4）
-- 1) 新权限键 enrollment.manage（报名/转班/退班从 class.manage 拆出）
-- 2) 三个报名 RPC 的动作闸改判 enrollment.manage（作用域仍走 can_manage_classroom）
-- 3) 岗位画像修订：教师收缩、学辅收缩、主管/校长补 enrollment.manage、
--    新增内置「教务 registrar」角色、教研补 schedule.view.all
--
-- 说明：class_sessions 的 update/delete/insert RLS 已经 gate 在 can_manage_classroom
-- （内部要求 class.manage），教师失去 class.manage 后自动失去课次写权，无需另改策略。

-- ----------------------------------------------------------------------------
-- 1) school_permission_keys() 加键（必须与 TS PERMISSION_KEYS 同步）
-- ----------------------------------------------------------------------------
create or replace function public.school_permission_keys()
returns text[]
language sql
immutable
as $$
  select array[
    'student.view.all',
    'student.view.assigned',
    'student.edit',
    'student.create',
    'student.assign',
    'followup.view',
    'followup.write',
    'course.view',
    'course.manage',
    'courseware.template.edit',
    'courseware.overlay.edit',
    'class.view.all',
    'class.view.mine',
    'class.create',
    'class.manage',
    'enrollment.manage',
    'schedule.view.all',
    'attendance.mark',
    'grading.write',
    'report.view.all',
    'finance.order.view',
    'finance.order.create',
    'finance.payment.record',
    'finance.refund.request',
    'finance.refund.approve',
    'finance.coupon.manage',
    'finance.scholarship.grant',
    'finance.account.adjust',
    'finance.report.view',
    'staff.manage',
    'permission.configure'
  ]::text[];
$$;

-- ----------------------------------------------------------------------------
-- 2) 报名 / 转班 / 退班 RPC：动作闸 class.manage → enrollment.manage
--    （作用域检查 can_manage_classroom 不变；三函数其余逻辑逐字保留）
-- ----------------------------------------------------------------------------
create or replace function public.enroll_student(p_classroom_id uuid, p_student_id uuid, p_remark text default '')
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  eid uuid;
  cap smallint;
  active_count int;
  cur_status text;
begin
  if uid is null or not public.has_perm(uid, 'enrollment.manage') then
    raise exception 'FORBIDDEN';
  end if;
  if not public.can_manage_classroom(p_classroom_id, uid) then
    raise exception 'FORBIDDEN_SCOPE';
  end if;

  select capacity into cap from public.classrooms where id = p_classroom_id;
  if cap is not null then
    select count(*) into active_count from public.enrollments
     where classroom_id = p_classroom_id and status = 'active';
    if active_count >= cap then
      raise exception 'CLASS_FULL';
    end if;
  end if;

  begin
    insert into public.enrollments (classroom_id, student_id, remark, operated_by)
    values (p_classroom_id, p_student_id, coalesce(p_remark, ''), uid)
    returning id into eid;
  exception when unique_violation then
    raise exception 'ALREADY_ENROLLED';
  end;

  select status into cur_status from public.students where id = p_student_id;
  if cur_status in ('lead', 'trialing') then
    update public.students set status = 'enrolled' where id = p_student_id;
  end if;

  return eid;
end;
$$;

create or replace function public.transfer_student(
  p_student_id uuid,
  p_from_classroom uuid,
  p_to_classroom uuid,
  p_remark text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
  cap smallint;
  active_count int;
begin
  if uid is null or not public.has_perm(uid, 'enrollment.manage') then
    raise exception 'FORBIDDEN';
  end if;
  if not (public.can_manage_classroom(p_from_classroom, uid) and public.can_manage_classroom(p_to_classroom, uid)) then
    raise exception 'FORBIDDEN_SCOPE';
  end if;

  select capacity into cap from public.classrooms where id = p_to_classroom;
  if cap is not null then
    select count(*) into active_count from public.enrollments
     where classroom_id = p_to_classroom and status = 'active';
    if active_count >= cap then
      raise exception 'CLASS_FULL';
    end if;
  end if;

  update public.enrollments
     set status = 'transferred_out', left_at = now(), remark = coalesce(p_remark, remark), operated_by = uid
   where classroom_id = p_from_classroom and student_id = p_student_id and status = 'active';
  if not found then
    raise exception 'NOT_ENROLLED';
  end if;

  insert into public.enrollments (classroom_id, student_id, remark, operated_by)
  values (p_to_classroom, p_student_id, coalesce(p_remark, ''), uid)
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function public.withdraw_student(p_enrollment_id uuid, p_remark text default '')
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  cid uuid;
begin
  if uid is null or not public.has_perm(uid, 'enrollment.manage') then
    raise exception 'FORBIDDEN';
  end if;
  select classroom_id into cid from public.enrollments where id = p_enrollment_id and status = 'active';
  if cid is null then
    raise exception 'NOT_ACTIVE';
  end if;
  if not public.can_manage_classroom(cid, uid) then
    raise exception 'FORBIDDEN_SCOPE';
  end if;
  update public.enrollments
     set status = 'withdrawn', left_at = now(), remark = coalesce(p_remark, remark), operated_by = uid
   where id = p_enrollment_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) 岗位画像修订（直接改现网 staff_roles / role_permissions 数据）
-- ----------------------------------------------------------------------------

-- 新增内置「教务 registrar」角色
insert into public.staff_roles (key, name, is_system)
values ('registrar', '教务', true)
on conflict (key) do update set name = excluded.name, is_system = excluded.is_system;

-- 教师收缩：去 class.create / class.manage（不能建班、删改课次、动花名册）
delete from public.role_permissions
 where role_id = (select id from public.staff_roles where key = 'teacher')
   and perm_key in ('class.create', 'class.manage');

-- 学辅收缩：去 finance.order.view（orders RLS 回落到自己经手/名下）
delete from public.role_permissions
 where role_id = (select id from public.staff_roles where key = 'sales')
   and perm_key = 'finance.order.view';

-- 主管 / 校长：补 enrollment.manage；教研：补 schedule.view.all；教务：整套画像
with perms(role_key, perm_key) as (
  values
    ('director', 'enrollment.manage'),
    ('principal', 'enrollment.manage'),
    ('research', 'schedule.view.all'),
    ('registrar', 'class.view.all'),
    ('registrar', 'class.create'),
    ('registrar', 'class.manage'),
    ('registrar', 'enrollment.manage'),
    ('registrar', 'schedule.view.all'),
    ('registrar', 'student.view.all'),
    ('registrar', 'student.edit'),
    ('registrar', 'student.assign'),
    ('registrar', 'course.view'),
    ('registrar', 'attendance.mark')
)
insert into public.role_permissions (role_id, perm_key)
select r.id, p.perm_key
  from perms p
  join public.staff_roles r on r.key = p.role_key
on conflict do nothing;
