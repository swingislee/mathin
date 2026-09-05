-- 公开课按学生一次保存本课各环节，复用原记录与授权。
create function public.save_public_class_registration_bundle(p_activity_id uuid,p_registration_id uuid,p_records jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_record jsonb; v_updated timestamptz;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.can_record_public_class(p_activity_id,auth.uid()) then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) not between 1 and 24 then raise exception 'VALIDATION'; end if;
  perform 1 from public.activity_registrations where id=p_registration_id and activity_id=p_activity_id and status<>'cancelled' for update;
  if not found then raise exception 'PUBLIC_CLASS_RECORD_NOT_FOUND'; end if;
  if (select count(distinct value->>'segmentId') from jsonb_array_elements(p_records))<>jsonb_array_length(p_records) then raise exception 'VALIDATION'; end if;
  for v_record in select value from jsonb_array_elements(p_records) order by value->>'segmentId' loop
    perform 1 from public.public_class_segments where id=(v_record->>'segmentId')::uuid and activity_id=p_activity_id;
    if not found then raise exception 'PUBLIC_CLASS_RECORD_NOT_FOUND'; end if;
    select updated_at into v_updated from public.public_class_participant_records
      where registration_id=p_registration_id and segment_id=(v_record->>'segmentId')::uuid for update;
    if v_updated is distinct from (v_record->>'expectedUpdatedAt')::timestamptz then raise exception 'PUBLIC_CLASS_RECORD_CHANGED'; end if;
    if v_record->>'studentPresence' is null or v_record->>'guardianPresence' is null then raise exception 'VALIDATION'; end if;
    perform public.save_public_class_participant_record((v_record->>'segmentId')::uuid,p_registration_id,
      v_record->>'studentPresence',v_record->>'guardianPresence',v_record->>'learningObservation',
      v_record->>'assessmentSummary',v_record->>'parentFeedback',v_record->>'recommendation');
  end loop;
end $$;
revoke all on function public.save_public_class_registration_bundle(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_public_class_registration_bundle(uuid,uuid,jsonb) to authenticated;

-- 座次属于本班成员关系；转班与退班历史继续使用原事实。
alter table public.enrollments add column placement_seat integer check(placement_seat>0);
with numbered as (
  select id,row_number() over(partition by classroom_id order by joined_at,id)::integer seat
  from public.enrollments where status='active'
) update public.enrollments e set placement_seat=n.seat from numbered n where e.id=n.id;
create unique index enrollments_active_placement_seat on public.enrollments(classroom_id,placement_seat)
  where status='active' and placement_seat is not null;

create function public.default_enrollment_placement_seat() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status='active' and new.placement_seat is null then
    perform pg_advisory_xact_lock(hashtextextended('placement-seat:'||new.classroom_id::text,0));
    select slot into new.placement_seat from generate_series(1,
      (select coalesce(max(placement_seat),0)+1 from public.enrollments where classroom_id=new.classroom_id and status='active')) slot
      where not exists(select 1 from public.enrollments where classroom_id=new.classroom_id and status='active' and placement_seat=slot)
      order by slot limit 1;
  end if;
  return new;
end $$;
revoke all on function public.default_enrollment_placement_seat() from public,anon,authenticated;
create trigger enrollments_default_placement_seat before insert or update of classroom_id,status,placement_seat on public.enrollments
  for each row execute function public.default_enrollment_placement_seat();

create function public.move_enrollment_to_seat(p_enrollment_id uuid,p_membership_id uuid,p_from_classroom_id uuid,
  p_to_classroom_id uuid,p_to_seat integer,p_expected_seat integer)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
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
  v_id:=public.move_enrollment_placement(p_enrollment_id,p_membership_id,p_from_classroom_id,p_to_classroom_id);
  if p_to_classroom_id is not null then
    select classroom_membership_id into v_target_member from public.course_enrollment_assignments where course_enrollment_id=v_id and status='active';
    update public.enrollments set placement_seat=p_to_seat where id=v_target_member;
  end if;
  return v_id;
end $$;
revoke all on function public.move_enrollment_to_seat(uuid,uuid,uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.move_enrollment_to_seat(uuid,uuid,uuid,uuid,integer,integer) to authenticated;

create or replace function public.get_enrollment_placement_board()
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare v_options jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(auth.uid(),'enrollment.manage') then raise exception 'FORBIDDEN'; end if;
  v_options:=public.get_enrollment_workflow_options();
  return jsonb_build_object('options',v_options,'enrollments',public.get_course_enrollment_workbench(),
    'members',coalesce((select jsonb_agg(item order by joined_at,id) from (
      select distinct on(r.classroom_id,r.student_id) r.joined_at,r.id,jsonb_build_object(
        'membershipId',r.id,'studentId',r.student_id,'name',s.name,'phone',coalesce(s.phone,''),'classroomId',r.classroom_id,
        'enrollmentId',coalesce(ca.course_enrollment_id,ce.id),'note',coalesce(r.remark,''),'seat',r.placement_seat,
        'status',case when r.status='withdrawn' then 'withdrawn' when s.status='paused' then 'paused' else 'active' end,
        'recommendation',coalesce((select ar.teacher_recommendation from public.assessment_results ar where ar.student_id=r.student_id
          and ar.teacher_recommendation<>'' order by ar.updated_at desc limit 1),'')) item
      from public.enrollments r join public.students s on s.id=r.student_id join public.classrooms cl on cl.id=r.classroom_id
      left join lateral(select a.course_enrollment_id from public.course_enrollment_assignments a where a.classroom_membership_id=r.id order by a.assigned_at desc limit 1) ca on true
      left join public.course_enrollments ce on ce.student_id=r.student_id and ce.course_id=cl.course_id and ce.term_id=cl.term_id and ce.status='active'
      where (r.status='active' or (r.status='withdrawn' and ce.id is null and not exists(
        select 1 from public.enrollments newer join public.classrooms nc on nc.id=newer.classroom_id
        where newer.student_id=r.student_id and nc.course_id=cl.course_id and nc.term_id=cl.term_id and newer.joined_at>r.joined_at)))
        and exists(select 1 from jsonb_array_elements(v_options->'classrooms') opt where opt->>'id'=r.classroom_id::text)
      order by r.classroom_id,r.student_id,r.joined_at desc,r.id desc
    ) members),'[]'::jsonb));
end $$;
notify pgrst,'reload schema';
