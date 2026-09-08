-- 表格行下补入与分班空位快速录入，共用已有幂等事务。
create or replace function public.add_school_support_work_item(p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); workspace text:=p_payload->>'workspace'; subject jsonb:=nullif(p_payload->'subject','null'::jsonb);
  person jsonb:=nullif(p_payload->'newPerson','null'::jsonb); work jsonb:=p_payload->'work';
  student_id uuid; lead_id uuid; name text; phone text; normalized_phone text; grade smallint; note text; work_date date;
  target_class uuid:=(work->>'classroomId')::uuid; target_seat integer:=(work->>'seat')::integer;
  target_membership uuid; classroom public.classrooms%rowtype;
  context_key text; item_id uuid; receipt public.school_support_entry_receipts%rowtype;
  s public.students%rowtype; l public.leads%rowtype; create_student boolean; identity_pending boolean; target_course uuid; target_term uuid; target_cycle uuid;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not public.has_perm(actor,'followup.write') or not public.has_perm(actor,'followup.view') then raise exception 'FORBIDDEN'; end if;
  if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' or workspace is null
    or workspace not in ('leads','communication','assessments','enrollments','renewals','students')
    or num_nonnulls(subject,person)<>1 or jsonb_typeof(work) is distinct from 'object' then raise exception 'VALIDATION'; end if;
  if workspace='enrollments' and not public.has_perm(actor,'enrollment.manage') then raise exception 'FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('school-support-request:'||actor||':'||p_request_id,0));
  select * into receipt from public.school_support_entry_receipts where actor_id=actor and request_id=p_request_id;
  if found then
    if receipt.fingerprint<>md5(p_payload::text) then raise exception 'REQUEST_CONFLICT'; end if;
    return public.read_school_support_work_item(receipt.work_item_id);
  end if;
  if target_class is not null then
    if workspace<>'enrollments' or target_seat is null or target_seat<1 then raise exception 'VALIDATION'; end if;
    if not public.can_manage_classroom(target_class,actor) then raise exception 'FORBIDDEN_SCOPE'; end if;
    perform pg_advisory_xact_lock(hashtextextended('placement-seat:'||target_class::text,0));
    select * into classroom from public.classrooms where id=target_class for update;
    if classroom.id is null or classroom.trashed_at is not null or classroom.archived_at is not null or classroom.purpose<>'production'
      or classroom.offering_type<>'long_term_formal' or classroom.operational_status not in ('planning','active') then raise exception 'CLASS_NOT_AVAILABLE'; end if;
    if classroom.course_id is distinct from (work->>'courseId')::uuid or classroom.term_id is distinct from (work->>'termId')::uuid then raise exception 'CLASS_TARGET_MISMATCH'; end if;
    if classroom.capacity is not null and target_seat>classroom.capacity then raise exception 'INVALID_SEAT'; end if;
    if exists(select 1 from public.enrollments where classroom_id=target_class and status='active' and placement_seat=target_seat) then raise exception 'SEAT_OCCUPIED'; end if;
  elsif target_seat is not null then raise exception 'VALIDATION'; end if;
  note:=btrim(coalesce(work->>'note','')); work_date:=(work->>'date')::date;
  target_course:=(work->>'courseId')::uuid; target_term:=(work->>'termId')::uuid; target_cycle:=(work->>'cycleId')::uuid;
  if length(note)>2000 or length(coalesce(work->>'location',''))>200 or work_date is not null and not isfinite(work_date)
    or workspace='communication' and work_date is null then raise exception 'VALIDATION'; end if;
  if target_course is not null and not exists(select 1 from public.courses where id=target_course and status='enabled'
    and purpose='production' and course_kind='curriculum' and trashed_at is null) then raise exception 'COURSE_NOT_AVAILABLE'; end if;
  if target_term is not null and not exists(select 1 from public.school_terms where id=target_term) then raise exception 'TERM_NOT_FOUND'; end if;
  if target_cycle is not null and not exists(select 1 from public.renewal_cycles where id=target_cycle and status<>'closed') then raise exception 'INVALID_CYCLE_STATE'; end if;
  if subject is not null then
    student_id:=(subject->>'studentId')::uuid; lead_id:=(subject->>'leadId')::uuid;
    if not public.school_support_subject_access(student_id,lead_id,true) then raise exception 'FORBIDDEN_SCOPE'; end if;
    if lead_id is not null then
      select * into l from public.leads where id=lead_id for update;
      if md5(to_jsonb(l)::text) is distinct from subject->>'version' then raise exception 'SUBJECT_CHANGED'; end if;
      if l.status='invalid' then raise exception 'LEAD_CLOSED'; end if;
      student_id:=coalesce(student_id,l.student_id);
    else
      select * into s from public.students where id=student_id for update;
      if md5(to_jsonb(s)::text) is distinct from subject->>'version' then raise exception 'SUBJECT_CHANGED'; end if;
    end if;
  else
    if not public.has_perm(actor,'student.create') then raise exception 'FORBIDDEN'; end if;
    name:=btrim(coalesce(person->>'name','')); phone:=btrim(coalesce(person->>'phone','')); grade:=(person->>'grade')::smallint;
    normalized_phone:=nullif(public.normalize_school_ops_phone(phone),'');
    create_student:=coalesce((person->>'createStudent')::boolean,false);
    identity_pending:=coalesce((person->>'identityPending')::boolean,false) or name='';
    if length(name)>100 or length(phone)>40 or name='' and phone='' or phone<>'' and (normalized_phone is null or normalized_phone !~ '^[0-9]{6,20}$')
      or grade is not null and grade not between 1 and 12 or create_student and (name='' or identity_pending) then raise exception 'VALIDATION'; end if;
    perform pg_advisory_xact_lock(hashtextextended('school-support-person:'||public.normalize_lead_name(name)||':'||coalesce(normalized_phone,''),0));
    if normalized_phone is not null and exists(select 1 from public.leads where normalized_name=public.normalize_lead_name(name) and phone_normalized=normalized_phone) then
      raise exception 'POSSIBLE_DUPLICATE';
    end if;
    if normalized_phone is not null and exists(select 1 from public.students where deleted_at is null
      and public.normalize_lead_name(students.name)=public.normalize_lead_name(name)
      and normalized_phone in (public.normalize_school_ops_phone(students.phone),public.normalize_school_ops_phone(parent_phone)))
      and not coalesce((p_payload->>'acknowledgeDuplicate')::boolean,false) then raise exception 'POSSIBLE_DUPLICATE'; end if;
    if create_student then
      student_id:=public.create_student(name,grade,'','','Manual entry','',''||phone,'');
    end if;
    insert into public.leads(provisional_student_name,normalized_name,phone,phone_normalized,grade_hint,status,owner_id,created_by,
      student_id,identity_confirmed_by,identity_confirmed_at,manual_entry,manual_identity_pending)
      values(name,public.normalize_lead_name(name),phone,normalized_phone,grade,'uncontacted',actor,actor,
        student_id,case when student_id is not null then actor end,case when student_id is not null then now() end,true,identity_pending)
      returning id into lead_id;
  end if;
  if lead_id is null and workspace in ('leads','communication') then
    select * into l from public.leads where leads.student_id=student_id and status not in ('invalid','converted')
      and public.school_support_subject_access(student_id,id,true) order by created_at,id limit 1 for update;
    lead_id:=l.id;
    if lead_id is null then
      select * into s from public.students where id=student_id;
      phone:=coalesce(nullif(s.parent_phone,''),s.phone); normalized_phone:=nullif(public.normalize_school_ops_phone(phone),'');
      -- 已有关联线索占用相同身份键时，保留为按学生办理的工作，继续读取原关系。
      if not exists(select 1 from public.leads where normalized_name=public.normalize_lead_name(s.name) and phone_normalized=normalized_phone) then
        insert into public.leads(provisional_student_name,normalized_name,phone,phone_normalized,grade_hint,status,owner_id,created_by,
          student_id,identity_confirmed_by,identity_confirmed_at,manual_entry)
          values(s.name,public.normalize_lead_name(s.name),phone,normalized_phone,s.grade,'uncontacted',coalesce(s.assigned_to,actor),actor,student_id,actor,now(),true)
          returning id into lead_id;
      end if;
    end if;
  end if;
  if target_class is not null and student_id is null then raise exception 'IDENTITY_NOT_CONFIRMED'; end if;
  context_key:=case when target_class is not null then 'seat:'||target_class||':'||target_seat when workspace='assessments' then coalesce('activity:'||(work->>'activityId'),'time:'||(work->>'scheduledAt'),'pending')
    when workspace='communication' then coalesce('worklist:'||(work->>'worklistId'),'date:'||work_date)
    when workspace in ('enrollments','renewals') then coalesce('cycle:'||target_cycle,'course:'||target_course||':'||target_term,'pending')
    else 'profile' end;
  perform pg_advisory_xact_lock(hashtextextended('school-support-work:'||coalesce(student_id,lead_id)||':'||workspace||':'||context_key,0));
  select w.id into item_id from public.school_support_work_items w left join public.leads related on related.id=w.lead_id
    where w.workspace=workspace and w.context_key=context_key and w.closed_at is null
      and (lead_id is not null and w.lead_id=lead_id or student_id is not null and coalesce(w.student_id,related.student_id)=student_id)
      order by w.created_at,w.id limit 1 for update of w;
  if item_id is null then
    insert into public.school_support_work_items(workspace,student_id,lead_id,context_key,work_date,note,course_id,term_id,cycle_id,created_by)
      values(workspace,student_id,lead_id,context_key,work_date,note,target_course,target_term,target_cycle,actor) returning id into item_id;
    if target_class is null then
      perform public.materialize_school_support_work_item(item_id,work);
    else
      -- 空位补入沿用班级手工加人，记录实际花名册；后续报名与收款沿原登记流程办理。
      if exists(select 1 from public.enrollments where classroom_id=target_class and enrollments.student_id=student_id and status='active') then raise exception 'ALREADY_ENROLLED'; end if;
      target_membership:=public.enroll_student(target_class,student_id,note);
      update public.enrollments set placement_seat=target_seat,term_id=classroom.term_id where id=target_membership;
      update public.school_support_work_items set closed_at=clock_timestamp() where id=item_id;
      perform public.emit_domain_event('enrollment.seat_changed','enrollment',target_membership,
        jsonb_build_object('classroomId',target_class,'toSeat',target_seat,'studentId',student_id),null,null);
    end if;
    perform public.emit_domain_event('school_support.student_added','school_support_work_item',item_id,
      jsonb_build_object('workspace',workspace,'studentId',student_id,'leadId',lead_id),actor,null);
  end if;
  insert into public.school_support_entry_receipts(actor_id,request_id,fingerprint,work_item_id) values(actor,p_request_id,md5(p_payload::text),item_id);
  return public.read_school_support_work_item(item_id);
end;
$$;

notify pgrst,'reload schema';
