-- R1 regression repair: realtime, per-item read state, and actionable notification deep links.

begin;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;

  update public.notifications
     set read_at = coalesce(read_at, now())
   where id = p_notification_id
     and recipient_id = auth.uid()
     and archived_at is null;

  if not found then raise exception 'NOT_FOUND'; end if;
  return true;
end
$$;

revoke all on function public.mark_notification_read(uuid) from public, anon, authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;

create or replace function public.apply_actionable_notification_link()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  event_row public.domain_events;
begin
  select * into event_row from public.domain_events where id = new.source_event_id;
  if not found then return new; end if;

  new.deep_link := case
    when event_row.event_type in ('work_item.assigned', 'work_item.reassigned')
      then '/dashboard?focus=durable:' || event_row.entity_id::text
    when event_row.event_type = 'work_item.closed'
      then '/dashboard/coordination?focus=durable:' || event_row.entity_id::text
    when event_row.event_type = 'approval.requested'
      then '/dashboard?focus=approval:' || event_row.entity_id::text
    when event_row.event_type in ('approval.approved', 'approval.rejected')
      then '/dashboard/coordination?focus=approval:' || event_row.entity_id::text
    else coalesce(new.deep_link, event_row.event_link)
  end;
  return new;
end
$$;

drop trigger if exists notifications_apply_actionable_link on public.notifications;
create trigger notifications_apply_actionable_link
before insert or update of source_event_id, deep_link on public.notifications
for each row execute function public.apply_actionable_notification_link();

update public.notifications notification_row
   set deep_link = case
     when event_row.event_type in ('work_item.assigned', 'work_item.reassigned')
       then '/dashboard?focus=durable:' || event_row.entity_id::text
     when event_row.event_type = 'work_item.closed'
       then '/dashboard/coordination?focus=durable:' || event_row.entity_id::text
     when event_row.event_type = 'approval.requested'
       then '/dashboard?focus=approval:' || event_row.entity_id::text
     when event_row.event_type in ('approval.approved', 'approval.rejected')
       then '/dashboard/coordination?focus=approval:' || event_row.entity_id::text
     else notification_row.deep_link
   end
  from public.domain_events event_row
 where event_row.id = notification_row.source_event_id
   and event_row.event_type in (
     'work_item.assigned', 'work_item.reassigned', 'work_item.closed',
     'approval.requested', 'approval.approved', 'approval.rejected'
   );

alter table public.notifications replica identity full;

do $$
begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists(
       select 1
         from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'notifications'
     ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end
$$;

commit;
