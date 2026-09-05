-- 场景内报名与邀约协同后续沟通。历史报名、班级成员与考勤原样保留。
alter table public.activity_routes add column course_enrollment_id uuid
  references public.course_enrollments(id) on delete restrict;
update public.activity_routes route set course_enrollment_id=source.id
  from (select distinct on (op.source_activity_route_id) op.source_activity_route_id,ce.id
    from public.course_opportunities op join public.course_enrollments ce on ce.opportunity_id=op.id
    where op.source_activity_route_id is not null and ce.status='active'
    order by op.source_activity_route_id,ce.confirmed_at desc,ce.id) source
  where route.id=source.source_activity_route_id;

create table public.activity_followup_contacts (
  id uuid primary key,
  registration_id uuid not null references public.activity_registrations(id) on delete restrict,
  channel text not null check (channel in ('phone','wechat','in_person','other')),
  outcome text not null check (outcome in ('connected','unreachable')),
  route text not null check (route in ('continue_follow_up','await_product','closed','enrollment_pending')),
  note text not null default '' check (length(note) <= 2000),
  next_contact_at timestamptz,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  occurred_at timestamptz not null default clock_timestamp()
);
create index activity_followup_contacts_timeline_idx
  on public.activity_followup_contacts(registration_id, occurred_at desc, id);
alter table public.activity_followup_contacts enable row level security;
revoke all on public.activity_followup_contacts from public, anon, authenticated;
grant select on public.activity_followup_contacts to authenticated;
create trigger activity_followup_contacts_immutable before update or delete
  on public.activity_followup_contacts for each row
  execute function public.guard_phase3_enrollment_history();

create function public.can_follow_up_participation(p_registration_id uuid, p_uid uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.activity_registrations r
    join public.activities a on a.id = r.activity_id
    left join public.students s on s.id = r.student_id
    left join public.leads l on l.id = r.lead_id
    where r.id = p_registration_id and a.deleted_at is null
      and public.can_access_course_opportunity_subject(r.student_id, r.lead_id, coalesce(s.assigned_to,l.owner_id),p_uid)
  )
$$;
create policy activity_followup_contacts_select on public.activity_followup_contacts
  for select to authenticated using (
    public.can_follow_up_participation(registration_id, (select auth.uid()))
  );

create function public.get_activity_enrollment_context(p_registration_id uuid, p_invitation_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid := p_registration_id;
  v_result jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if num_nonnulls(p_registration_id,p_invitation_id) <> 1 then raise exception 'VALIDATION'; end if;
  if not (public.has_perm(v_uid,'followup.view') or public.has_perm(v_uid,'followup.write')
    or public.has_perm(v_uid,'enrollment.manage')) then raise exception 'FORBIDDEN'; end if;
  if p_invitation_id is not null then
    select r.id into v_id from public.activities a join public.activity_registrations r on r.activity_id=a.id
      where a.source_invitation_id=p_invitation_id and a.deleted_at is null limit 1;
  end if;
  if not public.can_follow_up_participation(v_id,v_uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
  select jsonb_build_object(
    'registrationId',r.id,'studentId',r.student_id,'leadId',r.lead_id,
    'name',coalesce(s.name,l.provisional_student_name,''),'phone',coalesce(s.phone,l.phone,''),
    'grade',coalesce(s.grade,l.grade_hint),'gradeText',coalesce(l.grade_text,''),
    'ownerId',coalesce(s.assigned_to,l.owner_id),'leadStatus',l.status,
    'activityId',a.id,'activityTitle',a.title,'activityAt',a.scheduled_at,
    'eligible',r.status <> 'cancelled' and case when a.kind='assessment_1v1'
      then r.assessment_completed_at is not null or (r.assessment_started_at is null and ar.id is not null and r.status='attended')
      else r.status='attended' or exists (select 1 from public.public_class_participant_records pr
        where pr.registration_id=r.id and pr.student_presence in ('attended','late')) end,
    'recommendation',coalesce(nullif(ar.teacher_recommendation,''),(
      select nullif(pr.recommendation,'') from public.public_class_participant_records pr
      where pr.registration_id=r.id and pr.recommendation<>'' order by pr.updated_at desc limit 1),''),
    'assessmentBand',ar.assessment_band,'route',route.route,
    'routeNote',coalesce(route.note,''),'enrollmentId',case when ce.status='active' then ce.id end,
    'courseTitle',c.title,'termName',st.name,'classroomName',cl.name,'termId',ce.term_id,
    'canContact',public.has_perm(v_uid,'followup.write'),
    'canEnroll',public.has_perm(v_uid,'enrollment.manage'),
    'contacts',coalesce((select jsonb_agg(item order by item->>'occurredAt' desc) from (
      select jsonb_build_object('id',ct.id,'channel',ct.channel,'outcome',ct.outcome,'route',ct.route,
        'note',ct.note,'nextContactAt',ct.next_contact_at,'occurredAt',ct.occurred_at,
        'recordedByName',coalesce(p.display_name,'')) item
      from public.activity_followup_contacts ct left join public.profiles p on p.id=ct.recorded_by
      where ct.registration_id=r.id order by ct.occurred_at desc,ct.id limit 30
    ) history),'[]'::jsonb)
  ) into v_result
  from public.activity_registrations r join public.activities a on a.id=r.activity_id
  left join public.students s on s.id=r.student_id left join public.leads l on l.id=r.lead_id
  left join public.assessment_results ar on ar.activity_registration_id=r.id
  left join public.activity_routes route on route.activity_registration_id=r.id
  left join public.course_enrollments ce on ce.id=route.course_enrollment_id
  left join public.courses c on c.id=ce.course_id left join public.school_terms st on st.id=ce.term_id
  left join public.course_enrollment_assignments ca on ca.course_enrollment_id=ce.id and ca.status='active'
  left join public.classrooms cl on cl.id=ca.classroom_id where r.id=v_id;
  return v_result;
end $$;

create function public.save_post_activity_contact(
  p_registration_id uuid,p_request_id uuid,p_channel text,p_outcome text,p_route text,p_note text,p_next_contact_at timestamptz
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_context jsonb; v_existing public.activity_followup_contacts%rowtype;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid,'followup.write') then raise exception 'FORBIDDEN'; end if;
  if p_request_id is null or p_channel is null or p_channel not in ('phone','wechat','in_person','other')
    or p_outcome is null or p_outcome not in ('connected','unreachable')
    or p_route is null or p_route not in ('continue_follow_up','await_product','closed','enrollment_pending')
    or length(coalesce(p_note,''))>2000 then raise exception 'VALIDATION'; end if;
  perform 1 from public.activity_registrations where id=p_registration_id for update;
  v_context := public.get_activity_enrollment_context(p_registration_id,null);
  if not (v_context->>'eligible')::boolean then raise exception 'PARTICIPATION_NOT_COMPLETED'; end if;
  select * into v_existing from public.activity_followup_contacts where id=p_request_id;
  if found then
    if v_existing.registration_id<>p_registration_id or v_existing.recorded_by<>v_uid
      or v_existing.channel<>p_channel or v_existing.outcome<>p_outcome or v_existing.route<>p_route
      or v_existing.note<>btrim(coalesce(p_note,'')) or v_existing.next_contact_at is distinct from p_next_contact_at
      then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return v_existing.id;
  end if;
  insert into public.activity_followup_contacts(id,registration_id,channel,outcome,route,note,next_contact_at,recorded_by)
    values(p_request_id,p_registration_id,p_channel,p_outcome,p_route,btrim(coalesce(p_note,'')),p_next_contact_at,v_uid);
  insert into public.activity_routes(activity_registration_id,student_id,lead_id,route,note,routed_by)
    select id,student_id,lead_id,p_route,btrim(coalesce(p_note,'')),v_uid from public.activity_registrations where id=p_registration_id
    on conflict(activity_registration_id) do update set route=excluded.route,note=excluded.note,routed_by=excluded.routed_by;
  return p_request_id;
end $$;

create function public.get_post_activity_followups()
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid,'followup.view') then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(public.get_activity_enrollment_context(r.activity_registration_id,null)
    order by r.updated_at desc,r.id) from public.activity_routes r
    where public.can_follow_up_participation(r.activity_registration_id,v_uid)), '[]'::jsonb);
end $$;

create function public.confirm_activity_enrollment(
  p_registration_id uuid,p_course_id uuid,p_term_id uuid,p_classroom_id uuid,p_note text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_context jsonb; v_student uuid; v_route uuid;
  v_opportunity uuid; v_enrollment uuid; v_stage text; v_note text := btrim(coalesce(p_note,''));
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid,'enrollment.manage') then raise exception 'FORBIDDEN'; end if;
  if length(v_note)>2000 then raise exception 'VALIDATION'; end if;
  perform 1 from public.activity_registrations where id=p_registration_id for update;
  v_context := public.get_activity_enrollment_context(p_registration_id,null);
  if not (v_context->>'eligible')::boolean then raise exception 'PARTICIPATION_NOT_COMPLETED'; end if;
  v_student := (v_context->>'studentId')::uuid;
  if v_student is null then raise exception 'IDENTITY_NOT_CONFIRMED'; end if;
  if not exists(select 1 from public.students where id=v_student and deleted_at is null) then raise exception 'STUDENT_NOT_AVAILABLE'; end if;
  if not exists(select 1 from public.courses where id=p_course_id and status='enabled' and purpose='production'
    and course_kind='curriculum' and trashed_at is null) then raise exception 'COURSE_NOT_AVAILABLE'; end if;
  if not exists(select 1 from public.school_terms where id=p_term_id) then raise exception 'TERM_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_student::text||p_course_id::text||p_term_id::text,60103));
  insert into public.activity_routes(activity_registration_id,student_id,route,note,routed_by)
    values(p_registration_id,v_student,'enrollment_pending',v_note,v_uid)
    on conflict(activity_registration_id) do update set route=excluded.route,routed_by=excluded.routed_by
    returning id into v_route;
  select id into v_enrollment from public.course_enrollments where student_id=v_student
    and course_id=p_course_id and term_id=p_term_id and status='active' for update;
  if v_enrollment is null then
    select id,stage into v_opportunity,v_stage from public.course_opportunities
      where student_id=v_student and opportunity_type='new' and course_id=p_course_id and term_id=p_term_id for update;
    if v_opportunity is null then
      insert into public.course_opportunities(source_activity_route_id,student_id,opportunity_type,course_id,term_id,stage,
        owner_id,note,created_by,updated_by) values(v_route,v_student,'new',p_course_id,p_term_id,'committed',
        coalesce((v_context->>'ownerId')::uuid,v_uid),v_note,v_uid,v_uid) returning id into v_opportunity;
      insert into public.course_opportunity_events(opportunity_id,kind,to_stage,note,recorded_by)
        values(v_opportunity,'created','committed',v_note,v_uid);
    elsif v_stage <> 'committed' and v_stage <> 'enrolled' then
      update public.course_opportunities set stage='committed',updated_by=v_uid where id=v_opportunity;
      insert into public.course_opportunity_events(opportunity_id,kind,from_stage,to_stage,note,recorded_by)
        values(v_opportunity,'stage_changed',v_stage,'committed',v_note,v_uid);
    end if;
    v_enrollment := public.confirm_course_enrollment(v_opportunity,v_note);
  end if;
  if p_classroom_id is not null then
    perform public.assign_course_enrollment(v_enrollment,p_classroom_id,v_note,clock_timestamp());
  end if;
  update public.activity_routes set course_enrollment_id=v_enrollment where id=v_route;
  return v_enrollment;
end $$;

create function public.get_enrollment_workflow_options()
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare v_base jsonb;
begin
  v_base := public.get_phase3_enrollment_options();
  return v_base || jsonb_build_object('classrooms',coalesce((select jsonb_agg(item || jsonb_build_object(
    'teacherNames',coalesce((select string_agg(p.display_name,' / ' order by ca.responsibility,p.display_name)
      from public.classroom_staff_assignments ca join public.profiles p on p.id=ca.user_id
      where ca.classroom_id=(item->>'id')::uuid and ca.responsibility in ('primary_teacher','assistant_teacher')),''),
    'sessions',coalesce((select jsonb_agg(jsonb_build_object('at',x.scheduled_at,'duration',x.duration_min) order by x.scheduled_at)
      from (select cs.scheduled_at,cs.duration_min from public.class_sessions cs where cs.classroom_id=(item->>'id')::uuid
        and cs.deleted_at is null and cs.cancelled_by is null and cs.voided_at is null and cs.scheduled_at>=now()
        order by cs.scheduled_at limit 8) x),'[]'::jsonb)
    )) from jsonb_array_elements(v_base->'classrooms') item),'[]'::jsonb));
end $$;

create function public.get_enrollment_placement_board()
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
declare v_options jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(auth.uid(),'enrollment.manage') then raise exception 'FORBIDDEN'; end if;
  v_options := public.get_enrollment_workflow_options();
  return jsonb_build_object('options',v_options,'enrollments',public.get_course_enrollment_workbench(),
    'members',coalesce((select jsonb_agg(jsonb_build_object('membershipId',r.id,'studentId',r.student_id,
      'name',s.name,'phone',coalesce(s.phone,''),'classroomId',r.classroom_id,
      'enrollmentId',coalesce(ca.course_enrollment_id,ce.id),'note',coalesce(r.remark,''),
      'recommendation',coalesce((select ar.teacher_recommendation from public.assessment_results ar
        where ar.student_id=r.student_id and ar.teacher_recommendation<>'' order by ar.updated_at desc limit 1),'')) order by r.joined_at,r.id)
      from public.enrollments r join public.students s on s.id=r.student_id
      join public.classrooms cl on cl.id=r.classroom_id
      left join public.course_enrollment_assignments ca on ca.classroom_membership_id=r.id and ca.status='active'
      left join public.course_enrollments ce on ce.student_id=r.student_id and ce.course_id=cl.course_id and ce.term_id=cl.term_id and ce.status='active'
      where r.status='active' and exists(select 1 from jsonb_array_elements(v_options->'classrooms') opt where opt->>'id'=r.classroom_id::text)), '[]'::jsonb));
end $$;

-- 拖动的最终落点由数据库确认；旧花名册在第一次调整时补齐关联。
create function public.move_enrollment_placement(
  p_enrollment_id uuid,p_membership_id uuid,p_from_classroom_id uuid,p_to_classroom_id uuid
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid:=auth.uid(); v_enrollment uuid:=p_enrollment_id; v_opportunity uuid; v_stage text;
  v_member public.enrollments%rowtype; v_class public.classrooms%rowtype;
  v_assignment public.course_enrollment_assignments%rowtype; v_now timestamptz:=clock_timestamp();
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid,'enrollment.manage') then raise exception 'FORBIDDEN'; end if;
  if v_enrollment is null and p_membership_id is null then raise exception 'VALIDATION'; end if;
  if p_membership_id is not null then
    select * into v_member from public.enrollments where id=p_membership_id for update;
    if not found or v_member.status<>'active' then raise exception 'PLACEMENT_CHANGED'; end if;
    if v_member.classroom_id is distinct from p_from_classroom_id then raise exception 'PLACEMENT_CHANGED'; end if;
    if not public.can_manage_classroom(v_member.classroom_id,v_uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
    select * into v_class from public.classrooms where id=v_member.classroom_id;
    if v_class.course_id is null or v_class.term_id is null or v_class.purpose<>'production'
      or v_class.offering_type<>'long_term_formal' or v_class.trashed_at is not null or v_class.archived_at is not null
      or v_member.term_id is distinct from v_class.term_id then raise exception 'CLASS_NOT_AVAILABLE'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_member.student_id::text||v_class.course_id::text||v_class.term_id::text,60103));
    if v_enrollment is null then
      select id into v_enrollment from public.course_enrollments where student_id=v_member.student_id
        and course_id=v_class.course_id and term_id=v_class.term_id and status='active';
      if v_enrollment is null then
        select id,stage into v_opportunity,v_stage from public.course_opportunities where student_id=v_member.student_id
          and opportunity_type='new' and course_id=v_class.course_id and term_id=v_class.term_id for update;
        if v_opportunity is null then
          insert into public.course_opportunities(student_id,course_id,term_id,stage,owner_id,note,created_by,updated_by)
            values(v_member.student_id,v_class.course_id,v_class.term_id,'committed',v_uid,'关联已有班级花名册',v_uid,v_uid)
            returning id into v_opportunity;
          insert into public.course_opportunity_events(opportunity_id,kind,to_stage,note,recorded_by)
            values(v_opportunity,'created','committed','关联已有班级花名册',v_uid);
        elsif v_stage not in ('committed','enrolled') then
          update public.course_opportunities set stage='committed',updated_by=v_uid where id=v_opportunity;
          insert into public.course_opportunity_events(opportunity_id,kind,from_stage,to_stage,note,recorded_by)
            values(v_opportunity,'stage_changed',v_stage,'committed','关联已有班级花名册',v_uid);
        end if;
        v_enrollment:=public.confirm_course_enrollment(v_opportunity,'关联已有班级花名册');
      end if;
    end if;
    if not exists(select 1 from public.course_enrollments where id=v_enrollment and student_id=v_member.student_id
      and course_id=v_class.course_id and term_id=v_class.term_id and status='active') then raise exception 'PLACEMENT_CHANGED'; end if;
  end if;
  perform 1 from public.course_enrollments where id=v_enrollment and status='active' for update;
  if not found then raise exception 'ENROLLMENT_NOT_ACTIVE'; end if;
  if p_membership_id is not null and not exists(select 1 from public.course_enrollment_assignments where course_enrollment_id=v_enrollment and status='active') then
    perform public.assign_course_enrollment(v_enrollment,v_member.classroom_id,'关联已有班级花名册',v_now);
  end if;
  select * into v_assignment from public.course_enrollment_assignments where course_enrollment_id=v_enrollment and status='active' for update;
  if v_assignment.classroom_id is not distinct from p_to_classroom_id then return v_enrollment; end if;
  if v_assignment.classroom_id is distinct from p_from_classroom_id then raise exception 'PLACEMENT_CHANGED'; end if;
  if p_to_classroom_id is null then
    if not public.can_manage_classroom(v_assignment.classroom_id,v_uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
    update public.enrollments set status='withdrawn',left_at=v_now,operated_by=v_uid
      where id=v_assignment.classroom_membership_id and status='active';
    insert into public.course_enrollment_events(course_enrollment_id,kind,from_classroom_id,note,recorded_by,occurred_at)
      values(v_enrollment,'unassigned',v_assignment.classroom_id,'保留报名，退回待分班',v_uid,v_now);
  elsif v_assignment.id is null then
    perform public.assign_course_enrollment(v_enrollment,p_to_classroom_id,'分班表安排',v_now);
  else
    perform public.transfer_course_enrollment(v_enrollment,p_to_classroom_id,'分班表调班',v_now);
  end if;
  return v_enrollment;
end $$;

revoke all on function public.can_follow_up_participation(uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_activity_enrollment_context(uuid,uuid) from public,anon,authenticated;
revoke all on function public.save_post_activity_contact(uuid,uuid,text,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.get_post_activity_followups() from public,anon,authenticated;
revoke all on function public.confirm_activity_enrollment(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.get_enrollment_workflow_options() from public,anon,authenticated;
revoke all on function public.get_enrollment_placement_board() from public,anon,authenticated;
revoke all on function public.move_enrollment_placement(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.can_follow_up_participation(uuid,uuid) to authenticated;
grant execute on function public.get_activity_enrollment_context(uuid,uuid) to authenticated;
grant execute on function public.save_post_activity_contact(uuid,uuid,text,text,text,text,timestamptz) to authenticated;
grant execute on function public.get_post_activity_followups() to authenticated;
grant execute on function public.confirm_activity_enrollment(uuid,uuid,uuid,uuid,text) to authenticated;
grant execute on function public.get_enrollment_workflow_options() to authenticated;
grant execute on function public.get_enrollment_placement_board() to authenticated;
grant execute on function public.move_enrollment_placement(uuid,uuid,uuid,uuid) to authenticated;
select pg_notify('pgrst','reload schema');
