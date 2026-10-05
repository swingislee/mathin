-- Keep the existing school-time exclusions; add an independent weekly scheduling range.
alter table public.staff_calendar_settings add column available_windows jsonb not null default '[]'
  check(public.staff_calendar_school_windows_valid(available_windows));

create function public.save_calendar_scheduling_settings(p_school_windows jsonb,p_available_windows jsonb,p_expected_updated_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_settings public.staff_calendar_settings%rowtype; v_school jsonb; v_available jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(v_uid) or not public.has_perm(v_uid,'schedule.manage') then raise exception 'FORBIDDEN'; end if;
  if not public.staff_calendar_school_windows_valid(p_school_windows) or not public.staff_calendar_school_windows_valid(p_available_windows)
    then raise exception 'VALIDATION'; end if;
  select coalesce(jsonb_agg(item order by (item->>'weekday')::int,(item->>'startMinute')::int,(item->>'endMinute')::int),'[]')
    into v_school from jsonb_array_elements(p_school_windows) item;
  select coalesce(jsonb_agg(item order by (item->>'weekday')::int,(item->>'startMinute')::int,(item->>'endMinute')::int),'[]')
    into v_available from jsonb_array_elements(p_available_windows) item;
  select * into v_settings from public.staff_calendar_settings where singleton_key=1
    and organization_id=(select id from public.organizations where singleton_key=1) for update;
  if v_settings.singleton_key is null then raise exception 'NOT_FOUND'; end if;
  if v_settings.school_windows is distinct from v_school or v_settings.available_windows is distinct from v_available then
    if p_expected_updated_at is distinct from v_settings.updated_at and not (p_expected_updated_at is null and v_settings.updated_by is null)
      then raise exception 'CONFLICT'; end if;
    update public.staff_calendar_settings set school_windows=v_school,available_windows=v_available,updated_by=v_uid,updated_at=clock_timestamp()
      where singleton_key=1 returning * into v_settings;
  end if;
  return jsonb_build_object('schoolWindows',v_settings.school_windows,'availableWindows',v_settings.available_windows,'updatedAt',v_settings.updated_at);
end $$;

create or replace function public.get_calendar_workspace(p_from timestamptz,p_to timestamptz) returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_settings public.staff_calendar_settings%rowtype;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(v_uid) then raise exception 'FORBIDDEN'; end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<=p_from or p_to>p_from+interval '370 days'
    then raise exception 'VALIDATION'; end if;
  select * into v_settings from public.staff_calendar_settings where singleton_key=1
    and organization_id=(select id from public.organizations where singleton_key=1);
  return jsonb_build_object('currentUserId',v_uid,'canCreate',true,
    'schoolWindows',coalesce(v_settings.school_windows,'[]'),'availableWindows',coalesce(v_settings.available_windows,'[]'),
    'settingsUpdatedAt',v_settings.updated_at,'canManageSettings',public.has_perm(v_uid,'schedule.manage'),
    'teachingCalendar',public.list_teaching_calendar_entries_v2(),
    'people',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'displayName',display_name) order by display_name,id),'[]')
      from public.profiles where public.is_staff(id)),
    'events',(select coalesce(jsonb_agg(public.staff_calendar_event_projection(e.id) order by e.starts_at,e.id),'[]')
      from public.staff_calendar_events e where e.starts_at<p_to and e.ends_at>p_from and public.staff_calendar_can_view(e.id)));
end $$;

-- Each occurrence uses the same visibility policy as the calendar itself.
create function public.get_calendar_series(p_series_id uuid) returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  if p_series_id is null then raise exception 'VALIDATION'; end if;
  return (select coalesce(jsonb_agg(public.staff_calendar_event_projection(e.id) order by e.starts_at,e.id),'[]')
    from public.staff_calendar_events e where e.series_id=p_series_id and public.staff_calendar_can_view(e.id));
end $$;

revoke all on function public.save_calendar_scheduling_settings(jsonb,jsonb,timestamptz),public.get_calendar_series(uuid) from public,anon;
grant execute on function public.save_calendar_scheduling_settings(jsonb,jsonb,timestamptz),public.get_calendar_series(uuid) to authenticated;
notify pgrst, 'reload schema';
