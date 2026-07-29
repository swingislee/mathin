-- R1-1：单机构、多校区配置；版本化规则与运行期 Feature Flag。
-- 默认能力全部 fail-closed，所有管理写路径只允许走 SECURITY DEFINER RPC。

-- ---------------------------------------------------------------------------
-- 1. 机构、校区、教室与节假日。
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  singleton_key smallint not null default 1 unique check (singleton_key = 1),
  code text not null unique check (code ~ '^[a-z][a-z0-9-]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  timezone text not null default 'Asia/Shanghai' check (char_length(timezone) between 1 and 64),
  default_locale text not null default 'zh' check (default_locale in ('zh', 'en')),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.campuses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  code text not null check (code ~ '^[a-z][a-z0-9-]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  timezone text check (timezone is null or char_length(timezone) between 1 and 64),
  status text not null default 'active' check (status in ('active', 'archived')),
  is_default boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);
create unique index campuses_one_default_idx on public.campuses(organization_id) where is_default;

create table public.campus_rooms (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references public.campuses(id) on delete restrict,
  code text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$'),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  capacity integer check (capacity between 1 and 500),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campus_id, code)
);

create table public.school_holidays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  campus_id uuid references public.campuses(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  kind text not null check (kind in ('closed', 'teaching', 'makeup')),
  starts_on date not null,
  ends_on date not null,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_holidays_dates check (ends_on >= starts_on)
);
create index school_holidays_calendar_idx on public.school_holidays(organization_id, campus_id, starts_on, ends_on) where archived_at is null;

create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();
create trigger campuses_set_updated_at before update on public.campuses
  for each row execute function public.set_updated_at();
create trigger campus_rooms_set_updated_at before update on public.campus_rooms
  for each row execute function public.set_updated_at();
create trigger school_holidays_set_updated_at before update on public.school_holidays
  for each row execute function public.set_updated_at();

insert into public.organizations(singleton_key, code, name, timezone, default_locale)
values (1, 'main', 'Mathin', 'Asia/Shanghai', 'zh')
on conflict (singleton_key) do nothing;

-- 旧 schema 允许写入没有外键的 campus_id。显式接管这些值，再建立默认校区；不依赖测试 UUID。
insert into public.campuses(id, organization_id, code, name, status, is_default)
select distinct term_row.campus_id, organization_row.id,
       'legacy-' || left(replace(term_row.campus_id::text, '-', ''), 12),
       'Legacy campus ' || left(term_row.campus_id::text, 8), 'active', false
  from public.school_terms term_row
 cross join public.organizations organization_row
 where organization_row.singleton_key = 1 and term_row.campus_id is not null
on conflict (id) do nothing;

insert into public.campuses(organization_id, code, name, timezone, status, is_default)
select id, 'main', 'Mathin Main Campus', null, 'active', true
  from public.organizations where singleton_key = 1
on conflict (organization_id, code) do update set is_default = true;

update public.school_terms
   set campus_id = (select id from public.campuses where is_default limit 1)
 where campus_id is null;

alter table public.school_terms
  add constraint school_terms_campus_id_fkey foreign key (campus_id) references public.campuses(id) on delete restrict;
alter table public.school_terms alter column campus_id set not null;

-- ---------------------------------------------------------------------------
-- 2. 版本化规则与 Feature Flag。值不可覆盖；回滚也创建新版本。
-- ---------------------------------------------------------------------------

create table public.organization_rule_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  campus_id uuid references public.campuses(id) on delete restrict,
  domain text not null check (domain in ('calendar', 'lesson', 'scheduling', 'notification', 'finance', 'public_publishing')),
  version integer not null check (version > 0),
  value jsonb not null check (jsonb_typeof(value) = 'object' and octet_length(value::text) <= 16384),
  effective_from timestamptz not null,
  effective_until timestamptz,
  supersedes_id uuid references public.organization_rule_versions(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 1 and 200),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint organization_rule_effective_range check (effective_until is null or effective_until > effective_from)
);
create unique index organization_rule_version_scope_idx
  on public.organization_rule_versions(organization_id, coalesce(campus_id, '00000000-0000-0000-0000-000000000000'::uuid), domain, version);
create index organization_rule_effective_idx
  on public.organization_rule_versions(organization_id, campus_id, domain, effective_from desc, version desc);

create table public.feature_flag_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  campus_id uuid references public.campuses(id) on delete restrict,
  flag_key text not null,
  version integer not null check (version > 0),
  enabled boolean not null default false,
  effective_from timestamptz not null,
  effective_until timestamptz,
  supersedes_id uuid references public.feature_flag_versions(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 1 and 200),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint feature_flag_effective_range check (effective_until is null or effective_until > effective_from)
);
create unique index feature_flag_version_scope_idx
  on public.feature_flag_versions(organization_id, coalesce(campus_id, '00000000-0000-0000-0000-000000000000'::uuid), flag_key, version);
create index feature_flag_effective_idx
  on public.feature_flag_versions(organization_id, campus_id, flag_key, effective_from desc, version desc);

create or replace function public.organization_feature_keys()
returns text[] language sql immutable
as $$
  select array[
    'finance.enabled',
    'notifications.email',
    'notifications.sms',
    'notifications.wechat',
    'public_content.publish'
  ]::text[]
$$;

create or replace function public.guard_rule_version_immutable()
returns trigger language plpgsql
as $$
begin
  if tg_op = 'DELETE' then raise exception 'RULE_VERSION_IMMUTABLE'; end if;
  if (to_jsonb(new) - 'effective_until') is distinct from (to_jsonb(old) - 'effective_until') then
    raise exception 'RULE_VERSION_IMMUTABLE';
  end if;
  return new;
end
$$;
create trigger organization_rule_versions_immutable before update or delete on public.organization_rule_versions
  for each row execute function public.guard_rule_version_immutable();
create trigger feature_flag_versions_immutable before update or delete on public.feature_flag_versions
  for each row execute function public.guard_rule_version_immutable();

insert into public.organization_rule_versions(organization_id, domain, version, value, effective_from, reason)
select organization_row.id, seed.domain, 1, seed.value, now(), 'R1-1 explicit default'
  from public.organizations organization_row
 cross join (values
   ('calendar', jsonb_build_object('teachingWeekStartsOn', 1, 'weekendDays', jsonb_build_array(0, 6))),
   ('lesson', jsonb_build_object('defaultDurationMinutes', 90, 'billingUnitLessons', 1)),
   ('scheduling', jsonb_build_object('minBreakMinutes', 10, 'conflictPolicy', 'block')),
   ('notification', jsonb_build_object('inAppEnabled', true, 'emailEnabled', false, 'smsEnabled', false, 'wechatEnabled', false)),
   ('finance', jsonb_build_object('currency', 'CNY', 'refundRequiresApproval', true)),
   ('public_publishing', jsonb_build_object('defaultLocale', 'zh', 'requiresReview', true))
 ) as seed(domain, value)
 where organization_row.singleton_key = 1
on conflict do nothing;

insert into public.feature_flag_versions(organization_id, flag_key, version, enabled, effective_from, reason)
select organization_row.id, flag_key, 1, false, now(), 'R1-1 fail-closed default'
  from public.organizations organization_row
 cross join unnest(public.organization_feature_keys()) as flag_key
 where organization_row.singleton_key = 1
on conflict do nothing;

create or replace function public.is_feature_enabled(
  p_flag_key text,
  p_campus_id uuid default null,
  p_at timestamptz default now()
) returns boolean
language sql security definer stable set search_path = public, pg_temp
as $$
  select coalesce((
    select version_row.enabled
      from public.feature_flag_versions version_row
     where version_row.organization_id = (select id from public.organizations where singleton_key = 1)
       and version_row.flag_key = p_flag_key
       and version_row.flag_key = any(public.organization_feature_keys())
       and (version_row.campus_id is null or version_row.campus_id = p_campus_id)
       and version_row.effective_from <= coalesce(p_at, now())
       and (version_row.effective_until is null or version_row.effective_until > coalesce(p_at, now()))
     order by (version_row.campus_id is not null) desc, version_row.effective_from desc, version_row.version desc
     limit 1
  ), false)
$$;

create or replace function public.get_effective_organization_rule(
  p_domain text,
  p_campus_id uuid default null,
  p_at timestamptz default now()
) returns jsonb
language sql security definer stable set search_path = public, pg_temp
as $$
  select version_row.value
    from public.organization_rule_versions version_row
   where version_row.organization_id = (select id from public.organizations where singleton_key = 1)
     and version_row.domain = p_domain
     and (version_row.campus_id is null or version_row.campus_id = p_campus_id)
     and version_row.effective_from <= coalesce(p_at, now())
     and (version_row.effective_until is null or version_row.effective_until > coalesce(p_at, now()))
   order by (version_row.campus_id is not null) desc, version_row.effective_from desc, version_row.version desc
   limit 1
$$;

-- 财务能力在数据库授权层统一关闭：RPC、RLS、工作项都复用 has_perm/staff_has_perm。
create or replace function public.has_perm(uid uuid, p_key text)
returns boolean
language sql security definer stable set search_path = public, pg_temp
as $$
  select (p_key not like 'finance.%' or public.is_feature_enabled('finance.enabled'))
    and (
      public.is_admin(uid)
      or exists (
        select 1
          from public.staff_role_members member_row
          join public.role_permissions permission_row on permission_row.role_id = member_row.role_id
         where member_row.user_id = uid and permission_row.perm_key = p_key
      )
    )
$$;

create or replace function public.staff_has_perm(uid uuid, p_key text)
returns boolean language sql security definer stable set search_path = public, pg_temp
as $$ select public.has_perm(uid, p_key) $$;

create or replace function public.school_permission_keys()
returns text[] language sql immutable
as $$
  select array[
    'student.view.all','student.view.assigned','student.edit','student.create','student.assign','student.import','student.delete',
    'followup.view','followup.write','activity.manage','activity.register','review.write','video.review',
    'course.view','course.manage','course.view.all','course.product.create','course.assignment.manage',
    'courseware.template.edit','courseware.overlay.edit','courseware.page.edit','courseware.asset.manage',
    'courseware.release.publish','courseware.review','courseware.emergency_publish',
    'class.view.all','class.view.mine','class.create','class.manage','enrollment.manage',
    'schedule.view.all','schedule.manage','attendance.mark','grading.write','report.view.all','session.void','session.postwork.manage',
    'finance.order.view','finance.order.create','finance.payment.record','finance.refund.request','finance.refund.approve',
    'finance.coupon.manage','finance.scholarship.grant','finance.account.adjust','finance.report.view',
    'staff.manage','permission.configure','registration.invite.manage','organization.settings.manage','audit.view','testdata.purge'
  ]::text[]
$$;

insert into public.role_permissions(role_id, perm_key)
select role_row.id, 'organization.settings.manage'
  from public.staff_roles role_row where role_row.key = 'principal'
on conflict do nothing;

create or replace function public.get_my_permission_keys()
returns table (perm_key text)
language sql security definer stable set search_path = public, pg_temp
as $$
  select key from unnest(public.school_permission_keys()) as key
   where auth.uid() is not null and public.has_perm(auth.uid(), key)
   order by key
$$;

-- ---------------------------------------------------------------------------
-- 3. 默认校区学期与审计帮助函数。
-- ---------------------------------------------------------------------------

create or replace function public.default_campus_id()
returns uuid language sql security definer stable set search_path = public, pg_temp
as $$ select id from public.campuses where is_default and status = 'active' order by created_at limit 1 $$;

create or replace function public.current_school_term_id(p_campus_id uuid default null)
returns uuid language sql security definer stable set search_path = public, pg_temp
as $$
  select id from public.school_terms
   where campus_id = coalesce(p_campus_id, public.default_campus_id()) and is_current
   order by starts_on desc limit 1
$$;

create or replace function public.fill_current_term()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.term_id is null then new.term_id := public.current_school_term_id(); end if;
  return new;
end
$$;

create or replace function public.capture_student_grade_history()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare tid uuid;
begin
  if tg_op = 'UPDATE' and new.grade is not distinct from old.grade then return new; end if;
  tid := public.current_school_term_id();
  if tid is not null then
    insert into public.student_grade_history(student_id, term_id, grade, recorded_by)
    values(new.id, tid, new.grade, auth.uid())
    on conflict(student_id, term_id) do update
      set grade = excluded.grade, recorded_by = excluded.recorded_by, recorded_at = now();
  end if;
  return new;
end
$$;

create or replace function public.emit_domain_event(
  p_event_type text, p_entity_type text, p_entity_id uuid, p_payload jsonb default '{}'::jsonb,
  p_target_user_id uuid default null, p_event_link text default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare eid uuid; uid uuid := auth.uid(); role_snapshot text; tid uuid := public.current_school_term_id();
begin
  select role into role_snapshot from public.profiles where id = uid;
  insert into public.domain_events(actor_id, actor_role, target_user_id, event_type, entity_type, entity_id, payload, event_link, term_id)
  values(uid, role_snapshot, p_target_user_id, p_event_type, p_entity_type, p_entity_id, coalesce(p_payload, '{}'::jsonb), p_event_link, tid)
  returning id into eid;
  return eid;
end
$$;

create or replace function public.create_campus_school_term(
  p_campus_id uuid, p_year int, p_term smallint, p_name text, p_starts_on date, p_ends_on date
) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); tid uuid;
begin
  if uid is null or not public.has_perm(uid, 'schedule.manage') then raise exception 'FORBIDDEN'; end if;
  if not exists(select 1 from public.campuses where id = p_campus_id and status = 'active') then raise exception 'INVALID_CAMPUS'; end if;
  if p_year < 2020 or p_year > 2100 or p_term not in (1, 2) or p_ends_on < p_starts_on or btrim(coalesce(p_name, '')) = '' then
    raise exception 'INVALID_TERM';
  end if;
  insert into public.school_terms(campus_id, year, term, name, starts_on, ends_on, is_current)
  values(p_campus_id, p_year, p_term, left(btrim(p_name), 100), p_starts_on, p_ends_on, false)
  returning id into tid;
  perform public.emit_domain_event('school_term.created', 'school_term', tid,
    jsonb_build_object('campusId', p_campus_id, 'year', p_year, 'term', p_term), null, null);
  return tid;
end
$$;

create or replace function public.create_school_term(
  p_year int, p_term smallint, p_name text, p_starts_on date, p_ends_on date
) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  return public.create_campus_school_term(public.default_campus_id(), p_year, p_term, p_name, p_starts_on, p_ends_on);
end
$$;

create or replace function public.activate_school_term(p_term_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); target public.school_terms;
begin
  if uid is null or not public.has_perm(uid, 'schedule.manage') then raise exception 'FORBIDDEN'; end if;
  select * into target from public.school_terms where id = p_term_id for update;
  if target.id is null then raise exception 'NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtext('school-term:' || target.campus_id::text));
  update public.school_terms set is_current = false where campus_id = target.campus_id and is_current and id <> target.id;
  update public.school_terms set is_current = true where id = target.id;
  insert into public.student_grade_history(student_id, term_id, grade, recorded_by)
  select id, target.id, grade, uid from public.students where deleted_at is null and grade is not null
  on conflict(student_id, term_id) do nothing;
  perform public.emit_domain_event('school_term.activated', 'school_term', target.id,
    jsonb_build_object('campusId', target.campus_id, 'year', target.year, 'term', target.term, 'name', target.name), null, null);
end
$$;

-- ---------------------------------------------------------------------------
-- 4. 管理 RPC：校验、版本写入、回滚与聚合读取。
-- ---------------------------------------------------------------------------

create or replace function public.assert_organization_manager()
returns uuid language plpgsql security definer stable set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(auth.uid(), 'organization.settings.manage') then raise exception 'FORBIDDEN'; end if;
  return auth.uid();
end
$$;

create or replace function public.validate_organization_rule(p_domain text, p_value jsonb)
returns boolean language plpgsql immutable
as $$
begin
  if jsonb_typeof(p_value) <> 'object' or octet_length(p_value::text) > 16384 then return false; end if;
  return case p_domain
    when 'calendar' then
      (p_value ->> 'teachingWeekStartsOn') ~ '^[1-7]$'
      and jsonb_typeof(p_value -> 'weekendDays') = 'array'
      and jsonb_array_length(p_value -> 'weekendDays') between 0 and 7
    when 'lesson' then
      (p_value ->> 'defaultDurationMinutes') ~ '^\d+$'
      and (p_value ->> 'defaultDurationMinutes')::int between 15 and 300
      and (p_value ->> 'billingUnitLessons') ~ '^\d+(\.\d+)?$'
      and (p_value ->> 'billingUnitLessons')::numeric between 0.25 and 10
    when 'scheduling' then
      (p_value ->> 'minBreakMinutes') ~ '^\d+$'
      and (p_value ->> 'minBreakMinutes')::int between 0 and 180
      and p_value ->> 'conflictPolicy' in ('block', 'warn')
    when 'notification' then
      jsonb_typeof(p_value -> 'inAppEnabled') = 'boolean'
      and jsonb_typeof(p_value -> 'emailEnabled') = 'boolean'
      and jsonb_typeof(p_value -> 'smsEnabled') = 'boolean'
      and jsonb_typeof(p_value -> 'wechatEnabled') = 'boolean'
    when 'finance' then
      p_value ->> 'currency' = 'CNY'
      and jsonb_typeof(p_value -> 'refundRequiresApproval') = 'boolean'
    when 'public_publishing' then
      p_value ->> 'defaultLocale' in ('zh', 'en')
      and jsonb_typeof(p_value -> 'requiresReview') = 'boolean'
    else false
  end;
exception when others then
  return false;
end
$$;

create or replace function public.update_organization_profile(p_name text, p_timezone text, p_default_locale text)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := public.assert_organization_manager(); target public.organizations; old_value jsonb;
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 100
     or char_length(coalesce(p_timezone, '')) not between 1 and 64
     or p_default_locale not in ('zh', 'en')
     or not exists(select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'INVALID_ORGANIZATION';
  end if;
  select * into target from public.organizations where singleton_key = 1 for update;
  old_value := jsonb_build_object('name', target.name, 'timezone', target.timezone, 'defaultLocale', target.default_locale);
  update public.organizations set name = btrim(p_name), timezone = p_timezone, default_locale = p_default_locale, updated_by = uid
   where id = target.id;
  perform public.emit_domain_event('organization.updated', 'organization', target.id,
    jsonb_build_object('oldValue', old_value, 'newValue', jsonb_build_object('name', btrim(p_name), 'timezone', p_timezone, 'defaultLocale', p_default_locale)), null, null);
end
$$;

create or replace function public.create_campus(p_code text, p_name text, p_timezone text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := public.assert_organization_manager(); organization_uuid uuid; campus_uuid uuid; clean_code text := lower(btrim(coalesce(p_code, '')));
begin
  if clean_code !~ '^[a-z][a-z0-9-]{1,39}$' or char_length(btrim(coalesce(p_name, ''))) not between 1 and 100
     or (p_timezone is not null and not exists(select 1 from pg_timezone_names where name = p_timezone)) then raise exception 'INVALID_CAMPUS'; end if;
  select id into organization_uuid from public.organizations where singleton_key = 1;
  insert into public.campuses(organization_id, code, name, timezone, created_by, updated_by)
  values(organization_uuid, clean_code, btrim(p_name), nullif(p_timezone, ''), uid, uid) returning id into campus_uuid;
  perform public.emit_domain_event('campus.created', 'campus', campus_uuid,
    jsonb_build_object('code', clean_code, 'name', btrim(p_name)), null, null);
  return campus_uuid;
end
$$;

create or replace function public.update_campus(
  p_campus_id uuid, p_name text, p_timezone text, p_status text, p_is_default boolean
) returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := public.assert_organization_manager(); target public.campuses; old_value jsonb;
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 100 or p_status not in ('active', 'archived')
     or (nullif(p_timezone, '') is not null and not exists(select 1 from pg_timezone_names where name = p_timezone)) then raise exception 'INVALID_CAMPUS'; end if;
  select * into target from public.campuses where id = p_campus_id for update;
  if target.id is null then raise exception 'NOT_FOUND'; end if;
  if target.is_default and p_status = 'archived' then raise exception 'DEFAULT_CAMPUS_REQUIRED'; end if;
  if coalesce(p_is_default, false) and p_status <> 'active' then raise exception 'DEFAULT_CAMPUS_REQUIRED'; end if;
  old_value := jsonb_build_object('name', target.name, 'timezone', target.timezone, 'status', target.status, 'isDefault', target.is_default);
  if coalesce(p_is_default, false) then update public.campuses set is_default = false where organization_id = target.organization_id and id <> target.id; end if;
  update public.campuses set name = btrim(p_name), timezone = nullif(p_timezone, ''), status = p_status,
    is_default = coalesce(p_is_default, false), updated_by = uid where id = target.id;
  perform public.emit_domain_event('campus.updated', 'campus', target.id,
    jsonb_build_object('oldValue', old_value, 'newValue', jsonb_build_object('name', btrim(p_name), 'timezone', nullif(p_timezone, ''), 'status', p_status, 'isDefault', coalesce(p_is_default, false))), null, null);
end
$$;

create or replace function public.create_campus_room(p_campus_id uuid, p_code text, p_name text, p_capacity integer default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := public.assert_organization_manager(); room_uuid uuid; clean_code text := btrim(coalesce(p_code, ''));
begin
  if not exists(select 1 from public.campuses where id = p_campus_id and status = 'active')
     or clean_code !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$'
     or char_length(btrim(coalesce(p_name, ''))) not between 1 and 100
     or (p_capacity is not null and p_capacity not between 1 and 500) then raise exception 'INVALID_ROOM'; end if;
  insert into public.campus_rooms(campus_id, code, name, capacity, created_by, updated_by)
  values(p_campus_id, clean_code, btrim(p_name), p_capacity, uid, uid) returning id into room_uuid;
  perform public.emit_domain_event('campus_room.created', 'campus_room', room_uuid,
    jsonb_build_object('campusId', p_campus_id, 'code', clean_code, 'name', btrim(p_name), 'capacity', p_capacity), null, null);
  return room_uuid;
end
$$;

create or replace function public.set_campus_room_active(p_room_id uuid, p_is_active boolean)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := public.assert_organization_manager(); target public.campus_rooms;
begin
  select * into target from public.campus_rooms where id = p_room_id for update;
  if target.id is null then raise exception 'NOT_FOUND'; end if;
  update public.campus_rooms set is_active = coalesce(p_is_active, false), updated_by = uid where id = target.id;
  perform public.emit_domain_event('campus_room.updated', 'campus_room', target.id,
    jsonb_build_object('oldValue', jsonb_build_object('isActive', target.is_active), 'newValue', jsonb_build_object('isActive', coalesce(p_is_active, false))), null, null);
end
$$;

create or replace function public.create_school_holiday(
  p_campus_id uuid, p_name text, p_kind text, p_starts_on date, p_ends_on date
) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := public.assert_organization_manager(); organization_uuid uuid; holiday_uuid uuid;
begin
  if p_campus_id is not null and not exists(select 1 from public.campuses where id = p_campus_id) then raise exception 'INVALID_CAMPUS'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 100 or p_kind not in ('closed', 'teaching', 'makeup') or p_ends_on < p_starts_on then raise exception 'INVALID_HOLIDAY'; end if;
  select id into organization_uuid from public.organizations where singleton_key = 1;
  insert into public.school_holidays(organization_id, campus_id, name, kind, starts_on, ends_on, created_by, updated_by)
  values(organization_uuid, p_campus_id, btrim(p_name), p_kind, p_starts_on, p_ends_on, uid, uid) returning id into holiday_uuid;
  perform public.emit_domain_event('school_holiday.created', 'school_holiday', holiday_uuid,
    jsonb_build_object('campusId', p_campus_id, 'name', btrim(p_name), 'kind', p_kind, 'startsOn', p_starts_on, 'endsOn', p_ends_on), null, null);
  return holiday_uuid;
end
$$;

create or replace function public.archive_school_holiday(p_holiday_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := public.assert_organization_manager(); target public.school_holidays;
begin
  select * into target from public.school_holidays where id = p_holiday_id and archived_at is null for update;
  if target.id is null then raise exception 'NOT_FOUND'; end if;
  update public.school_holidays set archived_at = now(), updated_by = uid where id = target.id;
  perform public.emit_domain_event('school_holiday.archived', 'school_holiday', target.id,
    jsonb_build_object('name', target.name, 'startsOn', target.starts_on, 'endsOn', target.ends_on), null, null);
end
$$;

create or replace function public.set_organization_rule(
  p_domain text, p_campus_id uuid, p_value jsonb, p_effective_from timestamptz, p_reason text
) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := public.assert_organization_manager(); organization_uuid uuid; previous_row public.organization_rule_versions; next_version integer; new_id uuid;
begin
  if not public.validate_organization_rule(p_domain, p_value)
     or p_effective_from < now() - interval '5 minutes'
     or char_length(btrim(coalesce(p_reason, ''))) not between 1 and 200 then raise exception 'INVALID_RULE'; end if;
  if p_campus_id is not null and not exists(select 1 from public.campuses where id = p_campus_id) then raise exception 'INVALID_CAMPUS'; end if;
  select id into organization_uuid from public.organizations where singleton_key = 1;
  perform pg_advisory_xact_lock(hashtext('organization-rule:' || p_domain || ':' || coalesce(p_campus_id::text, 'global')));
  select * into previous_row from public.organization_rule_versions
   where organization_id = organization_uuid and campus_id is not distinct from p_campus_id
     and domain = p_domain and effective_from <= p_effective_from
     and (effective_until is null or effective_until > p_effective_from)
   order by effective_from desc, version desc limit 1;
  select coalesce(max(version), 0) + 1 into next_version from public.organization_rule_versions
   where organization_id = organization_uuid and campus_id is not distinct from p_campus_id and domain = p_domain;
  if previous_row.id is not null and previous_row.effective_from < p_effective_from then
    update public.organization_rule_versions set effective_until = p_effective_from where id = previous_row.id;
  end if;
  insert into public.organization_rule_versions(organization_id, campus_id, domain, version, value, effective_from, supersedes_id, reason, created_by)
  values(organization_uuid, p_campus_id, p_domain, next_version, p_value, p_effective_from, previous_row.id, btrim(p_reason), uid)
  returning id into new_id;
  perform public.emit_domain_event('organization_rule.versioned', 'organization_rule', new_id,
    jsonb_build_object('domain', p_domain, 'campusId', p_campus_id, 'version', next_version, 'effectiveFrom', p_effective_from,
      'oldValue', previous_row.value, 'newValue', p_value, 'reason', btrim(p_reason)), null, null);
  return new_id;
end
$$;

create or replace function public.rollback_organization_rule(p_version_id uuid, p_effective_from timestamptz, p_reason text)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare target public.organization_rule_versions;
begin
  perform public.assert_organization_manager();
  select * into target from public.organization_rule_versions where id = p_version_id;
  if target.id is null then raise exception 'NOT_FOUND'; end if;
  return public.set_organization_rule(target.domain, target.campus_id, target.value, p_effective_from, p_reason);
end
$$;

create or replace function public.set_feature_flag(
  p_flag_key text, p_campus_id uuid, p_enabled boolean, p_effective_from timestamptz, p_reason text
) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := public.assert_organization_manager(); organization_uuid uuid; previous_row public.feature_flag_versions; next_version integer; new_id uuid;
begin
  if not (p_flag_key = any(public.organization_feature_keys()))
     or p_effective_from < now() - interval '5 minutes'
     or char_length(btrim(coalesce(p_reason, ''))) not between 1 and 200 then raise exception 'INVALID_FEATURE_FLAG'; end if;
  if p_campus_id is not null and not exists(select 1 from public.campuses where id = p_campus_id) then raise exception 'INVALID_CAMPUS'; end if;
  select id into organization_uuid from public.organizations where singleton_key = 1;
  perform pg_advisory_xact_lock(hashtext('feature-flag:' || p_flag_key || ':' || coalesce(p_campus_id::text, 'global')));
  select * into previous_row from public.feature_flag_versions
   where organization_id = organization_uuid and campus_id is not distinct from p_campus_id
     and flag_key = p_flag_key and effective_from <= p_effective_from
     and (effective_until is null or effective_until > p_effective_from)
   order by effective_from desc, version desc limit 1;
  select coalesce(max(version), 0) + 1 into next_version from public.feature_flag_versions
   where organization_id = organization_uuid and campus_id is not distinct from p_campus_id and flag_key = p_flag_key;
  if previous_row.id is not null and previous_row.effective_from < p_effective_from then
    update public.feature_flag_versions set effective_until = p_effective_from where id = previous_row.id;
  end if;
  insert into public.feature_flag_versions(organization_id, campus_id, flag_key, version, enabled, effective_from, supersedes_id, reason, created_by)
  values(organization_uuid, p_campus_id, p_flag_key, next_version, coalesce(p_enabled, false), p_effective_from, previous_row.id, btrim(p_reason), uid)
  returning id into new_id;
  perform public.emit_domain_event('feature_flag.versioned', 'feature_flag', new_id,
    jsonb_build_object('flagKey', p_flag_key, 'campusId', p_campus_id, 'version', next_version, 'effectiveFrom', p_effective_from,
      'oldValue', previous_row.enabled, 'newValue', coalesce(p_enabled, false), 'reason', btrim(p_reason)), null, null);
  return new_id;
end
$$;

create or replace function public.rollback_feature_flag(p_version_id uuid, p_effective_from timestamptz, p_reason text)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare target public.feature_flag_versions;
begin
  perform public.assert_organization_manager();
  select * into target from public.feature_flag_versions where id = p_version_id;
  if target.id is null then raise exception 'NOT_FOUND'; end if;
  return public.set_feature_flag(target.flag_key, target.campus_id, target.enabled, p_effective_from, p_reason);
end
$$;

create or replace function public.get_organization_settings()
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp
as $$
declare organization_row public.organizations;
begin
  perform public.assert_organization_manager();
  select * into organization_row from public.organizations where singleton_key = 1;
  return jsonb_build_object(
    'organization', jsonb_build_object('id', organization_row.id, 'code', organization_row.code, 'name', organization_row.name,
      'timezone', organization_row.timezone, 'defaultLocale', organization_row.default_locale, 'updatedAt', organization_row.updated_at),
    'campuses', coalesce((select jsonb_agg(jsonb_build_object('id', campus_row.id, 'code', campus_row.code, 'name', campus_row.name,
      'timezone', campus_row.timezone, 'status', campus_row.status, 'isDefault', campus_row.is_default, 'updatedAt', campus_row.updated_at,
      'rooms', coalesce((select jsonb_agg(jsonb_build_object('id', room_row.id, 'code', room_row.code, 'name', room_row.name,
        'capacity', room_row.capacity, 'isActive', room_row.is_active) order by room_row.name) from public.campus_rooms room_row where room_row.campus_id = campus_row.id), '[]'::jsonb))
      order by campus_row.is_default desc, campus_row.name) from public.campuses campus_row where campus_row.organization_id = organization_row.id), '[]'::jsonb),
    'holidays', coalesce((select jsonb_agg(jsonb_build_object('id', holiday_row.id, 'campusId', holiday_row.campus_id, 'name', holiday_row.name,
      'kind', holiday_row.kind, 'startsOn', holiday_row.starts_on, 'endsOn', holiday_row.ends_on, 'createdAt', holiday_row.created_at)
      order by holiday_row.starts_on desc) from public.school_holidays holiday_row where holiday_row.organization_id = organization_row.id and holiday_row.archived_at is null), '[]'::jsonb),
    'terms', coalesce((select jsonb_agg(jsonb_build_object('id', term_row.id, 'campusId', term_row.campus_id, 'year', term_row.year,
      'term', term_row.term, 'name', term_row.name, 'startsOn', term_row.starts_on, 'endsOn', term_row.ends_on, 'isCurrent', term_row.is_current)
      order by term_row.starts_on desc) from public.school_terms term_row), '[]'::jsonb),
    'rules', coalesce((select jsonb_agg(jsonb_build_object('id', version_row.id, 'campusId', version_row.campus_id, 'domain', version_row.domain,
      'version', version_row.version, 'value', version_row.value, 'effectiveFrom', version_row.effective_from, 'effectiveUntil', version_row.effective_until,
      'reason', version_row.reason, 'createdAt', version_row.created_at, 'createdBy', coalesce(profile_row.display_name, ''))
      order by version_row.domain, version_row.campus_id nulls first, version_row.version desc)
      from public.organization_rule_versions version_row left join public.profiles profile_row on profile_row.id = version_row.created_by
      where version_row.organization_id = organization_row.id), '[]'::jsonb),
    'featureFlags', coalesce((select jsonb_agg(jsonb_build_object('id', flag_row.id, 'campusId', flag_row.campus_id, 'flagKey', flag_row.flag_key,
      'version', flag_row.version, 'enabled', flag_row.enabled, 'effectiveFrom', flag_row.effective_from, 'effectiveUntil', flag_row.effective_until,
      'reason', flag_row.reason, 'createdAt', flag_row.created_at, 'createdBy', coalesce(profile_row.display_name, ''))
      order by flag_row.flag_key, flag_row.campus_id nulls first, flag_row.version desc)
      from public.feature_flag_versions flag_row left join public.profiles profile_row on profile_row.id = flag_row.created_by
      where flag_row.organization_id = organization_row.id), '[]'::jsonb),
    'changeToken', greatest(organization_row.updated_at,
      coalesce((select max(updated_at) from public.campuses), organization_row.updated_at),
      coalesce((select max(created_at) from public.organization_rule_versions), organization_row.updated_at),
      coalesce((select max(created_at) from public.feature_flag_versions), organization_row.updated_at))
  );
end
$$;

-- 顾客白名单 RPC 也要服从财务开关；关闭后即使直接调用也只返回空集合。
create or replace function public.get_my_orders()
returns table(order_id uuid, order_no text, classroom_name text, kind text, amount_original numeric, amount_discount numeric, amount_due numeric, status text, created_at timestamptz, paid_total numeric, items jsonb)
language sql security definer stable set search_path = public, pg_temp
as $$
  select order_row.id, order_row.order_no, classroom_row.name, order_row.kind, order_row.amount_original, order_row.amount_discount,
    order_row.amount_due, order_row.status, order_row.created_at,
    coalesce((select sum(payment_row.amount) from public.payments payment_row where payment_row.order_id = order_row.id), 0),
    coalesce((select jsonb_agg(jsonb_build_object('name', item_row.name, 'unitPrice', item_row.unit_price, 'qty', item_row.qty) order by item_row.name)
      from public.order_items item_row where item_row.order_id = order_row.id), '[]'::jsonb)
  from public.orders order_row
  left join public.classrooms classroom_row on classroom_row.id = order_row.classroom_id
  join public.students student_row on student_row.id = order_row.student_id
  where public.is_feature_enabled('finance.enabled')
    and (student_row.user_id = auth.uid() or public.guardian_can(student_row.id, auth.uid(), 'finance'))
  order by order_row.created_at desc
$$;

create or replace function public.get_my_account()
returns table(student_id uuid, student_name text, balance numeric, ledger jsonb)
language sql security definer stable set search_path = public, pg_temp
as $$
  select student_row.id, student_row.name, coalesce(account_row.balance, 0),
    coalesce((select jsonb_agg(jsonb_build_object('delta', ledger_row.delta, 'reason', ledger_row.reason, 'createdAt', ledger_row.created_at) order by ledger_row.created_at desc)
      from (select * from public.account_ledger where student_id = student_row.id order by created_at desc limit 50) ledger_row), '[]'::jsonb)
  from public.students student_row
  left join public.student_accounts account_row on account_row.student_id = student_row.id
  where public.is_feature_enabled('finance.enabled')
    and (student_row.user_id = auth.uid() or public.guardian_can(student_row.id, auth.uid(), 'finance'))
$$;

-- ---------------------------------------------------------------------------
-- 5. RLS、最小授权与可调用面。
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.campuses enable row level security;
alter table public.campus_rooms enable row level security;
alter table public.school_holidays enable row level security;
alter table public.organization_rule_versions enable row level security;
alter table public.feature_flag_versions enable row level security;

create policy organizations_rpc_only on public.organizations for all using (false) with check (false);
create policy campuses_rpc_only on public.campuses for all using (false) with check (false);
create policy campus_rooms_rpc_only on public.campus_rooms for all using (false) with check (false);
create policy school_holidays_rpc_only on public.school_holidays for all using (false) with check (false);
create policy organization_rule_versions_rpc_only on public.organization_rule_versions for all using (false) with check (false);
create policy feature_flag_versions_rpc_only on public.feature_flag_versions for all using (false) with check (false);

revoke all on public.organizations, public.campuses, public.campus_rooms, public.school_holidays,
  public.organization_rule_versions, public.feature_flag_versions from public, anon, authenticated;

revoke all on function public.organization_feature_keys() from public;
revoke all on function public.is_feature_enabled(text, uuid, timestamptz) from public;
revoke all on function public.get_effective_organization_rule(text, uuid, timestamptz) from public;
revoke all on function public.get_my_permission_keys() from public;
revoke all on function public.default_campus_id() from public;
revoke all on function public.current_school_term_id(uuid) from public;
revoke all on function public.create_campus_school_term(uuid, int, smallint, text, date, date) from public;
revoke all on function public.assert_organization_manager() from public;
revoke all on function public.validate_organization_rule(text, jsonb) from public;
revoke all on function public.update_organization_profile(text, text, text) from public;
revoke all on function public.create_campus(text, text, text) from public;
revoke all on function public.update_campus(uuid, text, text, text, boolean) from public;
revoke all on function public.create_campus_room(uuid, text, text, integer) from public;
revoke all on function public.set_campus_room_active(uuid, boolean) from public;
revoke all on function public.create_school_holiday(uuid, text, text, date, date) from public;
revoke all on function public.archive_school_holiday(uuid) from public;
revoke all on function public.set_organization_rule(text, uuid, jsonb, timestamptz, text) from public;
revoke all on function public.rollback_organization_rule(uuid, timestamptz, text) from public;
revoke all on function public.set_feature_flag(text, uuid, boolean, timestamptz, text) from public;
revoke all on function public.rollback_feature_flag(uuid, timestamptz, text) from public;
revoke all on function public.get_organization_settings() from public;

grant execute on function public.organization_feature_keys() to authenticated;
grant execute on function public.is_feature_enabled(text, uuid, timestamptz) to anon, authenticated;
grant execute on function public.get_effective_organization_rule(text, uuid, timestamptz) to authenticated;
grant execute on function public.get_my_permission_keys() to authenticated;
grant execute on function public.default_campus_id() to authenticated;
grant execute on function public.current_school_term_id(uuid) to authenticated;
grant execute on function public.create_campus_school_term(uuid, int, smallint, text, date, date) to authenticated;
grant execute on function public.update_organization_profile(text, text, text) to authenticated;
grant execute on function public.create_campus(text, text, text) to authenticated;
grant execute on function public.update_campus(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.create_campus_room(uuid, text, text, integer) to authenticated;
grant execute on function public.set_campus_room_active(uuid, boolean) to authenticated;
grant execute on function public.create_school_holiday(uuid, text, text, date, date) to authenticated;
grant execute on function public.archive_school_holiday(uuid) to authenticated;
grant execute on function public.set_organization_rule(text, uuid, jsonb, timestamptz, text) to authenticated;
grant execute on function public.rollback_organization_rule(uuid, timestamptz, text) to authenticated;
grant execute on function public.set_feature_flag(text, uuid, boolean, timestamptz, text) to authenticated;
grant execute on function public.rollback_feature_flag(uuid, timestamptz, text) to authenticated;
grant execute on function public.get_organization_settings() to authenticated;

comment on table public.organization_rule_versions is 'R1-1 append-only rule values; effective_until is the only mutable interval boundary';
comment on table public.feature_flag_versions is 'R1-1 append-only fail-closed feature flags; rollback creates another version';
comment on function public.is_feature_enabled(text, uuid, timestamptz) is 'Unknown, absent or not-yet-effective flags always resolve false';
