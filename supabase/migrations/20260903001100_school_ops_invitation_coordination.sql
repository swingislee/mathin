-- SCHOOL-OPS-INVITATIONS-1: 将“诺访”拆成可流转的邀约协同事实。
--
-- 首次电联只负责记录沟通事实并发起邀约；测评老师确认、家长确认、
-- 活动匹配和最终到访是后续协同状态。时间可以先用自然语言记录，
-- 不要求老师在尚未确认时创建日历事件或填写虚构的下一动作日期。

create table public.lead_invitation_threads (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  kind text not null check (kind in ('assessment_1v1','activity','waiting_activity')),
  state text not null check (state in (
    'coordinating_time','awaiting_teacher','awaiting_parent','confirmed',
    'waiting_activity','completed','cancelled'
  )),
  activity_id uuid references public.activities(id) on delete set null,
  assessor_id uuid references public.profiles(id) on delete set null,
  proposed_time_text text not null default '' check (length(proposed_time_text) <= 200),
  location_text text not null default '' check (length(location_text) <= 200),
  summary text not null default '' check (length(summary) <= 2000),
  owner_id_at_open uuid references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_by uuid references public.profiles(id) on delete set null,
  closed_at timestamptz,
  constraint lead_invitation_threads_shape_check check (
    (kind = 'assessment_1v1' and activity_id is null and state <> 'waiting_activity')
    or (kind = 'activity' and activity_id is not null and state in ('awaiting_parent','confirmed','completed','cancelled'))
    or (kind = 'waiting_activity' and activity_id is null and assessor_id is null
        and proposed_time_text = '' and state in ('waiting_activity','completed','cancelled'))
  ),
  constraint lead_invitation_threads_closed_check check (
    (state in ('completed','cancelled') and closed_by is not null and closed_at is not null)
    or (state not in ('completed','cancelled') and closed_by is null and closed_at is null)
  )
);

create unique index lead_invitation_threads_one_active_idx
  on public.lead_invitation_threads(lead_id)
  where state not in ('completed','cancelled');
create index lead_invitation_threads_queue_idx
  on public.lead_invitation_threads(state, updated_at desc, id desc)
  where state not in ('completed','cancelled');

create trigger lead_invitation_threads_set_updated_at
  before update on public.lead_invitation_threads
  for each row execute function public.set_updated_at();

create table public.lead_invitation_events (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.lead_invitation_threads(id) on delete cascade,
  from_state text,
  to_state text not null check (to_state in (
    'coordinating_time','awaiting_teacher','awaiting_parent','confirmed',
    'waiting_activity','completed','cancelled'
  )),
  channel text not null default 'phone'
    check (channel in ('phone','wechat','in_person','other')),
  note text not null default '' check (length(note) <= 2000),
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  occurred_at timestamptz not null default now()
);

create index lead_invitation_events_thread_idx
  on public.lead_invitation_events(invitation_id, occurred_at desc, id desc);

comment on table public.lead_invitation_threads is
  'One active invitation coordination thread per lead. The state itself is the work queue; no synthetic due date is required.';
comment on column public.lead_invitation_threads.proposed_time_text is
  'Natural-language time discussed by phone, WeChat or face-to-face before a calendar booking exists.';
comment on table public.lead_invitation_events is
  'Append-only handoff history across learning support, assessor and parent confirmation.';

alter table public.lead_invitation_threads enable row level security;
alter table public.lead_invitation_events enable row level security;

create policy lead_invitation_threads_select_lead_scope on public.lead_invitation_threads
  for select to authenticated using (
    exists (select 1 from public.leads lead where lead.id = lead_invitation_threads.lead_id)
  );

create policy lead_invitation_events_select_thread_scope on public.lead_invitation_events
  for select to authenticated using (
    exists (
      select 1 from public.lead_invitation_threads invitation
       where invitation.id = lead_invitation_events.invitation_id
    )
  );

revoke all on public.lead_invitation_threads, public.lead_invitation_events
  from public, anon, authenticated;
grant select on public.lead_invitation_threads, public.lead_invitation_events to authenticated;

create or replace function public.list_invitation_assessors()
returns table (user_id uuid, display_name text)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select profile.id, profile.display_name
    from public.profiles profile
   where auth.uid() is not null
     and public.has_perm(auth.uid(), 'followup.view')
     and profile.role in ('staff', 'admin')
     and profile.is_active
     and public.has_perm(profile.id, 'review.write')
   order by profile.display_name, profile.id;
$$;

create or replace function public.record_lead_contact_v2(
  p_lead_id uuid,
  p_outcome text,
  p_note text,
  p_wechat_added boolean,
  p_interest_level text,
  p_invitation_kind text,
  p_invitation_state text,
  p_activity_id uuid,
  p_assessor_id uuid,
  p_proposed_time_text text,
  p_location_text text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_lead public.leads%rowtype;
  v_communication_id uuid;
  v_invitation_id uuid;
  v_previous_state text;
  v_status text;
  v_time_text text := btrim(coalesce(p_proposed_time_text, ''));
  v_location_text text := btrim(coalesce(p_location_text, ''));
  v_note text := btrim(coalesce(p_note, ''));
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid, 'followup.write') then raise exception 'FORBIDDEN'; end if;
  if p_outcome not in ('unreachable','connected','declined','invalid_number')
     or char_length(v_note) > 2000
     or (p_interest_level is not null and p_interest_level not in ('A','B','C'))
     or char_length(v_time_text) > 200
     or char_length(v_location_text) > 200 then
    raise exception 'INVALID_INPUT';
  end if;
  if p_outcome in ('unreachable','invalid_number') and p_wechat_added is true then
    raise exception 'INVALID_INPUT';
  end if;
  if p_invitation_kind is null then
    if p_invitation_state is not null or p_activity_id is not null or p_assessor_id is not null
       or v_time_text <> '' or v_location_text <> '' then
      raise exception 'INVALID_INVITATION';
    end if;
  else
    if p_outcome <> 'connected'
       or p_invitation_kind not in ('assessment_1v1','activity','waiting_activity')
       or p_invitation_state is null then
      raise exception 'INVALID_INVITATION';
    end if;
    if p_invitation_kind = 'assessment_1v1' then
      if p_activity_id is not null
         or p_invitation_state not in ('coordinating_time','awaiting_teacher','awaiting_parent','confirmed')
         or (p_invitation_state in ('awaiting_teacher','awaiting_parent','confirmed') and (p_assessor_id is null or v_time_text = '')) then
        raise exception 'INVALID_INVITATION';
      end if;
    elsif p_invitation_kind = 'activity' then
      if p_activity_id is null or p_assessor_id is not null or v_time_text <> ''
         or p_invitation_state not in ('awaiting_parent','confirmed') then
        raise exception 'INVALID_INVITATION';
      end if;
    else
      if p_activity_id is not null or p_assessor_id is not null or v_time_text <> ''
         or p_invitation_state <> 'waiting_activity' then
        raise exception 'INVALID_INVITATION';
      end if;
    end if;
  end if;

  if p_activity_id is not null and not exists (
    select 1 from public.activities activity
     where activity.id = p_activity_id and activity.deleted_at is null
  ) then raise exception 'ACTIVITY_NOT_FOUND'; end if;
  if p_assessor_id is not null and not exists (
    select 1 from public.profiles profile
     where profile.id = p_assessor_id and profile.role in ('staff','admin')
       and profile.is_active and public.has_perm(profile.id, 'review.write')
  ) then raise exception 'ASSESSOR_UNAVAILABLE'; end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if v_lead.id is null then raise exception 'NOT_FOUND'; end if;
  if v_lead.owner_id is null then raise exception 'LEAD_UNASSIGNED'; end if;
  if v_lead.student_id is not null or v_lead.status in ('invalid','converted') then
    raise exception 'LEAD_CLOSED';
  end if;
  if v_lead.owner_id <> v_uid and not public.has_perm(v_uid, 'student.view.all') then
    raise exception 'FORBIDDEN_SCOPE';
  end if;

  insert into public.lead_communications(
    lead_id, channel, outcome, note, wechat_added, visit_committed,
    interest_level, recorded_by, owner_id_at_contact
  ) values (
    v_lead.id, 'phone', p_outcome, v_note, p_wechat_added, null,
    p_interest_level, v_uid, v_lead.owner_id
  ) returning id into v_communication_id;

  update public.lead_next_actions
     set status = 'completed', completed_by = v_uid, completed_at = now()
   where lead_id = v_lead.id and status = 'open' and kind = 'initial_contact';

  v_status := case
    when p_outcome = 'invalid_number' then 'invalid'
    when p_outcome = 'declined' then 'nurture'
    when p_outcome = 'unreachable' and v_lead.status <> 'uncontacted' then v_lead.status
    when p_outcome = 'unreachable' then 'uncontacted'
    else 'contacted'
  end;
  update public.leads set status = v_status where id = v_lead.id;

  if p_invitation_kind is not null then
    select invitation.id, invitation.state
      into v_invitation_id, v_previous_state
      from public.lead_invitation_threads invitation
     where invitation.lead_id = v_lead.id
       and invitation.state not in ('completed','cancelled')
     for update;

    if v_invitation_id is null then
      insert into public.lead_invitation_threads(
        lead_id, kind, state, activity_id, assessor_id, proposed_time_text,
        location_text, summary, owner_id_at_open, created_by, updated_by
      ) values (
        v_lead.id, p_invitation_kind, p_invitation_state,
        case when p_invitation_kind = 'activity' then p_activity_id else null end,
        case when p_invitation_kind = 'assessment_1v1' then p_assessor_id else null end,
        case when p_invitation_kind = 'assessment_1v1' then v_time_text else '' end,
        v_location_text, v_note, v_lead.owner_id, v_uid, v_uid
      ) returning id into v_invitation_id;
    else
      update public.lead_invitation_threads
         set kind = p_invitation_kind,
             state = p_invitation_state,
             activity_id = case when p_invitation_kind = 'activity' then p_activity_id else null end,
             assessor_id = case when p_invitation_kind = 'assessment_1v1' then p_assessor_id else null end,
             proposed_time_text = case when p_invitation_kind = 'assessment_1v1' then v_time_text else '' end,
             location_text = v_location_text,
             summary = case when v_note <> '' then v_note else summary end,
             updated_by = v_uid
       where id = v_invitation_id;
    end if;

    insert into public.lead_invitation_events(
      invitation_id, from_state, to_state, channel, note, recorded_by
    ) values (
      v_invitation_id, v_previous_state, p_invitation_state, 'phone', v_note, v_uid
    );
  end if;

  perform public.emit_domain_event(
    'lead.communication.recorded', 'lead', v_lead.id,
    jsonb_build_object(
      'communicationId', v_communication_id,
      'outcome', p_outcome,
      'status', v_status,
      'invitationId', v_invitation_id,
      'invitationState', p_invitation_state
    ),
    v_uid, null
  );
  if v_invitation_id is not null then
    perform public.emit_domain_event(
      'lead.invitation.updated', 'lead_invitation', v_invitation_id,
      jsonb_build_object('leadId', v_lead.id, 'kind', p_invitation_kind, 'state', p_invitation_state),
      v_uid, null
    );
  end if;

  return jsonb_build_object(
    'communicationId', v_communication_id,
    'status', v_status,
    'invitationId', v_invitation_id,
    'invitationState', p_invitation_state
  );
end
$$;

create or replace function public.update_lead_invitation(
  p_invitation_id uuid,
  p_kind text,
  p_state text,
  p_activity_id uuid,
  p_assessor_id uuid,
  p_proposed_time_text text,
  p_location_text text,
  p_channel text,
  p_note text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_invitation public.lead_invitation_threads%rowtype;
  v_lead public.leads%rowtype;
  v_time_text text := btrim(coalesce(p_proposed_time_text, ''));
  v_location_text text := btrim(coalesce(p_location_text, ''));
  v_note text := btrim(coalesce(p_note, ''));
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid, 'followup.write') then raise exception 'FORBIDDEN'; end if;
  if p_kind not in ('assessment_1v1','activity','waiting_activity')
     or p_state not in ('coordinating_time','awaiting_teacher','awaiting_parent','confirmed','waiting_activity','completed','cancelled')
     or p_channel not in ('phone','wechat','in_person','other')
     or char_length(v_time_text) > 200 or char_length(v_location_text) > 200
     or char_length(v_note) > 2000 then
    raise exception 'INVALID_INVITATION';
  end if;
  if p_kind = 'assessment_1v1' then
    if p_activity_id is not null or p_state = 'waiting_activity'
       or (p_state in ('awaiting_teacher','awaiting_parent','confirmed') and (p_assessor_id is null or v_time_text = '')) then
      raise exception 'INVALID_INVITATION';
    end if;
  elsif p_kind = 'activity' then
    if p_activity_id is null or p_assessor_id is not null or v_time_text <> ''
       or p_state in ('coordinating_time','awaiting_teacher','waiting_activity') then
      raise exception 'INVALID_INVITATION';
    end if;
  else
    if p_activity_id is not null or p_assessor_id is not null or v_time_text <> ''
       or p_state not in ('waiting_activity','completed','cancelled') then
      raise exception 'INVALID_INVITATION';
    end if;
  end if;
  if p_activity_id is not null and not exists (
    select 1 from public.activities activity
     where activity.id = p_activity_id and activity.deleted_at is null
  ) then raise exception 'ACTIVITY_NOT_FOUND'; end if;
  if p_assessor_id is not null and not exists (
    select 1 from public.profiles profile
     where profile.id = p_assessor_id and profile.role in ('staff','admin')
       and profile.is_active and public.has_perm(profile.id, 'review.write')
  ) then raise exception 'ASSESSOR_UNAVAILABLE'; end if;

  select * into v_invitation
    from public.lead_invitation_threads
   where id = p_invitation_id for update;
  if v_invitation.id is null then raise exception 'NOT_FOUND'; end if;
  if v_invitation.state in ('completed','cancelled') then raise exception 'INVITATION_CLOSED'; end if;
  select * into v_lead from public.leads where id = v_invitation.lead_id;
  if v_lead.id is null or v_lead.student_id is not null or v_lead.status in ('invalid','converted') then
    raise exception 'LEAD_CLOSED';
  end if;
  if v_lead.owner_id is null then raise exception 'LEAD_UNASSIGNED'; end if;
  if v_lead.owner_id <> v_uid and not public.has_perm(v_uid, 'student.view.all') then
    raise exception 'FORBIDDEN_SCOPE';
  end if;

  update public.lead_invitation_threads
     set kind = p_kind,
         state = p_state,
         activity_id = case when p_kind = 'activity' then p_activity_id else null end,
         assessor_id = case when p_kind = 'assessment_1v1' then p_assessor_id else null end,
         proposed_time_text = case when p_kind = 'assessment_1v1' then v_time_text else '' end,
         location_text = v_location_text,
         summary = case when v_note <> '' then v_note else summary end,
         updated_by = v_uid,
         closed_by = case when p_state in ('completed','cancelled') then v_uid else null end,
         closed_at = case when p_state in ('completed','cancelled') then now() else null end
   where id = v_invitation.id;

  insert into public.lead_invitation_events(
    invitation_id, from_state, to_state, channel, note, recorded_by
  ) values (
    v_invitation.id, v_invitation.state, p_state, p_channel, v_note, v_uid
  );

  perform public.emit_domain_event(
    'lead.invitation.updated', 'lead_invitation', v_invitation.id,
    jsonb_build_object('leadId', v_invitation.lead_id, 'kind', p_kind, 'state', p_state),
    v_uid, null
  );
  return jsonb_build_object('invitationId', v_invitation.id, 'kind', p_kind, 'state', p_state);
end
$$;

-- 旧“已诺访”只证明当时产生了测评意向，不等于时间、老师和家长均已确认。
-- 将它迁移到“待协调时间”，以便现有本地验收数据能进入新工作台继续处理。
with latest_legacy as (
  select distinct on (communication.lead_id)
         communication.lead_id,
         communication.note,
         communication.recorded_by,
         communication.owner_id_at_contact,
         communication.occurred_at
    from public.lead_communications communication
    join public.leads lead on lead.id = communication.lead_id
   where communication.visit_committed is true
     and lead.student_id is null
     and lead.status not in ('invalid','converted')
   order by communication.lead_id, communication.occurred_at desc, communication.id desc
)
insert into public.lead_invitation_threads(
  lead_id, kind, state, summary, owner_id_at_open, created_by, updated_by, created_at, updated_at
)
select legacy.lead_id, 'assessment_1v1', 'coordinating_time', legacy.note,
       legacy.owner_id_at_contact, legacy.recorded_by, legacy.recorded_by,
       legacy.occurred_at, legacy.occurred_at
  from latest_legacy legacy
 where not exists (
   select 1 from public.lead_invitation_threads invitation
    where invitation.lead_id = legacy.lead_id
      and invitation.state not in ('completed','cancelled')
 );

insert into public.lead_invitation_events(invitation_id, from_state, to_state, channel, note, recorded_by, occurred_at)
select invitation.id, null, invitation.state, 'phone', invitation.summary,
       invitation.created_by, invitation.created_at
  from public.lead_invitation_threads invitation
 where not exists (
   select 1 from public.lead_invitation_events event where event.invitation_id = invitation.id
 );

update public.leads lead
   set status = 'contacted'
 where lead.status = 'intent_confirmed'
   and exists (
     select 1 from public.lead_invitation_threads invitation
      where invitation.lead_id = lead.id
        and invitation.state not in ('completed','cancelled')
   );

revoke all on function public.list_invitation_assessors() from public, anon, authenticated;
revoke all on function public.record_lead_contact_v2(uuid,text,text,boolean,text,text,text,uuid,uuid,text,text)
  from public, anon, authenticated;
revoke all on function public.update_lead_invitation(uuid,text,text,uuid,uuid,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.list_invitation_assessors() to authenticated;
grant execute on function public.record_lead_contact_v2(uuid,text,text,boolean,text,text,text,uuid,uuid,text,text)
  to authenticated;
grant execute on function public.update_lead_invitation(uuid,text,text,uuid,uuid,text,text,text,text)
  to authenticated;
