-- R1-4: hybrid work items and lightweight approvals.
-- Domain tables/RPCs remain authoritative. Durable rows only cover human
-- coordination, cross-domain exceptions, delegation, and independent SLAs.

begin;

-- ---------------------------------------------------------------------------
-- 1. Explicit permissions.
-- ---------------------------------------------------------------------------

create or replace function public.school_permission_keys()
returns text[] language sql immutable
as $$
  select array[
    'student.view.all','student.view.assigned','student.edit','student.create','student.assign','student.import','student.delete',
    'followup.view','followup.write','activity.manage','activity.register','review.write','video.review',
    'course.view','course.manage','course.view.all','course.product.create','course.assignment.manage',
    'courseware.template.edit','courseware.overlay.edit','courseware.page.edit','courseware.asset.manage',
    'courseware.release.publish','courseware.review','courseware.emergency_publish',
    'class.view.all','class.view.mine','class.create','class.manage','enrollment.manage',
    'schedule.view.all','schedule.manage','attendance.mark','grading.write','report.view.all','session.void','session.postwork.manage',
    'finance.order.view','finance.order.create','finance.payment.record','finance.refund.request','finance.refund.approve',
    'finance.coupon.manage','finance.scholarship.grant','finance.account.adjust','finance.report.view',
    'staff.manage','permission.configure','registration.invite.manage','organization.settings.manage','system.operations.manage',
    'account.support.manage','work_item.manage','approval.manage','audit.view','testdata.purge'
  ]::text[]
$$;

insert into public.role_permissions(role_id, perm_key)
select role_row.id, permission_key
  from public.staff_roles role_row
 cross join (values ('work_item.manage'), ('approval.manage')) keys(permission_key)
 where role_row.key = 'principal'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Durable coordination and append-only assignment history.
-- ---------------------------------------------------------------------------

create table public.work_items (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('manual','cross_domain','delegation','sla')),
  source_id text not null check (length(source_id) between 1 and 160),
  idempotency_key text not null unique check (length(idempotency_key) between 1 and 200),
  domain text not null check (domain in ('curriculum','teaching','student_service','finance','operations')),
  title text not null check (length(title) between 1 and 160),
  description text not null default '' check (length(description) <= 2000),
  action_kind text not null default 'work_item.close' check (action_kind = 'work_item.close'),
  action_href text not null check (left(action_href, 1) = '/' and length(action_href) <= 500),
  assignee_id uuid not null references public.profiles(id) on delete restrict,
  due_at timestamptz,
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  status text not null default 'open' check (status in ('open','closed','cancelled')),
  created_reason text not null check (length(created_reason) between 1 and 500),
  closed_reason text check (closed_reason is null or length(closed_reason) between 1 and 1000),
  created_by uuid not null references public.profiles(id) on delete restrict,
  closed_by uuid references public.profiles(id) on delete restrict,
  close_idempotency_key text unique check (close_idempotency_key is null or length(close_idempotency_key) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint work_items_close_shape check (
    (status = 'open' and closed_reason is null and closed_by is null and closed_at is null and close_idempotency_key is null)
    or
    (status in ('closed','cancelled') and closed_reason is not null and closed_by is not null and closed_at is not null and close_idempotency_key is not null)
  )
);

create index work_items_assignee_open_due_idx on public.work_items(assignee_id, due_at, created_at) where status = 'open';
create index work_items_creator_open_due_idx on public.work_items(created_by, due_at, created_at) where status = 'open';
create index work_items_open_due_idx on public.work_items(due_at, created_at) where status = 'open';
create index work_items_source_idx on public.work_items(source_kind, source_id);

create trigger work_items_set_updated_at before update on public.work_items
for each row execute function public.set_updated_at();

create table public.work_item_assignments (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.work_items(id) on delete restrict,
  from_assignee_id uuid references public.profiles(id) on delete restrict,
  to_assignee_id uuid not null references public.profiles(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (length(reason) between 1 and 500),
  idempotency_key text not null unique check (length(idempotency_key) between 1 and 220),
  created_at timestamptz not null default now()
);

create index work_item_assignments_item_created_idx on public.work_item_assignments(work_item_id, created_at);

-- ---------------------------------------------------------------------------
-- 3. Approval request, immutable decision, and audit contract.
-- ---------------------------------------------------------------------------

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  approval_kind text not null check (approval_kind ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  subject_kind text not null check (subject_kind ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  subject_id text not null check (length(subject_id) between 1 and 160),
  idempotency_key text not null unique check (length(idempotency_key) between 1 and 200),
  domain text not null check (domain in ('curriculum','teaching','student_service','finance','operations')),
  title text not null check (length(title) between 1 and 160),
  request_reason text not null check (length(request_reason) between 1 and 1000),
  payload jsonb not null default '{}'::jsonb,
  action_href text not null check (left(action_href, 1) = '/' and length(action_href) <= 500),
  requester_id uuid not null references public.profiles(id) on delete restrict,
  approver_id uuid not null references public.profiles(id) on delete restrict,
  due_at timestamptz,
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  status text not null default 'pending' check (status in ('pending','decided','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint approval_requests_distinct_people check (requester_id <> approver_id),
  constraint approval_requests_decided_shape check ((status = 'pending' and decided_at is null) or status <> 'pending')
);

create index approval_requests_approver_pending_due_idx on public.approval_requests(approver_id, due_at, created_at) where status = 'pending';
create index approval_requests_requester_pending_due_idx on public.approval_requests(requester_id, due_at, created_at) where status = 'pending';
create index approval_requests_pending_due_idx on public.approval_requests(due_at, created_at) where status = 'pending';
create index approval_requests_subject_idx on public.approval_requests(subject_kind, subject_id);

create trigger approval_requests_set_updated_at before update on public.approval_requests
for each row execute function public.set_updated_at();

create table public.approval_decisions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.approval_requests(id) on delete restrict,
  decider_id uuid not null references public.profiles(id) on delete restrict,
  decision text not null check (decision in ('approved','rejected')),
  decision_reason text not null check (length(decision_reason) between 1 and 1000),
  evidence jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique check (length(idempotency_key) between 1 and 200),
  decided_at timestamptz not null default now(),
  constraint approval_decisions_evidence_cap check (octet_length(evidence::text) <= 32768)
);

create index approval_decisions_decider_time_idx on public.approval_decisions(decider_id, decided_at desc);

create or replace function public.reject_r1_coordination_audit_mutation()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  raise exception 'APPEND_ONLY_AUDIT';
end
$$;

create trigger work_item_assignments_immutable before update or delete on public.work_item_assignments
for each row execute function public.reject_r1_coordination_audit_mutation();
create trigger approval_decisions_immutable before update or delete on public.approval_decisions
for each row execute function public.reject_r1_coordination_audit_mutation();

-- ---------------------------------------------------------------------------
-- 4. RLS: authenticated users can read only their coordination scope. All
-- mutations are RPC-only.
-- ---------------------------------------------------------------------------

alter table public.work_items enable row level security;
alter table public.work_item_assignments enable row level security;
alter table public.approval_requests enable row level security;
alter table public.approval_decisions enable row level security;

create policy work_items_select_scope on public.work_items for select to authenticated
using (
  assignee_id = (select auth.uid())
  or created_by = (select auth.uid())
  or public.has_perm((select auth.uid()), 'work_item.manage')
);

create policy work_item_assignments_select_scope on public.work_item_assignments for select to authenticated
using (exists (
  select 1 from public.work_items item_row
   where item_row.id = work_item_id
     and (item_row.assignee_id = (select auth.uid()) or item_row.created_by = (select auth.uid())
       or public.has_perm((select auth.uid()), 'work_item.manage'))
));

create policy approval_requests_select_scope on public.approval_requests for select to authenticated
using (
  requester_id = (select auth.uid())
  or approver_id = (select auth.uid())
  or public.has_perm((select auth.uid()), 'approval.manage')
);

create policy approval_decisions_select_scope on public.approval_decisions for select to authenticated
using (exists (
  select 1 from public.approval_requests request_row
   where request_row.id = request_id
     and (request_row.requester_id = (select auth.uid()) or request_row.approver_id = (select auth.uid())
       or public.has_perm((select auth.uid()), 'approval.manage'))
));

revoke all on public.work_items, public.work_item_assignments, public.approval_requests, public.approval_decisions from public, anon, authenticated;
grant select on public.work_items, public.work_item_assignments, public.approval_requests, public.approval_decisions to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Command RPCs with idempotency, permission, audit, and notification.
-- ---------------------------------------------------------------------------

create or replace function public.create_durable_work_item(
  p_source_kind text, p_source_id text, p_idempotency_key text, p_domain text,
  p_title text, p_description text, p_assignee_id uuid, p_due_at timestamptz,
  p_priority text, p_created_reason text, p_action_href text
) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  clean_source_kind text := lower(btrim(coalesce(p_source_kind, '')));
  clean_source_id text := btrim(coalesce(p_source_id, ''));
  clean_key text := btrim(coalesce(p_idempotency_key, ''));
  clean_title text := btrim(coalesce(p_title, ''));
  clean_description text := btrim(coalesce(p_description, ''));
  clean_reason text := btrim(coalesce(p_created_reason, ''));
  clean_href text := btrim(coalesce(p_action_href, ''));
  existing public.work_items;
  item_id uuid;
begin
  if uid is null or not public.is_staff(uid) then raise exception 'FORBIDDEN'; end if;
  if clean_source_kind not in ('manual','cross_domain','delegation','sla') then raise exception 'INVALID_SOURCE_KIND'; end if;
  if length(clean_source_id) not between 1 and 160 or length(clean_key) not between 1 and 200 then raise exception 'INVALID_IDEMPOTENCY'; end if;
  if p_domain not in ('curriculum','teaching','student_service','finance','operations') then raise exception 'INVALID_DOMAIN'; end if;
  if length(clean_title) not between 1 and 160 or length(clean_description) > 2000 or length(clean_reason) not between 1 and 500 then raise exception 'INVALID_TEXT'; end if;
  if p_priority not in ('low','normal','high','critical') then raise exception 'INVALID_PRIORITY'; end if;
  if left(clean_href, 1) <> '/' or length(clean_href) > 500 then raise exception 'INVALID_ACTION_HREF'; end if;
  if not public.is_staff(p_assignee_id) then raise exception 'INVALID_ASSIGNEE'; end if;
  if p_assignee_id <> uid and not public.has_perm(uid, 'work_item.manage') then raise exception 'FORBIDDEN'; end if;

  perform pg_advisory_xact_lock(hashtextextended('work_item:create:' || clean_key, 0));
  select * into existing from public.work_items where idempotency_key = clean_key;
  if found then
    if existing.source_kind = clean_source_kind and existing.source_id = clean_source_id
       and existing.domain = p_domain and existing.title = clean_title
       and existing.description = clean_description and existing.assignee_id = p_assignee_id
       and existing.due_at is not distinct from p_due_at and existing.priority = p_priority
       and existing.created_reason = clean_reason and existing.action_href = clean_href then
      return existing.id;
    end if;
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;

  insert into public.work_items(source_kind, source_id, idempotency_key, domain, title, description,
    action_href, assignee_id, due_at, priority, created_reason, created_by)
  values(clean_source_kind, clean_source_id, clean_key, p_domain, clean_title, clean_description,
    clean_href, p_assignee_id, p_due_at, p_priority, clean_reason, uid)
  returning id into item_id;

  insert into public.work_item_assignments(work_item_id, from_assignee_id, to_assignee_id, actor_id, reason, idempotency_key)
  values(item_id, null, p_assignee_id, uid, clean_reason, 'initial:' || item_id::text);

  perform public.emit_domain_event('work_item.assigned', 'work_item', item_id,
    jsonb_build_object('title', clean_title, 'sourceKind', clean_source_kind, 'dueAt', p_due_at, 'priority', p_priority),
    p_assignee_id, clean_href);
  return item_id;
end
$$;

create or replace function public.reassign_durable_work_item(
  p_work_item_id uuid, p_assignee_id uuid, p_reason text, p_idempotency_key text
) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  clean_reason text := btrim(coalesce(p_reason, ''));
  clean_key text := btrim(coalesce(p_idempotency_key, ''));
  item_row public.work_items;
  history_row public.work_item_assignments;
begin
  if uid is null or not public.is_staff(uid) then raise exception 'FORBIDDEN'; end if;
  if length(clean_reason) not between 1 and 500 or length(clean_key) not between 1 and 200 then raise exception 'INVALID_TEXT'; end if;
  if not public.is_staff(p_assignee_id) then raise exception 'INVALID_ASSIGNEE'; end if;

  perform pg_advisory_xact_lock(hashtextextended('work_item:reassign:' || clean_key, 0));
  select * into history_row from public.work_item_assignments where idempotency_key = clean_key;
  if found then
    if history_row.work_item_id = p_work_item_id and history_row.to_assignee_id = p_assignee_id
       and history_row.reason = clean_reason then return p_work_item_id; end if;
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;

  select * into item_row from public.work_items where id = p_work_item_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if item_row.status <> 'open' then raise exception 'WORK_ITEM_CLOSED'; end if;
  if uid not in (item_row.assignee_id, item_row.created_by) and not public.has_perm(uid, 'work_item.manage') then raise exception 'FORBIDDEN'; end if;
  if p_assignee_id = item_row.assignee_id then raise exception 'ASSIGNEE_UNCHANGED'; end if;

  insert into public.work_item_assignments(work_item_id, from_assignee_id, to_assignee_id, actor_id, reason, idempotency_key)
  values(item_row.id, item_row.assignee_id, p_assignee_id, uid, clean_reason, clean_key);
  update public.work_items set assignee_id = p_assignee_id where id = item_row.id;
  perform public.emit_domain_event('work_item.reassigned', 'work_item', item_row.id,
    jsonb_build_object('title', item_row.title, 'fromAssigneeId', item_row.assignee_id, 'reason', clean_reason),
    p_assignee_id, item_row.action_href);
  return item_row.id;
end
$$;

create or replace function public.close_durable_work_item(
  p_work_item_id uuid, p_closed_reason text, p_idempotency_key text
) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  clean_reason text := btrim(coalesce(p_closed_reason, ''));
  clean_key text := btrim(coalesce(p_idempotency_key, ''));
  item_row public.work_items;
begin
  if uid is null or not public.is_staff(uid) then raise exception 'FORBIDDEN'; end if;
  if length(clean_reason) not between 1 and 1000 or length(clean_key) not between 1 and 200 then raise exception 'INVALID_TEXT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('work_item:close:' || p_work_item_id::text, 0));
  select * into item_row from public.work_items where id = p_work_item_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if uid <> item_row.assignee_id and not public.has_perm(uid, 'work_item.manage') then raise exception 'FORBIDDEN'; end if;
  if item_row.status <> 'open' then
    if item_row.status = 'closed' and item_row.close_idempotency_key = clean_key and item_row.closed_reason = clean_reason then return item_row.id; end if;
    raise exception 'WORK_ITEM_CLOSED';
  end if;
  if exists(select 1 from public.work_items where close_idempotency_key = clean_key and id <> item_row.id) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;

  update public.work_items set status = 'closed', closed_reason = clean_reason, closed_by = uid,
    closed_at = now(), close_idempotency_key = clean_key where id = item_row.id;
  perform public.emit_domain_event('work_item.closed', 'work_item', item_row.id,
    jsonb_build_object('title', item_row.title, 'closedReason', clean_reason),
    case when item_row.created_by <> uid then item_row.created_by else null end, item_row.action_href);
  return item_row.id;
end
$$;

create or replace function public.request_approval(
  p_approval_kind text, p_subject_kind text, p_subject_id text, p_idempotency_key text,
  p_domain text, p_title text, p_request_reason text, p_payload jsonb,
  p_approver_id uuid, p_due_at timestamptz, p_priority text, p_action_href text
) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  clean_kind text := lower(btrim(coalesce(p_approval_kind, '')));
  clean_subject_kind text := lower(btrim(coalesce(p_subject_kind, '')));
  clean_subject_id text := btrim(coalesce(p_subject_id, ''));
  clean_key text := btrim(coalesce(p_idempotency_key, ''));
  clean_title text := btrim(coalesce(p_title, ''));
  clean_reason text := btrim(coalesce(p_request_reason, ''));
  clean_href text := btrim(coalesce(p_action_href, ''));
  clean_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  existing public.approval_requests;
  request_id uuid;
begin
  if uid is null or not public.is_staff(uid) then raise exception 'FORBIDDEN'; end if;
  if clean_kind !~ '^[a-z][a-z0-9_.-]{0,79}$' or clean_subject_kind !~ '^[a-z][a-z0-9_.-]{0,79}$' then raise exception 'INVALID_KIND'; end if;
  if length(clean_subject_id) not between 1 and 160 or length(clean_key) not between 1 and 200 then raise exception 'INVALID_IDEMPOTENCY'; end if;
  if p_domain not in ('curriculum','teaching','student_service','finance','operations') then raise exception 'INVALID_DOMAIN'; end if;
  if length(clean_title) not between 1 and 160 or length(clean_reason) not between 1 and 1000 then raise exception 'INVALID_TEXT'; end if;
  if octet_length(clean_payload::text) > 32768 then raise exception 'PAYLOAD_TOO_LARGE'; end if;
  if p_priority not in ('low','normal','high','critical') then raise exception 'INVALID_PRIORITY'; end if;
  if left(clean_href, 1) <> '/' or length(clean_href) > 500 then raise exception 'INVALID_ACTION_HREF'; end if;
  if p_approver_id = uid then raise exception 'FORBIDDEN_SELF_APPROVAL'; end if;
  if not public.is_staff(p_approver_id) then raise exception 'INVALID_APPROVER'; end if;

  perform pg_advisory_xact_lock(hashtextextended('approval:request:' || clean_key, 0));
  select * into existing from public.approval_requests where idempotency_key = clean_key;
  if found then
    if existing.approval_kind = clean_kind and existing.subject_kind = clean_subject_kind
       and existing.subject_id = clean_subject_id and existing.domain = p_domain
       and existing.title = clean_title and existing.request_reason = clean_reason
       and existing.payload = clean_payload and existing.approver_id = p_approver_id
       and existing.due_at is not distinct from p_due_at and existing.priority = p_priority
       and existing.action_href = clean_href then return existing.id; end if;
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;

  insert into public.approval_requests(approval_kind, subject_kind, subject_id, idempotency_key,
    domain, title, request_reason, payload, action_href, requester_id, approver_id, due_at, priority)
  values(clean_kind, clean_subject_kind, clean_subject_id, clean_key,
    p_domain, clean_title, clean_reason, clean_payload, clean_href, uid, p_approver_id, p_due_at, p_priority)
  returning id into request_id;

  perform public.emit_domain_event('approval.requested', 'approval_request', request_id,
    jsonb_build_object('title', clean_title, 'approvalKind', clean_kind, 'dueAt', p_due_at, 'priority', p_priority),
    p_approver_id, clean_href);
  return request_id;
end
$$;

create or replace function public.decide_approval(
  p_request_id uuid, p_decision text, p_decision_reason text, p_evidence jsonb, p_idempotency_key text
) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  clean_reason text := btrim(coalesce(p_decision_reason, ''));
  clean_key text := btrim(coalesce(p_idempotency_key, ''));
  clean_evidence jsonb := coalesce(p_evidence, '{}'::jsonb);
  request_row public.approval_requests;
  existing public.approval_decisions;
  decision_id uuid;
begin
  if uid is null or not public.is_staff(uid) then raise exception 'FORBIDDEN'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'INVALID_DECISION'; end if;
  if length(clean_reason) not between 1 and 1000 or length(clean_key) not between 1 and 200 then raise exception 'INVALID_TEXT'; end if;
  if octet_length(clean_evidence::text) > 32768 then raise exception 'PAYLOAD_TOO_LARGE'; end if;

  perform pg_advisory_xact_lock(hashtextextended('approval:decide:' || p_request_id::text, 0));
  select * into request_row from public.approval_requests where id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if uid = request_row.requester_id then raise exception 'FORBIDDEN_SELF_APPROVAL'; end if;
  if uid <> request_row.approver_id and not public.has_perm(uid, 'approval.manage') then raise exception 'FORBIDDEN'; end if;

  select * into existing from public.approval_decisions where request_id = p_request_id;
  if found then
    if existing.idempotency_key = clean_key and existing.decision = p_decision
       and existing.decision_reason = clean_reason and existing.evidence = clean_evidence then return existing.id; end if;
    raise exception 'ALREADY_DECIDED';
  end if;
  if request_row.status <> 'pending' then raise exception 'APPROVAL_NOT_PENDING'; end if;
  if exists(select 1 from public.approval_decisions where idempotency_key = clean_key) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;

  insert into public.approval_decisions(request_id, decider_id, decision, decision_reason, evidence, idempotency_key)
  values(p_request_id, uid, p_decision, clean_reason, clean_evidence, clean_key)
  returning id into decision_id;
  update public.approval_requests set status = 'decided', decided_at = now() where id = p_request_id;

  perform public.emit_domain_event('approval.' || p_decision, 'approval_request', p_request_id,
    jsonb_build_object('title', request_row.title, 'decision', p_decision, 'decisionReason', clean_reason),
    request_row.requester_id, request_row.action_href);
  return decision_id;
end
$$;

create or replace function public.list_work_coordination_candidates()
returns table(id uuid, display_name text, can_manage_work_items boolean)
language plpgsql security definer stable set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.is_staff(uid) then raise exception 'FORBIDDEN'; end if;
  return query
  select profile_row.id, profile_row.display_name,
    public.has_perm(profile_row.id, 'work_item.manage') or public.has_perm(profile_row.id, 'approval.manage')
  from public.profiles profile_row
  where profile_row.role in ('staff','admin') and coalesce(profile_row.account_status, 'active') = 'active'
  order by profile_row.display_name, profile_row.id;
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Preserve the 11-source domain projection, then expose one unified list.
-- The new list adds explicit source/action/assignee/priority/read-state fields.
-- ---------------------------------------------------------------------------

alter function public.list_my_work_items(text, boolean) rename to list_my_domain_work_items;
revoke all on function public.list_my_domain_work_items(text, boolean) from public, anon, authenticated;

create or replace function public.resolve_work_item_action_href(p_route_target text, p_route_params jsonb)
returns text language sql immutable set search_path = public, pg_temp
as $$
  select case split_part(coalesce(p_route_target, ''), ':', 1)
    when 'lecture' then '/dashboard/courseware/lectures/' || split_part(p_route_target, ':', 2)
      || case when coalesce(p_route_params ->> 'track', '') <> '' then '?track=' || (p_route_params ->> 'track') else '' end
    when 'classroom' then '/dashboard/classes/' || split_part(p_route_target, ':', 2)
    when 'session' then '/dashboard/sessions/' || split_part(p_route_target, ':', 2)
    when 'student' then '/dashboard/students/' || split_part(p_route_target, ':', 2)
    when 'course_family' then '/dashboard/courses/' || split_part(p_route_target, ':', 2)
    when 'course_variant' then '/dashboard/courses/' || split_part(p_route_target, ':', 2)
    when 'refund' then '/dashboard/finance'
    when 'order' then '/dashboard/finance'
    when 'activity' then '/dashboard/activities'
    else '/dashboard'
  end
$$;

create or replace function public.list_my_work_items(p_domain text default null, p_ignore_snooze boolean default false)
returns table(
  work_key text, group_key text, type text, domain text, kind text,
  primary_object_type text, primary_object_id uuid, primary_object_name text,
  secondary_object_type text, secondary_object_id uuid, secondary_object_name text,
  context jsonb, responsibility text, ownership_mode text,
  available_at timestamptz, due_at timestamptz, scheduled_at timestamptz, created_at timestamptz,
  urgency_bucket text, severity text, escalation_level integer, resurface_at timestamptz,
  reason_codes text[], action_code text, can_act boolean, context_lens text,
  route_target text, route_params jsonb, last_seen_at timestamptz, snoozed_until timestamptz,
  pinned_at timestamptz, acknowledged_at timestamptz, watching boolean,
  source_kind text, source_id text, action_kind text, action_href text,
  assignee_id uuid, assignee_name text, priority text, read_state text
)
language plpgsql security definer stable set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  v_domain text := nullif(btrim(coalesce(p_domain, '')), '');
  my_name text;
  can_manage_work boolean;
  can_manage_approval boolean;
begin
  if uid is null or not public.is_staff(uid) then raise exception 'FORBIDDEN'; end if;
  if v_domain is not null and v_domain not in ('curriculum','teaching','student_service','finance','operations') then raise exception 'INVALID_DOMAIN'; end if;
  select display_name into my_name from public.profiles where id = uid;
  can_manage_work := public.has_perm(uid, 'work_item.manage');
  can_manage_approval := public.has_perm(uid, 'approval.manage');

  return query
  with domain_items as (
    select d.work_key, d.group_key, d.type, d.domain, d.kind,
      d.primary_object_type, d.primary_object_id, d.primary_object_name,
      d.secondary_object_type, d.secondary_object_id, d.secondary_object_name,
      d.context, d.responsibility, d.ownership_mode, d.available_at, d.due_at,
      d.scheduled_at, d.created_at, d.urgency_bucket, d.severity,
      d.escalation_level, d.resurface_at, d.reason_codes, d.action_code, d.can_act,
      d.context_lens, d.route_target, d.route_params, d.last_seen_at, d.snoozed_until,
      d.pinned_at, d.acknowledged_at, d.watching,
      'domain_projection'::text as source_kind,
      d.primary_object_id::text as source_id,
      d.action_code as action_kind,
      public.resolve_work_item_action_href(d.route_target, d.route_params) as action_href,
      case when d.ownership_mode = 'oversight' then null::uuid else uid end as assignee_id,
      case when d.ownership_mode = 'oversight' then null::text else my_name end as assignee_name,
      d.severity as priority,
      case when d.last_seen_at is null then 'unseen' else 'seen' end::text as read_state
    from public.list_my_domain_work_items(v_domain, p_ignore_snooze) d
  ),
  durable_items as (
    select 'durable:' || item_row.id::text, 'durable:' || item_row.id::text, 'action'::text, item_row.domain,
      'work_item.' || item_row.source_kind, 'activity'::text, item_row.id, item_row.title,
      null::text, null::uuid, null::text,
      jsonb_build_object('description', item_row.description, 'createdReason', item_row.created_reason,
        'sourceId', item_row.source_id),
      'explicit_assignee'::text,
      case when item_row.assignee_id = uid then 'direct' when item_row.created_by = uid then 'delegated' else 'oversight' end::text,
      null::timestamptz, item_row.due_at, null::timestamptz, item_row.created_at,
      urgency.urgency_bucket, urgency.severity,
      case when item_row.assignee_id <> uid and item_row.due_at < now() then 1 else 0 end::integer,
      case when item_row.assignee_id <> uid then item_row.due_at else null end,
      array[item_row.created_reason]::text[], item_row.action_kind,
      item_row.assignee_id = uid or can_manage_work,
      case when item_row.domain = 'student_service' then 'support' else 'management' end::text,
      'work_item:' || item_row.id::text, jsonb_build_object('workItemId', item_row.id),
      state_row.last_seen_at, state_row.snoozed_until, state_row.pinned_at, state_row.acknowledged_at,
      coalesce(state_row.watching, false),
      'durable.' || item_row.source_kind, item_row.source_id, item_row.action_kind, item_row.action_href,
      item_row.assignee_id, assignee.display_name, item_row.priority,
      case when state_row.last_seen_at is null then 'unseen' else 'seen' end::text
    from public.work_items item_row
    join public.profiles assignee on assignee.id = item_row.assignee_id
    cross join lateral public.classify_work_item_urgency(item_row.due_at, item_row.priority) urgency
    left join public.work_item_user_state state_row on state_row.user_id = uid and state_row.work_key = 'durable:' || item_row.id::text
    where item_row.status = 'open'
      and (item_row.assignee_id = uid or item_row.created_by = uid
        or (can_manage_work and item_row.due_at < now()))
      and (v_domain is null or item_row.domain = v_domain)
      and (p_ignore_snooze or not (coalesce(state_row.snoozed_until > now(), false) and urgency.urgency_bucket in ('today','upcoming','backlog')))
  ),
  approval_items as (
    select 'approval:' || request_row.id::text, 'approval:' || request_row.id::text, 'action'::text, request_row.domain,
      'approval.decide'::text, 'activity'::text, request_row.id, request_row.title,
      null::text, null::uuid, null::text,
      jsonb_build_object('approvalKind', request_row.approval_kind, 'subjectKind', request_row.subject_kind,
        'subjectId', request_row.subject_id, 'requestReason', request_row.request_reason, 'payload', request_row.payload),
      'approver'::text,
      case when request_row.approver_id = uid then 'direct' when request_row.requester_id = uid then 'delegated' else 'oversight' end::text,
      null::timestamptz, request_row.due_at, null::timestamptz, request_row.created_at,
      urgency.urgency_bucket, urgency.severity,
      case when request_row.approver_id <> uid and request_row.due_at < now() then 1 else 0 end::integer,
      case when request_row.approver_id <> uid then request_row.due_at else null end,
      array[request_row.request_reason]::text[], 'approval.decide'::text,
      request_row.approver_id = uid or (can_manage_approval and uid <> request_row.requester_id),
      'management'::text, 'approval_request:' || request_row.id::text,
      jsonb_build_object('approvalRequestId', request_row.id),
      state_row.last_seen_at, state_row.snoozed_until, state_row.pinned_at, state_row.acknowledged_at,
      coalesce(state_row.watching, false),
      'approval_request'::text, request_row.id::text, 'approval.decide'::text, request_row.action_href,
      request_row.approver_id, approver.display_name, request_row.priority,
      case when state_row.last_seen_at is null then 'unseen' else 'seen' end::text
    from public.approval_requests request_row
    join public.profiles approver on approver.id = request_row.approver_id
    cross join lateral public.classify_work_item_urgency(request_row.due_at, request_row.priority) urgency
    left join public.work_item_user_state state_row on state_row.user_id = uid and state_row.work_key = 'approval:' || request_row.id::text
    where request_row.status = 'pending'
      and (request_row.approver_id = uid or request_row.requester_id = uid
        or (can_manage_approval and request_row.due_at < now()))
      and (v_domain is null or request_row.domain = v_domain)
      and (p_ignore_snooze or not (coalesce(state_row.snoozed_until > now(), false) and urgency.urgency_bucket in ('today','upcoming','backlog')))
  ),
  combined as (
    select * from domain_items
    union all select * from durable_items
    union all select * from approval_items
  )
  select combined.* from combined
  order by
    case combined.urgency_bucket when 'now' then 0 when 'overdue' then 1 when 'today' then 2 when 'upcoming' then 3 else 4 end,
    combined.pinned_at desc nulls last,
    case combined.priority when 'critical' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
    coalesce(combined.due_at, combined.scheduled_at) asc nulls last,
    combined.created_at asc, combined.work_key asc;
end
$$;

create or replace function public.list_my_work_summary()
returns table(domain text, urgency_bucket text, item_count bigint)
language sql security definer stable set search_path = public, pg_temp
as $$
  select item_row.domain, item_row.urgency_bucket, count(*)::bigint
  from public.list_my_work_items() item_row
  group by item_row.domain, item_row.urgency_bucket
$$;

revoke all on function public.create_durable_work_item(text,text,text,text,text,text,uuid,timestamptz,text,text,text) from public, anon, authenticated;
revoke all on function public.reassign_durable_work_item(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.close_durable_work_item(uuid,text,text) from public, anon, authenticated;
revoke all on function public.request_approval(text,text,text,text,text,text,text,jsonb,uuid,timestamptz,text,text) from public, anon, authenticated;
revoke all on function public.decide_approval(uuid,text,text,jsonb,text) from public, anon, authenticated;
revoke all on function public.list_work_coordination_candidates() from public, anon, authenticated;
revoke all on function public.resolve_work_item_action_href(text,jsonb) from public, anon, authenticated;
revoke all on function public.list_my_work_items(text,boolean) from public, anon, authenticated;
revoke all on function public.list_my_work_summary() from public, anon, authenticated;
revoke all on function public.reject_r1_coordination_audit_mutation() from public, anon, authenticated;

grant execute on function public.create_durable_work_item(text,text,text,text,text,text,uuid,timestamptz,text,text,text) to authenticated;
grant execute on function public.reassign_durable_work_item(uuid,uuid,text,text) to authenticated;
grant execute on function public.close_durable_work_item(uuid,text,text) to authenticated;
grant execute on function public.request_approval(text,text,text,text,text,text,text,jsonb,uuid,timestamptz,text,text) to authenticated;
grant execute on function public.decide_approval(uuid,text,text,jsonb,text) to authenticated;
grant execute on function public.list_work_coordination_candidates() to authenticated;
grant execute on function public.list_my_work_items(text,boolean) to authenticated;
grant execute on function public.list_my_work_summary() to authenticated;

comment on table public.work_items is 'R1-4 durable human coordination only; domain completion remains in domain RPCs.';
comment on table public.approval_requests is 'R1-4 independent approval request; pending rows project into the unified work list.';
comment on table public.approval_decisions is 'R1-4 immutable approval decision and audit evidence.';
comment on function public.list_my_work_items(text,boolean) is 'R1-4 unified projection of 11 domain sources, durable coordination, and independent approvals.';

commit;
