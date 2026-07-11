-- P4D-0（docs/plan/12 §3.1/§4.2/§4.3）：学生域 CRUD、批量导入与软删回收。

alter table public.students
  add column if not exists region text not null default '',
  add column if not exists deleted_at timestamptz;

create index if not exists students_region_idx
  on public.students (region) where deleted_at is null;

grant update (region, source) on public.students to authenticated;

-- P4D 六个新权限键一次落全，后续活动/课评/视频任务可直接复用。
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
    'student.import',
    'student.delete',
    'followup.view',
    'followup.write',
    'activity.manage',
    'activity.register',
    'review.write',
    'video.review',
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

with perms(role_key, perm_key) as (
  values
    ('principal', 'activity.manage'),
    ('principal', 'activity.register'),
    ('principal', 'review.write'),
    ('principal', 'video.review'),
    ('principal', 'student.import'),
    ('principal', 'student.delete'),
    ('director', 'activity.manage'),
    ('director', 'activity.register'),
    ('director', 'review.write'),
    ('director', 'video.review'),
    ('director', 'student.import'),
    ('registrar', 'activity.manage'),
    ('registrar', 'activity.register'),
    ('registrar', 'student.import'),
    ('registrar', 'student.delete'),
    ('teacher', 'review.write'),
    ('teacher', 'video.review'),
    ('sales', 'activity.register'),
    ('sales', 'student.import')
)
insert into public.role_permissions (role_id, perm_key)
select r.id, p.perm_key
  from perms p
  join public.staff_roles r on r.key = p.role_key
on conflict do nothing;

-- create_student 扩参。改签名必须先 drop；所有清洗仍在服务端做最后一道兜底。
drop function if exists public.create_student(text, smallint, text, text, text);
drop function if exists public.create_student(text, smallint, text, text, text, text, text, text);

create function public.create_student(
  p_name text,
  p_grade smallint default null,
  p_phone text default '',
  p_region text default '',
  p_source text default '',
  p_parent_name text default '',
  p_parent_phone text default '',
  p_remark text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  clean_name text := left(trim(coalesce(p_name, '')), 100);
begin
  if uid is null or not public.has_perm(uid, 'student.create') then
    raise exception 'FORBIDDEN';
  end if;
  if clean_name = '' then
    raise exception 'EMPTY_NAME';
  end if;
  if p_grade is not null and (p_grade < 1 or p_grade > 12) then
    raise exception 'INVALID_GRADE';
  end if;
  insert into public.students (
    name, grade, phone, region, source, parent_name, parent_phone, remark,
    assigned_to, created_by, bind_code
  )
  values (
    clean_name, p_grade, left(trim(coalesce(p_phone, '')), 40),
    left(trim(coalesce(p_region, '')), 100), left(trim(coalesce(p_source, '')), 100),
    left(trim(coalesce(p_parent_name, '')), 100), left(trim(coalesce(p_parent_phone, '')), 40),
    left(trim(coalesce(p_remark, '')), 2000), uid, uid, public.generate_student_bind_code()
  )
  returning id into sid;
  return sid;
end;
$$;

revoke all on function public.create_student(text, smallint, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_student(text, smallint, text, text, text, text, text, text) to authenticated;

create or replace function public.import_students(p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  item jsonb;
  row_no int;
  inserted_count int := 0;
  dup_count int := 0;
  errors jsonb := '[]'::jsonb;
  clean_name text;
  clean_phone text;
  grade_text text;
  grade_value smallint;
begin
  if uid is null or not public.has_perm(uid, 'student.import') then
    raise exception 'FORBIDDEN';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'INVALID_ROWS';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'TOO_MANY_ROWS';
  end if;

  for item, row_no in
    select value, ordinality::int
      from jsonb_array_elements(p_rows) with ordinality
  loop
    clean_name := left(trim(coalesce(item->>'name', '')), 100);
    clean_phone := left(trim(coalesce(item->>'phone', '')), 40);
    grade_text := trim(coalesce(item->>'grade', ''));
    grade_value := null;

    if clean_name = '' then
      errors := errors || jsonb_build_array(jsonb_build_object('row', row_no, 'reason', 'EMPTY_NAME'));
      continue;
    end if;
    if grade_text <> '' then
      if grade_text !~ '^[0-9]{1,2}$' or grade_text::int < 1 or grade_text::int > 12 then
        errors := errors || jsonb_build_array(jsonb_build_object('row', row_no, 'reason', 'INVALID_GRADE'));
        continue;
      end if;
      grade_value := grade_text::smallint;
    end if;
    if clean_phone <> '' and exists (
      select 1 from public.students s
       where s.phone = clean_phone and s.deleted_at is null
    ) then
      dup_count := dup_count + 1;
      continue;
    end if;

    insert into public.students (
      name, phone, grade, region, source, remark, status,
      assigned_to, created_by, bind_code
    ) values (
      clean_name, clean_phone, grade_value,
      left(trim(coalesce(item->>'region', '')), 100),
      left(trim(coalesce(item->>'source', '')), 100),
      left(trim(coalesce(item->>'remark', '')), 2000),
      'lead', uid, uid, public.generate_student_bind_code()
    );
    inserted_count := inserted_count + 1;
  end loop;

  return jsonb_build_object('inserted', inserted_count, 'dup', dup_count, 'errors', errors);
end;
$$;

revoke all on function public.import_students(jsonb) from public, anon, authenticated;
grant execute on function public.import_students(jsonb) to authenticated;

create or replace function public.soft_delete_student(p_student_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.has_perm(uid, 'student.delete') then
    raise exception 'FORBIDDEN';
  end if;
  if not public.can_access_student(p_student_id, uid) then
    raise exception 'FORBIDDEN_SCOPE';
  end if;
  if exists (
    select 1 from public.enrollments e
     where e.student_id = p_student_id and e.status = 'active'
  ) then
    raise exception 'ACTIVE_ENROLLMENT';
  end if;
  update public.students set deleted_at = now()
   where id = p_student_id and deleted_at is null;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
end;
$$;

create or replace function public.restore_student(p_student_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.has_perm(uid, 'student.delete') then
    raise exception 'FORBIDDEN';
  end if;
  if not public.can_access_student(p_student_id, uid) then
    raise exception 'FORBIDDEN_SCOPE';
  end if;
  update public.students set deleted_at = null
   where id = p_student_id and deleted_at is not null;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
end;
$$;

revoke all on function public.soft_delete_student(uuid) from public, anon, authenticated;
revoke all on function public.restore_student(uuid) from public, anon, authenticated;
grant execute on function public.soft_delete_student(uuid) to authenticated;
grant execute on function public.restore_student(uuid) to authenticated;

-- 分派必须同时满足调用者作用域和目标人确有 followup.write，避免绕过 UI 塞任意员工。
create or replace function public.assign_student(p_student_id uuid, p_staff_user_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.has_perm(uid, 'student.assign') then
    raise exception 'FORBIDDEN';
  end if;
  if not public.can_access_student(p_student_id, uid) then
    raise exception 'FORBIDDEN_SCOPE';
  end if;
  if not public.is_staff(p_staff_user_id) or not public.has_perm(p_staff_user_id, 'followup.write') then
    raise exception 'TARGET_CANNOT_FOLLOW_UP';
  end if;
  update public.students set assigned_to = p_staff_user_id
   where id = p_student_id and deleted_at is null;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
end;
$$;

create or replace function public.change_student_status(p_student_id uuid, p_status text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.has_perm(uid, 'student.edit') then
    raise exception 'FORBIDDEN';
  end if;
  if p_status not in ('lead', 'trialing', 'enrolled', 'paused', 'alumni', 'invalid') then
    raise exception 'INVALID_STATUS';
  end if;
  update public.students set status = p_status
   where id = p_student_id and deleted_at is null and public.can_access_student(id, uid);
  if not found then
    raise exception 'NOT_FOUND';
  end if;
end;
$$;

-- list_staff_members 兼容员工页与分派下拉：staff.manage 看全员；student.assign 只见可跟进员工。
drop function if exists public.list_staff_members();
create function public.list_staff_members()
returns table (
  user_id uuid,
  display_name text,
  email text,
  identity text,
  role_ids uuid[],
  role_names text[],
  can_follow_up boolean
)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select p.id,
         p.display_name,
         u.email::text,
         p.role,
         coalesce(r.role_ids, '{}'::uuid[]),
         coalesce(r.role_names, '{}'::text[]),
         public.has_perm(p.id, 'followup.write')
    from public.profiles p
    join auth.users u on u.id = p.id
    left join lateral (
      select array_agg(sr.id order by sr.created_at) as role_ids,
             array_agg(sr.name order by sr.created_at) as role_names
        from public.staff_role_members m
        join public.staff_roles sr on sr.id = m.role_id
       where m.user_id = p.id
    ) r on true
   where p.role in ('staff', 'admin')
     and (
       public.has_perm(auth.uid(), 'staff.manage')
       or (
         public.has_perm(auth.uid(), 'student.assign')
         and public.has_perm(p.id, 'followup.write')
       )
     )
   order by p.role desc, p.display_name;
$$;

revoke all on function public.list_staff_members() from public, anon, authenticated;
grant execute on function public.list_staff_members() to authenticated;

-- 已删学生不能再绑定顾客账号。
create or replace function public.claim_student_account(p_code text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  update public.students set user_id = uid
   where bind_code = lower(trim(p_code)) and user_id is null and deleted_at is null
  returning id into sid;
  if sid is null then raise exception 'INVALID_BIND_CODE'; end if;
  return sid;
end;
$$;

create or replace function public.bind_guardian(p_code text, p_relation text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select id into sid from public.students
   where bind_code = lower(trim(p_code)) and deleted_at is null;
  if sid is null then raise exception 'INVALID_BIND_CODE'; end if;
  insert into public.student_guardians (student_id, guardian_id, relation)
  values (sid, uid, coalesce(trim(p_relation), ''))
  on conflict (student_id, guardian_id) do update set relation = excluded.relation;
  perform set_config('app.allow_profile_role_update', '1', true);
  update public.profiles set role = 'parent' where id = uid and role = 'student';
  return sid;
end;
$$;

drop function if exists public.get_my_students();
create function public.get_my_students()
returns table(id uuid, name text, grade smallint, status text)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select s.id, s.name, s.grade, s.status
    from public.students s
   where s.user_id = auth.uid() and s.deleted_at is null
  union
  select s.id, s.name, s.grade, s.status
    from public.students s
    join public.student_guardians g on g.student_id = s.id
   where g.guardian_id = auth.uid() and s.deleted_at is null;
$$;
revoke all on function public.get_my_students() from public, anon, authenticated;
grant execute on function public.get_my_students() to authenticated;

-- P4C-7 后的十列版本：只改 my_students CTE 的存活过滤。
drop function if exists public.get_my_learning_summary();
create function public.get_my_learning_summary()
returns table (
  student_id uuid,
  student_name text,
  grade smallint,
  next_session_at timestamptz,
  attendance_rate_30d numeric,
  recent_submissions jsonb,
  star_total int,
  payment_status text,
  week_session_count int,
  pending_assignment_count int
)
language sql security definer stable
set search_path = public, pg_temp
as $$
  with my_students as (
    select s.id, s.name, s.grade, s.user_id
      from public.students s
     where s.user_id = auth.uid() and s.deleted_at is null
    union
    select s.id, s.name, s.grade, s.user_id
      from public.students s
      join public.student_guardians g on g.student_id = s.id
     where g.guardian_id = auth.uid() and s.deleted_at is null
  )
  select
    ms.id,
    ms.name,
    ms.grade,
    (
      select min(cs.scheduled_at)
        from public.class_sessions cs
        join public.enrollments e on e.classroom_id = cs.classroom_id and e.status = 'active'
       where e.student_id = ms.id and cs.scheduled_at >= now() and cs.deleted_at is null
    ),
    (
      select case when count(*) = 0 then null
             else round(100.0 * count(*) filter (where sa.status = 'present') / count(*), 1)
             end
        from public.session_attendance sa
        join public.class_sessions cs on cs.id = sa.session_id
       where sa.student_id = ms.id
         and cs.scheduled_at >= now() - interval '30 days'
         and cs.scheduled_at < now()
    ),
    (
      select coalesce(jsonb_agg(jsonb_build_object('title', row.title, 'score', row.score, 'gradedAt', row.graded_at) order by row.rank), '[]'::jsonb)
        from (
          select a.title, sub.score, sub.graded_at,
                 row_number() over (order by coalesce(sub.graded_at, sub.submitted_at) desc) as rank
            from public.submissions sub
            join public.assignments a on a.id = sub.assignment_id
           where ms.user_id is not null and sub.user_id = ms.user_id
        ) row
       where row.rank <= 5
    ),
    (
      select greatest(0, coalesce(sum(case when ev.type = 'star' then 1 else -1 end), 0))::int
        from public.session_events ev
       where ms.user_id is not null
         and ev.payload->>'studentId' = ms.user_id::text
         and ev.type in ('star', 'star_undo')
    ),
    (
      select case
               when exists (select 1 from public.orders o where o.student_id = ms.id and o.status in ('unpaid', 'partial')) then 'overdue'
               when exists (select 1 from public.orders o where o.student_id = ms.id) then 'ok'
               else 'none'
             end
    ),
    (
      select count(*)::int
        from public.class_sessions cs
        join public.enrollments e on e.classroom_id = cs.classroom_id and e.status = 'active'
       where e.student_id = ms.id and cs.deleted_at is null
         and cs.scheduled_at >= now() and cs.scheduled_at < now() + interval '7 days'
    ),
    (
      select case when ms.user_id is null then null else (
        select count(*)::int
          from public.assignments a
          join public.classroom_members cm
            on cm.classroom_id = a.classroom_id and cm.user_id = ms.user_id and cm.role = 'student'
         where (a.due_at is null or a.due_at >= now())
           and not exists (
             select 1 from public.submissions sub
              where sub.assignment_id = a.id and sub.user_id = ms.user_id and sub.submitted_at is not null
           )
      ) end
    )
  from my_students ms;
$$;
revoke all on function public.get_my_learning_summary() from public, anon, authenticated;
grant execute on function public.get_my_learning_summary() to authenticated;

-- 其余顾客白名单同样屏蔽已删学生。
create or replace function public.get_my_schedule(p_from timestamptz, p_to timestamptz)
returns table (
  session_id uuid, classroom_name text, lecture_name text, scheduled_at timestamptz,
  duration_min smallint, teacher_name text, student_name text, classroom_id uuid
)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select cs.id, c.name, cs.title, cs.scheduled_at, cs.duration_min,
         coalesce((select p.display_name from public.classroom_members cm
                    join public.profiles p on p.id = cm.user_id
                   where cm.classroom_id = c.id and cm.role = 'teacher' limit 1), ''),
         s.name, c.id
    from public.class_sessions cs
    join public.classrooms c on c.id = cs.classroom_id
    join public.enrollments e on e.classroom_id = c.id and e.status = 'active'
    join public.students s on s.id = e.student_id
   where (s.user_id = auth.uid() or exists (
           select 1 from public.student_guardians g where g.student_id = s.id and g.guardian_id = auth.uid()
         ))
     and s.deleted_at is null and cs.deleted_at is null
     and cs.scheduled_at is not null and cs.scheduled_at >= p_from and cs.scheduled_at < p_to
   order by cs.scheduled_at;
$$;

create or replace function public.get_my_attendance(p_from timestamptz, p_to timestamptz)
returns table (
  session_id uuid, student_name text, classroom_name text, lecture_name text,
  scheduled_at timestamptz, status text, note text
)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select cs.id, s.name, c.name, cs.title, cs.scheduled_at, sa.status, sa.note
    from public.session_attendance sa
    join public.class_sessions cs on cs.id = sa.session_id
    join public.classrooms c on c.id = cs.classroom_id
    join public.students s on s.id = sa.student_id
   where (s.user_id = auth.uid() or exists (
           select 1 from public.student_guardians g where g.student_id = s.id and g.guardian_id = auth.uid()
         ))
     and s.deleted_at is null and cs.deleted_at is null
     and cs.scheduled_at is not null and cs.scheduled_at >= p_from and cs.scheduled_at < p_to
   order by cs.scheduled_at desc;
$$;

create or replace function public.get_my_orders()
returns table (
  order_id uuid, order_no text, classroom_name text, kind text,
  amount_original numeric, amount_discount numeric, amount_due numeric, status text,
  created_at timestamptz, paid_total numeric, items jsonb
)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select o.id, o.order_no, c.name, o.kind, o.amount_original, o.amount_discount, o.amount_due, o.status, o.created_at,
    coalesce((select sum(p.amount) from public.payments p where p.order_id = o.id), 0),
    coalesce((select jsonb_agg(jsonb_build_object('name', oi.name, 'unitPrice', oi.unit_price, 'qty', oi.qty) order by oi.name)
                from public.order_items oi where oi.order_id = o.id), '[]'::jsonb)
    from public.orders o
    left join public.classrooms c on c.id = o.classroom_id
    join public.students s on s.id = o.student_id
   where s.deleted_at is null and (
     s.user_id = auth.uid() or exists (
       select 1 from public.student_guardians g where g.student_id = s.id and g.guardian_id = auth.uid()
     )
   )
   order by o.created_at desc;
$$;

create or replace function public.get_my_account()
returns table (student_id uuid, student_name text, balance numeric, ledger jsonb)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select s.id, s.name, coalesce(sa.balance, 0),
    coalesce((select jsonb_agg(jsonb_build_object('delta', al.delta, 'reason', al.reason, 'createdAt', al.created_at) order by al.created_at desc)
                from (select * from public.account_ledger where student_id = s.id order by created_at desc limit 50) al), '[]'::jsonb)
    from public.students s
    left join public.student_accounts sa on sa.student_id = s.id
   where s.deleted_at is null and (
     s.user_id = auth.uid() or exists (
       select 1 from public.student_guardians g where g.student_id = s.id and g.guardian_id = auth.uid()
     )
   );
$$;
