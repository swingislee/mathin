-- 复用沟通工作单承接明确安排；已有未安排日期的名单快照保留原行为。
alter table public.communication_worklists add column is_scheduled boolean not null default false;

create function public.student_subject_has_scheduled_work(p_student_id uuid,p_lead_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.communication_worklists w join public.communication_worklist_items i on i.worklist_id=w.id
    join public.leads l on i.row_key='lead:'||l.id where w.is_scheduled and w.closed_at is null and i.completed_at is null
      and (l.id=p_lead_id or p_student_id is not null and l.student_id=p_student_id));
$$;
revoke all on function public.student_subject_has_scheduled_work(uuid,uuid) from public,anon,authenticated,service_role;

create function public.student_recontact_candidates(p_scope text,p_search text,p_facts public.business_course_enrollment_subjects[])
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.is_staff(auth.uid()) or not public.has_perm(auth.uid(),'followup.view') then raise exception 'FORBIDDEN'; end if;
  with subjects as materialized (select * from public.student_record_index_with_enrollments(p_scope,p_search,p_facts)),
  contacts as materialized (
    select l.id as lead_id,l.student_id,l.phone_normalized,c.id,
      coalesce(r.effective_patch->>'outcome',c.outcome) as outcome,
      coalesce(r.effective_patch->>'note',c.note) as note,
      case when r.effective_patch ? 'occurredAt' then (r.effective_patch->>'occurredAt')::timestamptz
        when c.source_record_id is null then c.occurred_at
        else c.occurred_on::timestamp at time zone public.get_organization_timezone_v2() end as occurred_at,
      c.occurred_at as order_at
    from public.business_lead_communications c join public.leads l on l.id=c.lead_id
      left join lateral (select effective_patch from public.communication_record_revisions r
        where r.source='contact' and r.event_id=c.id order by revision_no desc limit 1) r on true
  ), latest as (
    select distinct on(s.key) s.key,c.outcome,c.note,c.occurred_at from subjects s join contacts c
      on c.lead_id=s.lead_id or s.student_id is not null and c.student_id=s.student_id
      where c.outcome is not null order by s.key,c.occurred_at desc nulls last,c.order_at desc nulls last,c.id
  ), available as (
    select s.*,l.phone,l.phone_normalized,c.occurred_at as last_contact_at,
      case when c.outcome='unreachable' then 'unreachable' when s.stage='awaiting_enrollment' then 'assessed'
        when s.stage='former_student' then 'former' else 'dormant' end as reason
    from subjects s join public.leads l on l.id=s.lead_id left join latest c on c.key=s.key
    where l.phone_normalized ~ '^[1-9][0-9]{5,19}$' and l.status not in ('invalid','converted')
      and s.stage<>'awaiting_renewal' and c.outcome is distinct from 'invalid_number'
      and not public.business_subject_is_current(s.student_id,s.lead_id)
      and not exists(select 1 from contacts c2 where c2.phone_normalized=l.phone_normalized
        and (c2.occurred_at>=now()-interval '7 days' or c2.note ~* '(不要再联系|不要再打|别再打|不再联系|拒绝联系|do not contact|do not call|stop calling)'))
      and not exists(select 1 from public.leads related join public.lead_next_actions a on a.lead_id=related.id
        where (related.phone_normalized=l.phone_normalized or s.student_id is not null and related.student_id=s.student_id)
          and a.status='open' and a.kind<>'initial_contact')
      and not exists(select 1 from public.leads related join public.lead_invitation_threads i on i.lead_id=related.id
        where (related.phone_normalized=l.phone_normalized or s.student_id is not null and related.student_id=s.student_id)
          and i.state not in ('completed','cancelled'))
      and not exists(select 1 from public.communication_worklists w join public.communication_worklist_items i on i.worklist_id=w.id
        join public.leads related on i.row_key='lead:'||related.id where w.closed_at is null and i.completed_at is null
          and (related.phone_normalized=l.phone_normalized or s.student_id is not null and related.student_id=s.student_id))
  ), ranked as (
    select a.*,count(*) over(partition by phone_normalized) as shared_phone_count,
      row_number() over(partition by phone_normalized order by case reason when 'unreachable' then 1 when 'assessed' then 2 when 'former' then 3 else 4 end,
        last_contact_at desc nulls last,key) as contact_order from available a
  ) select coalesce(jsonb_agg(to_jsonb(r)-'contact_order' order by last_contact_at desc nulls last,key),'[]'::jsonb)
    into result from ranked r where contact_order=1;
  return result;
end;
$$;
revoke all on function public.student_recontact_candidates(text,text,public.business_course_enrollment_subjects[]) from public,anon,authenticated,service_role;

create function public.list_student_recontact_summaries(p_scope text,p_search text,p_reason text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare facts public.business_course_enrollment_subjects[]; candidates jsonb; selected jsonb; rows jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(auth.uid()) or not public.has_perm(auth.uid(),'followup.view') then raise exception 'FORBIDDEN'; end if;
  if p_scope is null or p_scope not in ('mine','all','unassigned') or length(coalesce(p_search,''))>80
    or p_reason is null or p_reason not in ('unreachable','assessed','former','dormant') then raise exception 'VALIDATION'; end if;
  select coalesce(array_agg(e),'{}'::public.business_course_enrollment_subjects[]) into facts from public.business_course_enrollment_subjects e;
  candidates:=public.student_recontact_candidates(p_scope,p_search,facts);
  select coalesce(jsonb_agg(c),'[]'::jsonb) into selected from jsonb_array_elements(candidates) c where c->>'reason'=p_reason;
  rows:=public.student_record_list_rows(selected,facts);
  select coalesce(jsonb_agg(r||jsonb_build_object('phone',c->>'phone','recontactReason',c->>'reason','lastContactAt',c->'last_contact_at',
      'sharedPhoneCount',c->'shared_phone_count') order by c->>'last_contact_at' desc nulls last,c->>'key'),'[]'::jsonb)
    into rows from jsonb_array_elements(rows) r join jsonb_array_elements(selected) c on c->>'key'=r->>'key';
  return jsonb_build_object('rows',rows,'counts','{}'::jsonb,'reasonCounts',coalesce((select jsonb_object_agg(reason,n)
    from (select c->>'reason' as reason,count(*) as n from jsonb_array_elements(candidates) c group by 1) counts),'{}'::jsonb));
end;
$$;
revoke all on function public.list_student_recontact_summaries(text,text,text) from public,anon,authenticated;
grant execute on function public.list_student_recontact_summaries(text,text,text) to authenticated;

create function public.plan_student_recontact_worklist(p_id uuid,p_name text,p_work_date date,p_owner_id uuid,p_subjects jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); existing public.communication_worklists%rowtype; item jsonb; snapshot jsonb;
  facts public.business_course_enrollment_subjects[]; candidates jsonb; keys text[]; previous_keys text[]; phone text; needs_assignment boolean:=false;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not public.has_perm(actor,'followup.write') or not public.has_perm(actor,'followup.view') then raise exception 'FORBIDDEN'; end if;
  if p_id is null or p_name is null or length(btrim(p_name)) not between 1 and 100 or p_work_date is null or not isfinite(p_work_date)
    or p_work_date<(now() at time zone public.get_organization_timezone_v2())::date or p_owner_id is null
    or jsonb_typeof(p_subjects) is distinct from 'array' or jsonb_array_length(p_subjects) not between 1 and 100 then raise exception 'VALIDATION'; end if;
  if p_owner_id<>actor and not (public.has_perm(actor,'student.assign') and public.has_perm(actor,'student.view.all')) then raise exception 'FORBIDDEN'; end if;
  if not public.is_staff(p_owner_id) or not public.has_perm(p_owner_id,'followup.write')
    or not exists(select 1 from public.profiles where id=p_owner_id and is_active) then raise exception 'TARGET_CANNOT_FOLLOW_UP'; end if;
  select array_agg('lead:'||(value->>'leadId')::uuid::text order by ordinal) into keys from jsonb_array_elements(p_subjects) with ordinality x(value,ordinal);
  if array_position(keys,null) is not null or cardinality(keys)<>(select count(distinct k) from unnest(keys) k) then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('recontact-worklist:'||p_id,0));
  select * into existing from public.communication_worklists where id=p_id;
  if found then
    select array_agg(row_key order by position) into previous_keys from public.communication_worklist_items where worklist_id=p_id;
    if existing.created_by<>actor or not existing.is_scheduled or existing.name<>btrim(p_name) or existing.work_date<>p_work_date
      or existing.owner_id<>p_owner_id or previous_keys is distinct from keys then raise exception 'REQUEST_CONFLICT'; end if;
    perform public.get_communication_worklist(p_id); return p_id;
  end if;
  perform 1 from public.leads where id=any(array(select (value->>'leadId')::uuid from jsonb_array_elements(p_subjects))) order by id for update;
  for phone in select distinct l.phone_normalized from public.leads l where 'lead:'||l.id=any(keys) order by l.phone_normalized loop
    perform pg_advisory_xact_lock(hashtextextended('recontact-phone:'||phone,0));
  end loop;
  select coalesce(array_agg(e),'{}'::public.business_course_enrollment_subjects[]) into facts from public.business_course_enrollment_subjects e;
  candidates:=public.student_recontact_candidates('all','',facts);
  for item in select value from jsonb_array_elements(p_subjects) loop
    if not item ? 'expectedOwnerId' then raise exception 'VALIDATION'; end if;
    snapshot:=public.read_student_record_with_enrollments((item->>'studentId')::uuid,(item->>'leadId')::uuid,facts);
    if snapshot->>'studentId' is distinct from item->>'studentId' or snapshot->>'ownerId' is distinct from item->>'expectedOwnerId' then raise exception 'ASSIGNMENT_CONFLICT'; end if;
    if not exists(select 1 from jsonb_array_elements(candidates) c where c->>'key'=snapshot->>'key' and c->>'lead_id'=item->>'leadId') then raise exception 'RECONTACT_CHANGED'; end if;
    if (snapshot->>'ownerId')::uuid is distinct from p_owner_id or exists(select 1 from public.leads where id=(item->>'leadId')::uuid and owner_id is distinct from p_owner_id) then needs_assignment:=true; end if;
  end loop;
  if needs_assignment then perform public.assign_student_stage_subjects(p_subjects,p_owner_id); end if;
  insert into public.communication_worklists(id,name,work_date,owner_id,created_by,is_scheduled) values(p_id,btrim(p_name),p_work_date,p_owner_id,actor,true);
  insert into public.communication_worklist_items(worklist_id,row_key,position) select p_id,k,n::integer from unnest(keys) with ordinality x(k,n);
  return p_id;
end;
$$;
revoke all on function public.plan_student_recontact_worklist(uuid,text,date,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.plan_student_recontact_worklist(uuid,text,date,uuid,jsonb) to authenticated;

create function public.get_scheduled_communication_tasks(p_date date)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); from_at timestamptz; until_at timestamptz;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not public.has_perm(actor,'followup.view') then raise exception 'FORBIDDEN'; end if;
  if p_date is null or not isfinite(p_date) then raise exception 'VALIDATION'; end if;
  from_at:=p_date::timestamp at time zone public.get_organization_timezone_v2();
  until_at:=(p_date+1)::timestamp at time zone public.get_organization_timezone_v2();
  return coalesce((select jsonb_agg(jsonb_build_object('key',i.row_key,'dueAt',w.work_date::timestamp at time zone public.get_organization_timezone_v2(),
      'createdAt',w.created_at,'completedAt',i.completed_at,'kind','scheduled_worklist','ownerId',w.owner_id) order by w.work_date,i.position)
    from public.communication_worklists w join public.communication_worklist_items i on i.worklist_id=w.id
    where w.is_scheduled and w.work_date<=p_date and w.created_at<until_at and (w.closed_at is null or w.closed_at>=from_at)
      and (i.completed_at is null or i.completed_at>=from_at) and (w.owner_id=actor or public.has_perm(actor,'student.view.all'))
      and public.can_access_communication_row(i.row_key,false)),'[]'::jsonb);
end;
$$;
revoke all on function public.get_scheduled_communication_tasks(date) from public,anon,authenticated;
grant execute on function public.get_scheduled_communication_tasks(date) to authenticated;

-- 本轮范围由接续基线和明确工作安排共同组成；全部档案仍使用同一身份读取。
do $projection$
declare signature text; definition text;
begin
  foreach signature in array array['public.list_student_record_summaries(text,text,text,text)',
    'public.list_student_record_workspace(text,text,text,integer,integer,text,text)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if position('or public.business_subject_is_current(s.student_id,s.lead_id)' in definition)=0 then raise exception 'WORK_SCOPE_CONTRACT_CHANGED'; end if;
    execute replace(definition,'or public.business_subject_is_current(s.student_id,s.lead_id)',
      'or public.business_subject_is_current(s.student_id,s.lead_id) or public.student_subject_has_scheduled_work(s.student_id,s.lead_id)');
  end loop;
end;
$projection$;
notify pgrst,'reload schema';
