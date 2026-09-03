-- SCHOOL-OPS-LEADS-3: 负责人归属与联系阶段正交化，并明确来源质量事实。
--
-- `owner_id is null` 已足以表达待分配；status 只表达电话确认进度。
-- 小地推的提交时间、定位和推广员继续保存在不可变来源记录中，不把
-- Mathin 导入时间伪装成获客时间，也不自动臆断某个地点是否异常。

update public.leads
   set status = 'uncontacted'
 where status = 'unassigned';

create or replace function public.normalize_legacy_lead_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'unassigned' then
    new.status := 'uncontacted';
  end if;
  return new;
end
$$;

drop trigger if exists leads_normalize_legacy_status on public.leads;
create trigger leads_normalize_legacy_status
  before insert or update of status on public.leads
  for each row execute function public.normalize_legacy_lead_status();

alter table public.leads alter column status set default 'uncontacted';
alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads add constraint leads_status_check
  check (status in ('uncontacted','contacted','nurture','intent_confirmed','invalid','converted'));

comment on column public.leads.owner_id is
  'Operational assignment. NULL means waiting for assignment; it is independent from contact progress.';
comment on column public.leads.status is
  'Contact or identity progress only. Assignment is represented by owner_id, never by a status value.';
comment on column public.lead_source_records.submitted_at is
  'Acquisition time reported by the source system. NULL remains unknown and is never replaced by import time.';
comment on column public.lead_source_records.location_text is
  'Raw acquisition location reported by the source system for source-quality review.';
comment on column public.lead_source_records.promoter is
  'Raw promoter attribution reported by the source system for source-quality review.';

create or replace function public.assign_leads(
  p_lead_ids uuid[],
  p_staff_user_id uuid
) returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_count integer;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid, 'student.assign') then raise exception 'FORBIDDEN'; end if;
  if p_lead_ids is null or cardinality(p_lead_ids) not between 1 and 100
     or array_position(p_lead_ids, null) is not null then
    raise exception 'INVALID_INPUT';
  end if;

  select array_agg(distinct item order by item) into v_ids from unnest(p_lead_ids) item;
  if cardinality(v_ids) <> cardinality(p_lead_ids) then raise exception 'INVALID_INPUT'; end if;
  if not public.is_staff(p_staff_user_id)
     or not public.has_perm(p_staff_user_id, 'followup.write') then
    raise exception 'TARGET_CANNOT_FOLLOW_UP';
  end if;

  perform 1
    from public.leads lead
   where lead.id = any(v_ids)
     and lead.student_id is null
     and lead.status not in ('invalid','converted')
     and (
       lead.owner_id is null
       or lead.owner_id = v_uid
       or public.has_perm(v_uid, 'student.view.all')
     )
   for update;

  select count(*) into v_count
    from public.leads lead
   where lead.id = any(v_ids)
     and lead.student_id is null
     and lead.status not in ('invalid','converted')
     and (
       lead.owner_id is null
       or lead.owner_id = v_uid
       or public.has_perm(v_uid, 'student.view.all')
     );
  if v_count <> cardinality(v_ids) then raise exception 'LEAD_SCOPE_MISMATCH'; end if;

  update public.leads
     set owner_id = p_staff_user_id
   where id = any(v_ids);

  insert into public.lead_next_actions(lead_id, kind, due_at, created_by)
  select lead_id, 'initial_contact', now(), v_uid from unnest(v_ids) lead_id
  on conflict (lead_id) where status = 'open' do nothing;

  perform public.emit_domain_event(
    'lead.assignment.batch', 'lead', v_ids[1],
    jsonb_build_object('leadIds', to_jsonb(v_ids), 'ownerId', p_staff_user_id, 'count', v_count),
    v_uid, null
  );
  return v_count;
end
$$;

revoke all on function public.normalize_legacy_lead_status() from public, anon, authenticated;
