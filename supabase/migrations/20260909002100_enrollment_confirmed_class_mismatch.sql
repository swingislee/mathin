-- 老师明确确认课程／学期不匹配后插班；原因和确认标志写入原分班收据与事件。
-- 公开旧入口继续使用默认匹配校验，内部实现复用原权限、并发、班额和历史保留逻辑。

CREATE OR REPLACE FUNCTION mathin_internal.assign_course_enrollment(p_course_enrollment_id uuid, p_classroom_id uuid, p_note text, p_effective_at timestamp with time zone DEFAULT now(), p_allow_mismatch boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_enrollment public.course_enrollments%rowtype;
  v_classroom public.classrooms%rowtype;
  v_assignment public.course_enrollment_assignments%rowtype;
  v_membership_id uuid;
  v_membership_joined_at timestamptz;
  v_linked_enrollment_id uuid;
  v_active_count integer;
  v_note text := btrim(coalesce(p_note, ''));
  v_effective_at timestamptz := p_effective_at;
begin
 perform public.require_current_business_record('course_enrollments',p_course_enrollment_id);
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid, 'enrollment.manage') then raise exception 'FORBIDDEN'; end if;
  if char_length(v_note) > 2000 then raise exception 'INVALID_ASSIGNMENT'; end if;

  select * into v_enrollment
    from public.course_enrollments
   where id = p_course_enrollment_id
   for update;
  if not found or v_enrollment.status <> 'active' then raise exception 'ENROLLMENT_NOT_ACTIVE'; end if;
  if v_effective_at is null
     or v_effective_at < v_enrollment.confirmed_at
     or v_effective_at > now() + interval '5 minutes' then
    raise exception 'INVALID_EFFECTIVE_AT';
  end if;

  select * into v_assignment
    from public.course_enrollment_assignments
   where course_enrollment_id = v_enrollment.id and status = 'active'
   for update;
  if found then
    if v_assignment.classroom_id = p_classroom_id then return v_assignment.classroom_membership_id; end if;
    raise exception 'ENROLLMENT_ALREADY_ASSIGNED';
  end if;

  select * into v_classroom from public.classrooms where id = p_classroom_id for update;
  if not found or v_classroom.archived_at is not null or v_classroom.trashed_at is not null
     or v_classroom.operational_status not in ('planning','active')
     or v_classroom.purpose <> 'production'
     or v_classroom.offering_type <> 'long_term_formal' then
    raise exception 'CLASS_NOT_AVAILABLE';
  end if;
  if not public.can_manage_classroom(v_classroom.id, v_uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if not p_allow_mismatch and (v_classroom.course_id is distinct from v_enrollment.course_id
     or v_classroom.term_id is distinct from v_enrollment.term_id) then
    raise exception 'CLASS_TARGET_MISMATCH';
  end if;

  select roster.id, roster.joined_at into v_membership_id, v_membership_joined_at
    from public.enrollments roster
   where roster.classroom_id = v_classroom.id
     and roster.student_id = v_enrollment.student_id
     and roster.status = 'active'
   limit 1;
  if v_membership_id is not null then
    if not exists (
      select 1 from public.enrollments roster
       where roster.id = v_membership_id
         and roster.term_id is not distinct from v_classroom.term_id
    ) then raise exception 'CLASS_TARGET_MISMATCH'; end if;
    select bridge.course_enrollment_id into v_linked_enrollment_id
      from public.course_enrollment_assignments bridge
     where bridge.classroom_membership_id = v_membership_id;
    if v_linked_enrollment_id is not null then
      raise exception 'MEMBERSHIP_ALREADY_LINKED';
    end if;
    if v_membership_joined_at > v_effective_at then
      raise exception 'INVALID_EFFECTIVE_AT';
    end if;
  else
    if v_classroom.capacity is not null then
      select count(*) into v_active_count
        from public.enrollments roster
       where roster.classroom_id = v_classroom.id and roster.status = 'active';
      if v_active_count >= v_classroom.capacity then raise exception 'CLASS_FULL'; end if;
    end if;
    insert into public.enrollments(
      classroom_id, student_id, status, joined_at, term_id, remark, operated_by
    ) values (
      v_classroom.id, v_enrollment.student_id, 'active', v_effective_at,
      v_classroom.term_id, v_note, v_uid
    ) returning id into v_membership_id;
  end if;

  insert into public.course_enrollment_assignments(
    course_enrollment_id, classroom_id, classroom_membership_id,
    note, assigned_by, assigned_at
  ) values (
    v_enrollment.id, v_classroom.id, v_membership_id, v_note, v_uid,
    v_effective_at
  );
  insert into public.course_enrollment_events(
    course_enrollment_id, kind, to_classroom_id, note, recorded_by, occurred_at
  ) values (
    v_enrollment.id, 'assigned', v_classroom.id, v_note, v_uid, v_effective_at
  );

  perform public.emit_domain_event(
    'course.enrollment.assigned', 'course_enrollment', v_enrollment.id,
    jsonb_build_object(
      'studentId', v_enrollment.student_id,
      'classroomId', v_classroom.id,
      'classroomMembershipId', v_membership_id,
      'effectiveAt', v_effective_at
    ), null, '/dashboard/enrollments'
  );
  return v_membership_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.assign_course_enrollment(p_course_enrollment_id uuid, p_classroom_id uuid, p_note text, p_effective_at timestamp with time zone DEFAULT now())
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  select mathin_internal.assign_course_enrollment(p_course_enrollment_id,p_classroom_id,p_note,p_effective_at,false);
$$;

CREATE OR REPLACE FUNCTION mathin_internal.transfer_course_enrollment(p_course_enrollment_id uuid, p_to_classroom_id uuid, p_note text, p_effective_at timestamp with time zone DEFAULT now(), p_allow_mismatch boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_enrollment public.course_enrollments%rowtype;
  v_assignment public.course_enrollment_assignments%rowtype;
  v_target public.classrooms%rowtype;
  v_membership_id uuid;
  v_membership_joined_at timestamptz;
  v_linked_enrollment_id uuid;
  v_active_count integer;
  v_note text := btrim(coalesce(p_note, ''));
  v_effective_at timestamptz := p_effective_at;
begin
 perform public.require_current_business_record('course_enrollments',p_course_enrollment_id);
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid, 'enrollment.manage') then raise exception 'FORBIDDEN'; end if;
  if char_length(v_note) > 2000 then raise exception 'INVALID_ASSIGNMENT'; end if;

  select * into v_enrollment from public.course_enrollments
   where id = p_course_enrollment_id for update;
  if not found or v_enrollment.status <> 'active' then raise exception 'ENROLLMENT_NOT_ACTIVE'; end if;
  select * into v_assignment from public.course_enrollment_assignments
   where course_enrollment_id = v_enrollment.id and status = 'active'
   for update;
  if not found then raise exception 'ENROLLMENT_NOT_ASSIGNED'; end if;
  if v_effective_at is null
     or v_effective_at < v_assignment.assigned_at
     or v_effective_at > now() + interval '5 minutes' then
    raise exception 'INVALID_EFFECTIVE_AT';
  end if;
  if v_assignment.classroom_id = p_to_classroom_id then raise exception 'SAME_CLASSROOM'; end if;
  if not public.can_manage_classroom(v_assignment.classroom_id, v_uid) then raise exception 'FORBIDDEN_SCOPE'; end if;

  select * into v_target from public.classrooms where id = p_to_classroom_id for update;
  if not found or v_target.archived_at is not null or v_target.trashed_at is not null
     or v_target.operational_status not in ('planning','active')
     or v_target.purpose <> 'production'
     or v_target.offering_type <> 'long_term_formal' then
    raise exception 'CLASS_NOT_AVAILABLE';
  end if;
  if not public.can_manage_classroom(v_target.id, v_uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if not p_allow_mismatch and not exists (select 1 from public.classrooms origin
    where origin.id=v_assignment.classroom_id and origin.course_id is not distinct from v_target.course_id
      and origin.term_id is not distinct from v_target.term_id) then
    raise exception 'CLASS_TARGET_MISMATCH';
  end if;

  select roster.id, roster.joined_at into v_membership_id, v_membership_joined_at
    from public.enrollments roster
   where roster.classroom_id = v_target.id
     and roster.student_id = v_enrollment.student_id
     and roster.status = 'active'
   limit 1;
  if v_membership_id is not null then
    if not exists (
      select 1 from public.enrollments roster
       where roster.id = v_membership_id
         and roster.term_id is not distinct from v_target.term_id
    ) then raise exception 'CLASS_TARGET_MISMATCH'; end if;
    select bridge.course_enrollment_id into v_linked_enrollment_id
      from public.course_enrollment_assignments bridge
     where bridge.classroom_membership_id = v_membership_id;
    if v_linked_enrollment_id is not null then
      raise exception 'MEMBERSHIP_ALREADY_LINKED';
    end if;
    if v_membership_joined_at > v_effective_at then
      raise exception 'INVALID_EFFECTIVE_AT';
    end if;
  else
    if v_target.capacity is not null then
      select count(*) into v_active_count from public.enrollments roster
       where roster.classroom_id = v_target.id and roster.status = 'active';
      if v_active_count >= v_target.capacity then raise exception 'CLASS_FULL'; end if;
    end if;
  end if;

  update public.enrollments
     set status = 'transferred_out', left_at = v_effective_at,
         remark = case when v_note <> '' then v_note else remark end,
         operated_by = v_uid
   where id = v_assignment.classroom_membership_id and status = 'active';
  if not found then raise exception 'CLASS_MEMBERSHIP_NOT_ACTIVE'; end if;

  if v_membership_id is null then
    insert into public.enrollments(
      classroom_id, student_id, status, joined_at, term_id, remark, operated_by
    ) values (
      v_target.id, v_enrollment.student_id, 'active', v_effective_at,
      v_target.term_id, v_note, v_uid
    ) returning id into v_membership_id;
  end if;

  insert into public.course_enrollment_assignments(
    course_enrollment_id, classroom_id, classroom_membership_id,
    note, assigned_by, assigned_at
  ) values (
    v_enrollment.id, v_target.id, v_membership_id, v_note, v_uid,
    v_effective_at
  );
  insert into public.course_enrollment_events(
    course_enrollment_id, kind, from_classroom_id, to_classroom_id,
    note, recorded_by, occurred_at
  ) values (
    v_enrollment.id, 'transferred', v_assignment.classroom_id,
    v_target.id, v_note, v_uid, v_effective_at
  );

  perform public.emit_domain_event(
    'course.enrollment.transferred', 'course_enrollment', v_enrollment.id,
    jsonb_build_object(
      'studentId', v_enrollment.student_id,
      'fromClassroomId', v_assignment.classroom_id,
      'toClassroomId', v_target.id,
      'classroomMembershipId', v_membership_id,
      'effectiveAt', v_effective_at
    ), null, '/dashboard/enrollments'
  );
  return v_membership_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.transfer_course_enrollment(p_course_enrollment_id uuid, p_to_classroom_id uuid, p_note text, p_effective_at timestamp with time zone DEFAULT now())
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  select mathin_internal.transfer_course_enrollment(p_course_enrollment_id,p_to_classroom_id,p_note,p_effective_at,false);
$$;

CREATE OR REPLACE FUNCTION mathin_internal.move_enrollment_placement(p_enrollment_id uuid, p_membership_id uuid, p_from_classroom_id uuid, p_to_classroom_id uuid, p_allow_mismatch boolean DEFAULT false, p_note text DEFAULT '')
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      select course_enrollment_id into v_enrollment from public.course_enrollment_assignments where classroom_membership_id=v_member.id and status='active';
    end if;
    if v_enrollment is null then
      select id into v_enrollment from public.course_enrollments where record_state='current' and student_id=v_member.student_id
        and course_id=v_class.course_id and term_id=v_class.term_id and status='active';
      if v_enrollment is null then
        select id,stage into v_opportunity,v_stage from public.course_opportunities where record_state='current' and student_id=v_member.student_id
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
    if not exists(select 1 from public.course_enrollments where record_state='current' and id=v_enrollment and student_id=v_member.student_id
      and status='active' and ((course_id=v_class.course_id and term_id=v_class.term_id) or exists(select 1 from public.course_enrollment_assignments a
          where a.course_enrollment_id=v_enrollment and a.classroom_membership_id=v_member.id and a.status='active'))) then raise exception 'PLACEMENT_CHANGED'; end if;
  end if;
  perform 1 from public.course_enrollments where record_state='current' and id=v_enrollment and status='active' for update;
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
    perform mathin_internal.assign_course_enrollment(v_enrollment,p_to_classroom_id,coalesce(nullif(p_note,''),'分班表安排'),v_now,p_allow_mismatch);
  else
    perform mathin_internal.transfer_course_enrollment(v_enrollment,p_to_classroom_id,coalesce(nullif(p_note,''),'分班表调班'),v_now,p_allow_mismatch);
  end if;
  return v_enrollment;
end $function$;

CREATE OR REPLACE FUNCTION public.move_enrollment_placement(p_enrollment_id uuid, p_membership_id uuid, p_from_classroom_id uuid, p_to_classroom_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  select mathin_internal.move_enrollment_placement(p_enrollment_id,p_membership_id,p_from_classroom_id,p_to_classroom_id,false,'');
$$;

CREATE OR REPLACE FUNCTION mathin_internal.move_enrollment_to_seat(p_enrollment_id uuid, p_membership_id uuid, p_from_classroom_id uuid, p_to_classroom_id uuid, p_to_seat integer, p_expected_seat integer, p_allow_mismatch boolean DEFAULT false, p_note text DEFAULT '')
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_class uuid; v_member public.enrollments%rowtype; v_other public.enrollments%rowtype;
  v_id uuid; v_target_member uuid; v_capacity integer; v_temporary integer;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(auth.uid(),'enrollment.manage') then raise exception 'FORBIDDEN'; end if;
  if p_to_classroom_id is not null and (p_to_seat is null or p_to_seat<1) then raise exception 'VALIDATION'; end if;
  for v_class in select distinct x from unnest(array[p_from_classroom_id,p_to_classroom_id]) x where x is not null order by x loop
    if not public.can_manage_classroom(v_class,auth.uid()) then raise exception 'FORBIDDEN_SCOPE'; end if;
    perform pg_advisory_xact_lock(hashtextextended('placement-seat:'||v_class::text,0));
  end loop;
  if p_membership_id is not null then
    select * into v_member from public.enrollments where id=p_membership_id for update;
    if not found or v_member.status<>'active' or v_member.classroom_id is distinct from p_from_classroom_id
      or v_member.placement_seat is distinct from p_expected_seat then raise exception 'PLACEMENT_CHANGED'; end if;
  end if;
  if p_to_classroom_id is not null then
    select capacity into v_capacity from public.classrooms where id=p_to_classroom_id;
    if not found or (v_capacity is not null and p_to_seat>v_capacity) then raise exception 'INVALID_SEAT'; end if;
    select * into v_other from public.enrollments where classroom_id=p_to_classroom_id and status='active' and placement_seat=p_to_seat for update;
    if found and v_other.id is distinct from p_membership_id and p_from_classroom_id is distinct from p_to_classroom_id then raise exception 'SEAT_OCCUPIED'; end if;
  end if;
  if p_from_classroom_id=p_to_classroom_id and p_membership_id is not null then
    if v_member.placement_seat=p_to_seat then return p_enrollment_id; end if;
    select coalesce(max(placement_seat),0)+1 into v_temporary from public.enrollments where classroom_id=p_to_classroom_id and status='active';
    update public.enrollments set placement_seat=v_temporary where id=v_member.id;
    if v_other.id is not null then update public.enrollments set placement_seat=v_member.placement_seat where id=v_other.id; end if;
    update public.enrollments set placement_seat=p_to_seat where id=v_member.id;
    perform public.emit_domain_event('enrollment.seat_changed','enrollment',v_member.id,
      jsonb_build_object('classroomId',p_to_classroom_id,'fromSeat',v_member.placement_seat,'toSeat',p_to_seat),null,null);
    return p_enrollment_id;
  end if;
  v_id:=mathin_internal.move_enrollment_placement(p_enrollment_id,p_membership_id,p_from_classroom_id,p_to_classroom_id,p_allow_mismatch,p_note);
  if p_to_classroom_id is not null then
    select classroom_membership_id into v_target_member from public.course_enrollment_assignments where course_enrollment_id=v_id and status='active';
    update public.enrollments set placement_seat=p_to_seat where id=v_target_member;
  end if;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.move_enrollment_to_seat(p_enrollment_id uuid, p_membership_id uuid, p_from_classroom_id uuid, p_to_classroom_id uuid, p_to_seat integer, p_expected_seat integer)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  select mathin_internal.move_enrollment_to_seat(p_enrollment_id,p_membership_id,p_from_classroom_id,p_to_classroom_id,p_to_seat,p_expected_seat,false,'');
$$;

CREATE OR REPLACE FUNCTION mathin_internal.preview_enrollment_session_transfer(p_membership_id uuid, p_to_classroom_id uuid, p_seat integer, p_allow_mismatch boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare m public.enrollments%rowtype; c public.classrooms%rowtype; origin public.classrooms%rowtype; result jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(auth.uid(),'enrollment.manage') then raise exception 'FORBIDDEN'; end if;
  select * into m from public.enrollments where id=p_membership_id;
  if not found or m.status<>'active' then raise exception 'PLACEMENT_CHANGED'; end if;
  if not public.can_manage_classroom(m.classroom_id,auth.uid()) or not public.can_manage_classroom(p_to_classroom_id,auth.uid()) then raise exception 'FORBIDDEN_SCOPE'; end if;
  select * into c from public.classrooms where id=p_to_classroom_id;
  select * into origin from public.classrooms where id=m.classroom_id;
  if c.id is null or c.id=origin.id or (not p_allow_mismatch and (c.course_id is distinct from origin.course_id or c.term_id is distinct from origin.term_id
    or m.term_id is distinct from c.term_id)) then raise exception 'CLASS_TARGET_MISMATCH'; end if;
  if c.trashed_at is not null or c.archived_at is not null or origin.trashed_at is not null or origin.archived_at is not null
    or c.purpose<>'production' or c.offering_type<>'long_term_formal' or c.operational_status not in('planning','active') then raise exception 'CLASS_NOT_AVAILABLE'; end if;
  if p_seat is null or p_seat<1 or p_seat>least(coalesce(c.capacity,60),60) then raise exception 'INVALID_SEAT'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'sessionId',target.id,'sourceSessionId',source.id,'lectureNo',target.lecture_no,'title',target.title,
    'scheduledAt',target.scheduled_at,'sourceScheduledAt',source.scheduled_at,
    'version',md5(jsonb_build_array(to_jsonb(m),to_jsonb(c),to_jsonb(origin),to_jsonb(target),to_jsonb(source),
      public.session_roster_source_hash(target.id),public.session_roster_source_hash(source.id),p_seat)::text),
    'blocked',case
      when source.id is null then 'SOURCE_SESSION_MISSING'
      when source.matches<>1 then 'SOURCE_SESSION_AMBIGUOUS'
      when source.started_at is not null or source.ended_at is not null or source.roster_revision>0 or target.roster_revision>0 then 'SESSION_LOCKED'
      when exists(select 1 from public.session_attendance a where a.session_id in(source.id,target.id) and a.student_id=m.student_id) then 'SESSION_LOCKED'
      when exists(select 1 from public.session_student_transfers t where t.cancelled_at is null and t.student_id=m.student_id
        and (t.from_session_id in(source.id,target.id) or t.to_session_id in(source.id,target.id))) then 'SESSION_TRANSFER_EXISTS'
      when exists(select 1 from public.enrollments e where e.classroom_id=c.id and e.status='active' and (e.student_id=m.student_id or e.placement_seat=p_seat))
        or exists(select 1 from public.session_student_transfers t where t.to_session_id=target.id and t.target_seat=p_seat and t.cancelled_at is null) then 'SEAT_OCCUPIED'
      when (select count(*) from public.current_session_roster_source(target.id))>=least(coalesce(c.capacity,60),60) then 'CLASS_FULL'
      else null end
  ) order by target.lecture_no nulls last,target.scheduled_at nulls last,target.id),'[]'::jsonb) into result
  from public.class_sessions target
  left join lateral (
    select s.*,count(*) over() matches from public.class_sessions s
    where s.classroom_id=m.classroom_id and s.deleted_at is null and s.cancelled_by is null and s.voided_at is null
      and ((target.lecture_id is not null and s.lecture_id=target.lecture_id)
        or ((target.lecture_id is null or p_allow_mismatch) and target.lecture_no is not null and s.lecture_no=target.lecture_no))
    order by s.id limit 1
  ) source on true
  where target.classroom_id=c.id and target.deleted_at is null and target.cancelled_by is null and target.voided_at is null
    and target.started_at is null and target.ended_at is null;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.preview_enrollment_session_transfer(p_membership_id uuid, p_to_classroom_id uuid, p_seat integer)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $$
  select mathin_internal.preview_enrollment_session_transfer(p_membership_id,p_to_classroom_id,p_seat,false);
$$;

CREATE OR REPLACE FUNCTION public.preview_enrollment_session_transfer(p_membership_id uuid,p_to_classroom_id uuid,p_seat integer,p_allow_mismatch boolean)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $$
  select mathin_internal.preview_enrollment_session_transfer(p_membership_id,p_to_classroom_id,p_seat,p_allow_mismatch);
$$;

CREATE OR REPLACE FUNCTION public.change_enrollment_placement(p_request_id uuid, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare actor uuid:=auth.uid(); mode text:=p_input->>'mode'; reason text:=btrim(coalesce(p_input->>'reason',''));
  member_id uuid:=(p_input->>'membershipId')::uuid; enrollment_id uuid:=(p_input->>'enrollmentId')::uuid;
  from_id uuid:=(p_input->>'fromClassroomId')::uuid; to_id uuid:=(p_input->>'toClassroomId')::uuid;
  seat integer:=(p_input->>'seat')::integer; m public.enrollments%rowtype; receipt mathin_internal.enrollment_placement_receipts%rowtype;
  c uuid; option jsonb; chosen jsonb; preview jsonb; result jsonb; ids uuid[]; transfer_id uuid:=(p_input->>'transferId')::uuid;
  allow_mismatch boolean:=coalesce(p_input->'allowMismatch'='true'::jsonb,false);
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(actor,'enrollment.manage') then raise exception 'FORBIDDEN'; end if;
  if p_request_id is null or mode is null or mode not in('permanent','temporary','withdraw','cancel_temporary') or char_length(reason)>2000
    or (mode='withdraw' and reason='') or (member_id is null and enrollment_id is null) then raise exception 'VALIDATION'; end if;
  if (p_input ? 'allowMismatch' and jsonb_typeof(p_input->'allowMismatch')<>'boolean')
    or (allow_mismatch and (mode not in('permanent','temporary') or reason='')) then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('placement-request:'||p_request_id::text,0));
  select * into receipt from mathin_internal.enrollment_placement_receipts where request_id=p_request_id;
  if found then
    if receipt.actor_id<>actor or receipt.payload<>p_input then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return receipt.result;
  end if;
  for c in select distinct x from unnest(array[from_id,to_id]) x where x is not null order by x loop
    if not public.can_manage_classroom(c,actor) then raise exception 'FORBIDDEN_SCOPE'; end if;
    perform pg_advisory_xact_lock(hashtextextended('placement-seat:'||c::text,0));
  end loop;
  if member_id is not null then
    select * into m from public.enrollments where id=member_id for update;
    if not found or m.status<>'active' or m.classroom_id is distinct from from_id or m.placement_seat is distinct from (p_input->>'expectedSeat')::integer then raise exception 'PLACEMENT_CHANGED'; end if;
    if not public.can_manage_classroom(m.classroom_id,actor) then raise exception 'FORBIDDEN_SCOPE'; end if;
  end if;
  if member_id is null and enrollment_id is not null and not exists(select 1 from public.course_enrollments e
    where e.id=enrollment_id and public.can_access_student(e.student_id,actor)) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if mode='temporary' then
    if member_id is null or coalesce(jsonb_typeof(p_input->'sessions'),'null')<>'array' or jsonb_array_length(p_input->'sessions') not between 1 and 100 then raise exception 'VALIDATION'; end if;
    preview:=mathin_internal.preview_enrollment_session_transfer(member_id,to_id,seat,allow_mismatch);
    select array_agg(distinct x) into ids from (
      select (o->>'sessionId')::uuid x from jsonb_array_elements(preview) o where o->>'sessionId' in(select e->>'sessionId' from jsonb_array_elements(p_input->'sessions') e)
      union select (o->>'sourceSessionId')::uuid from jsonb_array_elements(preview) o where o->>'sessionId' in(select e->>'sessionId' from jsonb_array_elements(p_input->'sessions') e)
    ) matched where x is not null;
    perform 1 from public.class_sessions where id=any(ids) order by id for update;
    preview:=mathin_internal.preview_enrollment_session_transfer(member_id,to_id,seat,allow_mismatch);
    if (select count(distinct e->>'sessionId') from jsonb_array_elements(p_input->'sessions') e)<>jsonb_array_length(p_input->'sessions') then raise exception 'VALIDATION'; end if;
    if (select count(distinct o->>'sourceSessionId') from jsonb_array_elements(preview) o
      where o->>'sessionId' in(select e->>'sessionId' from jsonb_array_elements(p_input->'sessions') e))<>jsonb_array_length(p_input->'sessions') then raise exception 'SOURCE_SESSION_AMBIGUOUS'; end if;
    for chosen in select value from jsonb_array_elements(p_input->'sessions') loop
      select o into option from jsonb_array_elements(preview) o where o->>'sessionId'=chosen->>'sessionId';
      if option is null or option->>'version' is distinct from chosen->>'version' then raise exception 'PLACEMENT_CHANGED'; end if;
      if option->>'blocked' is not null then raise exception '%',option->>'blocked'; end if;
      insert into public.session_student_transfers(request_id,membership_id,student_id,from_session_id,to_session_id,target_seat,note,created_by)
        values(p_request_id,member_id,m.student_id,(option->>'sourceSessionId')::uuid,(option->>'sessionId')::uuid,seat,reason,actor);
    end loop;
  elsif mode='cancel_temporary' then
    if transfer_id is null or not exists(select 1 from public.session_student_transfers t join public.class_sessions s on s.id=t.to_session_id
      where t.id=transfer_id and t.membership_id=member_id and public.can_manage_classroom(s.classroom_id,actor)) then raise exception 'FORBIDDEN_SCOPE'; end if;
    perform mathin_internal.cancel_pending_session_transfers(member_id,transfer_id);
  elsif mode='withdraw' then
    if member_id is not null then
      perform mathin_internal.cancel_pending_session_transfers(member_id);
      if enrollment_id is null then select course_enrollment_id into enrollment_id from public.course_enrollment_assignments where classroom_membership_id=member_id and status='active'; end if;
      if enrollment_id is not null and not exists(select 1 from public.course_enrollment_assignments where classroom_membership_id=member_id and course_enrollment_id=enrollment_id and status='active') then raise exception 'PLACEMENT_CHANGED'; end if;
      perform public.withdraw_student(member_id,reason);
    elsif from_id is not null or exists(select 1 from public.course_enrollment_assignments where course_enrollment_id=enrollment_id and status='active') then raise exception 'PLACEMENT_CHANGED'; end if;
    if enrollment_id is not null then perform public.cancel_course_enrollment(enrollment_id,reason,clock_timestamp()); end if;
  else
    if to_id is null or from_id=to_id or (member_id is null)<>(from_id is null)
      or (member_id is null and enrollment_id is null) then raise exception 'VALIDATION'; end if;
    perform mathin_internal.cancel_pending_session_transfers(member_id);
    enrollment_id:=mathin_internal.move_enrollment_to_seat(enrollment_id,member_id,from_id,to_id,seat,(p_input->>'expectedSeat')::integer,allow_mismatch,reason);
  end if;
  result:=jsonb_build_object('requestId',p_request_id,'mode',mode,'enrollmentId',enrollment_id);
  insert into mathin_internal.enrollment_placement_receipts(request_id,actor_id,payload,result) values(p_request_id,actor,p_input,result);
  perform public.emit_domain_event('enrollment.placement.'||mode,'enrollment',coalesce(member_id,enrollment_id),
    jsonb_build_object('requestId',p_request_id,'fromClassroomId',from_id,'toClassroomId',to_id,'reason',reason,'allowMismatch',allow_mismatch,'sessions',p_input->'sessions','transferId',transfer_id),null,'/dashboard/followups/enrollments');
  return result;
end $function$;

revoke all on function mathin_internal.assign_course_enrollment(uuid,uuid,text,timestamptz,boolean) from public,anon,authenticated;

revoke all on function mathin_internal.transfer_course_enrollment(uuid,uuid,text,timestamptz,boolean) from public,anon,authenticated;

revoke all on function mathin_internal.move_enrollment_placement(uuid,uuid,uuid,uuid,boolean,text) from public,anon,authenticated;

revoke all on function mathin_internal.move_enrollment_to_seat(uuid,uuid,uuid,uuid,integer,integer,boolean,text) from public,anon,authenticated;

revoke all on function mathin_internal.preview_enrollment_session_transfer(uuid,uuid,integer,boolean) from public,anon,authenticated;

revoke all on function public.preview_enrollment_session_transfer(uuid,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.preview_enrollment_session_transfer(uuid,uuid,integer,boolean) to authenticated;
grant execute on function mathin_internal.assign_course_enrollment(uuid,uuid,text,timestamptz,boolean) to postgres;
grant execute on function mathin_internal.transfer_course_enrollment(uuid,uuid,text,timestamptz,boolean) to postgres;
grant execute on function mathin_internal.move_enrollment_placement(uuid,uuid,uuid,uuid,boolean,text) to postgres;
grant execute on function mathin_internal.move_enrollment_to_seat(uuid,uuid,uuid,uuid,integer,integer,boolean,text) to postgres;
grant execute on function mathin_internal.preview_enrollment_session_transfer(uuid,uuid,integer,boolean) to postgres;
