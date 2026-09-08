-- 导入期次筛选的结果进入人工复核；每次决定均保留操作者与依据。
create table public.history_workflow_decisions (
  key text primary key,
  decision text not null check(decision in ('continue','archive')),
  note text not null check(length(btrim(note)) between 1 and 1000),
  actor_id uuid not null references public.profiles(id),
  decided_at timestamptz not null default clock_timestamp()
);
create table public.history_workflow_decision_events (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  decision text not null check(decision in ('continue','archive')),
  note text not null,
  actor_id uuid not null references public.profiles(id),
  decided_at timestamptz not null default clock_timestamp()
);
alter table public.history_workflow_decisions enable row level security;
alter table public.history_workflow_decision_events enable row level security;
revoke all on public.history_workflow_decisions,public.history_workflow_decision_events from public,anon,authenticated;

create function public.history_workflow_review_candidates()
returns table(key text,student_id uuid,lead_id uuid,record_id text,name text,reason text,latest_period text)
language sql stable security definer set search_path=public,pg_temp as $$
  select s.scope_key,s.student_id,s.lead_id,null::text,coalesce(st.name,l.provisional_student_name,''),s.reason,s.latest_period
    from public.history_workflow_scopes s left join public.students st on st.id=s.student_id left join public.leads l on l.id=s.lead_id
    where s.record_id is null and s.resumed_at is null and s.reason in ('history_review_required','processed_prior_period')
      and (st.id is null or st.deleted_at is null)
  union all
  select 'record:'||h.id,null::uuid,null::uuid,h.id,
    coalesce(nullif(array_to_string(array(select jsonb_array_elements_text(h.record_data->'names')),'、'),''),h.record_data->>'tableName',''),
    'history_review_required',s.latest_period
    from public.history_import_records h left join public.history_workflow_scopes s on s.record_id=h.id and s.resumed_at is null
    where h.source_data->>'format'='feishu-base' and (s.record_id is not null
      or exists(select 1 from public.history_business_workflow_scopes f where f.source_record_id=h.id));
$$;
revoke all on function public.history_workflow_review_candidates() from public,anon,authenticated,service_role;

create function public.list_history_workflow_review(p_search text default '',p_page integer default 1,p_status text default 'pending')
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); result jsonb;
begin
  if actor is null then raise exception 'UNAUTHENTICATED';end if;
  if not (public.is_staff(actor) and public.has_perm(actor,'student.view.all') and public.has_perm(actor,'followup.view')) then raise exception 'FORBIDDEN';end if;
  if p_status not in ('pending','continue','archive') or p_page<1 then raise exception 'VALIDATION';end if;
  with all_rows as materialized (
    select c.*,d.decision,d.decided_at,d.note from public.history_workflow_review_candidates() c left join public.history_workflow_decisions d on d.key=c.key
  ), filtered as materialized (
    select * from all_rows where coalesce(decision,'pending')=p_status
      and (coalesce(p_search,'')='' or position(lower(p_search) in lower(name))>0)
  ), page as (select * from filtered order by key limit 50 offset (least(p_page,100000)-1)*50)
  select jsonb_build_object('pendingCount',(select count(*) from all_rows where decision is null),
    'count',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(p)) from page p),'[]'::jsonb)) into result;
  return result;
end;
$$;
revoke all on function public.list_history_workflow_review(text,integer,text) from public,anon;
grant execute on function public.list_history_workflow_review(text,integer,text) to authenticated;

create function public.decide_history_workflow_review(p_key text,p_decision text,p_note text,p_expected_at timestamptz default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); previous_at timestamptz;
begin
  if actor is null then raise exception 'UNAUTHENTICATED';end if;
  if not (public.is_staff(actor) and public.has_perm(actor,'student.view.all') and public.has_perm(actor,'followup.view') and public.has_perm(actor,'student.edit')) then raise exception 'FORBIDDEN';end if;
  if p_decision not in ('continue','archive') or p_note is null or length(btrim(p_note)) not between 1 and 1000 then raise exception 'VALIDATION';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_key,63));
  if not exists(select 1 from public.history_workflow_review_candidates() c where c.key=p_key) then raise exception 'NOT_FOUND';end if;
  select decided_at into previous_at from public.history_workflow_decisions where key=p_key;
  if previous_at is distinct from p_expected_at then raise exception 'CONFLICT';end if;
  insert into public.history_workflow_decisions(key,decision,note,actor_id) values(p_key,p_decision,btrim(p_note),actor)
    on conflict(key) do update set decision=excluded.decision,note=excluded.note,actor_id=actor,decided_at=clock_timestamp();
  insert into public.history_workflow_decision_events(key,decision,note,actor_id) values(p_key,p_decision,btrim(p_note),actor);
end;
$$;
revoke all on function public.decide_history_workflow_review(text,text,text,timestamptz) from public,anon;
grant execute on function public.decide_history_workflow_review(text,text,text,timestamptz) to authenticated;

create or replace function public.business_source_is_current(p_record_id text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((select d.decision='continue' from public.history_workflow_decisions d where d.key='record:'||p_record_id),
    not exists(select 1 from public.history_workflow_scopes s where s.record_id=p_record_id and s.resumed_at is null));
$$;
create or replace function public.business_fact_is_current(p_relation text,p_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select not exists(select 1 from public.history_business_workflow_scopes s
    left join public.history_workflow_decisions d on d.key='record:'||s.source_record_id
    where s.relation=p_relation and s.record_id=p_id and coalesce(d.decision,'archive')<>'continue');
$$;
create or replace function public.business_subject_is_current(p_student_id uuid,p_lead_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select not exists(select 1 from public.history_workflow_scopes s
    left join public.history_workflow_decisions d on d.key=s.scope_key
    where (s.student_id=p_student_id or s.lead_id=p_lead_id)
      and (d.decision='archive' or s.resumed_at is null and coalesce(d.decision,'archive')<>'continue'));
$$;
