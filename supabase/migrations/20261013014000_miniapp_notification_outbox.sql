begin;
create table public.miniapp_notification_outbox (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id), source_key text not null, source_id uuid not null,
  rule_id text not null, event text not null, service_id text not null, connection_id text not null, channel text not null,
  template_key text not null, title jsonb not null, body jsonb not null, data jsonb not null,
  due_at timestamptz not null, created_at timestamptz not null default now(), attempts integer not null default 0,
  status text not null check(status in ('queued','dispatching','sent','failed','cancelled')), lease_until timestamptz, last_error text,
  unique(source_key,rule_id)
);
create index miniapp_notification_due on public.miniapp_notification_outbox(status,due_at);
create index miniapp_notification_owner on public.miniapp_notification_outbox(owner_id,created_at desc);
alter table public.miniapp_notification_outbox enable row level security;
revoke all on public.miniapp_notification_outbox from public,anon,authenticated;
create function mathin_internal.queue_miniapp_event(p_owner uuid,p_event text,p_service_id text,p_source_id uuid,p_source_key text,p_time timestamptz,p_status text,p_name jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare rule jsonb; c jsonb; title jsonb; body jsonb; locale text; vars jsonb;
begin
  select published->'experience' into c from miniapp_settings where singleton;
  for rule in select v from jsonb_array_elements(c->'notifications') v where v->'enabled'='true' and v->>'event'=p_event
    and (v->'serviceIds'='[]' or v->'serviceIds' ? p_service_id) loop
    title:='{}'; body:='{}';
    foreach locale in array array['zh','en'] loop
      title:=title||jsonb_build_object(locale,replace(replace(replace(coalesce(rule->'title'->>locale,''),'{{service}}',coalesce(p_name->>locale,p_name->>'zh','')),'{{time}}',coalesce(p_time::text,'')),'{{status}}',p_status));
      body:=body||jsonb_build_object(locale,replace(replace(replace(coalesce(rule->'body'->>locale,''),'{{service}}',coalesce(p_name->>locale,p_name->>'zh','')),'{{time}}',coalesce(p_time::text,'')),'{{status}}',p_status));
    end loop;
    vars:=jsonb_build_object('service',p_name,'time',p_time,'status',p_status);
    insert into miniapp_notification_outbox(owner_id,source_key,source_id,rule_id,event,service_id,connection_id,channel,template_key,title,body,data,due_at,status)
      values(p_owner,p_source_key,p_source_id,rule->>'id',p_event,p_service_id,rule->>'connectionId',rule->>'channel',rule->>'templateKey',title,body,vars,
        coalesce(case when p_event='booking.reminder' then p_time else now() end,now())+make_interval(mins=>(rule->>'offsetMinutes')::int),
        case when rule->>'channel'='inApp' then 'sent' else 'queued' end) on conflict(source_key,rule_id) do update
          set status=excluded.status,due_at=excluded.due_at,title=excluded.title,body=excluded.body,data=excluded.data,attempts=0,lease_until=null,last_error=null
          where miniapp_notification_outbox.event='booking.reminder' and miniapp_notification_outbox.status='cancelled';
  end loop;
end $$;
create function public.queue_miniapp_experience_notifications() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare kind text; title jsonb; starts timestamptz;
begin
  if tg_table_name='miniapp_experience_requests' then
    kind:=case when tg_op='INSERT' then case when new.service_id='' then 'form.submitted' else 'request.created' end
      when new.status='confirmed' then 'booking.confirmed' when new.status='cancelled' then 'booking.cancelled' when new.status='completed' then 'booking.completed' else null end;
    if tg_op='UPDATE' and old.status=new.status then return new; end if;
    if kind is not null then perform mathin_internal.queue_miniapp_event(new.owner_id,kind,new.service_id,new.id,new.id::text||':'||new.version::text,null,new.status,coalesce(new.service_snapshot->'name',new.form_snapshot->'title')); end if;
  else
    if new.result is null then return new; end if;
    title:=new.snapshot#>'{service,name}'; starts:=(new.result->>'startsAt')::timestamptz;
    kind:=case when old.result is null then 'booking.created'
      when new.result->>'status'='cancelled' and old.result->>'status'<>'cancelled' then 'booking.cancelled'
      when new.result->>'status'='completed' and old.result->>'status'<>'completed' then 'booking.completed'
      when new.result->>'status'='noShow' and old.result->>'status'<>'noShow' then 'booking.noShow'
      when new.result->>'status'='confirmed' and old.result->>'status'<>'confirmed' then 'booking.confirmed'
      when old.result->>'startsAt' is distinct from new.result->>'startsAt' then 'booking.rescheduled' else null end;
    if kind is not null then
      perform mathin_internal.queue_miniapp_event(new.owner_id,kind,new.service_id,new.id,new.id::text||':'||md5(new.result::text),starts,new.result->>'status',title);
      update miniapp_notification_outbox set status='cancelled' where source_id=new.id and event='booking.reminder'
        and (status in ('queued','dispatching') or status='sent' and due_at>now());
      if new.result->>'status'='confirmed' and starts>now() then
        perform mathin_internal.queue_miniapp_event(new.owner_id,'booking.reminder',new.service_id,new.id,new.id::text||':reminder:'||starts::text,starts,'confirmed',title);
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger miniapp_request_notifications after insert or update of status on public.miniapp_experience_requests for each row execute function public.queue_miniapp_experience_notifications();
create trigger miniapp_remote_notifications after update of result on public.miniapp_remote_bookings for each row execute function public.queue_miniapp_experience_notifications();
create function mathin_internal.miniapp_notification_recipient(p_owner uuid,p_student uuid default null) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from profiles p where p.id=p_owner and p.is_active and p.account_status='active' and not p.password_change_required
    and public.has_current_required_consents(p.id)) and (p_student is null or exists(select 1 from students s where s.id=p_student and s.deleted_at is null
      and (s.user_id=p_owner or public.guardian_can(s.id,p_owner,'grades'))));
$$;
create function public.queue_miniapp_report_notifications() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare student uuid; version_id uuid; recipient uuid; title jsonb;
begin
  if tg_table_name='assessment_workflow_states' then
    if new.sent_at is null or new.sent_report_id is null then return new; end if;
    if tg_op='UPDATE' and old.sent_report_id is not distinct from new.sent_report_id and old.sent_at is not null then return new; end if;
    select r.student_id into student from activity_registrations r join assessment_reports p on p.registration_id=r.id where r.id=new.registration_id and p.id=new.sent_report_id;
    version_id:=new.sent_report_id; title:='{"zh":"学习诊断报告","en":"Assessment report"}';
  else
    if new.kind<>'session_review' or new.status<>'published' or new.published_revision_id is null then return new; end if;
    if tg_op='UPDATE' and old.published_revision_id is not distinct from new.published_revision_id and old.status='published' then return new; end if;
    student:=new.student_id; version_id:=new.published_revision_id; title:='{"zh":"学习反馈","en":"Learning feedback"}';
  end if;
  if student is null then return new; end if;
  for recipient in select distinct x.id from (select s.user_id id from students s where s.id=student union select g.guardian_id from student_guardians g where g.student_id=student) x
    where mathin_internal.miniapp_notification_recipient(x.id,student) loop
    perform mathin_internal.queue_miniapp_event(recipient,'report.published','',version_id,version_id::text||':'||recipient::text,now(),'published',title);
    update miniapp_notification_outbox set data=data||jsonb_build_object('studentId',student) where source_id=version_id and owner_id=recipient and event='report.published';
  end loop;
  return new;
end $$;
create trigger miniapp_assessment_report_notifications after insert or update of sent_at,sent_report_id on public.assessment_workflow_states for each row execute function public.queue_miniapp_report_notifications();
create trigger miniapp_feedback_report_notifications after insert or update of status,published_revision_id on public.learning_result_heads for each row execute function public.queue_miniapp_report_notifications();
create function public.miniapp_notifications() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not coalesce(mathin_internal.experience_audience('signedIn'),false) then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'body',body,'createdAt',due_at,'serviceId',service_id))
    from (select * from miniapp_notification_outbox where owner_id=auth.uid() and channel='inApp' and status='sent' and due_at<=now()
      and mathin_internal.miniapp_notification_recipient(owner_id,(data->>'studentId')::uuid) order by due_at desc limit 50) rows),'[]');
end $$;
create function public.miniapp_notification_claim() returns jsonb
language sql security definer set search_path=public,pg_temp as $$
  with expired as (update miniapp_notification_outbox set status='failed',lease_until=null,last_error='PROVIDER_UNAVAILABLE'
    where status='dispatching' and attempts>=8 and lease_until<now()),
  chosen as (select id from miniapp_notification_outbox where channel<>'inApp' and attempts<8 and due_at<=now()
    and (status='queued' or status='dispatching' and lease_until<now()) and mathin_internal.miniapp_notification_recipient(owner_id,(data->>'studentId')::uuid)
    order by due_at limit 10 for update skip locked),
  claimed as (update miniapp_notification_outbox o set status='dispatching',lease_until=now()+interval '3 minutes',attempts=attempts+1
    from chosen c where c.id=o.id returning o.*)
  select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') from claimed;
$$;
create function public.miniapp_notification_ack(p_id uuid,p_attempt integer,p_success boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update miniapp_notification_outbox set status=case when p_success then 'sent' when attempts>=8 then 'failed' else 'queued' end,
    due_at=case when p_success then due_at else now()+make_interval(secs=>least(3600,30*(2^least(attempts,7))::int)) end,
    lease_until=null,last_error=case when p_success then null else 'PROVIDER_UNAVAILABLE' end
    where id=p_id and attempts=p_attempt and status='dispatching';
end $$;
revoke all on function mathin_internal.queue_miniapp_event(uuid,text,text,uuid,text,timestamptz,text,jsonb),public.queue_miniapp_experience_notifications(),
  mathin_internal.miniapp_notification_recipient(uuid,uuid),public.queue_miniapp_report_notifications(),
  public.miniapp_notifications(),public.miniapp_notification_claim(),public.miniapp_notification_ack(uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.miniapp_notifications() to authenticated;
grant execute on function public.miniapp_notification_claim(),public.miniapp_notification_ack(uuid,integer,boolean) to service_role;
notify pgrst,'reload schema';
commit;
