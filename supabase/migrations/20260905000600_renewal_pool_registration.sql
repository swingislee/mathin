-- 续班登记附属于既有课程意向，金额为人工登记事实，不触发收费。
create table public.renewal_registration_records (
  opportunity_id uuid primary key references public.course_opportunities(id) on delete restrict,
  period_count integer not null check (period_count between 1 and 24),
  paid_amount numeric(12,2) not null check (paid_amount > 0),
  recorded_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.renewal_registration_records enable row level security;
create policy renewal_registration_read on public.renewal_registration_records for select to authenticated
  using (exists(select 1 from public.course_opportunities o where o.id=opportunity_id
    and public.has_perm(auth.uid(),'followup.view') and public.can_access_student(o.student_id,auth.uid())));
revoke all on public.renewal_registration_records from public,anon,authenticated;
grant select on public.renewal_registration_records to authenticated;

create function public.register_renewal_result(
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
    insert into public.renewal_registration_records values(v_opp.id,p_period_count,p_paid_amount,auth.uid(),now())
      on conflict(opportunity_id) do update set period_count=excluded.period_count,paid_amount=excluded.paid_amount,
        recorded_by=excluded.recorded_by,updated_at=excluded.updated_at;
  end if;
  insert into public.course_opportunity_events(opportunity_id,kind,from_stage,to_stage,note,recorded_by)
    values(v_opp.id,'stage_changed',v_opp.stage,p_stage,jsonb_build_object('kind','renewal_registration','note',p_note,
      'period_count',p_period_count,'paid_amount',p_paid_amount)::text,auth.uid());
  return v_opp.id;
end $$;
revoke all on function public.register_renewal_result(uuid,uuid,text,text,integer,numeric) from public,anon,authenticated;
grant execute on function public.register_renewal_result(uuid,uuid,text,text,integer,numeric) to authenticated;

-- 每个学生从可访问的成员关系取最近 56 天事实，前后各 28 天比较。
create function public.get_renewal_health_facts(p_student_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(auth.uid(),'followup.view') then raise exception 'FORBIDDEN'; end if;
  if cardinality(p_student_ids)>200 then raise exception 'VALIDATION'; end if;
  with subjects as (
    select s.id,s.user_id from public.students s where s.id=any(p_student_ids) and public.can_access_student(s.id,auth.uid())
  ), sessions as (
    select distinct s.id student_id,c.id session_id,c.classroom_id,coalesce(c.started_at,c.scheduled_at) at
    from subjects s join public.enrollments e on e.student_id=s.id join public.class_sessions c on c.classroom_id=e.classroom_id
    where c.deleted_at is null and c.cancelled_by is null and c.voided_at is null
      and coalesce(c.started_at,c.scheduled_at) between greatest(e.joined_at,now()-interval '56 days') and least(coalesce(e.left_at,now()),now())
      and c.started_at is not null
  ) select coalesce(jsonb_agg(jsonb_build_object(
    'studentId',s.id,'hasLearningAccount',s.user_id is not null,
    'lessons',(select coalesce(jsonb_agg(jsonb_build_object('id',x.session_id,'at',x.at,'attendance',a.status)),'[]') from sessions x left join public.session_attendance a on a.session_id=x.session_id and a.student_id=s.id where x.student_id=s.id),
    'checks',(select coalesce(jsonb_agg(jsonb_build_object('at',x.at,'status',r.status)),'[]') from sessions x join public.session_learning_checks c on c.session_id=x.session_id left join public.session_learning_check_results r on r.check_id=c.id and r.student_id=s.id where x.student_id=s.id),
    'contacts',(select coalesce(jsonb_agg(f.created_at),'[]') from public.student_follow_ups f where f.student_id=s.id and f.kind in ('call','visit') and f.created_at>=now()-interval '56 days'),
    'homework',(select coalesce(jsonb_agg(jsonb_build_object('at',a.due_at,'submitted',sub.submitted_at is not null,'score',sub.score)),'[]')
      from public.assignments a left join public.submissions sub on sub.assignment_id=a.id and sub.user_id=s.user_id
      where a.due_at between now()-interval '56 days' and now() and exists(select 1 from public.enrollments e where e.student_id=s.id and e.classroom_id=a.classroom_id and a.created_at>=e.joined_at and a.created_at<=coalesce(e.left_at,now()))),
    'videos',(select coalesce(jsonb_agg(jsonb_build_object('at',v.due_at,'submitted',exists(select 1 from public.session_videos u where u.session_id=v.session_id and u.student_id=s.id and u.deleted_at is null))),'[]')
      from public.session_video_tasks v where v.published_at is not null and v.due_at<now() and exists(select 1 from sessions x where x.student_id=s.id and x.session_id=v.session_id))
  )),'[]') into v_result from subjects s;
  return v_result;
end $$;
revoke all on function public.get_renewal_health_facts(uuid[]) from public,anon,authenticated;
grant execute on function public.get_renewal_health_facts(uuid[]) to authenticated;
notify pgrst,'reload schema';
