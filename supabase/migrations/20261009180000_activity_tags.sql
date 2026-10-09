-- Activity labels are maintained with the activity and published with its offer.
alter table public.activities add column tags text[] not null default '{}'
  check (cardinality(tags) <= 10 and array_position(tags, null) is null
    and char_length(array_to_string(tags, '')) <= 400);

-- Preserve the current business scope, column order and invoker permissions.
do $view$
declare columns text;
begin
  select string_agg(case when a.attname = 'record_state' then
    'case when public.business_source_is_current(r.source_record_id) and public.business_fact_is_current(''activities'',r.id) then r.record_state else ''historical''::text end as record_state'
    else format('r.%I', a.attname) end, ',' order by a.attnum) into columns
  from pg_attribute a where a.attrelid = 'public.activities'::regclass and a.attnum > 0 and not a.attisdropped;
  execute format('create or replace view public.business_activities with (security_invoker=true) as select %s from public.activities r where public.business_source_is_authoritative(r.source_record_id)', columns);
end;
$view$;

-- Create/update the activity and its labels in one transaction. Existing RPCs
-- retain their compatibility and their business permission/current-state checks.
create function public.save_activity_with_tags(
  p_activity_id uuid, p_kind text, p_title text, p_scheduled_at timestamptz,
  p_duration_min smallint, p_location text, p_capacity smallint, p_remark text, p_tags text[]
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare activity_id uuid; clean_tags text[];
begin
  if auth.uid() is null or not public.has_perm(auth.uid(), 'activity.manage') then raise exception 'FORBIDDEN'; end if;
  if p_tags is null or cardinality(p_tags) > 10 or coalesce(array_ndims(p_tags), 1) <> 1
    or exists(select 1 from unnest(p_tags) tag where tag is null or char_length(btrim(tag)) not between 1 and 40)
    or p_scheduled_at is null or p_duration_min is not null and p_duration_min < 1
    or p_capacity is not null and p_capacity < 1 then raise exception 'INVALID_INPUT'; end if;
  select coalesce(array_agg(tag order by position), '{}') into clean_tags
    from (select btrim(tag) tag, min(position) position from unnest(p_tags) with ordinality t(tag, position) group by btrim(tag)) tags;
  if p_activity_id is not null then
    perform public.update_activity(p_activity_id, p_kind, p_title, p_scheduled_at, p_duration_min, p_location, p_capacity, p_remark);
    activity_id := p_activity_id;
  elsif p_kind = 'public_class' then
    activity_id := public.create_public_class_event(p_title, p_scheduled_at, p_location, p_capacity, p_remark,
      jsonb_build_array(jsonb_build_object('kind', 'trial_lesson', 'title', p_title, 'scheduled_at', p_scheduled_at,
        'duration_min', coalesce(p_duration_min, 60), 'location', p_location)));
  else
    activity_id := public.create_activity(p_kind, p_title, p_scheduled_at, p_duration_min, p_location, p_capacity, p_remark);
  end if;
  update public.activities set tags = clean_tags where id = activity_id;
  return activity_id;
end;
$$;
revoke all on function public.save_activity_with_tags(uuid,text,text,timestamptz,smallint,text,smallint,text,text[]) from public, anon;
grant execute on function public.save_activity_with_tags(uuid,text,text,timestamptz,smallint,text,smallint,text,text[]) to authenticated;

create or replace function public.miniapp_registration_catalog() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(item order by updated_at desc), '[]'::jsonb) from (
    select p.updated_at, jsonb_build_object('id', p.classroom_id, 'kind', 'class', 'title', p.title, 'description', p.description,
      'priceCents', null, 'bookingClosesAt', p.booking_closes_at, 'revision', p.revision, 'classes', c.items, 'activity', null) item
    from parent_class_publications p cross join lateral (select mathin_internal.parent_registration_classes(array[p.classroom_id]) items) c
    where p.enabled and p.booking_closes_at > now() and jsonb_array_length(c.items) = 1
    union all
    select p.updated_at, jsonb_build_object('id', a.id, 'kind', 'activity', 'title', coalesce(p.title->>'zh', p.title->>'en', a.title),
      'description', coalesce(p.description->>'zh', p.description->>'en', ''), 'priceCents', null,
      'bookingClosesAt', coalesce(p.booking_closes_at, a.scheduled_at), 'revision', p.revision, 'classes', '[]'::jsonb,
      'activity', jsonb_build_object('id', a.id, 'tags', a.tags, 'targetGrades', a.target_grades, 'location', a.location, 'startsAt', a.scheduled_at,
        'durationMinutes', a.duration_min, 'remaining', case when a.capacity is null then null else greatest(a.capacity - (select count(*) from activity_registrations r where r.activity_id = a.id and r.status in ('booked', 'attended')), 0) end))
    from miniapp_activity_publications p join activities a on a.id = p.activity_id
    where p.enabled and a.deleted_at is null and a.record_state = 'current' and a.scheduled_at > now()
      and coalesce(p.booking_closes_at, a.scheduled_at) > now()
  ) offers;
$$;

notify pgrst, 'reload schema';
