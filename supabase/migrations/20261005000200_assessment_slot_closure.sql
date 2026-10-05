-- 已关闭的教师账号/校区仍允许教务停止其已有排班。
create or replace function public.save_assessment_slot(p_slot_id uuid,p_teacher_id uuid,p_campus_id uuid,p_subjects text[],p_grades integer[],
  p_starts_at timestamptz,p_ends_at timestamptz,p_enabled boolean,p_expected_updated_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_slot public.assessment_slots%rowtype; v_old_teacher uuid; v_teacher uuid; v_subjects text[]; v_grades integer[];
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.assessment_slots_can_manage(v_uid,p_teacher_id) then raise exception 'FORBIDDEN'; end if;
  if p_slot_id is null or p_teacher_id is null or p_campus_id is null or p_subjects is null or p_grades is null or p_enabled is null
    or cardinality(p_subjects) not between 1 and 2 or array_ndims(p_subjects)<>1 or array_position(p_subjects,null) is not null
    or not p_subjects<@array['math','english']::text[] or cardinality(p_grades)>14
    or (cardinality(p_grades)>0 and array_ndims(p_grades)<>1) or array_position(p_grades,null) is not null
    or not p_grades<@array[-1,0,1,2,3,4,5,6,7,8,9,10,11,12]
    or p_starts_at is null or p_ends_at is null or not isfinite(p_starts_at) or not isfinite(p_ends_at)
    or p_starts_at<>date_trunc('minute',p_starts_at) or p_ends_at<>date_trunc('minute',p_ends_at)
    or p_ends_at-p_starts_at not between interval '5 minutes' and interval '4 hours' then raise exception 'VALIDATION'; end if;
  v_subjects:=array(select distinct unnest(p_subjects) order by 1); v_grades:=array(select distinct unnest(p_grades) order by 1);
  if cardinality(v_subjects)<>cardinality(p_subjects) or cardinality(v_grades)<>cardinality(p_grades) then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('assessment-slot-save:'||p_slot_id::text,0));
  select teacher_id into v_old_teacher from public.assessment_slots where id=p_slot_id;
  if v_old_teacher is not null and not public.assessment_slots_can_manage(v_uid,v_old_teacher) then raise exception 'FORBIDDEN'; end if;
  for v_teacher in select distinct id from unnest(array[p_teacher_id,v_old_teacher]) id where id is not null order by id loop
    perform pg_advisory_xact_lock(hashtextextended('assessment-teacher:'||v_teacher::text,0));
  end loop;
  select * into v_slot from public.assessment_slots where id=p_slot_id for update;
  if v_slot.id is not null then
    if v_slot.teacher_id is distinct from v_old_teacher then raise exception 'CONFLICT'; end if;
    if (p_expected_updated_at is null and v_slot.created_by=v_uid or p_expected_updated_at=v_slot.updated_at)
      and (v_slot.teacher_id,v_slot.campus_id,v_slot.subjects,v_slot.grades,v_slot.starts_at,v_slot.ends_at,v_slot.enabled)
        is not distinct from (p_teacher_id,p_campus_id,v_subjects,v_grades,p_starts_at,p_ends_at,p_enabled)
      then return public.assessment_slot_projection(v_slot); end if;
    if p_expected_updated_at is null or p_expected_updated_at is distinct from v_slot.updated_at then raise exception 'CONFLICT'; end if;
    if exists(select 1 from public.lead_invitation_threads where assessment_slot_id=v_slot.id)
      and (v_slot.teacher_id,v_slot.campus_id,v_slot.subjects,v_slot.grades,v_slot.starts_at,v_slot.ends_at)
        is distinct from (p_teacher_id,p_campus_id,v_subjects,v_grades,p_starts_at,p_ends_at) then raise exception 'SLOT_BOOKED'; end if;
  elsif p_expected_updated_at is not null then raise exception 'NOT_FOUND'; end if;
  -- 原教师/校区停用后仍可关闭既有排班；关闭不会改变预约事实。
  if v_slot.id is not null and not p_enabled
    and (v_slot.teacher_id,v_slot.campus_id,v_slot.subjects,v_slot.grades,v_slot.starts_at,v_slot.ends_at)
      is not distinct from (p_teacher_id,p_campus_id,v_subjects,v_grades,p_starts_at,p_ends_at) then
    update public.assessment_slots set enabled=false,updated_by=v_uid where id=p_slot_id returning * into v_slot;
    return public.assessment_slot_projection(v_slot);
  end if;
  if not public.is_staff(p_teacher_id) or not public.has_perm(p_teacher_id,'review.write') then raise exception 'NO_ELIGIBLE_TEACHER'; end if;
  if not exists(select 1 from public.campuses where id=p_campus_id and status='active') then raise exception 'CAMPUS_UNAVAILABLE'; end if;
  if (v_slot.id is null or p_enabled or (v_slot.starts_at,v_slot.ends_at) is distinct from (p_starts_at,p_ends_at))
    and p_starts_at<=now() then raise exception 'TIME_UNAVAILABLE'; end if;
  if p_enabled and public.assessment_teacher_time_busy(p_teacher_id,p_starts_at,p_ends_at,
    (select id from public.lead_invitation_threads where assessment_slot_id=p_slot_id and state<>'cancelled' limit 1)) then raise exception 'TIME_UNAVAILABLE'; end if;
  if v_slot.id is null then
    insert into public.assessment_slots(id,teacher_id,campus_id,subjects,grades,starts_at,ends_at,enabled,created_by,updated_by)
      values(p_slot_id,p_teacher_id,p_campus_id,v_subjects,v_grades,p_starts_at,p_ends_at,p_enabled,v_uid,v_uid) returning * into v_slot;
  else
    update public.assessment_slots set teacher_id=p_teacher_id,campus_id=p_campus_id,subjects=v_subjects,grades=v_grades,
      starts_at=p_starts_at,ends_at=p_ends_at,enabled=p_enabled,updated_by=v_uid where id=p_slot_id returning * into v_slot;
  end if;
  return public.assessment_slot_projection(v_slot);
end $$;
-- 学生档案与阶段列表共用这一投影；传出来源，避免旧编辑器把已约时段当成意向格。
do $projection$
declare v_definition text; v_needle text:='''activityId'',invitation.activity_id,''assessorId'',invitation.assessor_id';
begin
  v_definition:=pg_get_functiondef('public.read_student_record_with_enrollments(uuid,uuid,public.business_course_enrollment_subjects[])'::regprocedure);
  if position(v_needle in v_definition)=0 then raise exception 'ASSESSMENT_SLOT_PROJECTION_ANCHOR_MISSING'; end if;
  execute replace(v_definition,v_needle,'''assessmentSlotId'',invitation.assessment_slot_id,'||v_needle);
end $projection$;
select pg_notify('pgrst','reload schema');
