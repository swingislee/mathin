-- Reuse the existing all-students permission and plan each small authorized lead set.
create or replace function public.school_record_contact_events(p_student_id uuid,p_lead_id uuid)
returns table(id uuid,lead_id uuid,channel text,outcome text,note text,wechat_added boolean,
  visit_committed boolean,interest_level text,recorded_by uuid,recorded_by_name text,
  occurred_at timestamptz,occurred_on date,source_date_label text,sort_key text,effective_contact boolean)
language plpgsql stable security definer set search_path=public,pg_temp
set plan_cache_mode=force_custom_plan as $$
declare actor uuid:=auth.uid(); v_student_id uuid:=p_student_id; visible_lead_ids uuid[]; view_all boolean;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not public.has_perm(actor,'followup.view') then return; end if;
  view_all:=public.has_perm(actor,'student.view.all');
  if p_lead_id is not null then
    if not view_all and not public.can_view_school_lead(p_lead_id,actor) then raise exception 'FORBIDDEN_SCOPE'; end if;
    select coalesce(v_student_id,l.student_id) into v_student_id from public.leads l where l.id=p_lead_id;
    if p_student_id is not null and exists(select 1 from public.leads l where l.id=p_lead_id and l.student_id is distinct from p_student_id) then raise exception 'SUBJECT_MISMATCH'; end if;
  end if;
  if v_student_id is not null and not view_all and not public.can_view_school_student(v_student_id,actor) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if v_student_id is null and p_lead_id is null then raise exception 'NOT_FOUND'; end if;
  select coalesce(array_agg(l.id),'{}'::uuid[]) into visible_lead_ids from public.leads l
    where (l.id=p_lead_id or l.student_id=v_student_id) and (view_all or public.can_view_school_lead(l.id,actor));
  if cardinality(visible_lead_ids)=0 then return; end if;
  return query
    select c.id,c.lead_id,coalesce(r.effective_patch->>'channel',c.channel),coalesce(r.effective_patch->>'outcome',c.outcome),
      coalesce(r.effective_patch->>'note',c.source_metric_facts->>'communicationNote',c.note,''),
      case when r.effective_patch?'wechatAdded' then (r.effective_patch->>'wechatAdded')::boolean else c.wechat_added end,
      case when r.effective_patch?'visitCommitted' then (r.effective_patch->>'visitCommitted')::boolean else c.visit_committed end,
      case when r.effective_patch?'interestLevel' then r.effective_patch->>'interestLevel' else c.interest_level end,
      c.recorded_by,coalesce(p.display_name,nullif(c.source_metric_facts->'staff'->>'contacts',''),''),
      coalesce((r.effective_patch->>'occurredAt')::timestamptz,c.occurred_at),c.occurred_on,
      c.source_metric_facts->>'communicationDate',
      public.school_contact_sort_key(coalesce((r.effective_patch->>'occurredAt')::timestamptz,c.occurred_at),c.occurred_on,c.source_metric_facts,c.source_key),
      public.school_contact_is_effective(to_jsonb(c),r.effective_patch)
    from public.business_lead_communications c left join lateral (
      select cr.effective_patch from public.communication_record_revisions cr
        where cr.source='contact' and cr.event_id=c.id order by cr.revision_no desc limit 1
    ) r on true left join public.profiles p on p.id=c.recorded_by
    where c.lead_id=any(visible_lead_ids)
      and (c.source_metric_facts->'contactAttempt' is distinct from 'false'::jsonb or r.effective_patch is not null);
end;
$$;
