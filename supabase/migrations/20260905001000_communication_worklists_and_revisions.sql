-- 沟通工作单保存成员快照；修订保留原记录、原录入时间与次数。
create table public.communication_worklists (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  work_date date not null check (isfinite(work_date)),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz
);
create index communication_worklists_owner_date_idx on public.communication_worklists(owner_id,work_date,created_at desc);
create table public.communication_worklist_items (
  worklist_id uuid not null references public.communication_worklists(id) on delete restrict,
  row_key text not null check (row_key ~ '^(lead|post):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  position integer not null check (position>0),
  added_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  primary key(worklist_id,row_key),
  unique(worklist_id,position)
);

-- 读范围与既有 leads 策略及参与跟进范围保持一致；写范围单独检查。
create function public.can_access_communication_row(p_row_key text,p_write boolean default false)
returns boolean language plpgsql security definer stable set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_id uuid; v_lead public.leads%rowtype;
begin
  if v_uid is null or p_row_key is null
    or p_row_key !~ '^(lead|post):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  v_id:=split_part(p_row_key,':',2)::uuid;
  if split_part(p_row_key,':',1)='post' then
    return public.can_follow_up_participation(v_id,v_uid)
      and (not p_write or public.has_perm(v_uid,'followup.write'));
  end if;
  select * into v_lead from public.leads where id=v_id;
  if not found then return false; end if;
  if p_write then
    return public.has_perm(v_uid,'followup.write') and v_lead.owner_id is not null
      and (v_lead.owner_id=v_uid or public.has_perm(v_uid,'student.view.all'));
  end if;
  return (public.has_perm(v_uid,'followup.view') and (v_lead.owner_id is null or v_lead.owner_id=v_uid or public.has_perm(v_uid,'student.view.all')))
    or (v_lead.created_by=v_uid and public.has_perm(v_uid,'student.import'))
    or public.has_assigned_invitation_lead(v_uid,v_id)
    or public.has_assessment_history_lead_access(v_id);
end $$;

alter table public.communication_worklists enable row level security;
alter table public.communication_worklist_items enable row level security;
create policy communication_worklists_select on public.communication_worklists for select to authenticated using (
  (public.has_perm((select auth.uid()),'followup.view') or public.has_perm((select auth.uid()),'followup.write'))
  and (owner_id=(select auth.uid()) or public.has_perm((select auth.uid()),'student.view.all'))
);
create policy communication_worklist_items_select on public.communication_worklist_items for select to authenticated using (
  exists(select 1 from public.communication_worklists w where w.id=worklist_id)
  and public.can_access_communication_row(row_key,false)
);
revoke all on public.communication_worklists,public.communication_worklist_items from public,anon,authenticated;
grant select on public.communication_worklists,public.communication_worklist_items to authenticated;

create function public.create_communication_worklist(p_name text,p_work_date date,p_row_keys text[])
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_id uuid; v_key text; v_keys text[];
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid,'followup.write') then raise exception 'FORBIDDEN'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 100 or p_work_date is null or not isfinite(p_work_date)
    or p_row_keys is null or cardinality(p_row_keys) not between 1 and 10000 then raise exception 'VALIDATION'; end if;
  foreach v_key in array p_row_keys loop
    if v_key is null or v_key !~* '^(lead|post):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'VALIDATION'; end if;
  end loop;
  select array_agg(row_key order by ordinal) into v_keys from (
    select lower(split_part(value,':',1))||':'||split_part(value,':',2)::uuid::text row_key,min(n) ordinal
    from unnest(p_row_keys) with ordinality x(value,n) group by 1
  ) normalized;
  foreach v_key in array v_keys loop
    if not public.can_access_communication_row(v_key,true) then raise exception 'FORBIDDEN_SCOPE'; end if;
  end loop;
  insert into public.communication_worklists(name,work_date,owner_id,created_by)
    values(btrim(p_name),p_work_date,v_uid,v_uid) returning id into v_id;
  insert into public.communication_worklist_items(worklist_id,row_key,position)
    select v_id,value,n::integer from unnest(v_keys) with ordinality x(value,n);
  return v_id;
end $$;

create function public.get_communication_worklist(p_id uuid)
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_list public.communication_worklists%rowtype; v_items jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not (public.has_perm(v_uid,'followup.view') or public.has_perm(v_uid,'followup.write')) then raise exception 'FORBIDDEN'; end if;
  select * into v_list from public.communication_worklists where id=p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_list.owner_id<>v_uid and not public.has_perm(v_uid,'student.view.all') then raise exception 'FORBIDDEN_SCOPE'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('key',i.row_key,'position',i.position,'addedAt',i.added_at,'completedAt',i.completed_at) order by i.position),'[]'::jsonb)
    into v_items from public.communication_worklist_items i where i.worklist_id=p_id and public.can_access_communication_row(i.row_key,false);
  return jsonb_build_object('id',v_list.id,'name',v_list.name,'date',v_list.work_date,'ownerId',v_list.owner_id,
    'createdBy',v_list.created_by,'createdAt',v_list.created_at,'closedAt',v_list.closed_at,'items',v_items,
    'rowKeys',coalesce((select jsonb_agg(value->>'key' order by (value->>'position')::integer) from jsonb_array_elements(v_items)),'[]'::jsonb),
    'canManage',public.has_perm(v_uid,'followup.write') and (v_list.owner_id=v_uid or public.has_perm(v_uid,'student.view.all')));
end $$;

create function public.get_communication_worklists(p_date date default null)
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not (public.has_perm(v_uid,'followup.view') or public.has_perm(v_uid,'followup.write')) then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(public.get_communication_worklist(w.id) order by w.work_date desc,w.created_at desc,w.id)
    from public.communication_worklists w where (p_date is null or w.work_date=p_date)
      and (w.owner_id=v_uid or public.has_perm(v_uid,'student.view.all'))),'[]'::jsonb);
end $$;

create function public.complete_communication_worklist_item(p_worklist_id uuid,p_row_key text,p_completed boolean default true)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_list public.communication_worklists%rowtype;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid,'followup.write') then raise exception 'FORBIDDEN'; end if;
  if p_completed is null then raise exception 'VALIDATION'; end if;
  select * into v_list from public.communication_worklists where id=p_worklist_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_list.owner_id<>v_uid and not public.has_perm(v_uid,'student.view.all') then raise exception 'FORBIDDEN_SCOPE'; end if;
  if not public.can_access_communication_row(p_row_key,true) then raise exception 'FORBIDDEN_SCOPE'; end if;
  update public.communication_worklist_items set completed_at=case when p_completed then coalesce(completed_at,clock_timestamp()) else null end
    where worklist_id=p_worklist_id and row_key=p_row_key;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

create table public.communication_record_revisions (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('contact','invitation','post_activity')),
  event_id uuid not null,
  revision_no integer not null check(revision_no>0),
  previous_revision_id uuid references public.communication_record_revisions(id) on delete restrict,
  patch jsonb not null check(jsonb_typeof(patch)='object' and patch<>'{}'::jsonb),
  effective_patch jsonb not null check(jsonb_typeof(effective_patch)='object'),
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  unique(source,event_id,revision_no)
);
create index communication_record_revisions_latest_idx on public.communication_record_revisions(source,event_id,revision_no desc);
create function public.guard_communication_record_revision() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'COMMUNICATION_REVISION_IMMUTABLE'; end $$;
create trigger communication_record_revisions_immutable before update or delete on public.communication_record_revisions
  for each row execute function public.guard_communication_record_revision();
alter table public.communication_record_revisions enable row level security;
create policy communication_record_revisions_select on public.communication_record_revisions for select to authenticated using (
  (source='contact' and exists(select 1 from public.lead_communications e where e.id=event_id))
  or (source='invitation' and exists(select 1 from public.lead_invitation_events e where e.id=event_id))
  or (source='post_activity' and exists(select 1 from public.activity_followup_contacts e where e.id=event_id))
);
revoke all on public.communication_record_revisions from public,anon,authenticated;
grant select on public.communication_record_revisions to authenticated;

create function public.can_revise_communication_record(p_source text,p_event_id uuid)
returns boolean language plpgsql security definer stable set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_author uuid; v_lead uuid; v_registration uuid; v_assessor uuid;
begin
  if v_uid is null then return false; end if;
  if p_source='contact' then
    select recorded_by,lead_id into v_author,v_lead from public.lead_communications where id=p_event_id;
    if not found or not public.can_access_communication_row('lead:'||v_lead::text,true) then return false; end if;
  elsif p_source='invitation' then
    select e.recorded_by,i.lead_id,i.assessor_id into v_author,v_lead,v_assessor from public.lead_invitation_events e
      join public.lead_invitation_threads i on i.id=e.invitation_id where e.id=p_event_id;
    if not found or not (public.can_access_communication_row('lead:'||v_lead::text,true)
      or (v_assessor is not distinct from v_uid and public.has_perm(v_uid,'review.write'))) then return false; end if;
  elsif p_source='post_activity' then
    select recorded_by,registration_id into v_author,v_registration from public.activity_followup_contacts where id=p_event_id;
    if not found or not public.can_access_communication_row('post:'||v_registration::text,true) then return false; end if;
  else return false;
  end if;
  return v_author=v_uid or public.has_perm(v_uid,'student.view.all');
end $$;

-- 最后版本使用累计补丁；原作者和原录入时间始终可读取。
create view public.effective_lead_communications with (security_invoker=true) as
select e.id,e.lead_id,coalesce(r.effective_patch->>'channel',e.channel) channel,
  coalesce(r.effective_patch->>'outcome',e.outcome) outcome,coalesce(r.effective_patch->>'note',e.note) note,
  case when r.effective_patch?'wechatAdded' then (r.effective_patch->>'wechatAdded')::boolean else e.wechat_added end wechat_added,
  case when r.effective_patch?'visitCommitted' then (r.effective_patch->>'visitCommitted')::boolean else e.visit_committed end visit_committed,
  case when r.effective_patch?'interestLevel' then r.effective_patch->>'interestLevel' else e.interest_level end interest_level,
  e.recorded_by,e.owner_id_at_contact,coalesce((r.effective_patch->>'occurredAt')::timestamptz,e.occurred_at) occurred_at,
  r.id revision_id,r.recorded_at revised_at,r.recorded_by revised_by,e.occurred_at original_occurred_at,
  public.can_revise_communication_record('contact',e.id) can_revise
from public.lead_communications e left join lateral(select * from public.communication_record_revisions r
  where r.source='contact' and r.event_id=e.id order by r.revision_no desc limit 1) r on true;
create view public.effective_lead_invitation_events with (security_invoker=true) as
select e.id,e.invitation_id,e.from_state,e.to_state,coalesce(r.effective_patch->>'channel',e.channel) channel,
  coalesce(r.effective_patch->>'note',e.note) note,e.recorded_by,
  coalesce((r.effective_patch->>'occurredAt')::timestamptz,e.occurred_at) occurred_at,
  r.id revision_id,r.recorded_at revised_at,r.recorded_by revised_by,e.occurred_at original_occurred_at,
  public.can_revise_communication_record('invitation',e.id) can_revise
from public.lead_invitation_events e left join lateral(select * from public.communication_record_revisions r
  where r.source='invitation' and r.event_id=e.id order by r.revision_no desc limit 1) r on true;
create view public.effective_activity_followup_contacts with (security_invoker=true) as
select e.id,e.registration_id,coalesce(r.effective_patch->>'channel',e.channel) channel,
  coalesce(r.effective_patch->>'outcome',e.outcome) outcome,coalesce(r.effective_patch->>'route',e.route) route,
  coalesce(r.effective_patch->>'note',e.note) note,e.next_contact_at,e.recorded_by,
  coalesce((r.effective_patch->>'occurredAt')::timestamptz,e.occurred_at) occurred_at,
  r.id revision_id,r.recorded_at revised_at,r.recorded_by revised_by,e.occurred_at original_occurred_at,
  public.can_revise_communication_record('post_activity',e.id) can_revise
from public.activity_followup_contacts e left join lateral(select * from public.communication_record_revisions r
  where r.source='post_activity' and r.event_id=e.id order by r.revision_no desc limit 1) r on true;
revoke all on public.effective_lead_communications,public.effective_lead_invitation_events,public.effective_activity_followup_contacts from public,anon,authenticated;
grant select on public.effective_lead_communications,public.effective_lead_invitation_events,public.effective_activity_followup_contacts to authenticated;

create function public.revise_communication_record(p_source text,p_event_id uuid,p_expected_revision uuid,p_patch jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_uid uuid:=auth.uid(); v_previous public.communication_record_revisions%rowtype; v_id uuid;
  v_contact public.lead_communications%rowtype; v_invitation_event public.lead_invitation_events%rowtype;
  v_post public.activity_followup_contacts%rowtype; v_lead public.leads%rowtype; v_thread public.lead_invitation_threads%rowtype;
  v_route public.activity_routes%rowtype; v_allowed text[]; v_key text; v_patch jsonb:=p_patch;
  v_effective jsonb; v_before jsonb; v_after jsonb; v_time timestamptz; v_semantic boolean; v_latest boolean;
  v_prior_status text; v_expected_status text; v_status text;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_source is null or p_source not in ('contact','invitation','post_activity') or p_event_id is null
    or p_patch is null or jsonb_typeof(p_patch)<>'object' or p_patch='{}'::jsonb then raise exception 'VALIDATION'; end if;
  if p_source='contact' then
    select * into v_contact from public.lead_communications where id=p_event_id for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    select * into v_lead from public.leads where id=v_contact.lead_id for update;
    v_allowed:=array['note','channel','occurredAt','outcome','wechatAdded','visitCommitted','interestLevel'];
    v_before:=jsonb_build_object('note',v_contact.note,'channel',v_contact.channel,'occurredAt',v_contact.occurred_at,
      'outcome',v_contact.outcome,'wechatAdded',v_contact.wechat_added,'visitCommitted',v_contact.visit_committed,'interestLevel',v_contact.interest_level);
  elsif p_source='invitation' then
    select * into v_invitation_event from public.lead_invitation_events where id=p_event_id for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    select * into v_thread from public.lead_invitation_threads where id=v_invitation_event.invitation_id for update;
    v_allowed:=array['note','channel','occurredAt'];
    v_before:=jsonb_build_object('note',v_invitation_event.note,'channel',v_invitation_event.channel,'occurredAt',v_invitation_event.occurred_at);
  else
    select * into v_post from public.activity_followup_contacts where id=p_event_id for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    perform 1 from public.activity_registrations where id=v_post.registration_id for update;
    select * into v_route from public.activity_routes where activity_registration_id=v_post.registration_id for update;
    v_allowed:=array['note','channel','occurredAt','outcome','route'];
    v_before:=jsonb_build_object('note',v_post.note,'channel',v_post.channel,'occurredAt',v_post.occurred_at,'outcome',v_post.outcome,'route',v_post.route);
  end if;
  if not public.can_revise_communication_record(p_source,p_event_id) then raise exception 'FORBIDDEN_SCOPE'; end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if not(v_key=any(v_allowed)) then raise exception 'VALIDATION'; end if;
  end loop;
  if p_patch?'note' then
    if jsonb_typeof(p_patch->'note')<>'string' or length(p_patch->>'note')>2000 then raise exception 'VALIDATION'; end if;
    v_patch:=jsonb_set(v_patch,'{note}',to_jsonb(btrim(p_patch->>'note')));
  end if;
  if p_patch?'channel' and (jsonb_typeof(p_patch->'channel')<>'string' or p_patch->>'channel' not in ('phone','wechat','in_person','other')) then raise exception 'VALIDATION'; end if;
  if p_patch?'occurredAt' then
    if jsonb_typeof(p_patch->'occurredAt')<>'string' or p_patch->>'occurredAt' !~* '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.+(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'VALIDATION'; end if;
    begin v_time:=(p_patch->>'occurredAt')::timestamptz;
      exception when invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION'; end;
    if not isfinite(v_time) then raise exception 'VALIDATION'; end if;
    v_patch:=jsonb_set(v_patch,'{occurredAt}',to_jsonb(v_time));
  end if;
  foreach v_key in array array['wechatAdded','visitCommitted'] loop
    if p_patch?v_key and jsonb_typeof(p_patch->v_key) not in ('boolean','null') then raise exception 'VALIDATION'; end if;
  end loop;
  if p_patch?'interestLevel' and (jsonb_typeof(p_patch->'interestLevel') not in ('string','null')
    or (jsonb_typeof(p_patch->'interestLevel')='string' and p_patch->>'interestLevel' not in ('A','B','C'))) then raise exception 'VALIDATION'; end if;
  if p_patch?'outcome' and (jsonb_typeof(p_patch->'outcome')<>'string' or (p_source='contact' and p_patch->>'outcome' not in ('unreachable','connected','declined','invalid_number'))
    or (p_source='post_activity' and p_patch->>'outcome' not in ('connected','unreachable'))) then raise exception 'VALIDATION'; end if;
  if p_patch?'route' and (jsonb_typeof(p_patch->'route')<>'string' or p_patch->>'route' not in ('continue_follow_up','await_product','closed','enrollment_pending')) then raise exception 'VALIDATION'; end if;
  select * into v_previous from public.communication_record_revisions where source=p_source and event_id=p_event_id order by revision_no desc limit 1;
  if v_previous.id is distinct from p_expected_revision then raise exception 'REVISION_CONFLICT'; end if;
  v_effective:=coalesce(v_previous.effective_patch,'{}'::jsonb)||v_patch;
  v_before:=v_before||coalesce(v_previous.effective_patch,'{}'::jsonb);
  v_after:=v_before||v_patch;
  if p_source='contact' then
    if v_after->>'outcome' not in ('connected','declined') and ((v_after->>'wechatAdded')::boolean is true or (v_after->>'visitCommitted')::boolean is true) then raise exception 'VALIDATION'; end if;
    v_semantic:=v_after->'outcome' is distinct from v_before->'outcome' or v_after->'visitCommitted' is distinct from v_before->'visitCommitted';
    v_latest:=not exists(select 1 from public.lead_communications e where e.lead_id=v_lead.id and (e.occurred_at,e.id)>(v_contact.occurred_at,v_contact.id));
    -- 历史结果可以更正；当前投影始终由最后录入的事实负责。
    if v_semantic and v_latest then
      if v_lead.student_id is not null or v_lead.status='converted'
        or exists(select 1 from public.lead_invitation_threads i where i.lead_id=v_lead.id)
        or exists(select 1 from public.activity_registrations r where r.lead_id=v_lead.id)
        or exists(select 1 from public.course_opportunities o where o.lead_id=v_lead.id)
        or exists(select 1 from public.lead_next_actions a where a.lead_id=v_lead.id and a.status='open' and a.created_at>=v_contact.occurred_at)
        then raise exception 'CORRECTION_REQUIRES_WORKFLOW' using detail='contact_has_later_communication_invitation_reminder_or_enrollment'; end if;
      select case when e.visit_committed is true then 'intent_confirmed' when e.outcome='invalid_number' then 'invalid'
        when e.outcome='declined' then 'nurture' else 'contacted' end into v_prior_status
        from public.lead_communications e where e.lead_id=v_lead.id and e.id<>p_event_id and (e.outcome<>'unreachable' or e.visit_committed is true)
        order by e.occurred_at desc,e.id desc limit 1;
      v_prior_status:=coalesce(v_prior_status,'uncontacted');
      v_expected_status:=case when v_before->>'outcome'='invalid_number' then 'invalid' when (v_before->>'visitCommitted')::boolean is true then 'intent_confirmed'
        when v_before->>'outcome'='declined' then 'nurture' when v_before->>'outcome'='unreachable' then v_prior_status else 'contacted' end;
      if v_lead.status<>v_expected_status then raise exception 'CORRECTION_REQUIRES_WORKFLOW' using detail='lead_current_status_is_owned_by_another_workflow'; end if;
      v_status:=case when v_after->>'outcome'='invalid_number' then 'invalid' when (v_after->>'visitCommitted')::boolean is true then 'intent_confirmed'
        when v_after->>'outcome'='declined' then 'nurture' when v_after->>'outcome'='unreachable' then v_prior_status else 'contacted' end;
      update public.leads set status=v_status where id=v_lead.id;
    end if;
  elsif p_source='post_activity' then
    v_semantic:=v_after->'outcome' is distinct from v_before->'outcome' or v_after->'route' is distinct from v_before->'route';
    v_latest:=not exists(select 1 from public.activity_followup_contacts e where e.registration_id=v_post.registration_id and (e.occurred_at,e.id)>(v_post.occurred_at,v_post.id));
    if v_semantic and v_latest and (v_route.id is null or v_route.course_enrollment_id is not null or v_route.route is distinct from v_before->>'route'
      or exists(select 1 from public.course_opportunities o where o.source_activity_route_id=v_route.id)) then
      raise exception 'CORRECTION_REQUIRES_WORKFLOW' using detail='activity_contact_has_later_followup_or_enrollment_route';
    end if;
    if v_semantic and v_latest then
      update public.activity_routes set route=v_after->>'route',note=v_after->>'note',routed_by=v_uid where id=v_route.id;
    elsif p_patch?'note' and v_latest and v_route.note=v_before->>'note' then
      update public.activity_routes set note=v_after->>'note',routed_by=v_uid where id=v_route.id;
    end if;
  elsif p_patch?'note' and v_thread.summary=v_before->>'note' and not exists(select 1 from public.lead_invitation_events e
    where e.invitation_id=v_thread.id and (e.occurred_at,e.id)>(v_invitation_event.occurred_at,v_invitation_event.id)) then
    update public.lead_invitation_threads set summary=v_after->>'note',updated_by=v_uid where id=v_thread.id;
  end if;
  insert into public.communication_record_revisions(source,event_id,revision_no,previous_revision_id,patch,effective_patch,recorded_by)
    values(p_source,p_event_id,coalesce(v_previous.revision_no,0)+1,v_previous.id,v_patch,v_effective,v_uid) returning id into v_id;
  return v_id;
end $$;

-- 定点替换历史数据源和当前事实顺序，保留原有身份、参与和报名判断。
do $$
declare v_definition text; v_source text; v_replacement text; v_index integer;
  v_sources text[]:=array['from public.activity_followup_contacts ct',
    'jsonb_agg(item order by item->>''occurredAt'' desc)',
    '''nextContactAt'',ct.next_contact_at,''occurredAt'',ct.occurred_at,',
    'order by ct.occurred_at desc,ct.id limit 30'];
  v_replacements text[]:=array['from public.effective_activity_followup_contacts ct',
    'jsonb_agg(item order by item->>''recordedAt'' desc,item->>''id'' desc)',
    '''nextContactAt'',ct.next_contact_at,''occurredAt'',ct.occurred_at,''recordedAt'',ct.original_occurred_at,',
    'order by ct.original_occurred_at desc,ct.id desc limit 30'];
begin
  v_definition:=pg_get_functiondef('public.get_activity_enrollment_context(uuid,uuid)'::regprocedure);
  for v_index in 1..array_length(v_sources,1) loop
    v_source:=v_sources[v_index]; v_replacement:=v_replacements[v_index];
    if (length(v_definition)-length(replace(v_definition,v_source,'')))/length(v_source)<>1 then
      raise exception 'COMMUNICATION_CONTEXT_DEFINITION_CHANGED' using detail=v_source;
    end if;
    v_definition:=replace(v_definition,v_source,v_replacement);
  end loop;
  execute v_definition;
end $$;

revoke all on function public.can_access_communication_row(text,boolean),public.create_communication_worklist(text,date,text[]),
  public.get_communication_worklist(uuid),public.get_communication_worklists(date),public.complete_communication_worklist_item(uuid,text,boolean),
  public.guard_communication_record_revision(),public.can_revise_communication_record(text,uuid),public.revise_communication_record(text,uuid,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.can_access_communication_row(text,boolean),public.create_communication_worklist(text,date,text[]),
  public.get_communication_worklist(uuid),public.get_communication_worklists(date),public.complete_communication_worklist_item(uuid,text,boolean),
  public.can_revise_communication_record(text,uuid),public.revise_communication_record(text,uuid,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
