begin;

create function mathin_internal.experience_answers_valid(f jsonb,a jsonb) returns boolean
language plpgsql immutable set search_path=public,pg_temp as $$
declare g jsonb; q jsonb; row jsonb; answer jsonb; c jsonb; other jsonb; key text; v text; visible boolean; empty boolean;
begin
  if jsonb_typeof(a) is distinct from 'object' or octet_length(a::text)>24576 then return false; end if;
  for key in select jsonb_object_keys(a) loop
    if not exists(select 1 from jsonb_array_elements(f->'groups') e where e->>'id'=key) then return false; end if;
  end loop;
  for g in select value from jsonb_array_elements(f->'groups') loop
    if jsonb_typeof(a->(g->>'id')) is distinct from 'array' then return false; end if;
    if jsonb_array_length(a->(g->>'id'))<(g->>'minEntries')::int
      or jsonb_array_length(a->(g->>'id'))>(case when g->'repeat'='true' then (g->>'maxEntries')::int else 1 end) then return false; end if;
    for row in select value from jsonb_array_elements(a->(g->>'id')) loop
      if jsonb_typeof(row)<>'object' then return false; end if;
      for key in select jsonb_object_keys(row) loop
        if not exists(select 1 from jsonb_array_elements(g->'fields') e where e->>'id'=key) then return false; end if;
      end loop;
      for q in select value from jsonb_array_elements(g->'fields') loop
        c:=q->'visibleWhen'; answer:=row->(q->>'id'); v:=answer#>>'{}'; other:=row->(c->>'fieldId');
        visible:=c is null or case c->>'operator'
          when 'answered' then coalesce(other<>'[]' and other<>'""' and other<>'null',false)
          when 'equals' then other=to_jsonb(c->>'value')
          when 'notEquals' then other is distinct from to_jsonb(c->>'value')
          when 'includes' then jsonb_typeof(other)='array' and other ? (c->>'value') else false end;
        empty:=answer is null or answer='[]' or jsonb_typeof(answer)='string' and btrim(v)='';
        if not coalesce(visible,false) then if not empty then return false; end if; continue; end if;
        if empty then if q->'required'='true' then return false; end if; continue; end if;
        if q->>'type'='multiselect' then
          if jsonb_typeof(answer)<>'array' or jsonb_array_length(answer)>30
            or jsonb_array_length(answer)<>(select count(distinct e) from jsonb_array_elements(answer) e)
            or exists(select 1 from jsonb_array_elements(answer) e where jsonb_typeof(e)<>'string'
              or not exists(select 1 from jsonb_array_elements(q->'options') o where to_jsonb(o->>'id')=e)) then return false; end if;
          continue;
        end if;
        if jsonb_typeof(answer)<>'string' or char_length(v)>(case when q->>'type'='textarea' then 4000 else 500 end) then return false; end if;
        if q->>'type'='select' and not exists(select 1 from jsonb_array_elements(q->'options') e where e->>'id'=v)
          or q->>'type'='consent' and v<>'yes'
          or q->>'type'='phone' and v !~ '^\+?[0-9 ()-]{6,30}$'
          or q->>'type'='email' and v !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then return false; end if;
        if q->>'type'='date' and (v !~ '^\d{4}-\d{2}-\d{2}$' or to_char(v::date,'YYYY-MM-DD')<>v) then return false; end if;
        if q->>'type'='number' and (v !~ '^-?[0-9]+(\.[0-9]+)?$' or q ? 'min' and v::numeric<(q->>'min')::numeric or q ? 'max' and v::numeric>(q->>'max')::numeric) then return false; end if;
      end loop;
    end loop;
  end loop;
  return true;
exception when others then return false;
end $$;
create table public.miniapp_experience_requests (
  id uuid primary key, owner_id uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  service_id text not null, form_id text not null, publication_revision integer not null,
  participant_ids uuid[] not null default '{}', form_snapshot jsonb not null, answers jsonb not null,
  service_snapshot jsonb, flow_snapshot jsonb, policy_snapshot jsonb, confirmation_snapshot jsonb, consent_snapshot jsonb not null default '{}',
  request_hash text not null, status text not null default 'submitted' check(status in ('submitted','confirmed','completed','cancelled','declined')),
  version integer not null default 1, note text not null default '', updated_at timestamptz not null default now()
);
create index miniapp_experience_requests_owner on public.miniapp_experience_requests(owner_id,created_at desc);
create index miniapp_experience_requests_status on public.miniapp_experience_requests(status,created_at desc);
create table public.miniapp_experience_events (
  id uuid primary key default gen_random_uuid(), request_id uuid not null references public.miniapp_experience_requests(id),
  actor_id uuid not null references public.profiles(id), event text not null, created_at timestamptz not null default now(),
  payload jsonb not null default '{}'
);
create trigger miniapp_experience_events_immutable before update or delete on public.miniapp_experience_events for each row execute function public.reject_immutable_security_row();
alter table public.miniapp_experience_requests enable row level security;
alter table public.miniapp_experience_events enable row level security;
revoke all on public.miniapp_experience_requests,public.miniapp_experience_events from public,anon,authenticated;

create function mathin_internal.experience_request_json(r public.miniapp_experience_requests) returns jsonb
language sql stable set search_path=public,pg_temp as $$
  select jsonb_build_object('id',r.id,'serviceId',r.service_id,'serviceName',coalesce(r.service_snapshot->'name',r.form_snapshot->'title'),
    'formId',r.form_id,'createdAt',r.created_at,'status',r.status,'version',r.version,'note',r.note,'participantIds',to_jsonb(r.participant_ids),
    'form',r.form_snapshot,'answers',r.answers,'confirmation',r.confirmation_snapshot,
    'completionAction',coalesce(r.flow_snapshot->'completionAction','{"kind":"none","target":"","label":{"zh":"","en":""}}'));
$$;
create function public.miniapp_submit_experience_request(p_id uuid,p_service_id text,p_form_id text,p_revision integer,p_answers jsonb,p_participant_ids uuid[],p_consents jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare e jsonb; s jsonb; f jsonb; flow jsonb; policy jsonb; confirmation jsonb; consent jsonb:='{}'; doc jsonb; docid text;
  revision integer; r public.miniapp_experience_requests; h text;
begin
  if not coalesce(mathin_internal.experience_audience('signedIn'),false) then raise exception 'FORBIDDEN'; end if;
  if p_id is null or p_service_id is null or p_form_id is null or p_revision is null or p_answers is null or p_participant_ids is null
    or cardinality(p_participant_ids)>10 or jsonb_typeof(p_consents) is distinct from 'object' or octet_length(p_consents::text)>2048 then raise exception 'VALIDATION'; end if;
  h:=md5(jsonb_build_array(p_service_id,p_form_id,p_revision,p_answers,p_participant_ids,p_consents)::text);
  perform pg_advisory_xact_lock(hashtextextended('experience-request-owner:'||auth.uid()::text,914));
  select * into r from miniapp_experience_requests where id=p_id;
  if r.id is not null then
    if r.owner_id<>auth.uid() or r.request_hash<>h then raise exception 'CONFLICT'; end if;
    return mathin_internal.experience_request_json(r);
  end if;
  if (select count(*) from miniapp_experience_requests where owner_id=auth.uid() and created_at>now()-interval '1 minute')>=20 then raise exception 'RATE_LIMIT'; end if;
  select published->'experience',published_revision into e,revision from miniapp_settings where singleton for share;
  if p_revision is distinct from revision then raise exception 'FORM_CHANGED'; end if;
  if p_service_id<>'' then
    select v into s from jsonb_array_elements(e->'services') v where v->>'id'=p_service_id and v->'enabled'='true';
    if s is null or s#>>'{binding,adapter}'<>'request' then raise exception 'NOT_FOUND'; end if;
    select v into flow from jsonb_array_elements(e->'flows') v where v->>'id'=s->>'flowId';
    if flow is null or flow->>'mode'<>'request' or flow->>'formId'<>p_form_id then raise exception 'VALIDATION'; end if;
    select v into policy from jsonb_array_elements(e->'policies') v where v->>'id'=flow->>'policyId';
    select v into confirmation from jsonb_array_elements(e->'pages') v where v->>'id'=flow->>'confirmationPageId' and v->'enabled'='true';
    if flow->'requireParticipant'='true' and cardinality(p_participant_ids)=0 or flow->'allowMultipleParticipants'='false' and cardinality(p_participant_ids)>1 then raise exception 'VALIDATION'; end if;
    if policy is not null and (select count(*) from miniapp_experience_requests where owner_id=auth.uid() and service_id=p_service_id and status in ('submitted','confirmed'))>=(policy->>'maxActiveBookings')::int then raise exception 'BOOKING_CLOSED'; end if;
    for docid in select jsonb_array_elements_text(flow->'consentDocumentIds') loop
      doc:=public.miniapp_document(docid,null);
      if p_consents->>docid is distinct from doc->>'version' then raise exception 'FORM_CHANGED'; end if;
      consent:=consent||jsonb_build_object(docid,doc);
    end loop;
  elsif p_consents<>'{}' or cardinality(p_participant_ids)>0 then raise exception 'VALIDATION'; end if;
  if cardinality(p_participant_ids)<>(select count(distinct id) from unnest(p_participant_ids) id)
    or exists(select 1 from unnest(p_participant_ids) id where not coalesce(public.miniapp_can_participate(id),false)) then raise exception 'FORBIDDEN'; end if;
  select v into f from jsonb_array_elements(e->'forms') v where v->>'id'=p_form_id and v->'enabled'='true';
  if f is null then raise exception 'NOT_FOUND'; end if;
  if not coalesce(mathin_internal.experience_audience(f->>'audience'),false) then raise exception 'FORBIDDEN'; end if;
  if not mathin_internal.experience_answers_valid(f,p_answers) then raise exception 'VALIDATION'; end if;
  insert into miniapp_experience_requests(id,owner_id,service_id,form_id,publication_revision,participant_ids,form_snapshot,answers,service_snapshot,flow_snapshot,policy_snapshot,confirmation_snapshot,consent_snapshot,request_hash)
    values(p_id,auth.uid(),p_service_id,p_form_id,p_revision,p_participant_ids,f,p_answers,s,flow,policy,confirmation,consent,h) returning * into r;
  insert into miniapp_experience_events(request_id,actor_id,event) values(p_id,auth.uid(),case when p_service_id='' then 'form.submitted' else 'request.created' end);
  return mathin_internal.experience_request_json(r);
end $$;
create function public.miniapp_experience_requests(p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not coalesce(mathin_internal.experience_audience('signedIn'),false) then raise exception 'FORBIDDEN'; end if;
  if p_page is null or p_page not between 1 and 1000 then raise exception 'VALIDATION'; end if;
  return coalesce((select jsonb_agg(mathin_internal.experience_request_json(r)) from
    (select * from miniapp_experience_requests where owner_id=auth.uid() order by created_at desc limit 30 offset (p_page-1)*30) r),'[]');
end $$;
create function public.miniapp_experience_request_workbench(p_page integer default 1,p_status text default '') returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  if p_page is null or p_page not between 1 and 1000 or p_status is null or p_status not in ('','submitted','confirmed','completed','cancelled','declined') then raise exception 'VALIDATION'; end if;
  return coalesce((select jsonb_agg(mathin_internal.experience_request_json(r)) from
    (select * from miniapp_experience_requests where p_status='' or status=p_status order by created_at desc limit 30 offset (p_page-1)*30) r),'[]');
end $$;
create function public.miniapp_update_experience_request(p_id uuid,p_version integer,p_status text,p_note text default '') returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.miniapp_experience_requests; staff boolean;
begin
  staff:=coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false);
  if not staff and not coalesce(mathin_internal.experience_audience('signedIn'),false) then raise exception 'FORBIDDEN'; end if;
  select * into r from miniapp_experience_requests where id=p_id for update;
  if r.id is null or not staff and r.owner_id<>auth.uid() then raise exception 'NOT_FOUND'; end if;
  if r.version is distinct from p_version then raise exception 'FORM_CHANGED'; end if;
  if p_status is null or p_status not in ('confirmed','completed','cancelled','declined') or p_note is null or char_length(p_note)>2000 then raise exception 'VALIDATION'; end if;
  if not staff and (p_status<>'cancelled' or coalesce(r.policy_snapshot->>'cancellation','self')<>'self') then raise exception 'FORBIDDEN'; end if;
  if r.status not in ('submitted','confirmed') or r.status='submitted' and p_status='completed' then raise exception 'CONFLICT'; end if;
  update miniapp_experience_requests set status=p_status,version=version+1,note=case when staff then p_note else note end,updated_at=now() where id=p_id returning * into r;
  insert into miniapp_experience_events(request_id,actor_id,event,payload) values(p_id,auth.uid(),'request.'||p_status,jsonb_build_object('version',r.version));
  return mathin_internal.experience_request_json(r);
end $$;
revoke all on function mathin_internal.experience_answers_valid(jsonb,jsonb),mathin_internal.experience_request_json(public.miniapp_experience_requests),
  public.miniapp_submit_experience_request(uuid,text,text,integer,jsonb,uuid[],jsonb),public.miniapp_experience_requests(integer),
  public.miniapp_experience_request_workbench(integer,text),public.miniapp_update_experience_request(uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.miniapp_submit_experience_request(uuid,text,text,integer,jsonb,uuid[],jsonb),public.miniapp_experience_requests(integer),
  public.miniapp_experience_request_workbench(integer,text),public.miniapp_update_experience_request(uuid,integer,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
