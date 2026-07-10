-- ============================================================================
-- P4B-6 财务模块（docs/plan/10-school-backend.md §5.6）
-- 账目一律 append-only + 状态机，绝不原地改金额；金额一律服务端算；
-- orders.status / student_accounts.balance 由触发器按流水全量求和重算，
-- 不做增量写回（同 P4 星星撤销、P4B-5 考勤触发器的教训）。
-- ============================================================================

create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  order_no         text unique not null,
  student_id       uuid not null references public.students (id),
  classroom_id     uuid references public.classrooms (id),
  kind             text not null default 'enroll' check (kind in ('enroll', 'makeup', 'deposit')),
  amount_original  numeric(12, 2) not null default 0,
  amount_discount  numeric(12, 2) not null default 0,
  amount_due       numeric(12, 2) not null default 0,
  status           text not null default 'unpaid'
    check (status in ('unpaid', 'partial', 'paid', 'refunding', 'refunded', 'void')),
  remark           text not null default '',
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  name        text not null,
  category    text not null default 'course' check (category in ('course', 'material', 'other')),
  unit_price  numeric(12, 2) not null default 0,
  qty         smallint not null default 1,
  refundable  boolean not null default true
);

create table public.payments (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id),
  amount      numeric(12, 2) not null check (amount > 0),
  method      text not null check (method in ('cash', 'scan', 'transfer', 'account')),
  paid_at     timestamptz not null default now(),
  operator_id uuid references public.profiles (id) on delete set null,
  remark      text not null default ''
);

create table public.refunds (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id),
  amount        numeric(12, 2) not null check (amount > 0),
  reason        text not null default '',
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'done')),
  requested_by  uuid references public.profiles (id) on delete set null,
  requested_at  timestamptz not null default now(),
  approved_by   uuid references public.profiles (id) on delete set null,
  approved_at   timestamptz
);

create table public.coupons (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  name        text not null,
  kind        text not null check (kind in ('amount', 'percent')),
  value       numeric(12, 2) not null check (value > 0),
  scope       jsonb not null default '{}',
  valid_from  timestamptz,
  valid_to    timestamptz,
  status      text not null default 'enabled' check (status in ('enabled', 'disabled')),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table public.coupon_grants (
  id          uuid primary key default gen_random_uuid(),
  coupon_id   uuid references public.coupons (id),
  student_id  uuid references public.students (id),
  order_id    uuid references public.orders (id),
  status      text not null default 'granted' check (status in ('granted', 'used', 'expired', 'revoked')),
  granted_by  uuid references public.profiles (id) on delete set null,
  granted_at  timestamptz not null default now(),
  used_at     timestamptz
);

create table public.scholarships (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students (id),
  amount      numeric(12, 2) not null check (amount > 0),
  kind        text not null default 'discount' check (kind in ('discount', 'deposit')),
  reason      text not null default '',
  order_id    uuid references public.orders (id),
  granted_by  uuid references public.profiles (id) on delete set null,
  granted_at  timestamptz not null default now()
);

create table public.student_accounts (
  student_id  uuid primary key references public.students (id) on delete cascade,
  balance     numeric(12, 2) not null default 0,
  updated_at  timestamptz not null default now()
);

create table public.account_ledger (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.students (id),
  delta        numeric(12, 2) not null check (delta <> 0),
  reason       text not null,
  ref_order    uuid references public.orders (id),
  operator_id  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index orders_student_idx on public.orders (student_id);
create index orders_classroom_idx on public.orders (classroom_id);
create index orders_status_idx on public.orders (status);
create index order_items_order_idx on public.order_items (order_id);
create index payments_order_idx on public.payments (order_id);
create index refunds_order_idx on public.refunds (order_id);
create index refunds_status_idx on public.refunds (status);
create index coupon_grants_student_idx on public.coupon_grants (student_id);
create index coupon_grants_coupon_idx on public.coupon_grants (coupon_id);
create index scholarships_student_idx on public.scholarships (student_id);
create index account_ledger_student_idx on public.account_ledger (student_id, created_at desc);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 派生量重算：orders.status / student_accounts.balance 一律按流水全量求和，
-- 幂等、不增量写回；由 payments/refunds/account_ledger 变动后的触发器调用。
-- ----------------------------------------------------------------------------

create function public.recompute_order_status(p_order_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_due            numeric(12, 2);
  v_paid_total     numeric(12, 2);
  v_refunded_total numeric(12, 2);
  v_net_paid       numeric(12, 2);
  v_has_pending    boolean;
  v_new_status     text;
begin
  select amount_due into v_due from public.orders where id = p_order_id;
  if not found then
    return;
  end if;

  select coalesce(sum(amount), 0) into v_paid_total from public.payments where order_id = p_order_id;
  select coalesce(sum(amount), 0) into v_refunded_total from public.refunds where order_id = p_order_id and status = 'done';
  select exists (select 1 from public.refunds where order_id = p_order_id and status = 'pending') into v_has_pending;
  v_net_paid := v_paid_total - v_refunded_total;

  v_new_status := case
    when v_has_pending then 'refunding'
    when v_refunded_total > 0 and v_net_paid <= 0 then 'refunded'
    when v_due <= 0 and v_paid_total = 0 then 'paid'
    when v_net_paid >= v_due and v_due > 0 then 'paid'
    when v_net_paid > 0 then 'partial'
    else 'unpaid'
  end;

  update public.orders set status = v_new_status where id = p_order_id and status is distinct from v_new_status;
end;
$$;

create function public.recompute_student_balance(p_student_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_balance numeric(12, 2);
begin
  select coalesce(sum(delta), 0) into v_balance from public.account_ledger where student_id = p_student_id;
  insert into public.student_accounts (student_id, balance, updated_at)
  values (p_student_id, v_balance, now())
  on conflict (student_id) do update set balance = excluded.balance, updated_at = excluded.updated_at;
end;
$$;

create function public.payments_recompute_order()
returns trigger
language plpgsql
as $$
begin
  perform public.recompute_order_status(new.order_id);
  return new;
end;
$$;

create trigger payments_after_insert
  after insert on public.payments
  for each row execute function public.payments_recompute_order();

create function public.refunds_recompute_order()
returns trigger
language plpgsql
as $$
begin
  perform public.recompute_order_status(new.order_id);
  return new;
end;
$$;

create trigger refunds_after_change
  after insert or update on public.refunds
  for each row execute function public.refunds_recompute_order();

create function public.ledger_recompute_balance()
returns trigger
language plpgsql
as $$
begin
  perform public.recompute_student_balance(new.student_id);
  return new;
end;
$$;

create trigger ledger_after_insert
  after insert on public.account_ledger
  for each row execute function public.ledger_recompute_balance();

-- recompute_order_status/recompute_student_balance 本身无权限判断（只按既有流水重算，
-- 幂等、不可伪造金额），但仍按最小授权显式锁掉直接调用（default privileges 会自动
-- 直接 grant execute 给 anon/authenticated，只 revoke from public 锁不住，见下方说明）。
revoke all on function public.recompute_order_status(uuid) from public, anon, authenticated;
revoke all on function public.recompute_student_balance(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- RLS 辅助函数
-- ----------------------------------------------------------------------------

-- 订单可见范围：finance.order.view 持有者全校；否则仅自己经手(created_by)
-- 或名下学生(students.assigned_to) 的订单——避免代收款后学辅看不到自己学生回款。
create function public.can_view_order(p_order_id uuid, uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select public.is_admin(uid)
    or public.staff_has_perm(uid, 'finance.order.view')
    or exists (select 1 from public.orders o where o.id = p_order_id and o.created_by = uid)
    or exists (
      select 1 from public.orders o
        join public.students s on s.id = o.student_id
       where o.id = p_order_id and s.assigned_to = uid
    );
$$;

-- 学生财务信息（账户/流水/奖学金/券）可见范围：任一财务功能键持有者，或本来就能访问该生档案。
create function public.can_view_finance_student(sid uuid, uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select public.is_admin(uid)
    or public.staff_has_perm(uid, 'finance.order.view')
    or public.staff_has_perm(uid, 'finance.account.adjust')
    or public.staff_has_perm(uid, 'finance.scholarship.grant')
    or public.staff_has_perm(uid, 'finance.coupon.manage')
    or public.can_access_student(sid, uid)
    or exists (select 1 from public.students s where s.id = sid and s.assigned_to = uid);
$$;

revoke all on function public.can_view_order(uuid, uuid) from public;
revoke all on function public.can_view_finance_student(uuid, uuid) from public;
grant execute on function public.can_view_order(uuid, uuid) to authenticated;
grant execute on function public.can_view_finance_student(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 内部专用辅助（无权限校验，仅供本文件下方的 RPC 内部调用，不对外授权）
-- ----------------------------------------------------------------------------

create function public.generate_order_no()
returns text
language plpgsql
as $$
declare
  no text;
begin
  loop
    no := 'ORD' || to_char(now(), 'YYYYMMDD') || upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from public.orders where order_no = no);
  end loop;
  return no;
end;
$$;

-- 优惠券适用范围：scope={} 或缺省 course_ids/grades 视为通用；否则要求命中该班的课程/年级。
create function public.coupon_scope_matches(p_scope jsonb, p_classroom_id uuid)
returns boolean
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  v_course_id uuid;
  v_grade     smallint;
  v_course_ids jsonb;
  v_grades     jsonb;
begin
  if p_scope is null or p_scope = '{}'::jsonb then
    return true;
  end if;
  select course_id, grade into v_course_id, v_grade from public.classrooms where id = p_classroom_id;

  v_course_ids := p_scope -> 'course_ids';
  if v_course_ids is not null and jsonb_array_length(v_course_ids) > 0 then
    if v_course_id is null or not (v_course_ids @> to_jsonb(v_course_id::text)) then
      return false;
    end if;
  end if;

  v_grades := p_scope -> 'grades';
  if v_grades is not null and jsonb_array_length(v_grades) > 0 then
    if v_grade is null or not (v_grades @> to_jsonb(v_grade::int)) then
      return false;
    end if;
  end if;

  return true;
end;
$$;

-- 报名落库核心逻辑（原 enroll_student 的表操作部分抽出，供 place_order 复用）：
-- 不含权限判断，调用方（enroll_student / place_order）各自负责鉴权。
create function public.enroll_student_core(p_classroom_id uuid, p_student_id uuid, p_remark text, p_operator uuid)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  eid uuid;
  cap smallint;
  active_count int;
  cur_status text;
begin
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
    values (p_classroom_id, p_student_id, coalesce(p_remark, ''), p_operator)
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

-- 注意：本库对 public schema 设了 default privileges，新建函数会自动直接
-- grant execute 给 anon/authenticated（不经过 PUBLIC 伪角色），所以内部专用函数
-- 必须显式对 anon/authenticated 也 revoke，只 revoke from public 不够、锁不住。
revoke all on function public.generate_order_no() from public, anon, authenticated;
revoke all on function public.coupon_scope_matches(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.enroll_student_core(uuid, uuid, text, uuid) from public, anon, authenticated;

-- 复用核心逻辑改造既有 enroll_student（P4B-3），行为不变，仅内部结构调整。
create or replace function public.enroll_student(p_classroom_id uuid, p_student_id uuid, p_remark text default '')
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.has_perm(uid, 'class.manage') then
    raise exception 'FORBIDDEN';
  end if;
  if not public.can_manage_classroom(p_classroom_id, uid) then
    raise exception 'FORBIDDEN_SCOPE';
  end if;
  return public.enroll_student_core(p_classroom_id, p_student_id, coalesce(p_remark, ''), uid);
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC：下单 / 收款 / 退费申请 / 退费审批
-- ----------------------------------------------------------------------------

create function public.place_order(
  p_student_id uuid,
  p_classroom_id uuid,
  p_items jsonb,
  p_kind text default 'enroll',
  p_coupon_grant_id uuid default null,
  p_remark text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  v_original numeric(12, 2) := 0;
  v_discount numeric(12, 2) := 0;
  v_due numeric(12, 2);
  v_status text;
  v_order_id uuid;
  v_grant_student uuid;
  v_grant_status text;
  v_coupon_status text;
  v_coupon_kind text;
  v_coupon_value numeric(12, 2);
  v_coupon_scope jsonb;
  v_valid_from timestamptz;
  v_valid_to timestamptz;
  item record;
begin
  if uid is null or not public.has_perm(uid, 'finance.order.create') then
    raise exception 'FORBIDDEN';
  end if;
  if p_kind = 'enroll' and p_classroom_id is null then
    raise exception 'CLASSROOM_REQUIRED';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'ITEMS_REQUIRED';
  end if;

  for item in
    select coalesce(x.name, '') as name, coalesce(x.unit_price, 0) as unit_price, coalesce(x.qty, 1) as qty
      from jsonb_to_recordset(p_items) as x(name text, category text, unit_price numeric, qty smallint, refundable boolean)
  loop
    if trim(item.name) = '' or item.unit_price < 0 or item.qty < 1 then
      raise exception 'INVALID_ITEM';
    end if;
    v_original := v_original + item.unit_price * item.qty;
  end loop;

  if p_coupon_grant_id is not null then
    select cg.student_id, cg.status, c.status, c.kind, c.value, c.scope, c.valid_from, c.valid_to
      into v_grant_student, v_grant_status, v_coupon_status, v_coupon_kind, v_coupon_value, v_coupon_scope, v_valid_from, v_valid_to
      from public.coupon_grants cg
      join public.coupons c on c.id = cg.coupon_id
     where cg.id = p_coupon_grant_id
     for update of cg;
    if not found then
      raise exception 'COUPON_NOT_FOUND';
    end if;
    if v_grant_student <> p_student_id then
      raise exception 'COUPON_NOT_FOR_STUDENT';
    end if;
    if v_grant_status <> 'granted' then
      raise exception 'COUPON_NOT_AVAILABLE';
    end if;
    if v_coupon_status <> 'enabled' then
      raise exception 'COUPON_DISABLED';
    end if;
    if v_valid_from is not null and now() < v_valid_from then
      raise exception 'COUPON_NOT_STARTED';
    end if;
    if v_valid_to is not null and now() > v_valid_to then
      raise exception 'COUPON_EXPIRED';
    end if;
    if p_classroom_id is not null and not public.coupon_scope_matches(v_coupon_scope, p_classroom_id) then
      raise exception 'COUPON_SCOPE_MISMATCH';
    end if;
    v_discount := case when v_coupon_kind = 'amount' then v_coupon_value else round(v_original * v_coupon_value / 100, 2) end;
    v_discount := least(v_discount, v_original);
  end if;

  v_due := greatest(v_original - v_discount, 0);
  v_status := case when v_due <= 0 then 'paid' else 'unpaid' end;

  insert into public.orders (order_no, student_id, classroom_id, kind, amount_original, amount_discount, amount_due, status, remark, created_by)
  values (public.generate_order_no(), p_student_id, p_classroom_id, coalesce(p_kind, 'enroll'), v_original, v_discount, v_due, v_status, coalesce(p_remark, ''), uid)
  returning id into v_order_id;

  insert into public.order_items (order_id, name, category, unit_price, qty, refundable)
  select v_order_id, coalesce(x.name, ''), coalesce(x.category, 'course'), coalesce(x.unit_price, 0), coalesce(x.qty, 1), coalesce(x.refundable, true)
    from jsonb_to_recordset(p_items) as x(name text, category text, unit_price numeric, qty smallint, refundable boolean);

  if p_coupon_grant_id is not null then
    update public.coupon_grants set status = 'used', order_id = v_order_id, used_at = now() where id = p_coupon_grant_id;
  end if;

  if coalesce(p_kind, 'enroll') = 'enroll' then
    perform public.enroll_student_core(p_classroom_id, p_student_id, coalesce(p_remark, ''), uid);
  end if;

  return v_order_id;
end;
$$;

create function public.record_payment(p_order_id uuid, p_amount numeric, p_method text, p_remark text default '')
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  v_student_id uuid;
  v_kind text;
  v_status text;
  v_balance numeric(12, 2);
  v_payment_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'finance.payment.record') then
    raise exception 'FORBIDDEN';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  select student_id, kind, status into v_student_id, v_kind, v_status from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if v_status in ('void', 'refunded', 'refunding') then
    raise exception 'ORDER_CLOSED';
  end if;

  if p_method = 'account' then
    select balance into v_balance from public.student_accounts where student_id = v_student_id for update;
    if coalesce(v_balance, 0) < p_amount then
      raise exception 'INSUFFICIENT_BALANCE';
    end if;
    insert into public.account_ledger (student_id, delta, reason, ref_order, operator_id)
    values (v_student_id, -p_amount, 'deduct', p_order_id, uid);
  end if;

  insert into public.payments (order_id, amount, method, operator_id, remark)
  values (p_order_id, p_amount, p_method, uid, coalesce(p_remark, ''))
  returning id into v_payment_id;

  -- 预存单：非账户余额支付时，收款金额同步充入学生账户，供后续订单以 method='account' 抵扣。
  if v_kind = 'deposit' and p_method <> 'account' then
    insert into public.account_ledger (student_id, delta, reason, ref_order, operator_id)
    values (v_student_id, p_amount, 'deposit', p_order_id, uid);
  end if;

  return v_payment_id;
end;
$$;

create function public.request_refund(p_order_id uuid, p_amount numeric, p_reason text default '')
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  v_status text;
  v_paid numeric(12, 2);
  v_refunded numeric(12, 2);
  v_nonrefundable numeric(12, 2);
  v_cap numeric(12, 2);
  v_refund_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'finance.refund.request') then
    raise exception 'FORBIDDEN';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  select status into v_status from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if v_status = 'refunding' then
    raise exception 'REFUND_ALREADY_PENDING';
  end if;

  select coalesce(sum(amount), 0) into v_paid from public.payments where order_id = p_order_id;
  select coalesce(sum(amount), 0) into v_refunded from public.refunds where order_id = p_order_id and status = 'done';
  select coalesce(sum(unit_price * qty), 0) into v_nonrefundable from public.order_items where order_id = p_order_id and refundable = false;
  v_cap := greatest(v_paid - v_refunded - v_nonrefundable, 0);
  if p_amount > v_cap then
    raise exception 'AMOUNT_EXCEEDS_REFUNDABLE';
  end if;

  insert into public.refunds (order_id, amount, reason, requested_by)
  values (p_order_id, p_amount, coalesce(p_reason, ''), uid)
  returning id into v_refund_id;

  return v_refund_id;
end;
$$;

create function public.approve_refund(p_refund_id uuid, p_ok boolean)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  v_order_id uuid;
  v_amount numeric(12, 2);
  v_status text;
begin
  if uid is null or not public.has_perm(uid, 'finance.refund.approve') then
    raise exception 'FORBIDDEN';
  end if;

  select order_id, amount, status into v_order_id, v_amount, v_status from public.refunds where id = p_refund_id for update;
  if not found then
    raise exception 'REFUND_NOT_FOUND';
  end if;
  if v_status <> 'pending' then
    raise exception 'REFUND_NOT_PENDING';
  end if;

  if p_ok then
    update public.refunds set status = 'done', approved_by = uid, approved_at = now() where id = p_refund_id;
    -- refunds 无 method 列，统一将退款额计入学生账户流水（可用于抵未来订单，或由
    -- finance.account.adjust 持有者用 adjust_account 反向核销线下现金支出），避免退款无落点不可对账。
    insert into public.account_ledger (student_id, delta, reason, ref_order, operator_id)
    select o.student_id, v_amount, 'refund', v_order_id, uid from public.orders o where o.id = v_order_id;
  else
    update public.refunds set status = 'rejected', approved_by = uid, approved_at = now() where id = p_refund_id;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC：优惠券 / 奖学金 / 账户调整
-- ----------------------------------------------------------------------------

create function public.create_coupon(
  p_code text,
  p_name text,
  p_kind text,
  p_value numeric,
  p_scope jsonb default '{}',
  p_valid_from timestamptz default null,
  p_valid_to timestamptz default null
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  v_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'finance.coupon.manage') then
    raise exception 'FORBIDDEN';
  end if;
  insert into public.coupons (code, name, kind, value, scope, valid_from, valid_to, created_by)
  values (nullif(trim(p_code), ''), trim(p_name), p_kind, p_value, coalesce(p_scope, '{}'::jsonb), p_valid_from, p_valid_to, uid)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.set_coupon_status(p_coupon_id uuid, p_status text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.has_perm(auth.uid(), 'finance.coupon.manage') then
    raise exception 'FORBIDDEN';
  end if;
  if p_status not in ('enabled', 'disabled') then
    raise exception 'INVALID_STATUS';
  end if;
  update public.coupons set status = p_status where id = p_coupon_id;
end;
$$;

create function public.grant_coupon(p_coupon_id uuid, p_student_id uuid)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  v_id uuid;
  v_status text;
begin
  if uid is null or not public.has_perm(uid, 'finance.coupon.manage') then
    raise exception 'FORBIDDEN';
  end if;
  select status into v_status from public.coupons where id = p_coupon_id;
  if v_status is null then
    raise exception 'COUPON_NOT_FOUND';
  end if;
  if v_status <> 'enabled' then
    raise exception 'COUPON_DISABLED';
  end if;
  insert into public.coupon_grants (coupon_id, student_id, granted_by)
  values (p_coupon_id, p_student_id, uid)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.revoke_coupon(p_grant_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.has_perm(auth.uid(), 'finance.coupon.manage') then
    raise exception 'FORBIDDEN';
  end if;
  update public.coupon_grants set status = 'revoked' where id = p_grant_id and status = 'granted';
  if not found then
    raise exception 'GRANT_NOT_REVOCABLE';
  end if;
end;
$$;

create function public.grant_scholarship(
  p_student_id uuid,
  p_amount numeric,
  p_kind text,
  p_reason text default '',
  p_order_id uuid default null
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  v_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'finance.scholarship.grant') then
    raise exception 'FORBIDDEN';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_kind not in ('discount', 'deposit') then
    raise exception 'INVALID_KIND';
  end if;

  insert into public.scholarships (student_id, amount, kind, reason, order_id, granted_by)
  values (p_student_id, p_amount, p_kind, coalesce(p_reason, ''), p_order_id, uid)
  returning id into v_id;

  if p_kind = 'deposit' then
    insert into public.account_ledger (student_id, delta, reason, ref_order, operator_id)
    values (p_student_id, p_amount, 'scholarship', p_order_id, uid);
  else
    if p_order_id is null then
      raise exception 'ORDER_REQUIRED_FOR_DISCOUNT';
    end if;
    update public.orders
       set amount_discount = amount_discount + p_amount,
           amount_due = greatest(amount_original - (amount_discount + p_amount), 0)
     where id = p_order_id and student_id = p_student_id;
    if not found then
      raise exception 'ORDER_NOT_FOUND';
    end if;
    perform public.recompute_order_status(p_order_id);
  end if;

  return v_id;
end;
$$;

create function public.adjust_account(p_student_id uuid, p_delta numeric, p_reason text default '')
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.has_perm(auth.uid(), 'finance.account.adjust') then
    raise exception 'FORBIDDEN';
  end if;
  if p_delta is null or p_delta = 0 then
    raise exception 'INVALID_DELTA';
  end if;
  insert into public.account_ledger (student_id, delta, reason, operator_id)
  values (p_student_id, p_delta, coalesce(nullif(trim(p_reason), ''), 'adjust'), auth.uid());
end;
$$;

-- 下单向导用的班级下拉：finance.order.create 持有者未必有 class.view.*，单独放行。
create function public.get_order_classroom_options()
returns table (id uuid, name text, course_title text)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select c.id, c.name, co.title
    from public.classrooms c
    left join public.courses co on co.id = c.course_id
   where c.archived_at is null
     and (public.is_admin(auth.uid()) or public.has_perm(auth.uid(), 'finance.order.create') or public.has_perm(auth.uid(), 'class.manage'))
   order by c.name;
$$;

-- ----------------------------------------------------------------------------
-- 顾客侧白名单 RPC：学生/家长读本人/孩子订单与账户，永不直读内部表。
-- ----------------------------------------------------------------------------

create function public.get_my_orders()
returns table (
  order_id         uuid,
  order_no         text,
  classroom_name   text,
  kind             text,
  amount_original  numeric,
  amount_discount  numeric,
  amount_due       numeric,
  status           text,
  created_at       timestamptz,
  paid_total       numeric,
  items            jsonb
)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select o.id, o.order_no, c.name, o.kind, o.amount_original, o.amount_discount, o.amount_due, o.status, o.created_at,
    coalesce((select sum(p.amount) from public.payments p where p.order_id = o.id), 0),
    coalesce(
      (select jsonb_agg(jsonb_build_object('name', oi.name, 'unitPrice', oi.unit_price, 'qty', oi.qty) order by oi.name)
         from public.order_items oi where oi.order_id = o.id),
      '[]'::jsonb
    )
    from public.orders o
    left join public.classrooms c on c.id = o.classroom_id
    join public.students s on s.id = o.student_id
   where s.user_id = auth.uid()
      or exists (select 1 from public.student_guardians g where g.student_id = s.id and g.guardian_id = auth.uid())
   order by o.created_at desc;
$$;

create function public.get_my_account()
returns table (student_id uuid, student_name text, balance numeric, ledger jsonb)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select s.id, s.name, coalesce(sa.balance, 0),
    coalesce(
      (select jsonb_agg(jsonb_build_object('delta', al.delta, 'reason', al.reason, 'createdAt', al.created_at) order by al.created_at desc)
         from (select * from public.account_ledger where student_id = s.id order by created_at desc limit 50) al),
      '[]'::jsonb
    )
    from public.students s
    left join public.student_accounts sa on sa.student_id = s.id
   where s.user_id = auth.uid()
      or exists (select 1 from public.student_guardians g where g.student_id = s.id and g.guardian_id = auth.uid());
$$;

revoke all on function public.place_order(uuid, uuid, jsonb, text, uuid, text) from public;
revoke all on function public.record_payment(uuid, numeric, text, text) from public;
revoke all on function public.request_refund(uuid, numeric, text) from public;
revoke all on function public.approve_refund(uuid, boolean) from public;
revoke all on function public.create_coupon(text, text, text, numeric, jsonb, timestamptz, timestamptz) from public;
revoke all on function public.set_coupon_status(uuid, text) from public;
revoke all on function public.grant_coupon(uuid, uuid) from public;
revoke all on function public.revoke_coupon(uuid) from public;
revoke all on function public.grant_scholarship(uuid, numeric, text, text, uuid) from public;
revoke all on function public.adjust_account(uuid, numeric, text) from public;
revoke all on function public.get_order_classroom_options() from public;
revoke all on function public.get_my_orders() from public;
revoke all on function public.get_my_account() from public;

grant execute on function public.place_order(uuid, uuid, jsonb, text, uuid, text) to authenticated;
grant execute on function public.record_payment(uuid, numeric, text, text) to authenticated;
grant execute on function public.request_refund(uuid, numeric, text) to authenticated;
grant execute on function public.approve_refund(uuid, boolean) to authenticated;
grant execute on function public.create_coupon(text, text, text, numeric, jsonb, timestamptz, timestamptz) to authenticated;
grant execute on function public.set_coupon_status(uuid, text) to authenticated;
grant execute on function public.grant_coupon(uuid, uuid) to authenticated;
grant execute on function public.revoke_coupon(uuid) to authenticated;
grant execute on function public.grant_scholarship(uuid, numeric, text, text, uuid) to authenticated;
grant execute on function public.adjust_account(uuid, numeric, text) to authenticated;
grant execute on function public.get_order_classroom_options() to authenticated;
grant execute on function public.get_my_orders() to authenticated;
grant execute on function public.get_my_account() to authenticated;

-- ----------------------------------------------------------------------------
-- RLS：全部只读 select，写一律走上方 RPC（security definer），表级不给 insert/update。
-- 学生/家长无表级授权，只经 get_my_orders/get_my_account。
-- ----------------------------------------------------------------------------

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.coupons enable row level security;
alter table public.coupon_grants enable row level security;
alter table public.scholarships enable row level security;
alter table public.student_accounts enable row level security;
alter table public.account_ledger enable row level security;

create policy "orders_select_scope" on public.orders
  for select to authenticated
  using (public.can_view_order(id, (select auth.uid())));

create policy "order_items_select_scope" on public.order_items
  for select to authenticated
  using (public.can_view_order(order_id, (select auth.uid())));

create policy "payments_select_scope" on public.payments
  for select to authenticated
  using (public.can_view_order(order_id, (select auth.uid())));

create policy "refunds_select_scope" on public.refunds
  for select to authenticated
  using (public.can_view_order(order_id, (select auth.uid())));

create policy "coupons_select_staff" on public.coupons
  for select to authenticated
  using (
    public.is_admin((select auth.uid()))
    or public.staff_has_perm((select auth.uid()), 'finance.coupon.manage')
    or public.staff_has_perm((select auth.uid()), 'finance.order.create')
    or public.staff_has_perm((select auth.uid()), 'finance.order.view')
  );

create policy "coupon_grants_select_scope" on public.coupon_grants
  for select to authenticated
  using (
    public.is_admin((select auth.uid()))
    or public.staff_has_perm((select auth.uid()), 'finance.coupon.manage')
    or public.can_view_finance_student(student_id, (select auth.uid()))
  );

create policy "scholarships_select_scope" on public.scholarships
  for select to authenticated
  using (
    public.is_admin((select auth.uid()))
    or public.staff_has_perm((select auth.uid()), 'finance.scholarship.grant')
    or public.can_view_finance_student(student_id, (select auth.uid()))
  );

create policy "student_accounts_select_scope" on public.student_accounts
  for select to authenticated
  using (public.can_view_finance_student(student_id, (select auth.uid())));

create policy "account_ledger_select_scope" on public.account_ledger
  for select to authenticated
  using (public.can_view_finance_student(student_id, (select auth.uid())));

revoke all on public.orders from anon, authenticated;
revoke all on public.order_items from anon, authenticated;
revoke all on public.payments from anon, authenticated;
revoke all on public.refunds from anon, authenticated;
revoke all on public.coupons from anon, authenticated;
revoke all on public.coupon_grants from anon, authenticated;
revoke all on public.scholarships from anon, authenticated;
revoke all on public.student_accounts from anon, authenticated;
revoke all on public.account_ledger from anon, authenticated;

grant select on public.orders to authenticated;
grant select on public.order_items to authenticated;
grant select on public.payments to authenticated;
grant select on public.refunds to authenticated;
grant select on public.coupons to authenticated;
grant select on public.coupon_grants to authenticated;
grant select on public.scholarships to authenticated;
grant select on public.student_accounts to authenticated;
grant select on public.account_ledger to authenticated;
