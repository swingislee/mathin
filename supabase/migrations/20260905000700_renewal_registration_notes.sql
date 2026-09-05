-- 缴费补录备注单独持久化；金额审计与全文备注分开，保留 2000 字符边界。
alter table public.renewal_registration_records add column note text not null default '' check(length(note)<=2000);
create or replace function public.register_renewal_result(
  p_cycle_id uuid, p_membership_id uuid, p_stage text, p_note text,
  p_period_count integer default null, p_paid_amount numeric default null
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_entry public.renewal_cycle_entries%rowtype;
  v_opp public.course_opportunities%rowtype;
  v_cycle public.renewal_cycles%rowtype;
  v_owner uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(auth.uid(),'followup.write') then raise exception 'FORBIDDEN'; end if;
  if p_stage is null or p_stage not in ('considering','payment_pending','enrolled','not_enrolled','nurturing')
    or p_note is null or length(p_note)>2000 then raise exception 'VALIDATION'; end if;
  select * into v_cycle from public.renewal_cycles where id=p_cycle_id for update;
  if not found or v_cycle.status<>'open' then raise exception 'INVALID_CYCLE_STATE'; end if;
  select * into v_entry from public.renewal_cycle_entries where renewal_cycle_id=p_cycle_id
    and source_class_membership_id=p_membership_id for update;
  if not found or not exists(select 1 from public.enrollments e where e.id=p_membership_id
    and public.can_access_student(e.student_id,auth.uid())) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if p_stage='enrolled' then
    if not public.has_perm(auth.uid(),'enrollment.manage') then raise exception 'FORBIDDEN'; end if;
    if p_period_count is null or p_period_count not between 1 and 24 or p_paid_amount is null
      or p_paid_amount<=0 or p_paid_amount>9999999999.99 or p_paid_amount<>round(p_paid_amount,2)
      or p_paid_amount::text in ('NaN','Infinity','-Infinity') then raise exception 'VALIDATION'; end if;
  elsif p_period_count is not null or p_paid_amount is not null then raise exception 'VALIDATION'; end if;
  if v_entry.opportunity_id is null then
    select s.assigned_to into v_owner from public.enrollments e join public.students s on s.id=e.student_id where e.id=p_membership_id;
    perform public.prepare_renewal_opportunities(p_cycle_id,array[p_membership_id],coalesce(v_owner,auth.uid()),'续班登记',now());
    select opportunity_id into v_entry.opportunity_id from public.renewal_cycle_entries
      where renewal_cycle_id=p_cycle_id and source_class_membership_id=p_membership_id;
  end if;
  select * into v_opp from public.course_opportunities where id=v_entry.opportunity_id for update;
  if v_opp.stage='enrolled' and p_stage<>'enrolled' then raise exception 'OPPORTUNITY_ENROLLED'; end if;
  if v_opp.stage<>'enrolled' then
    -- 快捷登记仍沿用规范状态转换；重新沟通先恢复为规划中。
    if not public.course_opportunity_transition_allowed(v_opp.stage,case when p_stage in ('payment_pending','enrolled') then 'committed' else p_stage end) then
      perform public.save_course_opportunity(v_opp.id,null,null,null,'renewal',v_opp.course_id,v_opp.term_id,'planning',v_opp.owner_id,'',null,p_note);
    end if;
    perform public.save_course_opportunity(v_opp.id,null,null,null,'renewal',v_opp.course_id,v_opp.term_id,
      case when p_stage in ('payment_pending','enrolled') then 'committed' else p_stage end,v_opp.owner_id,'',null,p_note);
    if p_stage='payment_pending' then
      perform public.save_course_opportunity(v_opp.id,null,null,null,'renewal',v_opp.course_id,v_opp.term_id,p_stage,v_opp.owner_id,'',null,p_note);
    elsif p_stage='enrolled' then perform public.confirm_course_enrollment(v_opp.id,p_note); end if;
  end if;
  if p_stage='enrolled' then
    insert into public.renewal_registration_records(opportunity_id,period_count,paid_amount,recorded_by,updated_at,note) values(v_opp.id,p_period_count,p_paid_amount,auth.uid(),now(),p_note)
      on conflict(opportunity_id) do update set period_count=excluded.period_count,paid_amount=excluded.paid_amount,
        recorded_by=excluded.recorded_by,updated_at=excluded.updated_at,note=excluded.note;
  end if;
  insert into public.course_opportunity_events(opportunity_id,kind,from_stage,to_stage,note,recorded_by)
    values(v_opp.id,'stage_changed',v_opp.stage,p_stage,jsonb_build_object('kind','renewal_registration',
      'period_count',p_period_count,'paid_amount',p_paid_amount)::text,auth.uid());
  insert into public.course_opportunity_events(opportunity_id,kind,from_stage,to_stage,note,recorded_by)
    values(v_opp.id,'stage_changed',p_stage,p_stage,p_note,auth.uid());
  return v_opp.id;
end $$;
notify pgrst,'reload schema';
