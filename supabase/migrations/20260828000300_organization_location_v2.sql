-- DEV-ORG-1: organization profile and structured campus/room locations.
--
-- This is the compatibility migration. Legacy codes, campus timezone/default
-- columns, classrooms.room and the V1 RPCs stay in place for one rollback
-- window. V2 writes use opaque UUIDs and keep the legacy room text in sync.

begin;

-- ---------------------------------------------------------------------------
-- 1. Permission split and additive schema.
-- ---------------------------------------------------------------------------

create or replace function public.school_permission_keys()
returns text[] language sql immutable
as $$
  select array[
    'student.view.all','student.view.assigned','student.edit','student.create','student.assign','student.import','student.delete',
    'followup.view','followup.write','activity.manage','activity.register','review.write','video.review',
    'course.view','course.manage','course.view.all','course.product.create','course.assignment.manage',
    'courseware.template.edit','courseware.overlay.edit','courseware.microcourse.author','courseware.page.edit','courseware.asset.manage',
    'courseware.release.publish','courseware.review','courseware.emergency_publish',
    'class.view.all','class.view.mine','class.create','class.manage','enrollment.manage',
    'schedule.view.all','schedule.manage','attendance.mark','grading.write','report.view.all','session.void','session.postwork.manage',
    'finance.order.view','finance.order.create','finance.payment.record','finance.refund.request','finance.refund.approve',
    'finance.coupon.manage','finance.scholarship.grant','finance.account.adjust','finance.report.view',
    'staff.manage','permission.configure','registration.invite.manage','organization.settings.manage',
    'organization.profile.manage','location.manage','system.operations.manage',
    'account.support.manage','work_item.manage','approval.manage','audit.view','testdata.purge'
  ]::text[]
$$;

insert into public.role_permissions(role_id, perm_key)
select distinct permission_row.role_id, split_permission.perm_key
from public.role_permissions permission_row
cross join (values ('organization.profile.manage'), ('location.manage')) split_permission(perm_key)
where permission_row.perm_key = 'organization.settings.manage'
on conflict do nothing;

alter table public.organizations
  add column if not exists default_lesson_duration_min smallint not null default 90;
alter table public.organizations
  drop constraint if exists organizations_default_lesson_duration_check;
alter table public.organizations
  add constraint organizations_default_lesson_duration_check
  check (default_lesson_duration_min between 15 and 300);

alter table public.campuses add column if not exists address text;
alter table public.campuses drop constraint if exists campuses_address_check;
alter table public.campuses add constraint campuses_address_check
  check (address is null or char_length(address) <= 500);

alter table public.campus_rooms add column if not exists status text not null default 'active';
update public.campus_rooms set status = case when is_active then 'active' else 'inactive' end;
alter table public.campus_rooms drop constraint if exists campus_rooms_status_check;
alter table public.campus_rooms add constraint campus_rooms_status_check
  check (status in ('active', 'inactive'));

create unique index if not exists campuses_name_ci_unique_idx
  on public.campuses(organization_id, lower(btrim(name)));
create unique index if not exists campus_rooms_name_ci_unique_idx
  on public.campus_rooms(campus_id, lower(btrim(name)));

alter table public.classrooms
  add column if not exists default_room_id uuid references public.campus_rooms(id) on delete restrict;
alter table public.class_sessions
  add column if not exists room_id uuid references public.campus_rooms(id) on delete restrict,
  add column if not exists room_assignment_origin text not null default 'class_default';
alter table public.class_sessions drop constraint if exists class_sessions_room_assignment_origin_check;
alter table public.class_sessions add constraint class_sessions_room_assignment_origin_check
  check (room_assignment_origin in ('class_default', 'session_override'));

create index if not exists classrooms_default_room_idx
  on public.classrooms(default_room_id) where default_room_id is not null;
create index if not exists class_sessions_room_schedule_idx
  on public.class_sessions(room_id, scheduled_at) where room_id is not null and deleted_at is null;

grant select (default_room_id) on public.classrooms to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Internal compatibility helpers and fail-closed preflight.
-- ---------------------------------------------------------------------------

create or replace function public.internal_location_code_v2(p_prefix text)
returns text language sql volatile
set search_path = public, pg_temp
as $$
  select lower(left(regexp_replace(coalesce(p_prefix, 'loc'), '[^a-zA-Z0-9]+', '-', 'g'), 12))
    || '-' || substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 12)
$$;

create or replace function public.resolve_legacy_room_v2(
  p_room_text text,
  p_allow_single_campus_create boolean default false
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  clean_name text := btrim(coalesce(p_room_text, ''));
  matched_ids uuid[];
  active_campus_ids uuid[];
  result_id uuid;
begin
  if clean_name = '' then return null; end if;

  select array_agg(room_row.id order by room_row.id)
    into matched_ids
    from public.campus_rooms room_row
   where lower(btrim(room_row.name)) = lower(clean_name)
      or lower(btrim(room_row.code)) = lower(clean_name);

  if coalesce(cardinality(matched_ids), 0) = 1 then return matched_ids[1]; end if;
  if coalesce(cardinality(matched_ids), 0) > 1 then
    raise exception 'AMBIGUOUS_LEGACY_ROOM: %', clean_name;
  end if;
  if not coalesce(p_allow_single_campus_create, false) then return null; end if;

  select array_agg(campus_row.id order by campus_row.id)
    into active_campus_ids
    from public.campuses campus_row
   where campus_row.status = 'active';
  if coalesce(cardinality(active_campus_ids), 0) <> 1 then
    raise exception 'UNRESOLVED_LEGACY_ROOM: %', clean_name;
  end if;

  insert into public.campus_rooms(
    campus_id, code, name, capacity, is_active, status, created_by, updated_by
  ) values (
    active_campus_ids[1], public.internal_location_code_v2('room'), clean_name,
    null, true, 'active', auth.uid(), auth.uid()
  ) returning id into result_id;
  return result_id;
end
$$;

do $$
declare
  override_summary jsonb;
  duplicate_summary jsonb;
  legacy_summary jsonb;
  duplicate_row record;
  signature_count integer;
begin
  select jsonb_build_object(
    'activeCampusRules', (select count(*) from public.organization_rule_versions
      where campus_id is not null and effective_from <= now()
        and (effective_until is null or effective_until > now())),
    'activeCampusFlags', (select count(*) from public.feature_flag_versions
      where campus_id is not null and effective_from <= now()
        and (effective_until is null or effective_until > now()))
  ) into override_summary;

  if (override_summary ->> 'activeCampusRules')::int > 0
     or (override_summary ->> 'activeCampusFlags')::int > 0 then
    raise exception 'ACTIVE_CAMPUS_OVERRIDE_REQUIRES_MAPPING: %', override_summary;
  end if;

  select coalesce(jsonb_agg(item), '[]'::jsonb) into duplicate_summary
  from (
    select jsonb_build_object('startYear', start_year, 'count', count(*)) item
      from public.school_years group by start_year having count(*) > 1
  ) duplicates;
  for duplicate_row in
    select start_year from public.school_years group by start_year having count(*) > 1
  loop
    select count(distinct signature::text) into signature_count
      from (
        select jsonb_build_object(
          'name', year_row.name,
          'status', year_row.status,
          'gradeEffectiveOn', year_row.grade_effective_on,
          'periods', coalesce((
            select jsonb_agg(jsonb_build_object(
              'term', term_row.term,
              'name', term_row.name,
              'startsOn', term_row.starts_on,
              'endsOn', term_row.ends_on,
              'isCurrent', term_row.is_current
            ) order by term_row.term)
              from public.school_terms term_row
             where term_row.school_year_id = year_row.id
          ), '[]'::jsonb)
        ) signature
          from public.school_years year_row
         where year_row.start_year = duplicate_row.start_year
      ) signatures;
    if signature_count <> 1 then
      raise exception 'DUPLICATE_SCHOOL_YEAR_REQUIRES_ORG_MERGE: %', duplicate_summary;
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'roomText', room_text,
    'classroomCount', classroom_count,
    'candidateCount', candidate_count
  ) order by room_text), '[]'::jsonb)
  into legacy_summary
  from (
    select grouped.room_text,
           grouped.classroom_count,
           (select count(*) from public.campus_rooms room_row
             where lower(btrim(room_row.name)) = lower(grouped.room_text)
                or lower(btrim(room_row.code)) = lower(grouped.room_text)) candidate_count
      from (
        select btrim(classroom_row.room) room_text, count(*) classroom_count
          from public.classrooms classroom_row
         where nullif(btrim(coalesce(classroom_row.room, '')), '') is not null
         group by btrim(classroom_row.room)
      ) grouped
  ) legacy;
  raise notice 'DEV_ORG_LOCATION_V2_PREFLIGHT legacyRooms=% overrides=% schoolYearDuplicates=%',
    legacy_summary, override_summary, duplicate_summary;
end
$$;

-- Existing free text is either matched globally or, only when exactly one
-- active campus exists, materialized there. Any other unresolved value aborts
-- the migration before a business row is changed.
do $$
declare legacy_row record; resolved_room_id uuid;
begin
  for legacy_row in
    select distinct btrim(room) room_text
      from public.classrooms
     where nullif(btrim(coalesce(room, '')), '') is not null
     order by btrim(room)
  loop
    resolved_room_id := public.resolve_legacy_room_v2(legacy_row.room_text, true);
    update public.classrooms
       set default_room_id = resolved_room_id
     where lower(btrim(room)) = lower(legacy_row.room_text);
  end loop;
end
$$;

update public.class_sessions session_row
   set room_id = classroom_row.default_room_id,
       room_assignment_origin = 'class_default'
  from public.classrooms classroom_row
 where classroom_row.id = session_row.classroom_id;

-- ---------------------------------------------------------------------------
-- 3. Compatibility triggers: V1 text and V2 UUID stay coherent.
-- ---------------------------------------------------------------------------

create or replace function public.sync_campus_room_status_v2()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.status := coalesce(new.status, case when new.is_active then 'active' else 'inactive' end);
    new.is_active := new.status = 'active';
  elsif new.status is distinct from old.status then
    new.is_active := new.status = 'active';
  elsif new.is_active is distinct from old.is_active then
    new.status := case when new.is_active then 'active' else 'inactive' end;
  end if;
  return new;
end
$$;

drop trigger if exists campus_rooms_sync_status_v2 on public.campus_rooms;
create trigger campus_rooms_sync_status_v2
  before insert or update of status, is_active on public.campus_rooms
  for each row execute function public.sync_campus_room_status_v2();

create or replace function public.sync_classroom_room_compat_v2()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare resolved_id uuid; resolved_name text;
begin
  if tg_op = 'INSERT' then
    if new.default_room_id is not null then
      select room_row.name into resolved_name from public.campus_rooms room_row
       where room_row.id = new.default_room_id and room_row.status = 'active';
      if resolved_name is null then raise exception 'INVALID_ROOM'; end if;
      new.room := resolved_name;
    elsif nullif(btrim(coalesce(new.room, '')), '') is not null then
      resolved_id := public.resolve_legacy_room_v2(new.room, true);
      new.default_room_id := resolved_id;
      select name into new.room from public.campus_rooms where id = resolved_id;
    else
      new.default_room_id := null;
      new.room := '';
    end if;
    return new;
  end if;

  if new.default_room_id is distinct from old.default_room_id then
    if new.default_room_id is null then
      new.room := '';
    else
      select room_row.name into resolved_name from public.campus_rooms room_row
       where room_row.id = new.default_room_id and room_row.status = 'active';
      if resolved_name is null then raise exception 'INVALID_ROOM'; end if;
      new.room := resolved_name;
    end if;
  elsif new.room is distinct from old.room then
    if nullif(btrim(coalesce(new.room, '')), '') is null then
      new.default_room_id := null;
      new.room := '';
    elsif new.default_room_id is not null and exists (
      select 1 from public.campus_rooms room_row
       where room_row.id = new.default_room_id
         and lower(btrim(room_row.name)) = lower(btrim(new.room))
    ) then
      select name into new.room from public.campus_rooms where id = new.default_room_id;
    else
      resolved_id := public.resolve_legacy_room_v2(new.room, true);
      new.default_room_id := resolved_id;
      select name into new.room from public.campus_rooms where id = resolved_id;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists classrooms_sync_room_compat_v2 on public.classrooms;
create trigger classrooms_sync_room_compat_v2
  before insert or update of room, default_room_id on public.classrooms
  for each row execute function public.sync_classroom_room_compat_v2();

create or replace function public.copy_classroom_default_room_v2()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.room_assignment_origin = 'class_default' then
    select classroom_row.default_room_id into new.room_id
      from public.classrooms classroom_row where classroom_row.id = new.classroom_id;
  end if;
  return new;
end
$$;

drop trigger if exists class_sessions_copy_default_room_v2 on public.class_sessions;
create trigger class_sessions_copy_default_room_v2
  before insert on public.class_sessions
  for each row execute function public.copy_classroom_default_room_v2();

create or replace function public.propagate_room_name_compat_v2()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.name is distinct from old.name then
    update public.classrooms
       set room = new.name, default_room_id = new.id
     where default_room_id = new.id;
  end if;
  return new;
end
$$;

drop trigger if exists campus_rooms_propagate_name_v2 on public.campus_rooms;
create trigger campus_rooms_propagate_name_v2
  after update of name on public.campus_rooms
  for each row execute function public.propagate_room_name_compat_v2();

-- ---------------------------------------------------------------------------
-- 4. V2 organization and location read/write API. No code/default/timezone
-- compatibility fields are returned from these DTOs.
-- ---------------------------------------------------------------------------

create or replace function public.assert_organization_profile_manager_v2()
returns uuid language plpgsql security definer stable
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(auth.uid(), 'organization.profile.manage') then raise exception 'FORBIDDEN'; end if;
  return auth.uid();
end
$$;

create or replace function public.assert_location_manager_v2()
returns uuid language plpgsql security definer stable
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(auth.uid(), 'location.manage') then raise exception 'FORBIDDEN'; end if;
  return auth.uid();
end
$$;

create or replace function public.get_organization_profile_v2()
returns jsonb language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare organization_row public.organizations;
begin
  perform public.assert_organization_profile_manager_v2();
  select * into organization_row from public.organizations where singleton_key = 1;
  return jsonb_build_object(
    'id', organization_row.id,
    'name', organization_row.name,
    'timezone', organization_row.timezone,
    'updatedAt', organization_row.updated_at
  );
end
$$;

create or replace function public.update_organization_profile_v2(p_name text, p_timezone text)
returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := public.assert_organization_profile_manager_v2(); target public.organizations; old_value jsonb;
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 100
     or char_length(coalesce(p_timezone, '')) not between 1 and 64
     or not exists(select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'INVALID_ORGANIZATION';
  end if;
  select * into target from public.organizations where singleton_key = 1 for update;
  old_value := jsonb_build_object('name', target.name, 'timezone', target.timezone);
  update public.organizations
     set name = btrim(p_name), timezone = p_timezone, default_locale = 'zh', updated_by = uid
   where id = target.id;
  perform public.emit_domain_event('organization.profile.updated', 'organization', target.id,
    jsonb_build_object('oldValue', old_value, 'newValue',
      jsonb_build_object('name', btrim(p_name), 'timezone', p_timezone)), null, null);
end
$$;

create or replace function public.get_schedule_defaults_v2()
returns jsonb language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare duration_value smallint;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  select default_lesson_duration_min into duration_value
    from public.organizations where singleton_key = 1;
  return jsonb_build_object('defaultDurationMinutes', duration_value, 'conflictPolicy', 'warn');
end
$$;

create or replace function public.update_schedule_defaults_v2(p_default_duration_minutes smallint)
returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); organization_id_value uuid; old_duration smallint;
begin
  if uid is null or not public.has_perm(uid, 'schedule.manage') then raise exception 'FORBIDDEN'; end if;
  if p_default_duration_minutes not between 15 and 300 then raise exception 'VALIDATION'; end if;
  select id, default_lesson_duration_min into organization_id_value, old_duration
    from public.organizations where singleton_key = 1 for update;
  update public.organizations set default_lesson_duration_min = p_default_duration_minutes, updated_by = uid
   where id = organization_id_value;
  perform public.emit_domain_event('schedule.defaults.updated', 'organization', organization_id_value,
    jsonb_build_object('oldDurationMinutes', old_duration,
      'defaultDurationMinutes', p_default_duration_minutes, 'conflictPolicy', 'warn'), null, null);
end
$$;

create or replace function public.get_location_catalog_v2(p_include_inactive boolean default false)
returns jsonb language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare organization_id_value uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if coalesce(p_include_inactive, false)
     and not public.has_perm(auth.uid(), 'location.manage') then raise exception 'FORBIDDEN'; end if;
  select id into organization_id_value from public.organizations where singleton_key = 1;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', campus_row.id,
      'name', campus_row.name,
      'address', campus_row.address,
      'status', campus_row.status,
      'updatedAt', campus_row.updated_at,
      'rooms', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', room_row.id,
          'name', room_row.name,
          'capacity', room_row.capacity,
          'status', room_row.status,
          'updatedAt', room_row.updated_at
        ) order by lower(room_row.name), room_row.id)
        from public.campus_rooms room_row
        where room_row.campus_id = campus_row.id
          and (coalesce(p_include_inactive, false) or room_row.status = 'active')
      ), '[]'::jsonb)
    ) order by (campus_row.status = 'active') desc, lower(campus_row.name), campus_row.id)
    from public.campuses campus_row
    where campus_row.organization_id = organization_id_value
      and (coalesce(p_include_inactive, false) or campus_row.status = 'active')
  ), '[]'::jsonb);
end
$$;

create or replace function public.get_campus_v2(p_campus_id uuid)
returns jsonb language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  perform public.assert_location_manager_v2();
  select jsonb_build_object(
    'id', campus_row.id,
    'name', campus_row.name,
    'address', campus_row.address,
    'status', campus_row.status,
    'updatedAt', campus_row.updated_at,
    'rooms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', room_row.id,
        'name', room_row.name,
        'capacity', room_row.capacity,
        'status', room_row.status,
        'updatedAt', room_row.updated_at
      ) order by (room_row.status = 'active') desc, lower(room_row.name), room_row.id)
      from public.campus_rooms room_row where room_row.campus_id = campus_row.id
    ), '[]'::jsonb)
  ) into result
  from public.campuses campus_row where campus_row.id = p_campus_id;
  if result is null then raise exception 'NOT_FOUND'; end if;
  return result;
end
$$;

create or replace function public.list_room_options_v2(p_include_inactive boolean default false)
returns table(
  room_id uuid,
  room_name text,
  capacity integer,
  room_status text,
  campus_id uuid,
  campus_name text,
  campus_status text
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if coalesce(p_include_inactive, false)
     and not public.has_perm(auth.uid(), 'location.manage') then raise exception 'FORBIDDEN'; end if;
  return query
  select room_row.id, room_row.name, room_row.capacity, room_row.status,
         campus_row.id, campus_row.name, campus_row.status
    from public.campus_rooms room_row
    join public.campuses campus_row on campus_row.id = room_row.campus_id
   where coalesce(p_include_inactive, false)
      or (campus_row.status = 'active' and room_row.status = 'active')
   order by lower(campus_row.name), lower(room_row.name), room_row.id;
end
$$;

create or replace function public.create_campus_v2(p_name text, p_address text default null)
returns uuid language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := public.assert_location_manager_v2(); organization_id_value uuid; campus_id_value uuid;
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 100
     or char_length(coalesce(p_address, '')) > 500 then raise exception 'INVALID_CAMPUS'; end if;
  select id into organization_id_value from public.organizations where singleton_key = 1;
  insert into public.campuses(
    organization_id, code, name, address, timezone, status, is_default, created_by, updated_by
  ) values (
    organization_id_value, public.internal_location_code_v2('campus'), btrim(p_name),
    nullif(btrim(coalesce(p_address, '')), ''), null, 'active', false, uid, uid
  ) returning id into campus_id_value;
  perform public.emit_domain_event('campus.created', 'campus', campus_id_value,
    jsonb_build_object('name', btrim(p_name), 'address', nullif(btrim(coalesce(p_address, '')), '')), null, null);
  return campus_id_value;
exception when unique_violation then
  raise exception 'CAMPUS_NAME_EXISTS';
end
$$;

create or replace function public.create_campus_room_v2(
  p_campus_id uuid,
  p_name text,
  p_capacity integer default null
) returns uuid language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := public.assert_location_manager_v2(); room_id_value uuid;
begin
  if not exists(select 1 from public.campuses where id = p_campus_id and status = 'active')
     or char_length(btrim(coalesce(p_name, ''))) not between 1 and 100
     or (p_capacity is not null and p_capacity not between 1 and 500) then
    raise exception 'INVALID_ROOM';
  end if;
  insert into public.campus_rooms(
    campus_id, code, name, capacity, is_active, status, created_by, updated_by
  ) values (
    p_campus_id, public.internal_location_code_v2('room'), btrim(p_name), p_capacity,
    true, 'active', uid, uid
  ) returning id into room_id_value;
  perform public.emit_domain_event('campus_room.created', 'campus_room', room_id_value,
    jsonb_build_object('campusId', p_campus_id, 'name', btrim(p_name), 'capacity', p_capacity), null, null);
  return room_id_value;
exception when unique_violation then
  raise exception 'ROOM_NAME_EXISTS';
end
$$;

create or replace function public.update_campus_room_v2(
  p_room_id uuid,
  p_name text,
  p_capacity integer default null
) returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := public.assert_location_manager_v2(); target public.campus_rooms; old_value jsonb;
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 100
     or (p_capacity is not null and p_capacity not between 1 and 500) then raise exception 'INVALID_ROOM'; end if;
  select * into target from public.campus_rooms where id = p_room_id for update;
  if target.id is null then raise exception 'NOT_FOUND'; end if;
  old_value := jsonb_build_object('name', target.name, 'capacity', target.capacity);
  update public.campus_rooms
     set name = btrim(p_name), capacity = p_capacity, updated_by = uid
   where id = target.id;
  perform public.emit_domain_event('campus_room.updated', 'campus_room', target.id,
    jsonb_build_object('oldValue', old_value,
      'newValue', jsonb_build_object('name', btrim(p_name), 'capacity', p_capacity)), null, null);
exception when unique_violation then
  raise exception 'ROOM_NAME_EXISTS';
end
$$;

create or replace function public.get_location_impact_v2(p_entity_type text, p_entity_id uuid)
returns jsonb language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare room_ids uuid[]; room_count_value integer;
begin
  perform public.assert_location_manager_v2();
  if p_entity_type = 'room' then
    if not exists(select 1 from public.campus_rooms where id = p_entity_id) then raise exception 'NOT_FOUND'; end if;
    room_ids := array[p_entity_id];
  elsif p_entity_type = 'campus' then
    if not exists(select 1 from public.campuses where id = p_entity_id) then raise exception 'NOT_FOUND'; end if;
    select coalesce(array_agg(id), '{}'::uuid[]), count(*) into room_ids, room_count_value
      from public.campus_rooms where campus_id = p_entity_id;
  else
    raise exception 'VALIDATION';
  end if;

  return jsonb_build_object(
    'entityType', p_entity_type,
    'entityId', p_entity_id,
    'roomCount', coalesce(room_count_value, cardinality(room_ids), 0),
    'classDefaultCount', (select count(*) from public.classrooms
      where default_room_id = any(room_ids)),
    'unstartedSessionCount', (select count(*) from public.class_sessions
      where room_id = any(room_ids)
        and deleted_at is null and cancelled_by is null and voided_at is null
        and started_at is null and ended_at is null),
    'historicalSessionCount', (select count(*) from public.class_sessions
      where room_id = any(room_ids)
        and (started_at is not null or ended_at is not null
          or cancelled_by is not null or voided_at is not null))
  );
end
$$;

create or replace function public.clear_unstarted_room_references_v2(p_room_id uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update public.classrooms set default_room_id = null where default_room_id = p_room_id;
  update public.class_sessions
     set room_id = null
   where room_id = p_room_id
     and deleted_at is null and cancelled_by is null and voided_at is null
     and started_at is null and ended_at is null;
end
$$;

create or replace function public.clear_archived_campus_references_v2()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare room_row record;
begin
  if new.status = 'archived' and old.status is distinct from new.status then
    for room_row in select id from public.campus_rooms where campus_id = new.id
    loop
      perform public.clear_unstarted_room_references_v2(room_row.id);
    end loop;
    update public.campus_rooms
       set status = 'inactive', is_active = false, updated_by = coalesce(auth.uid(), updated_by)
     where campus_id = new.id and status <> 'inactive';
  end if;
  return new;
end
$$;

drop trigger if exists campuses_clear_references_v2 on public.campuses;
create trigger campuses_clear_references_v2
  after update of status on public.campuses
  for each row execute function public.clear_archived_campus_references_v2();

create or replace function public.clear_inactive_room_references_v2()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'inactive' and old.status is distinct from new.status then
    perform public.clear_unstarted_room_references_v2(new.id);
  end if;
  return new;
end
$$;

drop trigger if exists campus_rooms_clear_references_v2 on public.campus_rooms;
create trigger campus_rooms_clear_references_v2
  after update of status on public.campus_rooms
  for each row execute function public.clear_inactive_room_references_v2();

create or replace function public.set_campus_room_status_v2(
  p_room_id uuid,
  p_status text,
  p_expected_unstarted_session_count integer default null
) returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := public.assert_location_manager_v2(); target public.campus_rooms;
        actual_unstarted_count integer;
begin
  if p_status not in ('active', 'inactive') then raise exception 'VALIDATION'; end if;
  select * into target from public.campus_rooms where id = p_room_id for update;
  if target.id is null then raise exception 'NOT_FOUND'; end if;
  if p_status = 'active' and not exists (
    select 1 from public.campuses where id = target.campus_id and status = 'active'
  ) then raise exception 'CAMPUS_ARCHIVED'; end if;

  select count(*) into actual_unstarted_count from public.class_sessions
   where room_id = target.id
     and deleted_at is null and cancelled_by is null and voided_at is null
     and started_at is null and ended_at is null;
  if p_status = 'inactive' and p_expected_unstarted_session_count is not null
     and actual_unstarted_count <> p_expected_unstarted_session_count then
    raise exception 'LOCATION_IMPACT_STALE';
  end if;

  update public.campus_rooms
     set status = p_status, is_active = p_status = 'active', updated_by = uid
   where id = target.id;
  perform public.emit_domain_event('campus_room.status_updated', 'campus_room', target.id,
    jsonb_build_object('oldStatus', target.status, 'status', p_status,
      'clearedUnstartedSessionCount', case when p_status = 'inactive' then actual_unstarted_count else 0 end), null, null);
end
$$;

create or replace function public.update_campus_v2(
  p_campus_id uuid,
  p_name text,
  p_address text,
  p_status text,
  p_expected_unstarted_session_count integer default null
) returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := public.assert_location_manager_v2(); target public.campuses;
        actual_unstarted_count integer; old_value jsonb;
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 100
     or char_length(coalesce(p_address, '')) > 500
     or p_status not in ('active', 'archived') then raise exception 'INVALID_CAMPUS'; end if;
  select * into target from public.campuses where id = p_campus_id for update;
  if target.id is null then raise exception 'NOT_FOUND'; end if;

  select count(*) into actual_unstarted_count
    from public.class_sessions session_row
    join public.campus_rooms room_row on room_row.id = session_row.room_id
   where room_row.campus_id = target.id
     and session_row.deleted_at is null and session_row.cancelled_by is null and session_row.voided_at is null
     and session_row.started_at is null and session_row.ended_at is null;
  if p_status = 'archived' and p_expected_unstarted_session_count is not null
     and actual_unstarted_count <> p_expected_unstarted_session_count then
    raise exception 'LOCATION_IMPACT_STALE';
  end if;

  old_value := jsonb_build_object('name', target.name, 'address', target.address, 'status', target.status);
  update public.campuses
     set name = btrim(p_name), address = nullif(btrim(coalesce(p_address, '')), ''),
         status = p_status, timezone = null, updated_by = uid
   where id = target.id;
  perform public.emit_domain_event('campus.updated', 'campus', target.id,
    jsonb_build_object('oldValue', old_value,
      'newValue', jsonb_build_object('name', btrim(p_name),
        'address', nullif(btrim(coalesce(p_address, '')), ''), 'status', p_status),
      'clearedUnstartedSessionCount', case when p_status = 'archived' then actual_unstarted_count else 0 end), null, null);
exception when unique_violation then
  raise exception 'CAMPUS_NAME_EXISTS';
end
$$;

-- Keep the V1 room status RPC safe during the rollback window. Its visible
-- behavior is unchanged, while deactivation now performs the required cleanup.
create or replace function public.set_campus_room_active(p_room_id uuid, p_is_active boolean)
returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.set_campus_room_status_v2(
    p_room_id,
    case when coalesce(p_is_active, false) then 'active' else 'inactive' end,
    null
  );
end
$$;

create or replace function public.get_location_migration_preflight_v2()
returns jsonb language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); organization_id_value uuid;
begin
  if uid is null or not (
    public.has_perm(uid, 'audit.view')
    or public.has_perm(uid, 'system.operations.manage')
    or public.has_perm(uid, 'location.manage')
  ) then raise exception 'FORBIDDEN'; end if;
  select id into organization_id_value from public.organizations where singleton_key = 1;
  return jsonb_build_object(
    'activeCampusCount', (select count(*) from public.campuses where status = 'active'),
    'legacyRooms', coalesce((select jsonb_agg(jsonb_build_object(
      'roomText', legacy.room_text,
      'classroomCount', legacy.classroom_count,
      'candidateCount', legacy.candidate_count
    ) order by legacy.room_text) from (
      select grouped.room_text,
             grouped.classroom_count,
             (select count(*) from public.campus_rooms room_row
               where lower(btrim(room_row.name)) = lower(grouped.room_text)
                  or lower(btrim(room_row.code)) = lower(grouped.room_text)) candidate_count
        from (
          select btrim(classroom_row.room) room_text, count(*) classroom_count
            from public.classrooms classroom_row
           where nullif(btrim(coalesce(classroom_row.room, '')), '') is not null
           group by btrim(classroom_row.room)
        ) grouped
    ) legacy), '[]'::jsonb),
    'schoolYearDuplicates', coalesce((select jsonb_agg(jsonb_build_object(
      'startYear', duplicate.start_year, 'count', duplicate.year_count
    ) order by duplicate.start_year) from (
      select start_year, count(*) year_count from public.school_years
       group by start_year having count(*) > 1
    ) duplicate), '[]'::jsonb),
    'activeCampusRuleOverrides', (select count(*) from public.organization_rule_versions
      where organization_id = organization_id_value and campus_id is not null
        and effective_from <= now() and (effective_until is null or effective_until > now())),
    'activeCampusFlagOverrides', (select count(*) from public.feature_flag_versions
      where organization_id = organization_id_value and campus_id is not null
        and effective_from <= now() and (effective_until is null or effective_until > now())),
    'formalImpact', jsonb_build_object(
      'classrooms', (select count(*) from public.classrooms
        where purpose = 'production' and default_room_id is not null),
      'sessions', (select count(*) from public.class_sessions session_row
        join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
        where classroom_row.purpose = 'production' and session_row.room_id is not null)
    )
  );
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Class default and session override semantics.
-- ---------------------------------------------------------------------------

create or replace function public.get_classroom_room_apply_preview_v2(
  p_classroom_id uuid,
  p_room_id uuid default null
) returns jsonb language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); classroom_row public.classrooms; room_row public.campus_rooms;
        affected_count integer;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into classroom_row from public.classrooms where id = p_classroom_id;
  if classroom_row.id is null then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  if not (public.is_admin(uid) or public.can_manage_classroom(p_classroom_id, uid)
          or public.is_classroom_teacher(p_classroom_id, uid)) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if p_room_id is not null then
    select * into room_row from public.campus_rooms where id = p_room_id and status = 'active';
    if room_row.id is null or not exists(select 1 from public.campuses where id = room_row.campus_id and status = 'active') then
      raise exception 'INVALID_ROOM';
    end if;
  end if;
  select count(*) into affected_count from public.class_sessions
   where classroom_id = p_classroom_id
     and room_assignment_origin = 'class_default'
     and room_id is distinct from p_room_id
     and deleted_at is null and cancelled_by is null and voided_at is null
     and started_at is null and ended_at is null;
  return jsonb_build_object(
    'classroomId', p_classroom_id,
    'roomId', p_room_id,
    'unstartedDefaultSessionCount', affected_count,
    'capacityWarning', p_room_id is not null and classroom_row.capacity is not null
      and room_row.capacity is not null and classroom_row.capacity > room_row.capacity,
    'classCapacity', classroom_row.capacity,
    'roomCapacity', room_row.capacity
  );
end
$$;

create or replace function public.update_classroom_default_room_v2(
  p_classroom_id uuid,
  p_room_id uuid default null,
  p_apply_to_unstarted boolean default false,
  p_expected_unstarted_session_count integer default null
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); classroom_row public.classrooms; preview jsonb;
        affected_count integer; old_room_id uuid;
begin
  preview := public.get_classroom_room_apply_preview_v2(p_classroom_id, p_room_id);
  select * into classroom_row from public.classrooms where id = p_classroom_id for update;
  old_room_id := classroom_row.default_room_id;
  affected_count := (preview ->> 'unstartedDefaultSessionCount')::integer;
  if coalesce(p_apply_to_unstarted, false) and p_expected_unstarted_session_count is not null
     and affected_count <> p_expected_unstarted_session_count then raise exception 'LOCATION_IMPACT_STALE'; end if;

  update public.classrooms set default_room_id = p_room_id where id = p_classroom_id;
  if coalesce(p_apply_to_unstarted, false) then
    update public.class_sessions
       set room_id = p_room_id
     where classroom_id = p_classroom_id
       and room_assignment_origin = 'class_default'
       and room_id is distinct from p_room_id
       and deleted_at is null and cancelled_by is null and voided_at is null
       and started_at is null and ended_at is null;
  end if;
  perform public.emit_domain_event('classroom.default_room.updated', 'classroom', p_classroom_id,
    jsonb_build_object('oldRoomId', old_room_id, 'roomId', p_room_id,
      'appliedToUnstarted', coalesce(p_apply_to_unstarted, false),
      'updatedSessionCount', case when coalesce(p_apply_to_unstarted, false) then affected_count else 0 end), null, null);
  return preview || jsonb_build_object(
    'appliedToUnstarted', coalesce(p_apply_to_unstarted, false),
    'updatedSessionCount', case when coalesce(p_apply_to_unstarted, false) then affected_count else 0 end
  );
end
$$;

create or replace function public.set_class_session_room_v2(p_session_id uuid, p_room_id uuid default null)
returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); session_row public.class_sessions; old_room_id uuid; old_origin text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into session_row from public.class_sessions where id = p_session_id for update;
  if session_row.id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not (public.is_admin(uid) or public.can_manage_classroom(session_row.classroom_id, uid)
          or public.is_classroom_teacher(session_row.classroom_id, uid)) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if session_row.deleted_at is not null or session_row.cancelled_by is not null or session_row.voided_at is not null
     or session_row.started_at is not null or session_row.ended_at is not null then raise exception 'SESSION_NOT_EDITABLE'; end if;
  if p_room_id is not null and not exists (
    select 1 from public.campus_rooms room_row join public.campuses campus_row on campus_row.id = room_row.campus_id
     where room_row.id = p_room_id and room_row.status = 'active' and campus_row.status = 'active'
  ) then raise exception 'INVALID_ROOM'; end if;
  old_room_id := session_row.room_id;
  old_origin := session_row.room_assignment_origin;
  update public.class_sessions set room_id = p_room_id, room_assignment_origin = 'session_override'
   where id = p_session_id;
  perform public.emit_domain_event('session.room.overridden', 'class_session', p_session_id,
    jsonb_build_object('oldRoomId', old_room_id, 'oldOrigin', old_origin,
      'roomId', p_room_id, 'origin', 'session_override'), null, null);
end
$$;

create or replace function public.reset_class_session_room_v2(p_session_id uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); session_row public.class_sessions; default_room_id_value uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into session_row from public.class_sessions where id = p_session_id for update;
  if session_row.id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not (public.is_admin(uid) or public.can_manage_classroom(session_row.classroom_id, uid)
          or public.is_classroom_teacher(session_row.classroom_id, uid)) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if session_row.deleted_at is not null or session_row.cancelled_by is not null or session_row.voided_at is not null
     or session_row.started_at is not null or session_row.ended_at is not null then raise exception 'SESSION_NOT_EDITABLE'; end if;
  select default_room_id into default_room_id_value from public.classrooms where id = session_row.classroom_id;
  update public.class_sessions set room_id = default_room_id_value, room_assignment_origin = 'class_default'
   where id = p_session_id;
  perform public.emit_domain_event('session.room.reset_to_class_default', 'class_session', p_session_id,
    jsonb_build_object('roomId', default_room_id_value, 'origin', 'class_default'), null, null);
end
$$;

create or replace function public.create_class_v2(
  p_name text,
  p_course_id uuid default null,
  p_capacity smallint default null,
  p_room_id uuid default null,
  p_primary_teacher_id uuid default null,
  p_learning_support_id uuid default null,
  p_term_id uuid default null,
  p_purpose text default 'production',
  p_sessions jsonb default '[]'::jsonb,
  p_activate boolean default false,
  p_offering_type text default 'long_term_formal'
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare classroom_id_value uuid;
begin
  if p_room_id is not null and not exists (
    select 1 from public.campus_rooms room_row
    join public.campuses campus_row on campus_row.id = room_row.campus_id
    where room_row.id = p_room_id and room_row.status = 'active' and campus_row.status = 'active'
  ) then raise exception 'INVALID_ROOM'; end if;

  classroom_id_value := public.create_class(
    p_name => p_name,
    p_course_id => p_course_id,
    p_capacity => p_capacity,
    p_room => '',
    p_primary_teacher_id => p_primary_teacher_id,
    p_learning_support_id => p_learning_support_id,
    p_term_id => p_term_id,
    p_purpose => p_purpose,
    p_sessions => p_sessions,
    p_activate => p_activate,
    p_offering_type => p_offering_type
  );
  update public.classrooms set default_room_id = p_room_id where id = classroom_id_value;
  update public.class_sessions
     set room_id = p_room_id, room_assignment_origin = 'class_default'
   where classroom_id = classroom_id_value;
  return classroom_id_value;
end
$$;

create or replace function public.create_free_class_with_sessions_v2(
  p_name text,
  p_capacity smallint default null,
  p_room_id uuid default null,
  p_primary_teacher_id uuid default null,
  p_learning_support_id uuid default null,
  p_term_id uuid default null,
  p_purpose text default 'production',
  p_sessions jsonb default '[]'::jsonb,
  p_activate boolean default false,
  p_offering_type text default 'long_term_formal'
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare classroom_id_value uuid;
begin
  if p_room_id is not null and not exists (
    select 1 from public.campus_rooms room_row
    join public.campuses campus_row on campus_row.id = room_row.campus_id
    where room_row.id = p_room_id and room_row.status = 'active' and campus_row.status = 'active'
  ) then raise exception 'INVALID_ROOM'; end if;

  classroom_id_value := public.create_free_class_with_sessions(
    p_name => p_name,
    p_capacity => p_capacity,
    p_room => '',
    p_primary_teacher_id => p_primary_teacher_id,
    p_learning_support_id => p_learning_support_id,
    p_term_id => p_term_id,
    p_purpose => p_purpose,
    p_sessions => p_sessions,
    p_activate => p_activate,
    p_offering_type => p_offering_type
  );
  update public.classrooms set default_room_id = p_room_id where id = classroom_id_value;
  update public.class_sessions
     set room_id = p_room_id, room_assignment_origin = 'class_default'
   where classroom_id = classroom_id_value;
  return classroom_id_value;
end
$$;

create or replace function public.get_class_build_conflicts_v2(
  p_primary_teacher_id uuid,
  p_room_id uuid,
  p_slots jsonb
) returns table(
  session_id uuid,
  classroom_name text,
  lecture_name text,
  scheduled_at timestamptz,
  duration_min smallint,
  teacher_conflict boolean,
  room_conflict boolean,
  room_id uuid,
  room_name text,
  campus_id uuid,
  campus_name text
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.has_perm(uid, 'class.create') then raise exception 'FORBIDDEN'; end if;
  if p_primary_teacher_id is null or jsonb_typeof(coalesce(p_slots, '[]'::jsonb)) <> 'array' then
    raise exception 'INVALID_SCHEDULE';
  end if;
  if p_room_id is not null and not exists (
    select 1 from public.campus_rooms room_row join public.campuses campus_row on campus_row.id = room_row.campus_id
    where room_row.id = p_room_id and room_row.status = 'active' and campus_row.status = 'active'
  ) then raise exception 'INVALID_ROOM'; end if;

  return query
  with requested as (
    select requested_slot.scheduled_at, requested_slot.duration_min
      from jsonb_to_recordset(p_slots) as requested_slot(scheduled_at timestamptz, duration_min smallint)
     where requested_slot.scheduled_at is not null and requested_slot.duration_min between 1 and 600
  ), candidates as (
    select distinct session_row.id,
      classroom_row.name classroom_name,
      session_row.title lecture_name,
      session_row.scheduled_at,
      session_row.duration_min,
      (
        session_row.teacher_override = p_primary_teacher_id
        or classroom_row.owner_id = p_primary_teacher_id
        or exists (
          select 1 from public.classroom_staff_assignments assignment_row
           where assignment_row.classroom_id = classroom_row.id
             and assignment_row.user_id = p_primary_teacher_id
             and assignment_row.responsibility in ('primary_teacher', 'assistant_teacher')
        )
      ) teacher_conflict,
      (p_room_id is not null and session_row.room_id = p_room_id) room_conflict,
      session_row.room_id,
      room_row.name room_name,
      campus_row.id campus_id,
      campus_row.name campus_name
    from requested
    join public.class_sessions session_row
      on session_row.deleted_at is null
     and session_row.cancelled_by is null
     and session_row.voided_at is null
     and session_row.scheduled_at is not null
     and session_row.duration_min is not null
     and session_row.scheduled_at < requested.scheduled_at + make_interval(mins => requested.duration_min)
     and requested.scheduled_at < session_row.scheduled_at + make_interval(mins => session_row.duration_min)
    join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
    left join public.campus_rooms room_row on room_row.id = session_row.room_id
    left join public.campuses campus_row on campus_row.id = room_row.campus_id
    where classroom_row.trashed_at is null and session_row.ended_at is null
  )
  select candidate.id, candidate.classroom_name, candidate.lecture_name,
         candidate.scheduled_at, candidate.duration_min,
         candidate.teacher_conflict, candidate.room_conflict,
         candidate.room_id, candidate.room_name, candidate.campus_id, candidate.campus_name
    from candidates candidate
   where candidate.teacher_conflict or candidate.room_conflict
   order by candidate.scheduled_at, candidate.id
   limit 50;
end
$$;

create or replace function public.get_staff_schedule_v2(
  p_from timestamptz,
  p_to timestamptz,
  p_campus_id uuid default null,
  p_room_id uuid default null
) returns table(
  session_id uuid,
  classroom_id uuid,
  classroom_name text,
  lecture_name text,
  scheduled_at timestamptz,
  duration_min smallint,
  teacher_name text,
  room_id uuid,
  room_name text,
  campus_id uuid,
  campus_name text,
  room_assignment_origin text
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to > p_from + interval '370 days' then
    raise exception 'VALIDATION';
  end if;
  return query
  select session_row.id, classroom_row.id, classroom_row.name, session_row.title,
         session_row.scheduled_at, session_row.duration_min,
         coalesce(override_profile.display_name, primary_profile.display_name, owner_profile.display_name, ''),
         room_row.id, room_row.name, campus_row.id, campus_row.name,
         session_row.room_assignment_origin
    from public.class_sessions session_row
    join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
    left join public.profiles override_profile on override_profile.id = session_row.teacher_override
    left join lateral (
      select assignment_row.user_id
        from public.classroom_staff_assignments assignment_row
       where assignment_row.classroom_id = classroom_row.id
         and assignment_row.responsibility = 'primary_teacher'
       order by assignment_row.created_at limit 1
    ) primary_assignment on true
    left join public.profiles primary_profile on primary_profile.id = primary_assignment.user_id
    left join public.profiles owner_profile on owner_profile.id = classroom_row.owner_id
    left join public.campus_rooms room_row on room_row.id = session_row.room_id
    left join public.campuses campus_row on campus_row.id = room_row.campus_id
   where session_row.deleted_at is null
     and session_row.scheduled_at >= p_from and session_row.scheduled_at < p_to
     and (p_room_id is null or session_row.room_id = p_room_id)
     and (p_campus_id is null or campus_row.id = p_campus_id)
     and (
       public.has_perm(uid, 'schedule.view.all')
       or public.is_classroom_teacher(classroom_row.id, uid)
       or exists (
         select 1 from public.classroom_staff_assignments assignment_row
          where assignment_row.classroom_id = classroom_row.id and assignment_row.user_id = uid
       )
     )
   order by session_row.scheduled_at, session_row.id;
end
$$;

create or replace function public.get_organization_timezone_v2()
returns text language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare result text;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  select timezone into result from public.organizations where singleton_key = 1;
  return result;
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Function ACL and schema refresh.
-- ---------------------------------------------------------------------------

revoke all on function public.internal_location_code_v2(text) from public, anon, authenticated;
revoke all on function public.resolve_legacy_room_v2(text, boolean) from public, anon, authenticated;
revoke all on function public.sync_campus_room_status_v2() from public, anon, authenticated;
revoke all on function public.sync_classroom_room_compat_v2() from public, anon, authenticated;
revoke all on function public.copy_classroom_default_room_v2() from public, anon, authenticated;
revoke all on function public.propagate_room_name_compat_v2() from public, anon, authenticated;
revoke all on function public.assert_organization_profile_manager_v2() from public, anon, authenticated;
revoke all on function public.assert_location_manager_v2() from public, anon, authenticated;
revoke all on function public.clear_unstarted_room_references_v2(uuid) from public, anon, authenticated;
revoke all on function public.clear_archived_campus_references_v2() from public, anon, authenticated;
revoke all on function public.clear_inactive_room_references_v2() from public, anon, authenticated;

revoke all on function public.get_organization_profile_v2() from public, anon, authenticated;
revoke all on function public.update_organization_profile_v2(text, text) from public, anon, authenticated;
revoke all on function public.get_schedule_defaults_v2() from public, anon, authenticated;
revoke all on function public.update_schedule_defaults_v2(smallint) from public, anon, authenticated;
revoke all on function public.get_location_catalog_v2(boolean) from public, anon, authenticated;
revoke all on function public.get_campus_v2(uuid) from public, anon, authenticated;
revoke all on function public.list_room_options_v2(boolean) from public, anon, authenticated;
revoke all on function public.create_campus_v2(text, text) from public, anon, authenticated;
revoke all on function public.update_campus_v2(uuid, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.create_campus_room_v2(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.update_campus_room_v2(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.get_location_impact_v2(text, uuid) from public, anon, authenticated;
revoke all on function public.set_campus_room_status_v2(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.get_location_migration_preflight_v2() from public, anon, authenticated;
revoke all on function public.get_classroom_room_apply_preview_v2(uuid, uuid) from public, anon, authenticated;
revoke all on function public.update_classroom_default_room_v2(uuid, uuid, boolean, integer) from public, anon, authenticated;
revoke all on function public.set_class_session_room_v2(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reset_class_session_room_v2(uuid) from public, anon, authenticated;
revoke all on function public.create_class_v2(text, uuid, smallint, uuid, uuid, uuid, uuid, text, jsonb, boolean, text) from public, anon, authenticated;
revoke all on function public.create_free_class_with_sessions_v2(text, smallint, uuid, uuid, uuid, uuid, text, jsonb, boolean, text) from public, anon, authenticated;
revoke all on function public.get_class_build_conflicts_v2(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.get_staff_schedule_v2(timestamptz, timestamptz, uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_organization_timezone_v2() from public, anon, authenticated;

grant execute on function public.get_organization_profile_v2() to authenticated;
grant execute on function public.update_organization_profile_v2(text, text) to authenticated;
grant execute on function public.get_schedule_defaults_v2() to authenticated;
grant execute on function public.update_schedule_defaults_v2(smallint) to authenticated;
grant execute on function public.get_location_catalog_v2(boolean) to authenticated;
grant execute on function public.get_campus_v2(uuid) to authenticated;
grant execute on function public.list_room_options_v2(boolean) to authenticated;
grant execute on function public.create_campus_v2(text, text) to authenticated;
grant execute on function public.update_campus_v2(uuid, text, text, text, integer) to authenticated;
grant execute on function public.create_campus_room_v2(uuid, text, integer) to authenticated;
grant execute on function public.update_campus_room_v2(uuid, text, integer) to authenticated;
grant execute on function public.get_location_impact_v2(text, uuid) to authenticated;
grant execute on function public.set_campus_room_status_v2(uuid, text, integer) to authenticated;
grant execute on function public.get_location_migration_preflight_v2() to authenticated;
grant execute on function public.get_classroom_room_apply_preview_v2(uuid, uuid) to authenticated;
grant execute on function public.update_classroom_default_room_v2(uuid, uuid, boolean, integer) to authenticated;
grant execute on function public.set_class_session_room_v2(uuid, uuid) to authenticated;
grant execute on function public.reset_class_session_room_v2(uuid) to authenticated;
grant execute on function public.create_class_v2(text, uuid, smallint, uuid, uuid, uuid, uuid, text, jsonb, boolean, text) to authenticated;
grant execute on function public.create_free_class_with_sessions_v2(text, smallint, uuid, uuid, uuid, uuid, text, jsonb, boolean, text) to authenticated;
grant execute on function public.get_class_build_conflicts_v2(uuid, uuid, jsonb) to authenticated;
grant execute on function public.get_staff_schedule_v2(timestamptz, timestamptz, uuid, uuid) to authenticated;
grant execute on function public.get_organization_timezone_v2() to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
