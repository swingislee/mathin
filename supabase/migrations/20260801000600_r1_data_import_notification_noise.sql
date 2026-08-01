-- R1-7A browser repair: import validation/application events are audit records,
-- not user-facing notifications. Clear their target before the generic
-- domain-event notification trigger runs.

create or replace function public.clear_data_import_event_target()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  new.target_user_id := null;
  return new;
end
$$;

drop trigger if exists domain_events_clear_data_import_target on public.domain_events;
create trigger domain_events_clear_data_import_target
before insert on public.domain_events
for each row
when (new.event_type in ('data_import.validated', 'data_import.completed'))
execute function public.clear_data_import_event_target();

revoke all on function public.clear_data_import_event_target() from public, anon, authenticated;