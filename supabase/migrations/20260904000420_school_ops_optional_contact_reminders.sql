-- SCHOOL-OPS-REMINDERS-1: 等待再次联系或外部确认时，可选登记下次联系提醒。
--
-- 提醒继续复用 lead_next_actions，不把日期回填成 Lead 主表字段，也不把
-- 提醒时间误当成老师、家长、活动或到访已经确认的业务时间。

alter table public.lead_next_actions
  drop constraint if exists lead_next_actions_kind_check;
alter table public.lead_next_actions
  add constraint lead_next_actions_kind_check check (kind in (
    'initial_contact','retry','wechat_followup','visit_confirmation',
    'nurture','invitation_followup','other'
  ));

create or replace function public.replace_lead_contact_reminder(
  p_lead_id uuid,
  p_remind_at timestamptz,
  p_kind text,
  p_actor_id uuid
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if p_actor_id is null
     or (p_remind_at is not null and p_kind not in ('retry','nurture','invitation_followup')) then
    raise exception 'INVALID_INPUT';
  end if;
  if p_remind_at is not null and p_remind_at <= now() then
    raise exception 'REMINDER_NOT_FUTURE';
  end if;

  update public.lead_next_actions
     set status = 'cancelled', completed_by = p_actor_id, completed_at = now()
   where lead_id = p_lead_id
     and status = 'open'
     and kind <> 'initial_contact';

  if p_remind_at is not null then
    if exists (
      select 1 from public.lead_next_actions
       where lead_id = p_lead_id and status = 'open'
    ) then
      raise exception 'INITIAL_CONTACT_PENDING';
    end if;
    insert into public.lead_next_actions(lead_id, kind, due_at, created_by)
    values (p_lead_id, p_kind, p_remind_at, p_actor_id);
  end if;
end
$$;

create or replace function public.set_lead_contact_reminder(
  p_lead_id uuid,
  p_remind_at timestamptz
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_lead public.leads%rowtype;
  v_invitation public.lead_invitation_threads%rowtype;
  v_kind text;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid, 'followup.write') then raise exception 'FORBIDDEN'; end if;
  if p_remind_at is not null and p_remind_at <= now() then
    raise exception 'REMINDER_NOT_FUTURE';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if v_lead.id is null then raise exception 'NOT_FOUND'; end if;
  if v_lead.owner_id is null then raise exception 'LEAD_UNASSIGNED'; end if;
  if v_lead.student_id is not null or v_lead.status in ('invalid','converted') then
    raise exception 'LEAD_CLOSED';
  end if;
  if v_lead.owner_id <> v_uid and not public.has_perm(v_uid, 'student.view.all') then
    raise exception 'FORBIDDEN_SCOPE';
  end if;

  select * into v_invitation
    from public.lead_invitation_threads invitation
   where invitation.lead_id = v_lead.id
     and invitation.state not in ('completed','cancelled')
   for update;

  v_kind := case
    when v_invitation.id is not null
     and v_invitation.state in ('coordinating_time','awaiting_teacher','awaiting_parent','waiting_activity')
      then 'invitation_followup'
    when v_invitation.id is not null then null
    when v_lead.status = 'uncontacted' then 'retry'
    when v_lead.status = 'nurture' then 'nurture'
    else null
  end;
  if p_remind_at is not null and v_kind is null then
    raise exception 'REMINDER_NOT_ALLOWED';
  end if;

  perform public.replace_lead_contact_reminder(v_lead.id, p_remind_at, v_kind, v_uid);
  perform public.emit_domain_event(
    'lead.next_contact_reminder.updated', 'lead', v_lead.id,
    jsonb_build_object('nextContactAt', p_remind_at, 'actionKind', v_kind),
    v_uid, null
  );
  return jsonb_build_object('leadId', v_lead.id, 'nextContactAt', p_remind_at, 'actionKind', v_kind);
end
$$;

create or replace function public.record_lead_contact_v4(
  p_lead_id uuid,
  p_outcome text,
  p_note text,
  p_wechat_added boolean,
  p_interest_level text,
  p_invitation_kind text,
  p_invitation_state text,
  p_activity_id uuid,
  p_assessor_id uuid,
  p_parent_time_options text[],
  p_assessor_time_options text[],
  p_scheduled_at timestamptz,
  p_location_text text,
  p_next_contact_at timestamptz
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if p_next_contact_at is not null and p_next_contact_at <= now() then
    raise exception 'REMINDER_NOT_FUTURE';
  end if;
  v_result := public.record_lead_contact_v3(
    p_lead_id, p_outcome, p_note, p_wechat_added, p_interest_level,
    p_invitation_kind, p_invitation_state, p_activity_id, p_assessor_id,
    p_parent_time_options, p_assessor_time_options, p_scheduled_at, p_location_text
  );
  perform public.set_lead_contact_reminder(p_lead_id, p_next_contact_at);
  return v_result || jsonb_build_object('nextContactAt', p_next_contact_at);
end
$$;

create or replace function public.update_lead_invitation_v3(
  p_invitation_id uuid,
  p_kind text,
  p_state text,
  p_activity_id uuid,
  p_assessor_id uuid,
  p_parent_time_options text[],
  p_assessor_time_options text[],
  p_scheduled_at timestamptz,
  p_location_text text,
  p_channel text,
  p_note text,
  p_next_contact_at timestamptz
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_lead_id uuid;
begin
  if p_next_contact_at is not null
     and p_state not in ('coordinating_time','awaiting_teacher','awaiting_parent','waiting_activity') then
    raise exception 'REMINDER_NOT_ALLOWED';
  end if;
  if p_next_contact_at is not null and p_next_contact_at <= now() then
    raise exception 'REMINDER_NOT_FUTURE';
  end if;
  select lead_id into v_lead_id
    from public.lead_invitation_threads
   where id = p_invitation_id;
  if v_lead_id is null then raise exception 'NOT_FOUND'; end if;

  v_result := public.update_lead_invitation_v2(
    p_invitation_id, p_kind, p_state, p_activity_id, p_assessor_id,
    p_parent_time_options, p_assessor_time_options, p_scheduled_at,
    p_location_text, p_channel, p_note
  );
  perform public.set_lead_contact_reminder(v_lead_id, p_next_contact_at);
  return v_result || jsonb_build_object('nextContactAt', p_next_contact_at);
end
$$;

create or replace function public.close_lead_invitation_reminder()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update public.lead_next_actions
     set status = 'cancelled', completed_by = new.updated_by, completed_at = now()
   where lead_id = new.lead_id
     and status = 'open'
     and kind = 'invitation_followup';
  return new;
end
$$;

drop trigger if exists lead_invitation_threads_close_reminder on public.lead_invitation_threads;
create trigger lead_invitation_threads_close_reminder
  after update of state on public.lead_invitation_threads
  for each row
  when (
    old.state is distinct from new.state
    and new.state in ('confirmed','completed','cancelled')
  )
  execute function public.close_lead_invitation_reminder();

comment on function public.set_lead_contact_reminder(uuid,timestamptz) is
  'Creates, replaces, or clears an optional next-contact reminder only while a lead is waiting for retry, nurture, activity placement, or external confirmation.';

revoke all on function public.replace_lead_contact_reminder(uuid,timestamptz,text,uuid)
  from public, anon, authenticated;
revoke all on function public.set_lead_contact_reminder(uuid,timestamptz)
  from public, anon, authenticated;
revoke all on function public.record_lead_contact_v4(uuid,text,text,boolean,text,text,text,uuid,uuid,text[],text[],timestamptz,text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.update_lead_invitation_v3(uuid,text,text,uuid,uuid,text[],text[],timestamptz,text,text,text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.close_lead_invitation_reminder()
  from public, anon, authenticated;
grant execute on function public.set_lead_contact_reminder(uuid,timestamptz) to authenticated;
grant execute on function public.record_lead_contact_v4(uuid,text,text,boolean,text,text,text,uuid,uuid,text[],text[],timestamptz,text,timestamptz)
  to authenticated;
grant execute on function public.update_lead_invitation_v3(uuid,text,text,uuid,uuid,text[],text[],timestamptz,text,text,text,timestamptz)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
