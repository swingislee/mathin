-- Reference validity is a current reading of historical facts. It never edits
-- completion, enrollment, sent-report identities, or frozen report payloads.
create table public.assessment_reference_policy (
  singleton boolean primary key default true check(singleton),
  validity_months integer not null default 6 check(validity_months between 1 and 36),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references public.profiles(id) on delete restrict
);
insert into public.assessment_reference_policy(singleton) values(true);
alter table public.assessment_reference_policy enable row level security;
revoke all on public.assessment_reference_policy from public, anon, authenticated;
grant select on public.assessment_reference_policy to authenticated;
create policy assessment_reference_policy_read on public.assessment_reference_policy for select to authenticated
  using(public.is_staff(auth.uid()) and (public.has_perm(auth.uid(),'followup.view')
    or public.assessment_slots_can_manage(auth.uid(),auth.uid())));

create function public.get_assessment_reference_policy() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(auth.uid()) or not (public.has_perm(auth.uid(),'followup.view')
    or public.assessment_slots_can_manage(auth.uid(),auth.uid())) then raise exception 'FORBIDDEN'; end if;
  return (select jsonb_build_object('validityMonths',validity_months,'updatedAt',updated_at,
    'canManage',public.assessment_slots_manage_all(auth.uid())) from public.assessment_reference_policy where singleton);
end $$;

create function public.save_assessment_reference_policy(p_validity_months integer,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_updated timestamptz;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.assessment_slots_manage_all(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  if p_validity_months is null or p_validity_months not between 1 and 36 then raise exception 'VALIDATION'; end if;
  select updated_at into v_updated from public.assessment_reference_policy where singleton for update;
  if p_expected_updated_at is null or p_expected_updated_at is distinct from v_updated then raise exception 'CONFLICT'; end if;
  update public.assessment_reference_policy set validity_months=p_validity_months,updated_by=auth.uid(),updated_at=clock_timestamp() where singleton;
  return public.get_assessment_reference_policy();
end $$;

-- One calendar-month calculation shared by the staff and family projections.
create function public.assessment_reference_validity_value(p_assessed_on date,p_months integer,p_today date) returns jsonb
language sql immutable set search_path=public,pg_temp as $$
  select jsonb_build_object('status',case when p_assessed_on is null or p_assessed_on>p_today then 'unknown'
      when p_today>(p_assessed_on+make_interval(months=>p_months))::date then 'expired' else 'valid' end,
    'assessedOn',p_assessed_on,'validUntil',case when p_assessed_on<=p_today then (p_assessed_on+make_interval(months=>p_months))::date end,
    'validityMonths',p_months);
$$;

-- Import timestamps and later edits must not refresh an old assessment.
-- The invoker view retains the existing registration/activity/result RLS.
create view public.assessment_reference_dates with(security_invoker=true) as
  select r.id as registration_id,
    coalesce(ar.assessed_on,a.occurred_on,case when r.source_record_id is null and a.source_record_id is null and a.record_state<>'historical'
      then (coalesce(r.assessment_completed_at,ar.result_finalized_at,a.scheduled_at) at time zone 'Asia/Shanghai')::date end) as assessed_on
  from public.business_activity_registrations r join public.business_activities a on a.id=r.activity_id
  left join public.business_assessment_results ar on ar.activity_registration_id=r.id
  where a.deleted_at is null;
revoke all on public.assessment_reference_dates from public,anon,authenticated;
grant select on public.assessment_reference_dates to authenticated;

create function public.get_assessment_reference_validities(p_registration_ids uuid[]) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_registration_ids is null or cardinality(p_registration_ids)>100 or array_position(p_registration_ids,null) is not null
    then raise exception 'VALIDATION'; end if;
  return (select coalesce(jsonb_object_agg(d.registration_id,public.assessment_reference_validity_value(
      d.assessed_on,p.validity_months,(now() at time zone 'Asia/Shanghai')::date)),'{}')
    from public.assessment_reference_dates d cross join public.assessment_reference_policy p
    where d.registration_id=any(p_registration_ids));
end $$;

-- Append to the existing delivery projection so other report extensions and the
-- established sent-report/guardian scope remain intact regardless of ordering.
alter function public.miniapp_assessment_reports() rename to miniapp_assessment_reports_before_validity;
revoke all on function public.miniapp_assessment_reports_before_validity() from public,anon,authenticated;
create function public.miniapp_assessment_reports() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(item||jsonb_build_object('referenceValidity',public.assessment_reference_validity_value(
    d.assessed_on,policy.validity_months,(now() at time zone 'Asia/Shanghai')::date)) order by ord),'[]')
  from jsonb_array_elements(public.miniapp_assessment_reports_before_validity()) with ordinality as original(item,ord)
  left join public.assessment_reports report on report.id=(item->>'id')::uuid
  left join public.assessment_reference_dates d on d.registration_id=report.registration_id
  cross join public.assessment_reference_policy policy;
$$;
revoke all on function public.get_assessment_reference_policy(),public.save_assessment_reference_policy(integer,timestamptz),
  public.assessment_reference_validity_value(date,integer,date),public.get_assessment_reference_validities(uuid[]),
  public.miniapp_assessment_reports() from public,anon,authenticated;
grant execute on function public.get_assessment_reference_policy(),public.save_assessment_reference_policy(integer,timestamptz),
  public.assessment_reference_validity_value(date,integer,date),public.get_assessment_reference_validities(uuid[]),
  public.miniapp_assessment_reports() to authenticated;

notify pgrst,'reload schema';
