-- 续报表的沟通、季节及缴费补充事实；旧名单和历史缴费保持原样。
create table public.renewal_workbench_details (
  opportunity_id uuid primary key references public.course_opportunities(id),
  revision integer not null check (revision > 0),
  contact_method text check (contact_method in ('individual','parent_meeting','phone','wechat')),
  seasons text[] not null default '{}' check (
    seasons <@ array['winter','spring','summer','autumn']::text[]
    and cardinality(seasons) <= 4 and array_position(seasons, null) is null
  ),
  paid_on date,
  payment_method text check (payment_method in ('mofaxiao_qr','cash','alipay','offline_pos','wechat','bank_transfer','other')),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.renewal_workbench_details enable row level security;
create policy renewal_workbench_details_select_scope on public.renewal_workbench_details
  for select to authenticated using (exists (
    select 1 from public.course_opportunities o where o.id = opportunity_id
  ));
revoke all on public.renewal_workbench_details from anon, authenticated;
grant select on public.renewal_workbench_details to authenticated;

-- 版本检查、续报状态、报名、缴费补录与后续联系在一次事务内保存。
create function public.save_renewal_workbench_v1(
  p_cycle_id uuid, p_membership_id uuid, p_expected_revision integer,
  p_result text, p_note text, p_contact_method text, p_seasons text[],
  p_next_contact_at timestamptz, p_period_count integer, p_paid_amount numeric,
  p_paid_on date, p_payment_method text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cycle public.renewal_cycles%rowtype;
  v_entry public.renewal_cycle_entries%rowtype;
  v_before public.renewal_workbench_details%rowtype;
  v_details public.renewal_workbench_details%rowtype;
  v_opp public.course_opportunities%rowtype;
  v_id uuid;
  v_next timestamptz;
  v_payment jsonb;
  v_before_next timestamptz;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(auth.uid(), 'followup.write') then raise exception 'FORBIDDEN'; end if;
  if p_expected_revision is null or p_expected_revision < 0
    or p_result is null or p_result not in ('considering','payment_pending','registered','paid','not_enrolled','nurturing')
    or p_note is null or length(p_note) > 2000
    or (p_contact_method is not null and p_contact_method not in ('individual','parent_meeting','phone','wechat'))
    or p_seasons is null or not (p_seasons <@ array['winter','spring','summer','autumn']::text[])
    or cardinality(p_seasons) > 4 or array_position(p_seasons, null) is not null
    or cardinality(p_seasons) <> (select count(distinct s) from unnest(p_seasons) s)
    or (p_next_contact_at is not null and not isfinite(p_next_contact_at))
  then raise exception 'VALIDATION'; end if;
  if p_result in ('registered','paid') and not public.has_perm(auth.uid(), 'enrollment.manage') then
    raise exception 'FORBIDDEN';
  end if;
  if p_result = 'paid' then
    if p_paid_on is null or not isfinite(p_paid_on) or p_payment_method is null
      or p_payment_method not in ('mofaxiao_qr','cash','alipay','offline_pos','wechat','bank_transfer','other')
      or p_period_count is null or p_period_count not between 1 and 24
      or p_paid_amount is null or p_paid_amount <= 0 or p_paid_amount > 1000000
      or p_paid_amount <> round(p_paid_amount, 2) or p_paid_amount::text in ('NaN','Infinity','-Infinity')
    then raise exception 'VALIDATION'; end if;
  elsif p_period_count is not null or p_paid_amount is not null or p_paid_on is not null or p_payment_method is not null then
    raise exception 'VALIDATION';
  end if;

  select * into v_cycle from public.renewal_cycles where id = p_cycle_id for update;
  if not found or v_cycle.status <> 'open' then raise exception 'INVALID_CYCLE_STATE'; end if;
  select * into v_entry from public.renewal_cycle_entries
    where renewal_cycle_id = p_cycle_id and source_class_membership_id = p_membership_id for update;
  if not found or not exists (select 1 from public.enrollments e where e.id = p_membership_id
    and public.can_access_student(e.student_id, auth.uid())) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if v_entry.opportunity_id is not null then
    select * into v_opp from public.course_opportunities where id = v_entry.opportunity_id for update;
    if not public.can_access_course_opportunity_subject(v_opp.student_id, v_opp.lead_id, v_opp.owner_id, auth.uid()) then
      raise exception 'FORBIDDEN_SCOPE';
    end if;
    select * into v_before from public.renewal_workbench_details where opportunity_id = v_opp.id;
    v_before_next := v_opp.next_action_at;
  end if;
  if p_expected_revision <> coalesce(v_before.revision, 0) then raise exception 'RENEWAL_WORKBENCH_CONFLICT'; end if;
  if v_opp.stage = 'enrolled' and p_result not in ('registered','paid') then raise exception 'OPPORTUNITY_ENROLLED'; end if;
  if p_result = 'registered' and exists (select 1 from public.renewal_registration_records where opportunity_id = v_opp.id) then
    raise exception 'OPPORTUNITY_ENROLLED';
  end if;

  if p_result = 'registered' then
    v_id := v_opp.id;
    if v_opp.stage is distinct from 'enrolled' then
      v_id := public.register_renewal_result(p_cycle_id, p_membership_id, 'payment_pending', p_note);
      perform public.confirm_course_enrollment(v_id, p_note);
    end if;
  else
    v_id := public.register_renewal_result(p_cycle_id, p_membership_id,
      case when p_result = 'paid' then 'enrolled' else p_result end,
      p_note, p_period_count, p_paid_amount);
  end if;
  v_next := case when p_result in ('paid','not_enrolled') then null else p_next_contact_at end;
  update public.course_opportunities set note = btrim(p_note), next_action_at = v_next,
    next_action = case when v_next is null then '' else '续报联系' end, updated_by = auth.uid()
    where id = v_id returning * into v_opp;
  insert into public.renewal_workbench_details(opportunity_id, revision, contact_method, seasons, paid_on, payment_method, updated_by)
    values (v_id, p_expected_revision + 1, p_contact_method, p_seasons, p_paid_on, p_payment_method, auth.uid())
    on conflict (opportunity_id) do update set revision = excluded.revision, contact_method = excluded.contact_method,
      seasons = excluded.seasons, paid_on = excluded.paid_on, payment_method = excluded.payment_method,
      updated_by = excluded.updated_by, updated_at = now()
    returning * into v_details;
  insert into public.course_opportunity_events(opportunity_id, kind, from_stage, to_stage, note, recorded_by)
    values (v_id, 'stage_changed', v_opp.stage, v_opp.stage, jsonb_build_object(
      'kind', 'renewal_workbench_v1', 'before', to_jsonb(v_before), 'after', to_jsonb(v_details),
      'previous_next_contact_at', v_before_next, 'next_contact_at', v_next
    )::text, auth.uid());
  -- 报名后的备注修订保留全文事件，和有长度上限的结构化审计分别保存。
  if p_result = 'registered' then
    insert into public.course_opportunity_events(opportunity_id, kind, from_stage, to_stage, note, recorded_by)
      values (v_id, 'stage_changed', v_opp.stage, v_opp.stage, btrim(p_note), auth.uid());
  end if;
  select jsonb_build_object('opportunity_id', r.opportunity_id, 'period_count', r.period_count,
    'paid_amount', r.paid_amount, 'note', r.note) into v_payment
    from public.renewal_registration_records r where opportunity_id = v_id;
  return jsonb_build_object('record', jsonb_build_object(
    'opportunityId', v_id, 'revision', v_details.revision, 'contactMethod', v_details.contact_method,
    'seasons', v_details.seasons, 'paidOn', v_details.paid_on, 'paymentMethod', v_details.payment_method,
    'updatedAt', v_details.updated_at), 'stage', v_opp.stage, 'note', v_opp.note,
    'nextContactAt', v_next, 'payment', v_payment);
end $$;
revoke all on function public.save_renewal_workbench_v1(uuid,uuid,integer,text,text,text,text[],timestamptz,integer,numeric,date,text) from public, anon, authenticated;
grant execute on function public.save_renewal_workbench_v1(uuid,uuid,integer,text,text,text,text[],timestamptz,integer,numeric,date,text) to authenticated;
notify pgrst, 'reload schema';
