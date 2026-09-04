-- 1 对 1 测评时间采用双边可用时段：学辅代家长登记范围，测评老师登记本人时段，
-- 最终时间只能从精确的共同可行格中产生。“放学后”保留为范围格，不伪装成时间戳。

create or replace function public.valid_assessment_time_options(p_options text[])
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select cardinality(coalesce(p_options, '{}'::text[])) <= 84
     and not exists (
       select 1
         from unnest(coalesce(p_options, '{}'::text[])) option_value
        where option_value !~ '^\d{4}-\d{2}-\d{2}@(09:50|10:00|14:00|16:00|after_school|17:00|17:30|19:20)$'
     );
$$;

alter table public.lead_invitation_threads
  add column parent_time_options text[] not null default '{}'::text[],
  add column assessor_time_options text[] not null default '{}'::text[],
  add column scheduled_at timestamptz,
  add constraint lead_invitation_threads_time_options_check check (
    public.valid_assessment_time_options(parent_time_options)
    and public.valid_assessment_time_options(assessor_time_options)
  ),
  add constraint lead_invitation_threads_availability_shape_check check (
    (
      kind = 'assessment_1v1'
      and (
        scheduled_at is null
        or (
          to_char(scheduled_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD"@"HH24:MI') = any(parent_time_options)
          and to_char(scheduled_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD"@"HH24:MI') = any(assessor_time_options)
        )
      )
    )
    or (
      kind <> 'assessment_1v1'
      and cardinality(parent_time_options) = 0
      and cardinality(assessor_time_options) = 0
      and scheduled_at is null
    )
  );

comment on column public.lead_invitation_threads.parent_time_options is
  'Selectable week-grid tokens recorded by learning support for the parent, such as 2026-09-08@after_school or 2026-09-12@10:00.';
comment on column public.lead_invitation_threads.assessor_time_options is
  'Selectable week-grid tokens recorded by the assigned assessment teacher.';
comment on column public.lead_invitation_threads.scheduled_at is
  'Final exact assessment time. It must correspond to an exact token present on both sides; broad range tokens cannot become final appointments.';

create or replace function public.record_lead_contact_v3(
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
  p_location_text text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_parent_options text[];
  v_assessor_options text[];
  v_scheduled_option text;
  v_legacy_time_text text := '';
  v_result jsonb;
  v_invitation_id uuid;
begin
  select coalesce(array_agg(distinct option_value order by option_value), '{}'::text[])
    into v_parent_options
    from unnest(coalesce(p_parent_time_options, '{}'::text[])) option_value;
  select coalesce(array_agg(distinct option_value order by option_value), '{}'::text[])
    into v_assessor_options
    from unnest(coalesce(p_assessor_time_options, '{}'::text[])) option_value;
  v_scheduled_option := case when p_scheduled_at is null then null
    else to_char(p_scheduled_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD"@"HH24:MI') end;

  if not public.valid_assessment_time_options(v_parent_options)
     or not public.valid_assessment_time_options(v_assessor_options) then
    raise exception 'INVALID_INVITATION';
  end if;

  if p_invitation_kind = 'assessment_1v1' then
    if p_invitation_state = 'awaiting_teacher'
       and (p_assessor_id is null or cardinality(v_parent_options) = 0) then
      raise exception 'INVALID_INVITATION';
    end if;
    if p_invitation_state = 'awaiting_parent'
       and (p_assessor_id is null or not (v_parent_options && v_assessor_options)) then
      raise exception 'INVALID_INVITATION';
    end if;
    if p_invitation_state = 'confirmed'
       and (p_assessor_id is null or v_scheduled_option is null
         or not (v_scheduled_option = any(v_parent_options))
         or not (v_scheduled_option = any(v_assessor_options))) then
      raise exception 'INVALID_INVITATION';
    end if;
    v_legacy_time_text := case
      when p_scheduled_at is not null then to_char(p_scheduled_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI')
      when cardinality(v_parent_options) > 0 then '已登记 ' || cardinality(v_parent_options)::text || ' 个家长可行时段'
      else ''
    end;
  elsif cardinality(v_parent_options) > 0 or cardinality(v_assessor_options) > 0 or p_scheduled_at is not null then
    raise exception 'INVALID_INVITATION';
  end if;

  v_result := public.record_lead_contact_v2(
    p_lead_id, p_outcome, p_note, p_wechat_added, p_interest_level,
    p_invitation_kind, p_invitation_state, p_activity_id, p_assessor_id,
    v_legacy_time_text, p_location_text
  );
  v_invitation_id := nullif(v_result ->> 'invitationId', '')::uuid;
  if v_invitation_id is not null then
    update public.lead_invitation_threads
       set parent_time_options = case when p_invitation_kind = 'assessment_1v1' then v_parent_options else '{}'::text[] end,
           assessor_time_options = case when p_invitation_kind = 'assessment_1v1' then v_assessor_options else '{}'::text[] end,
           scheduled_at = case when p_invitation_kind = 'assessment_1v1' then p_scheduled_at else null end
     where id = v_invitation_id;
  end if;
  return v_result;
end
$$;

create or replace function public.update_lead_invitation_v2(
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
  p_note text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_parent_options text[];
  v_assessor_options text[];
  v_scheduled_option text;
  v_legacy_time_text text := '';
  v_result jsonb;
begin
  select coalesce(array_agg(distinct option_value order by option_value), '{}'::text[])
    into v_parent_options
    from unnest(coalesce(p_parent_time_options, '{}'::text[])) option_value;
  select coalesce(array_agg(distinct option_value order by option_value), '{}'::text[])
    into v_assessor_options
    from unnest(coalesce(p_assessor_time_options, '{}'::text[])) option_value;
  v_scheduled_option := case when p_scheduled_at is null then null
    else to_char(p_scheduled_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD"@"HH24:MI') end;

  if not public.valid_assessment_time_options(v_parent_options)
     or not public.valid_assessment_time_options(v_assessor_options) then
    raise exception 'INVALID_INVITATION';
  end if;

  if p_kind = 'assessment_1v1' then
    if p_state = 'awaiting_teacher'
       and (p_assessor_id is null or cardinality(v_parent_options) = 0) then
      raise exception 'INVALID_INVITATION';
    end if;
    if p_state = 'awaiting_parent'
       and (p_assessor_id is null or not (v_parent_options && v_assessor_options)) then
      raise exception 'INVALID_INVITATION';
    end if;
    if p_state = 'confirmed'
       and (p_assessor_id is null or v_scheduled_option is null
         or not (v_scheduled_option = any(v_parent_options))
         or not (v_scheduled_option = any(v_assessor_options))) then
      raise exception 'INVALID_INVITATION';
    end if;
    v_legacy_time_text := case
      when p_scheduled_at is not null then to_char(p_scheduled_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI')
      when cardinality(v_parent_options) > 0 then '已登记 ' || cardinality(v_parent_options)::text || ' 个家长可行时段'
      else ''
    end;
  elsif cardinality(v_parent_options) > 0 or cardinality(v_assessor_options) > 0 or p_scheduled_at is not null then
    raise exception 'INVALID_INVITATION';
  end if;

  -- 先清空旧测评时段，确保从测评切换到活动时仍满足表级形状约束；失败会随事务回滚。
  if p_kind <> 'assessment_1v1' then
    update public.lead_invitation_threads
       set parent_time_options = '{}'::text[], assessor_time_options = '{}'::text[], scheduled_at = null
     where id = p_invitation_id;
  end if;

  v_result := public.update_lead_invitation(
    p_invitation_id, p_kind, p_state, p_activity_id, p_assessor_id,
    v_legacy_time_text, p_location_text, p_channel, p_note
  );
  update public.lead_invitation_threads
     set parent_time_options = case when p_kind = 'assessment_1v1' then v_parent_options else '{}'::text[] end,
         assessor_time_options = case when p_kind = 'assessment_1v1' then v_assessor_options else '{}'::text[] end,
         scheduled_at = case when p_kind = 'assessment_1v1' then p_scheduled_at else null end
   where id = p_invitation_id;
  return v_result;
end
$$;

create or replace function public.set_invitation_assessor_availability(
  p_invitation_id uuid,
  p_assessor_time_options text[]
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_invitation public.lead_invitation_threads%rowtype;
  v_options text[];
  v_next_state text;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid, 'review.write') then raise exception 'FORBIDDEN'; end if;
  select coalesce(array_agg(distinct option_value order by option_value), '{}'::text[])
    into v_options
    from unnest(coalesce(p_assessor_time_options, '{}'::text[])) option_value;
  if not public.valid_assessment_time_options(v_options) then raise exception 'INVALID_INVITATION'; end if;

  select * into v_invitation
    from public.lead_invitation_threads
   where id = p_invitation_id
   for update;
  if v_invitation.id is null then raise exception 'NOT_FOUND'; end if;
  if v_invitation.state in ('completed','cancelled','confirmed') then raise exception 'INVITATION_CLOSED'; end if;
  if v_invitation.kind <> 'assessment_1v1' then raise exception 'INVALID_INVITATION'; end if;
  if v_invitation.assessor_id is distinct from v_uid then raise exception 'ASSESSOR_SCOPE'; end if;

  v_next_state := case
    when v_invitation.parent_time_options && v_options then 'awaiting_parent'
    when cardinality(v_invitation.parent_time_options) > 0 then 'coordinating_time'
    else v_invitation.state
  end;
  update public.lead_invitation_threads
     set assessor_time_options = v_options,
         scheduled_at = case
           when scheduled_at is not null
            and to_char(scheduled_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD"@"HH24:MI') = any(v_options)
           then scheduled_at else null end,
         state = v_next_state,
         updated_by = v_uid
   where id = v_invitation.id;

  insert into public.lead_invitation_events(invitation_id, from_state, to_state, channel, note, recorded_by)
  values (v_invitation.id, v_invitation.state, v_next_state, 'other', '', v_uid);
  perform public.emit_domain_event(
    'lead.invitation.assessor_availability_updated', 'lead_invitation', v_invitation.id,
    jsonb_build_object(
      'leadId', v_invitation.lead_id,
      'state', v_next_state,
      'assessorOptionCount', cardinality(v_options)
    ),
    v_uid, null
  );
  return jsonb_build_object('invitationId', v_invitation.id, 'state', v_next_state);
end
$$;

create or replace function public.has_assigned_invitation_lead(p_uid uuid, p_lead_id uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select p_uid is not null
     and public.has_perm(p_uid, 'review.write')
     and exists (
       select 1
         from public.lead_invitation_threads invitation
        where invitation.lead_id = p_lead_id
          and invitation.assessor_id = p_uid
          and invitation.state not in ('completed','cancelled')
     );
$$;

create policy lead_invitation_threads_select_assessor_scope on public.lead_invitation_threads
  for select to authenticated using (
    assessor_id = (select auth.uid())
    and public.has_perm((select auth.uid()), 'review.write')
  );

create policy leads_select_assigned_invitation_assessor on public.leads
  for select to authenticated using (
    public.has_assigned_invitation_lead((select auth.uid()), id)
  );

create or replace function public.list_invitation_assessors()
returns table (user_id uuid, display_name text)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select profile.id, profile.display_name
    from public.profiles profile
   where auth.uid() is not null
     and (public.has_perm(auth.uid(), 'followup.view') or public.has_perm(auth.uid(), 'review.write'))
     and profile.role in ('staff', 'admin')
     and profile.is_active
     and public.has_perm(profile.id, 'review.write')
   order by profile.display_name, profile.id;
$$;

revoke all on function public.valid_assessment_time_options(text[]) from public, anon, authenticated;
revoke all on function public.record_lead_contact_v3(uuid,text,text,boolean,text,text,text,uuid,uuid,text[],text[],timestamptz,text)
  from public, anon, authenticated;
revoke all on function public.update_lead_invitation_v2(uuid,text,text,uuid,uuid,text[],text[],timestamptz,text,text,text)
  from public, anon, authenticated;
revoke all on function public.set_invitation_assessor_availability(uuid,text[]) from public, anon, authenticated;
revoke all on function public.has_assigned_invitation_lead(uuid,uuid) from public, anon, authenticated;
grant execute on function public.record_lead_contact_v3(uuid,text,text,boolean,text,text,text,uuid,uuid,text[],text[],timestamptz,text)
  to authenticated;
grant execute on function public.update_lead_invitation_v2(uuid,text,text,uuid,uuid,text[],text[],timestamptz,text,text,text)
  to authenticated;
grant execute on function public.set_invitation_assessor_availability(uuid,text[]) to authenticated;
grant execute on function public.has_assigned_invitation_lead(uuid,uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');
