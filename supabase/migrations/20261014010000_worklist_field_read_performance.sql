-- Header facets read every visible subject. A poorly estimated LEFT JOIN to
-- ranked re-ran both windows for every subject. Aggregate the latest summaries
-- once, then look them up by key without repeatedly scanning the ranked rows.
create or replace function public.school_record_communication_summaries(p_subjects jsonb)
returns table(key text,summary jsonb)
language plpgsql stable security definer set search_path=public,pg_temp
set plan_cache_mode=force_custom_plan as $$
declare actor uuid:=auth.uid(); view_all boolean;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not public.has_perm(actor,'followup.view') then return; end if;
  view_all:=public.has_perm(actor,'student.view.all');
  return query
  with subjects as materialized (
    select s.key,coalesce(s.student_id,l.student_id) as student_id,s.lead_id
    from jsonb_to_recordset(p_subjects) s(key text,student_id uuid,lead_id uuid)
    left join public.leads l on l.id=s.lead_id
    where (s.student_id is not null or s.lead_id is not null)
      and (s.student_id is null or s.lead_id is null or s.student_id=l.student_id)
  ), authorized as materialized (
    select s.* from subjects s
    where (s.student_id is null or view_all or public.can_view_school_student(s.student_id,actor))
      and (s.lead_id is null or view_all or public.can_view_school_lead(s.lead_id,actor))
  ), lead_refs as materialized (
    select distinct s.key,l.id from authorized s join public.leads l on l.id=s.lead_id or l.student_id=s.student_id
    where view_all or public.can_view_school_lead(l.id,actor)
  ), contacts as materialized (
    select ref.key,c.id,
      coalesce(r.effective_patch->>'note',c.source_metric_facts->>'communicationNote',c.note,'') as note,
      coalesce(r.effective_patch->>'outcome',c.outcome) as outcome,
      coalesce(r.effective_patch->>'occurredAt',c.occurred_at::text,c.occurred_on::text) as occurred_at,
      c.source_metric_facts->>'communicationDate' as source_date_label,
      coalesce(p.display_name,nullif(c.source_metric_facts->'staff'->>'contacts',''),'') as actor_name,
      public.school_contact_sort_key(coalesce((r.effective_patch->>'occurredAt')::timestamptz,c.occurred_at),c.occurred_on,c.source_metric_facts,c.source_key) as sort_key,
      public.school_contact_is_effective(to_jsonb(c),r.effective_patch) as effective_contact
    from lead_refs ref join public.business_lead_communications c on c.lead_id=ref.id
    left join lateral (select cr.effective_patch from public.communication_record_revisions cr
      where cr.source='contact' and cr.event_id=c.id order by cr.revision_no desc limit 1) r on true
    left join public.profiles p on p.id=c.recorded_by
    where c.source_metric_facts->'contactAttempt' is distinct from 'false'::jsonb or r.effective_patch is not null
  ), ranked as (
    select c.*,row_number() over(partition by c.key order by c.sort_key desc,c.id desc) as rank,
      count(*) over(partition by c.key) as total,
      count(*) filter(where c.effective_contact) over(partition by c.key) as effective_total from contacts c
  ), summaries as materialized (
    select jsonb_object_agg(r.key,jsonb_build_object(
      'count',r.total,'effectiveCount',r.effective_total,
      'latestNote',coalesce(r.note,''),'latestOutcome',r.outcome,'latestAt',r.occurred_at,
      'latestDateLabel',r.source_date_label,'latestActor',coalesce(r.actor_name,''))) as items
    from ranked r where r.rank=1 and r.key is not null
  ) select s.key,coalesce(m.items->s.key,jsonb_build_object(
      'count',0,'effectiveCount',0,'latestNote','','latestOutcome',null,'latestAt',null,
      'latestDateLabel',null,'latestActor',''))
    from authorized s cross join summaries m;
end;
$$;
revoke all on function public.school_record_communication_summaries(jsonb) from public,anon,authenticated,service_role;
alter function public.school_record_communication_summaries(jsonb) owner to postgres;
