-- 有效首联保存后建立稳定 Student；建档与首联/邀约的业务状态分别推进。
-- Family、Contact、监护/账号关系继续按已确认的事实单独维护。

create or replace function public.ensure_lead_student_profile(p_lead_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_lead public.leads%rowtype;
  v_contact public.lead_communications%rowtype;
  v_student_id uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid, 'followup.write') then raise exception 'FORBIDDEN'; end if;
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_lead.owner_id is null then raise exception 'LEAD_UNASSIGNED'; end if;
  if v_lead.owner_id <> v_uid and not public.has_perm(v_uid, 'student.view.all') then
    raise exception 'FORBIDDEN_SCOPE';
  end if;
  if v_lead.student_id is not null then
    return jsonb_build_object('studentId', v_lead.student_id, 'studentProfileStatus', 'existing');
  end if;
  if v_lead.status in ('invalid','converted') then
    return jsonb_build_object('studentId', null, 'studentProfileStatus', 'pending_contact');
  end if;

  select communication.* into v_contact
    from public.lead_communications communication
    left join lateral (
      select revision.effective_patch from public.communication_record_revisions revision
       where revision.source = 'contact' and revision.event_id = communication.id
       order by revision.revision_no desc limit 1
    ) correction on true
   where communication.lead_id = v_lead.id
     and coalesce(correction.effective_patch ->> 'outcome', communication.outcome) in ('connected','declined')
   order by communication.occurred_at, communication.id limit 1;
  if not found then
    return jsonb_build_object('studentId', null, 'studentProfileStatus', 'pending_contact');
  end if;
  -- 建档是已获授权首联的固定副作用，只使用此 Lead 的已存事实。
  -- 不授予老师通用 student.create/edit 权限，也不接受任意学生或关系入参。

  -- 与显式身份确认共用锁。仅姓名+电话构成疑似重复提示，不据此合并孩子。
  perform pg_advisory_xact_lock(hashtext(
    'lead-identity-student:' || public.normalize_lead_name(v_lead.provisional_student_name)
    || ':' || v_lead.phone_normalized
  ));
  if v_lead.suggested_student_id is not null or exists (
    select 1 from public.students student
     where student.deleted_at is null
       and public.normalize_lead_name(student.name) = v_lead.normalized_name
       and (public.normalize_school_ops_phone(student.phone) = v_lead.phone_normalized
         or public.normalize_school_ops_phone(student.parent_phone) = v_lead.phone_normalized)
  ) then
    return jsonb_build_object('studentId', null, 'studentProfileStatus', 'needs_review');
  end if;

  insert into public.students(name, grade, parent_phone, source, assigned_to, created_by, bind_code)
  values (v_lead.provisional_student_name, v_lead.grade_hint, v_lead.phone,
    'Lead first contact', v_lead.owner_id, v_uid, public.generate_student_bind_code())
  returning id into v_student_id;

  -- 复用已有绑定和历史重挂触发器；保留邀约、提醒及 Lead 状态。
  update public.leads set student_id = v_student_id,
    identity_confirmed_by = v_uid, identity_confirmed_at = now()
   where id = v_lead.id;
  perform public.emit_domain_event('lead.student_profile.created', 'lead', v_lead.id,
    jsonb_build_object('studentId', v_student_id, 'communicationId', v_contact.id), v_uid, null);
  return jsonb_build_object('studentId', v_student_id, 'studentProfileStatus', 'created');
end;
$$;

-- 这些既有入口继续以业务关闭状态、负责人和权限决定可操作性。
-- 精确校验旧定义，避免迁移静默覆盖其他版本的合同。
do $migration$
declare
  signature text;
  definition text;
begin
  foreach signature in array array[
    'public.record_lead_contact(uuid,text,text,boolean,boolean,text,timestamp with time zone)',
    'public.record_lead_contact_v2(uuid,text,text,boolean,text,text,text,uuid,uuid,text,text)',
    'public.update_lead_invitation(uuid,text,text,uuid,uuid,text,text,text,text)',
    'public.set_lead_contact_reminder(uuid,timestamp with time zone)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position('v_lead.student_id is not null or ' in definition) = 0 then
      raise exception 'STUDENT_PROFILE_FUNCTION_DRIFT: %', signature;
    end if;
    execute replace(definition, 'v_lead.student_id is not null or ', '');
  end loop;
  signature := 'public.assign_leads(uuid[],uuid)';
  definition := pg_get_functiondef(signature::regprocedure);
  if position('and lead.student_id is null' in definition) = 0 then
    raise exception 'STUDENT_PROFILE_FUNCTION_DRIFT: %', signature;
  end if;
  execute replace(definition, 'and lead.student_id is null', '');
end $migration$;

create or replace function public.sync_first_contact_profile_owner()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  -- 首联档案沿用 Lead 负责人；已独立调整过的 Student 归属保持原样。
  update public.students set assigned_to = new.owner_id
   where id = new.student_id and assigned_to is not distinct from old.owner_id
     and source = 'Lead first contact' and new.family_id is null;
  return new;
end;
$$;
create trigger leads_sync_first_contact_profile_owner after update of owner_id on public.leads
  for each row when (new.student_id is not null and new.owner_id is distinct from old.owner_id)
  execute function public.sync_first_contact_profile_owner();

create or replace function public.record_lead_contact_v4(
  p_lead_id uuid, p_outcome text, p_note text, p_wechat_added boolean, p_interest_level text,
  p_invitation_kind text, p_invitation_state text, p_activity_id uuid, p_assessor_id uuid,
  p_parent_time_options text[], p_assessor_time_options text[], p_scheduled_at timestamptz,
  p_location_text text, p_next_contact_at timestamptz
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  if p_next_contact_at is not null and p_next_contact_at <= now() then
    raise exception 'REMINDER_NOT_FUTURE';
  end if;
  v_result := public.record_lead_contact_v3(
    p_lead_id, p_outcome, p_note, p_wechat_added, p_interest_level,
    p_invitation_kind, p_invitation_state, p_activity_id, p_assessor_id,
    p_parent_time_options, p_assessor_time_options, p_scheduled_at, p_location_text
  );
  if p_outcome = 'invalid_number' then
    if p_next_contact_at is not null then raise exception 'REMINDER_NOT_ALLOWED'; end if;
  else
    perform public.set_lead_contact_reminder(p_lead_id, p_next_contact_at);
  end if;
  -- 在沟通、邀约、提醒均保存成功后建档，任一步异常都由同一事务回滚。
  return v_result || jsonb_build_object('nextContactAt', p_next_contact_at)
    || public.ensure_lead_student_profile(p_lead_id);
end;
$$;

-- 仅返回当前可访问对象的生命周期，不返回超出职责范围的历史明细。
-- EXISTS 覆盖全部事实，标签不受时间轴 500 条上限或当前/历史工作范围影响。
create or replace function public.get_student_lifecycle(p_student_id uuid, p_lead_id uuid)
returns text
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_student_id uuid := p_student_id;
  v_lead public.leads%rowtype;
  v_lead_ids uuid[];
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(v_uid) then raise exception 'FORBIDDEN'; end if;
  if p_lead_id is not null then
    select * into v_lead from public.leads where id = p_lead_id;
    if not found then raise exception 'NOT_FOUND'; end if;
    if p_student_id is not null and v_lead.student_id is distinct from p_student_id then
      raise exception 'SUBJECT_MISMATCH';
    end if;
    v_student_id := coalesce(p_student_id, v_lead.student_id);
  end if;
  if not coalesce((
    (v_student_id is not null and public.can_access_student(v_student_id, v_uid))
    or (v_lead.id is not null and public.has_perm(v_uid, 'followup.view')
      and (v_lead.owner_id is null or v_lead.owner_id = v_uid or public.has_perm(v_uid, 'student.view.all')))
    or (v_lead.id is not null and v_lead.created_by = v_uid and public.has_perm(v_uid, 'student.import'))
    or (v_lead.id is not null and (public.has_assigned_invitation_lead(v_uid, v_lead.id)
      or public.has_assessment_history_lead_access(v_lead.id)))
  ), false) or (v_student_id is null and v_lead.id is null) then
    raise exception 'FORBIDDEN_SCOPE';
  end if;
  select coalesce(array_agg(id), '{}'::uuid[]) into v_lead_ids from public.leads
   where id = p_lead_id or (v_student_id is not null and student_id = v_student_id);

  if v_student_id is not null and (
    exists (select 1 from public.course_enrollments where student_id = v_student_id)
    or exists (select 1 from public.enrollments where student_id = v_student_id)
  ) then return 'awaiting_renewal'; end if;
  if exists (select 1 from public.assessment_results
    where student_id = v_student_id or lead_id = any(v_lead_ids)) then
    return 'awaiting_enrollment';
  end if;
  if exists (
    select 1 from public.lead_communications communication
    left join lateral (
      select revision.effective_patch from public.communication_record_revisions revision
       where revision.source = 'contact' and revision.event_id = communication.id
       order by revision.revision_no desc limit 1
    ) correction on true
    where communication.lead_id = any(v_lead_ids)
      and coalesce(correction.effective_patch ->> 'outcome', communication.outcome) in ('connected','declined')
  ) then return 'awaiting_assessment'; end if;
  return 'awaiting_first_contact';
end;
$$;

revoke all on function public.ensure_lead_student_profile(uuid) from public, anon, authenticated;
revoke all on function public.sync_first_contact_profile_owner() from public, anon, authenticated;
revoke all on function public.get_student_lifecycle(uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_student_lifecycle(uuid,uuid) to authenticated;
revoke all on function public.record_lead_contact_v4(uuid,text,text,boolean,text,text,text,uuid,uuid,text[],text[],timestamptz,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_lead_contact_v4(uuid,text,text,boolean,text,text,text,uuid,uuid,text[],text[],timestamptz,text,timestamptz)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
