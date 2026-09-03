-- SCHOOL-OPS-LEADS-2: 种子批量分配与首联工作台。
--
-- 飞书旧表中的确认月份、确认周次、确认日期、确认人员、跟进月份、
-- 跟进周次和跟进人都由沟通记录的时间/操作人推导，不再作为人工字段。
-- 加微、诺访和意向级别仍是业务事实；每次沟通追加一条记录，下一动作单独保存。

create table public.lead_communications (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  channel text not null default 'phone'
    check (channel in ('phone','wechat','in_person','other')),
  outcome text not null
    check (outcome in ('unreachable','connected','declined','invalid_number')),
  note text not null default '' check (length(note) <= 2000),
  wechat_added boolean,
  visit_committed boolean,
  interest_level text check (interest_level is null or interest_level in ('A','B','C')),
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  owner_id_at_contact uuid references public.profiles(id) on delete set null,
  occurred_at timestamptz not null default now(),
  constraint lead_communications_reachability_check check (
    outcome in ('connected','declined')
    or (wechat_added is distinct from true and visit_committed is distinct from true)
  )
);

create index lead_communications_lead_idx
  on public.lead_communications(lead_id, occurred_at desc, id desc);

create table public.lead_next_actions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  kind text not null check (kind in (
    'initial_contact','retry','wechat_followup','visit_confirmation','nurture','other'
  )),
  due_at timestamptz not null,
  status text not null default 'open' check (status in ('open','completed','cancelled')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint lead_next_actions_completion_check check (
    (status = 'open' and completed_by is null and completed_at is null)
    or (status in ('completed','cancelled') and completed_at is not null)
  )
);

create unique index lead_next_actions_one_open_idx
  on public.lead_next_actions(lead_id) where status = 'open';
create index lead_next_actions_due_idx
  on public.lead_next_actions(status, due_at, lead_id);

comment on table public.lead_communications is
  'Append-only communication facts for unconfirmed leads. Calendar buckets and operator names are derived from occurred_at/recorded_by.';
comment on table public.lead_next_actions is
  'One current operational action per lead; assignment creates the initial contact action and communication completes/replaces it.';

alter table public.lead_communications enable row level security;
alter table public.lead_next_actions enable row level security;

create policy lead_communications_select_lead_scope on public.lead_communications
  for select to authenticated using (
    exists (select 1 from public.leads lead where lead.id = lead_communications.lead_id)
  );

create policy lead_next_actions_select_lead_scope on public.lead_next_actions
  for select to authenticated using (
    exists (select 1 from public.leads lead where lead.id = lead_next_actions.lead_id)
  );

revoke all on public.lead_communications, public.lead_next_actions
  from public, anon, authenticated;
grant select on public.lead_communications, public.lead_next_actions to authenticated;

create or replace function public.assign_leads(
  p_lead_ids uuid[],
  p_staff_user_id uuid
) returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_count integer;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid, 'student.assign') then raise exception 'FORBIDDEN'; end if;
  if p_lead_ids is null or cardinality(p_lead_ids) not between 1 and 100
     or array_position(p_lead_ids, null) is not null then
    raise exception 'INVALID_INPUT';
  end if;

  select array_agg(distinct item order by item) into v_ids from unnest(p_lead_ids) item;
  if cardinality(v_ids) <> cardinality(p_lead_ids) then raise exception 'INVALID_INPUT'; end if;
  if not public.is_staff(p_staff_user_id)
     or not public.has_perm(p_staff_user_id, 'followup.write') then
    raise exception 'TARGET_CANNOT_FOLLOW_UP';
  end if;

  perform 1
    from public.leads lead
   where lead.id = any(v_ids)
     and lead.student_id is null
     and lead.status not in ('invalid','converted')
     and (
       lead.owner_id is null
       or lead.owner_id = v_uid
       or public.has_perm(v_uid, 'student.view.all')
     )
   for update;

  select count(*) into v_count
    from public.leads lead
   where lead.id = any(v_ids)
     and lead.student_id is null
     and lead.status not in ('invalid','converted')
     and (
       lead.owner_id is null
       or lead.owner_id = v_uid
       or public.has_perm(v_uid, 'student.view.all')
     );
  if v_count <> cardinality(v_ids) then raise exception 'LEAD_SCOPE_MISMATCH'; end if;

  update public.leads
     set owner_id = p_staff_user_id,
         status = case when status = 'unassigned' then 'uncontacted' else status end
   where id = any(v_ids);

  insert into public.lead_next_actions(lead_id, kind, due_at, created_by)
  select lead_id, 'initial_contact', now(), v_uid from unnest(v_ids) lead_id
  on conflict (lead_id) where status = 'open' do nothing;

  perform public.emit_domain_event(
    'lead.assignment.batch', 'lead', v_ids[1],
    jsonb_build_object('leadIds', to_jsonb(v_ids), 'ownerId', p_staff_user_id, 'count', v_count),
    v_uid, null
  );
  return v_count;
end
$$;

create or replace function public.record_lead_contact(
  p_lead_id uuid,
  p_outcome text,
  p_note text,
  p_wechat_added boolean,
  p_visit_committed boolean,
  p_interest_level text,
  p_next_action_at timestamptz
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_lead public.leads%rowtype;
  v_communication_id uuid;
  v_next_action_kind text;
  v_status text;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid, 'followup.write') then raise exception 'FORBIDDEN'; end if;
  if p_outcome not in ('unreachable','connected','declined','invalid_number')
     or length(trim(coalesce(p_note, ''))) > 2000
     or (p_interest_level is not null and p_interest_level not in ('A','B','C')) then
    raise exception 'INVALID_INPUT';
  end if;
  if p_outcome in ('unreachable','invalid_number')
     and (p_wechat_added is true or p_visit_committed is true) then
    raise exception 'INVALID_INPUT';
  end if;
  if p_outcome = 'invalid_number' and p_next_action_at is not null then
    raise exception 'INVALID_INPUT';
  end if;
  if p_next_action_at is not null and p_next_action_at <= now() then
    raise exception 'NEXT_ACTION_NOT_FUTURE';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if v_lead.id is null then raise exception 'NOT_FOUND'; end if;
  if v_lead.owner_id is null then raise exception 'LEAD_UNASSIGNED'; end if;
  if v_lead.student_id is not null or v_lead.status in ('invalid','converted') then
    raise exception 'LEAD_CLOSED';
  end if;
  if v_lead.owner_id <> v_uid and not public.has_perm(v_uid, 'student.view.all') then
    raise exception 'FORBIDDEN_SCOPE';
  end if;

  insert into public.lead_communications(
    lead_id, channel, outcome, note, wechat_added, visit_committed,
    interest_level, recorded_by, owner_id_at_contact
  ) values (
    v_lead.id, 'phone', p_outcome, trim(coalesce(p_note, '')),
    p_wechat_added, p_visit_committed, p_interest_level, v_uid, v_lead.owner_id
  ) returning id into v_communication_id;

  update public.lead_next_actions
     set status = 'completed', completed_by = v_uid, completed_at = now()
   where lead_id = v_lead.id and status = 'open';

  v_status := case
    when p_outcome = 'invalid_number' then 'invalid'
    when p_visit_committed is true then 'intent_confirmed'
    when v_lead.status = 'intent_confirmed' then 'intent_confirmed'
    when p_outcome = 'declined' then 'nurture'
    when p_outcome = 'unreachable' and v_lead.status <> 'uncontacted' then v_lead.status
    when p_outcome = 'unreachable' then 'uncontacted'
    else 'contacted'
  end;

  update public.leads set status = v_status where id = v_lead.id;

  if p_next_action_at is not null then
    v_next_action_kind := case
      when p_visit_committed is true then 'visit_confirmation'
      when p_outcome = 'unreachable' then 'retry'
      when p_wechat_added is true then 'wechat_followup'
      when p_outcome = 'declined' then 'nurture'
      else 'other'
    end;
    insert into public.lead_next_actions(lead_id, kind, due_at, created_by)
    values (v_lead.id, v_next_action_kind, p_next_action_at, v_uid);
  end if;

  perform public.emit_domain_event(
    'lead.communication.recorded', 'lead', v_lead.id,
    jsonb_build_object(
      'communicationId', v_communication_id,
      'outcome', p_outcome,
      'status', v_status,
      'nextActionKind', v_next_action_kind,
      'nextActionAt', p_next_action_at
    ),
    v_uid, null
  );

  return jsonb_build_object(
    'communicationId', v_communication_id,
    'status', v_status,
    'nextActionKind', v_next_action_kind,
    'nextActionAt', p_next_action_at
  );
end
$$;

revoke all on function public.assign_leads(uuid[], uuid) from public, anon, authenticated;
revoke all on function public.record_lead_contact(uuid, text, text, boolean, boolean, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.assign_leads(uuid[], uuid) to authenticated;
grant execute on function public.record_lead_contact(uuid, text, text, boolean, boolean, text, timestamptz)
  to authenticated;
