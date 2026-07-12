-- P4E-F：领域事件、学期轴、稳定内容 ID、状态机与 migration 账本。

-- ---------------------------------------------------------------------------
-- 学期轴与年级历史
-- ---------------------------------------------------------------------------

create table public.school_terms (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid,
  year smallint not null check(year between 2000 and 2200),
  term smallint not null check(term between 1 and 4),
  name text not null,
  starts_on date not null,
  ends_on date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  constraint school_terms_dates check(ends_on>=starts_on),
  unique(campus_id,year,term)
);
create unique index school_terms_one_current_idx
  on public.school_terms(coalesce(campus_id,'00000000-0000-0000-0000-000000000000'::uuid)) where is_current;
create unique index school_terms_scope_unique_idx
  on public.school_terms(coalesce(campus_id,'00000000-0000-0000-0000-000000000000'::uuid),year,term);
insert into public.school_terms(year,term,name,starts_on,ends_on,is_current)
values(2026,1,'2026 春季学期','2026-02-01','2026-08-31',true)
on conflict(campus_id,year,term) do nothing;

create table public.student_grade_history (
  student_id uuid not null references public.students(id) on delete cascade,
  term_id uuid not null references public.school_terms(id),
  grade smallint check(grade between 1 and 12),
  recorded_by uuid references public.profiles(id) on delete set null,
  recorded_at timestamptz not null default now(),
  primary key(student_id,term_id)
);
insert into public.student_grade_history(student_id,term_id,grade)
select s.id,t.id,s.grade from public.students s cross join public.school_terms t
 where t.is_current and t.campus_id is null and s.grade is not null on conflict do nothing;

alter table public.courses add column if not exists term_id uuid references public.school_terms(id);
alter table public.classrooms add column if not exists term_id uuid references public.school_terms(id);
alter table public.class_sessions add column if not exists term_id uuid references public.school_terms(id);
alter table public.enrollments add column if not exists term_id uuid references public.school_terms(id);
alter table public.orders add column if not exists term_id uuid references public.school_terms(id);
alter table public.activities add column if not exists term_id uuid references public.school_terms(id);
alter table public.session_reviews add column if not exists term_id uuid references public.school_terms(id);
alter table public.session_videos add column if not exists term_id uuid references public.school_terms(id);

do $$ declare tid uuid; begin
  select id into tid from public.school_terms where is_current and campus_id is null;
  update public.courses set term_id=tid where term_id is null;
  update public.classrooms set term_id=tid where term_id is null;
  update public.class_sessions set term_id=tid where term_id is null;
  update public.enrollments set term_id=tid where term_id is null;
  update public.orders set term_id=tid where term_id is null;
  update public.activities set term_id=tid where term_id is null;
  update public.session_reviews set term_id=tid where term_id is null;
  update public.session_videos set term_id=tid where term_id is null;
end $$;

create or replace function public.fill_current_term()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.term_id is null then
    select id into new.term_id from public.school_terms where is_current and campus_id is null;
  end if;
  return new;
end $$;
create trigger courses_fill_term before insert on public.courses for each row execute function public.fill_current_term();
create trigger classrooms_fill_term before insert on public.classrooms for each row execute function public.fill_current_term();
create trigger class_sessions_fill_term before insert on public.class_sessions for each row execute function public.fill_current_term();
create trigger enrollments_fill_term before insert on public.enrollments for each row execute function public.fill_current_term();
create trigger orders_fill_term before insert on public.orders for each row execute function public.fill_current_term();
create trigger activities_fill_term before insert on public.activities for each row execute function public.fill_current_term();
create trigger session_reviews_fill_term before insert on public.session_reviews for each row execute function public.fill_current_term();
create trigger session_videos_fill_term before insert on public.session_videos for each row execute function public.fill_current_term();

-- ---------------------------------------------------------------------------
-- 审计/领域事件与未读游标
-- ---------------------------------------------------------------------------

create table public.domain_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_role text,
  target_user_id uuid,
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  event_link text,
  term_id uuid references public.school_terms(id),
  constraint domain_events_payload_cap check(octet_length(payload::text)<=262144)
);
create index domain_events_feed_idx on public.domain_events(occurred_at desc);
create index domain_events_target_idx on public.domain_events(target_user_id,occurred_at desc);
create index domain_events_entity_idx on public.domain_events(entity_type,entity_id,occurred_at desc);

create table public.user_event_reads (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default 'epoch'
);

create or replace function public.emit_domain_event(
  p_event_type text,p_entity_type text,p_entity_id uuid,p_payload jsonb default '{}'::jsonb,
  p_target_user_id uuid default null,p_event_link text default null
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare eid uuid; uid uuid:=auth.uid(); role_snapshot text; tid uuid;
begin
  select role into role_snapshot from public.profiles where id=uid;
  select id into tid from public.school_terms where is_current and campus_id is null;
  insert into public.domain_events(actor_id,actor_role,target_user_id,event_type,entity_type,entity_id,payload,event_link,term_id)
  values(uid,role_snapshot,p_target_user_id,p_event_type,p_entity_type,p_entity_id,coalesce(p_payload,'{}'::jsonb),p_event_link,tid)
  returning id into eid;
  return eid;
end $$;

create or replace function public.guard_domain_events_immutable()
returns trigger language plpgsql as $$ begin raise exception 'DOMAIN_EVENTS_APPEND_ONLY'; end $$;
create trigger domain_events_immutable before update or delete on public.domain_events
  for each row execute function public.guard_domain_events_immutable();

create or replace function public.audit_sensitive_row()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare row_json jsonb; entity uuid; kind text; target_uid uuid;
begin
  row_json:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_table_name='payments' then kind:='payment.recorded'; entity:=new.id;
  elsif tg_table_name='refunds' then kind:='refund.'||lower(coalesce(new.status,tg_op)); entity:=new.id;
  elsif tg_table_name='role_permissions' then kind:='permission.'||lower(tg_op); entity:=coalesce(new.role_id,old.role_id);
  elsif tg_table_name='session_reviews' then
    kind:='review.'||lower(tg_op); entity:=new.session_id;
    select user_id into target_uid from public.students where id=new.student_id;
  else kind:=lower(tg_table_name)||'.'||lower(tg_op); entity:=null; end if;
  perform public.emit_domain_event(kind,tg_table_name,entity,
    jsonb_build_object('before',case when tg_op='INSERT' then null else to_jsonb(old) end,'after',case when tg_op='DELETE' then null else to_jsonb(new) end),
    target_uid,null);
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger payments_domain_event after insert on public.payments for each row execute function public.audit_sensitive_row();
create trigger refunds_domain_event after insert or update on public.refunds for each row execute function public.audit_sensitive_row();
create trigger role_permissions_domain_event after insert or delete on public.role_permissions for each row execute function public.audit_sensitive_row();
create trigger session_reviews_domain_event after insert or update on public.session_reviews for each row execute function public.audit_sensitive_row();

create or replace function public.can_read_domain_event(p_event_id uuid,p_uid uuid)
returns boolean language sql security definer stable set search_path=public,pg_temp as $$
  select exists(select 1 from public.domain_events e where e.id=p_event_id and (
    e.actor_id=p_uid or e.target_user_id=p_uid or public.is_admin(p_uid) or public.has_perm(p_uid,'audit.view')
    or exists(select 1 from public.students s where s.id=nullif(e.payload#>>'{after,student_id}','')::uuid
      and (s.user_id=p_uid or exists(select 1 from public.student_guardians g where g.student_id=s.id and g.guardian_id=p_uid)))
  ))
$$;

alter table public.school_terms enable row level security;
alter table public.student_grade_history enable row level security;
alter table public.domain_events enable row level security;
alter table public.user_event_reads enable row level security;
create policy school_terms_read on public.school_terms for select to authenticated using(true);
create policy grade_history_scope on public.student_grade_history for select to authenticated
  using(public.can_access_student(student_id,(select auth.uid())) or exists(select 1 from public.students s where s.id=student_id and (s.user_id=(select auth.uid()) or exists(select 1 from public.student_guardians g where g.student_id=s.id and g.guardian_id=(select auth.uid())))));
create policy domain_events_read_scope on public.domain_events for select to authenticated
  using(public.can_read_domain_event(id,(select auth.uid())));
create policy user_event_reads_own_select on public.user_event_reads for select to authenticated using(user_id=(select auth.uid()));
create policy user_event_reads_own_insert on public.user_event_reads for insert to authenticated with check(user_id=(select auth.uid()));
create policy user_event_reads_own_update on public.user_event_reads for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
revoke all on public.school_terms,public.student_grade_history,public.domain_events,public.user_event_reads from anon,authenticated;
grant select on public.school_terms,public.student_grade_history,public.domain_events to authenticated;
grant select,insert(user_id,last_read_at),update(last_read_at) on public.user_event_reads to authenticated;
revoke all on function public.emit_domain_event(text,text,uuid,jsonb,uuid,text) from public,anon,authenticated;
revoke all on function public.can_read_domain_event(uuid,uuid) from public;
grant execute on function public.can_read_domain_event(uuid,uuid) to authenticated;

-- audit.view 加入权限目录并赋给校长。
create or replace function public.school_permission_keys() returns text[] language sql immutable as $$
select array[
 'student.view.all','student.view.assigned','student.edit','student.create','student.assign','student.import','student.delete',
 'followup.view','followup.write','activity.manage','activity.register','review.write','video.review',
 'course.view','course.manage','courseware.template.edit','courseware.overlay.edit',
 'class.view.all','class.view.mine','class.create','class.manage','enrollment.manage','schedule.view.all','attendance.mark','grading.write','report.view.all',
 'finance.order.view','finance.order.create','finance.payment.record','finance.refund.request','finance.refund.approve',
 'finance.coupon.manage','finance.scholarship.grant','finance.account.adjust','finance.report.view','staff.manage','permission.configure','audit.view'
]::text[] $$;
insert into public.role_permissions(role_id,perm_key)
select id,'audit.view' from public.staff_roles where key='principal' on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 业务状态跃迁：值约束之外再约束有向边，禁止任意跳转。
-- ---------------------------------------------------------------------------

create or replace function public.guard_student_state_transition()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status and not (
    (old.status='lead' and new.status in ('trialing','invalid')) or
    (old.status='trialing' and new.status in ('lead','enrolled','invalid')) or
    (old.status='enrolled' and new.status in ('paused','alumni')) or
    (old.status='paused' and new.status in ('enrolled','alumni')) or
    (old.status='alumni' and new.status='enrolled') or
    (old.status='invalid' and new.status='lead')
  ) then raise exception 'INVALID_STATUS_TRANSITION:%->%',old.status,new.status; end if;
  if new.follow_up_status is distinct from old.follow_up_status and not (
    (old.follow_up_status='pending' and new.follow_up_status in ('following','lost')) or
    (old.follow_up_status='following' and new.follow_up_status in ('invited','lost')) or
    (old.follow_up_status='invited' and new.follow_up_status in ('following','trialed','lost')) or
    (old.follow_up_status='trialed' and new.follow_up_status in ('following','signed','lost')) or
    (old.follow_up_status='lost' and new.follow_up_status='following')
  ) then raise exception 'INVALID_FOLLOWUP_TRANSITION:%->%',old.follow_up_status,new.follow_up_status; end if;
  return new;
end $$;
create trigger students_guard_state before update of status,follow_up_status on public.students
  for each row execute function public.guard_student_state_transition();

-- ---------------------------------------------------------------------------
-- 内容稳定 ID 与 migration 账本
-- ---------------------------------------------------------------------------

create table public.content_slug_aliases (
  uid text not null,
  slug text not null,
  locale text not null default 'zh',
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  primary key(locale,slug)
);
create unique index content_slug_aliases_current_idx on public.content_slug_aliases(uid,locale) where is_current;
alter table public.content_slug_aliases enable row level security;
create policy content_aliases_public_read on public.content_slug_aliases for select to anon,authenticated using(true);
revoke all on public.content_slug_aliases from anon,authenticated;
grant select on public.content_slug_aliases to anon,authenticated;

create table public.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now(),
  checksum text not null
);
revoke all on public.schema_migrations from anon,authenticated;
