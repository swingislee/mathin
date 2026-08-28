-- DEV-ORG-1 follow-up: staff-facing class/session read models join room and
-- campus names directly through PostgREST. Keep writes RPC-only and expose
-- only the code-free location columns required by those joins.

begin;

drop policy if exists campuses_staff_read_v2 on public.campuses;
create policy campuses_staff_read_v2
  on public.campuses
  for select
  to authenticated
  using (public.is_staff((select auth.uid())));

drop policy if exists campus_rooms_staff_read_v2 on public.campus_rooms;
create policy campus_rooms_staff_read_v2
  on public.campus_rooms
  for select
  to authenticated
  using (public.is_staff((select auth.uid())));

-- Reset every current column grant first so reapplying this migration also
-- narrows an accidentally broader development grant. Compatibility and audit
-- fields remain internal even for staff.
revoke select (
  id, organization_id, code, name, timezone, status, is_default,
  created_by, updated_by, created_at, updated_at, address
)
  on public.campuses from authenticated;
grant select (id, name)
  on public.campuses to authenticated;

revoke select (
  id, campus_id, code, name, capacity, is_active,
  created_by, updated_by, created_at, updated_at, status
)
  on public.campus_rooms from authenticated;
grant select (id, campus_id, name, capacity)
  on public.campus_rooms to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
