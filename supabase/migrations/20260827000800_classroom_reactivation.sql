-- R1-Live classroom lifecycle follow-up:
-- completing a class is reversible operational state, not archival or deletion.

begin;

create or replace function public.transition_classroom_status(
  p_classroom_id uuid,
  p_target text
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  classroom_row public.classrooms%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'class.manage') then raise exception 'FORBIDDEN'; end if;
  if p_target not in ('planning', 'active', 'completed') then raise exception 'INVALID_TRANSITION'; end if;

  select * into classroom_row from public.classrooms where id = p_classroom_id for update;
  if not found then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  if not public.can_manage_classroom(p_classroom_id, uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if classroom_row.trashed_at is not null then raise exception 'INVALID_TRANSITION'; end if;
  if classroom_row.operational_status = p_target then return; end if;
  if not (
    (classroom_row.operational_status = 'planning' and p_target in ('active', 'completed'))
    or (classroom_row.operational_status = 'active' and p_target = 'completed')
    or (classroom_row.operational_status = 'completed' and p_target = 'active')
  ) then
    raise exception 'INVALID_TRANSITION';
  end if;

  update public.classrooms set operational_status = p_target where id = p_classroom_id;
  perform public.emit_domain_event(
    'classroom.lifecycle.transition', 'classroom', p_classroom_id,
    jsonb_build_object('from', classroom_row.operational_status, 'to', p_target), null, null
  );
end;
$$;

revoke all on function public.transition_classroom_status(uuid, text) from public, anon, authenticated;
grant execute on function public.transition_classroom_status(uuid, text) to authenticated;

comment on function public.transition_classroom_status(uuid, text) is
  'Transitions classroom operational state; completed classes may be explicitly reactivated without rewriting session history.';

commit;
