\set ON_ERROR_STOP on
-- R1-4: hybrid projection, durable coordination, approval, idempotency,
-- notification, authorization, and PERF-04 assertions.
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
select id as sales_id from public.profiles where display_name = '测试-学辅' limit 1 \gset
select id as student_id from public.profiles where display_name = '测试-学生' limit 1 \gset
\if :{?admin_id}
\else
  \echo R1 fixtures missing
  select 1 / 0;
\endif

do $$
declare failures text[] := '{}';
begin
  if not exists(select 1 from unnest(public.school_permission_keys()) key where key='work_item.manage') then failures:=array_append(failures,'work item permission missing'); end if;
  if not exists(select 1 from unnest(public.school_permission_keys()) key where key='approval.manage') then failures:=array_append(failures,'approval permission missing'); end if;
  if exists(select 1 from unnest(array['work_items','work_item_assignments','approval_requests','approval_decisions']) table_name
    where not (select relrowsecurity from pg_class where oid=('public.'||table_name)::regclass)) then failures:=array_append(failures,'R1-4 table without RLS'); end if;
  if exists(select 1 from unnest(array['work_items','work_item_assignments','approval_requests','approval_decisions']) table_name
    where has_table_privilege('authenticated','public.'||table_name,'INSERT,UPDATE,DELETE')) then failures:=array_append(failures,'coordination table allows direct mutation'); end if;
  if to_regprocedure('public.list_my_domain_work_items(text,boolean)') is null then failures:=array_append(failures,'11-source projection was not preserved'); end if;
  if to_regprocedure('public.list_my_work_items_before_classroom_visibility(text,boolean)') is null then failures:=array_append(failures,'classroom visibility wrapper source missing'); end if;
  if to_regprocedure('public.list_my_work_items(text,boolean)') is null then failures:=array_append(failures,'unified projection missing'); end if;
  if has_function_privilege('authenticated','public.list_my_work_items_before_classroom_visibility(text,boolean)','EXECUTE') then failures:=array_append(failures,'unfiltered classroom projection exposed'); end if;
  if to_regclass('public.work_items_assignee_open_due_idx') is null then failures:=array_append(failures,'work item assignee/due index missing'); end if;
  if to_regclass('public.approval_requests_approver_pending_due_idx') is null then failures:=array_append(failures,'approval approver/due index missing'); end if;
  if cardinality(failures)>0 then raise exception 'R1-4 structure assertions failed: %',array_to_string(failures,', '); end if;
end
$$;

-- A class/session-backed work item is eligible for the ordinary inbox only
-- when its classroom is an unarchived, untrashed production classroom. The
-- legacy projection is checked first so this fixture proves the wrapper is
-- filtering real source rows rather than passing vacuously.
insert into public.classrooms(owner_id,name,invite_code,purpose,operational_status)
values(:'teacher_id','__R1_WORK_VISIBLE_PRODUCTION__','WV'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),'production','active')
returning id as visible_classroom_id \gset
insert into public.class_sessions(classroom_id,title,scheduled_at)
values(:'visible_classroom_id','__R1_WORK_VISIBLE_SESSION__',now()-interval '1 day')
returning id as visible_session_id \gset

insert into public.classrooms(owner_id,name,invite_code,purpose,operational_status)
values(:'teacher_id','__R1_WORK_TEST_CLASS__','WT'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),'test','active')
returning id as test_classroom_id \gset
insert into public.class_sessions(classroom_id,title,scheduled_at)
values(:'test_classroom_id','__R1_WORK_TEST_SESSION__',now()-interval '1 day')
returning id as test_session_id \gset

insert into public.classrooms(owner_id,name,invite_code,purpose,operational_status,archived_at)
values(:'teacher_id','__R1_WORK_ARCHIVED_CLASS__','WA'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),'production','active',now())
returning id as archived_classroom_id \gset
insert into public.class_sessions(classroom_id,title,scheduled_at)
values(:'archived_classroom_id','__R1_WORK_ARCHIVED_SESSION__',now()-interval '1 day')
returning id as archived_session_id \gset

insert into public.classrooms(owner_id,name,invite_code,purpose,operational_status,trashed_at)
values(:'teacher_id','__R1_WORK_TRASHED_CLASS__','WX'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),'production','active',now())
returning id as trashed_classroom_id \gset
insert into public.class_sessions(classroom_id,title,scheduled_at)
values(:'trashed_classroom_id','__R1_WORK_TRASHED_SESSION__',now()-interval '1 day')
returning id as trashed_session_id \gset

select set_config('request.jwt.claim.sub', :'admin_id', true);
select set_config('test.r1_work_visible_session_id', :'visible_session_id', true);
select set_config('test.r1_work_test_session_id', :'test_session_id', true);
select set_config('test.r1_work_archived_session_id', :'archived_session_id', true);
select set_config('test.r1_work_trashed_session_id', :'trashed_session_id', true);
do $$
declare
  visible_session uuid := current_setting('test.r1_work_visible_session_id')::uuid;
  hidden_sessions uuid[] := array[
    current_setting('test.r1_work_test_session_id')::uuid,
    current_setting('test.r1_work_archived_session_id')::uuid,
    current_setting('test.r1_work_trashed_session_id')::uuid
  ];
begin
  if not exists (
    select 1
    from public.list_my_work_items_before_classroom_visibility(null,true)
    where primary_object_id = any(hidden_sessions)
      and kind in ('session.prepare','session.overdue_not_started')
  ) then
    raise exception 'R1_CLASSROOM_VISIBILITY_FIXTURE_DID_NOT_REACH_SOURCE_PROJECTION';
  end if;
  if exists (
    select 1
    from public.list_my_work_items(null,true)
    where primary_object_id = any(hidden_sessions)
  ) then
    raise exception 'R1_HIDDEN_CLASSROOM_WORK_ITEM_VISIBLE';
  end if;
  if (
    select count(*)
    from public.list_my_work_items(null,true)
    where primary_object_id = visible_session
      and kind in ('session.prepare','session.overdue_not_started')
  ) <> 2 then
    raise exception 'R1_VISIBLE_PRODUCTION_CLASSROOM_WORK_ITEM_MISSING';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'student_id', true);
do $$
begin
  begin
    perform public.list_my_work_items();
    raise exception 'R1_STUDENT_WORK_LIST_WAS_ACCEPTED';
  exception when others then if SQLERRM <> 'FORBIDDEN' then raise; end if; end;
  begin
    insert into public.work_items(source_kind,source_id,idempotency_key,domain,title,action_href,assignee_id,created_reason,created_by)
    values('manual','blocked','r1-blocked','operations','blocked','/dashboard',auth.uid(),'blocked',auth.uid());
    raise exception 'R1_DIRECT_WORK_ITEM_INSERT_WAS_ACCEPTED';
  exception when insufficient_privilege then null; end;
end
$$;

select set_config('test.admin_id', :'admin_id', true);
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.create_durable_work_item(
  'sla','r1-teacher-sla','r1-work-create','operations','R1 SLA item','R1 assertion',
  :'teacher_id'::uuid,now()-interval '1 hour','high','Independent SLA expired','/dashboard'
) as work_item_id \gset
select public.create_durable_work_item(
  'sla','r1-teacher-sla','r1-work-create','operations','R1 SLA item','R1 assertion',
  :'teacher_id'::uuid,now()-interval '1 hour','high','Independent SLA expired','/dashboard'
) as replay_work_item_id \gset

do $$
begin
  if (select count(*) from public.work_items where idempotency_key='r1-work-create') <> 1 then raise exception 'R1_WORK_ITEM_IDEMPOTENCY_FAILED'; end if;
  if not exists(select 1 from public.list_my_work_items() where work_key='durable:'||(select id::text from public.work_items where idempotency_key='r1-work-create') and source_kind='durable.sla'
      and action_kind='work_item.close' and action_href='/dashboard' and assignee_id=auth.uid()
      and priority='high' and read_state='unseen' and urgency_bucket='overdue' and can_act) then
    raise exception 'R1_DURABLE_ITEM_NOT_IN_UNIFIED_LIST';
  end if;
  begin
    perform public.create_durable_work_item('sla','r1-teacher-sla','r1-work-create','operations','changed','R1 assertion',
      auth.uid(),now()-interval '1 hour','high','Independent SLA expired','/dashboard');
    raise exception 'R1_WORK_ITEM_IDEMPOTENCY_CONFLICT_WAS_ACCEPTED';
  exception when others then if SQLERRM <> 'IDEMPOTENCY_CONFLICT' then raise; end if; end;
  begin
    perform public.create_durable_work_item('delegation','r1-forbidden','r1-forbidden-assign','operations','forbidden','test',
      current_setting('test.admin_id')::uuid,now()+interval '1 day','normal','No cross-assignment','/dashboard');
    raise exception 'R1_NON_MANAGER_CROSS_ASSIGNMENT_WAS_ACCEPTED';
  exception when others then if SQLERRM <> 'FORBIDDEN' then raise; end if; end;
  begin
    perform public.close_durable_work_item('00000000-0000-4000-8000-000000000101','domain projection bypass','r1-domain-close');
    raise exception 'R1_DOMAIN_ITEM_GENERIC_CLOSE_WAS_ACCEPTED';
  exception when others then if SQLERRM <> 'NOT_FOUND' then raise; end if; end;
end
$$;

select public.request_approval(
  'general','manual','r1-approval-subject','r1-approval-request','operations','R1 approval',
  'Independent decision required','{}'::jsonb,:'admin_id'::uuid,now()+interval '4 hours','normal','/dashboard'
) as approval_request_id \gset
select public.request_approval(
  'general','manual','r1-approval-subject','r1-approval-request','operations','R1 approval',
  'Independent decision required','{}'::jsonb,:'admin_id'::uuid,now()+interval '4 hours','normal','/dashboard'
) as replay_approval_request_id \gset

do $$
begin
  if (select count(*) from public.approval_requests where idempotency_key='r1-approval-request') <> 1 then raise exception 'R1_APPROVAL_REQUEST_IDEMPOTENCY_FAILED'; end if;
  if not exists(select 1 from public.list_my_work_items() where work_key='approval:'||(select id::text from public.approval_requests where idempotency_key='r1-approval-request')
      and source_kind='approval_request' and action_kind='approval.decide' and ownership_mode='delegated' and not can_act) then
    raise exception 'R1_APPROVAL_REQUESTER_PROJECTION_MISSING';
  end if;
  begin
    perform public.decide_approval((select id from public.approval_requests where idempotency_key='r1-approval-request'),'approved','self approval blocked','{}'::jsonb,'r1-self-decision');
    raise exception 'R1_SELF_APPROVAL_WAS_ACCEPTED';
  exception when others then if SQLERRM <> 'FORBIDDEN_SELF_APPROVAL' then raise; end if; end;
end
$$;

reset role;
select (select count(*)=1 from public.domain_events where entity_id=:'work_item_id'::uuid and event_type='work_item.assigned') as work_notification_once \gset
select (select count(*)=1 from public.notifications where recipient_id=:'admin_id'::uuid and notification_key='approval.requested') as approval_notification_once \gset
\if :work_notification_once
\else
  \echo R1-4 idempotent work assignment emitted duplicate events
  select 1 / 0;
\endif
\if :approval_notification_once
\else
  \echo R1-4 approval request notification missing or duplicated
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
do $$
begin
  if not exists(select 1 from public.list_my_work_items() where work_key='approval:'||(select id::text from public.approval_requests where idempotency_key='r1-approval-request')
      and action_kind='approval.decide' and ownership_mode='direct' and can_act) then
    raise exception 'R1_APPROVER_PROJECTION_MISSING';
  end if;
end
$$;
select public.decide_approval(:'approval_request_id'::uuid,'approved','Approved in R1 assertion','{}'::jsonb,'r1-approval-decision') as approval_decision_id \gset
select public.decide_approval(:'approval_request_id'::uuid,'approved','Approved in R1 assertion','{}'::jsonb,'r1-approval-decision') as replay_approval_decision_id \gset
do $$
begin
  if (select count(*) from public.approval_decisions where idempotency_key='r1-approval-decision') <> 1 then raise exception 'R1_APPROVAL_DECISION_IDEMPOTENCY_FAILED'; end if;
  if exists(select 1 from public.list_my_work_items() where work_key='approval:'||(select id::text from public.approval_requests where idempotency_key='r1-approval-request')) then raise exception 'R1_DECIDED_APPROVAL_STILL_PROJECTED'; end if;
end
$$;

select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.set_work_item_seen('durable:'||:'work_item_id');
do $$
begin
  if not exists(select 1 from public.list_my_work_items() where work_key='durable:'||(select id::text from public.work_items where idempotency_key='r1-work-create') and read_state='seen') then
    raise exception 'R1_READ_STATE_NOT_PROJECTED';
  end if;
end
$$;
select public.close_durable_work_item(:'work_item_id'::uuid,'Resolved in R1 assertion','r1-work-close') as closed_work_item_id \gset
select public.close_durable_work_item(:'work_item_id'::uuid,'Resolved in R1 assertion','r1-work-close') as replay_closed_work_item_id \gset
do $$
begin
  if (select count(*) from public.work_items where close_idempotency_key='r1-work-close') <> 1 then raise exception 'R1_WORK_CLOSE_IDEMPOTENCY_FAILED'; end if;
  if exists(select 1 from public.list_my_work_items() where work_key='durable:'||(select id::text from public.work_items where idempotency_key='r1-work-create')) then raise exception 'R1_CLOSED_DURABLE_ITEM_STILL_PROJECTED'; end if;
end
$$;
reset role;

do $$
begin
  begin
    update public.work_item_assignments set reason='tampered' where work_item_id=(select id from public.work_items where idempotency_key='r1-work-create');
    raise exception 'R1_ASSIGNMENT_AUDIT_WAS_MUTABLE';
  exception when others then if SQLERRM <> 'APPEND_ONLY_AUDIT' then raise; end if; end;
  begin
    delete from public.approval_decisions where idempotency_key='r1-approval-decision';
    raise exception 'R1_APPROVAL_DECISION_WAS_MUTABLE';
  exception when others then if SQLERRM <> 'APPEND_ONLY_AUDIT' then raise; end if; end;
end
$$;

-- Near-production synthetic coordination cardinality. The transaction rolls
-- back, so no fixture or operational row survives the assertion.
create temporary table r1_perf_users(seq integer primary key, id uuid not null unique);
insert into r1_perf_users select n, gen_random_uuid() from generate_series(1,300) n;
insert into auth.users(id,email,raw_user_meta_data)
select perf_user.id, 'r1-perf-'||perf_user.seq||'@example.invalid',
  jsonb_build_object(
    'display_name','R1 PERF '||perf_user.seq,
    'registration_invite_code',(select code from public.registration_invite_settings where id=1),
    'privacy_consent',true,
    'children_privacy_consent',true
  )
from r1_perf_users perf_user;
update public.profiles set role='staff' where id in (select id from r1_perf_users);

insert into public.work_items(source_kind,source_id,idempotency_key,domain,title,description,action_href,
  assignee_id,due_at,priority,created_reason,created_by,created_at)
select 'sla','perf-'||n,'r1-perf-'||n,'operations','Performance item '||n,'','/dashboard',
  case when n%301=0 then :'teacher_id'::uuid else perf_user.id end,
  now()+((n%240)-120)*interval '1 minute',case when n%17=0 then 'high' else 'normal' end,
  'R1 PERF-04 synthetic',case when n%301=0 then :'teacher_id'::uuid else perf_user.id end,
  now()-(n%1000)*interval '1 second'
from generate_series(1,30000) n
join r1_perf_users perf_user on perf_user.seq=(n%300)+1;

create temporary table r1_work_perf(sample_no integer primary key, elapsed_ms numeric);
select set_config('request.jwt.claim.sub', :'teacher_id', true);
do $$
declare started timestamptz; n integer;
begin
  for n in 1..40 loop
    started := clock_timestamp();
    perform count(*) from public.list_my_work_items();
    insert into r1_work_perf values(n, extract(epoch from clock_timestamp()-started)*1000);
  end loop;
end
$$;

select round(percentile_cont(0.95) within group(order by elapsed_ms)::numeric,2) as perf_p95_ms,
       round(percentile_cont(0.99) within group(order by elapsed_ms)::numeric,2) as perf_p99_ms,
       round(max(elapsed_ms),2) as perf_max_ms
from r1_work_perf \gset
\echo R1-4 PERF-04 synthetic_rows=30000 samples=40 p95_ms=:perf_p95_ms p99_ms=:perf_p99_ms max_ms=:perf_max_ms
do $$
declare p95 numeric; p99 numeric;
begin
  select percentile_cont(0.95) within group(order by elapsed_ms),
         percentile_cont(0.99) within group(order by elapsed_ms) into p95,p99 from r1_work_perf;
  if p95 > 500 then raise exception 'R1_PERF04_P95_FAILED: %ms',round(p95,2); end if;
  if p99 > 1000 then raise exception 'R1_PERF04_P99_FAILED: %ms',round(p99,2); end if;
end
$$;

rollback;
\echo R1-4 work item and approval assertions passed
