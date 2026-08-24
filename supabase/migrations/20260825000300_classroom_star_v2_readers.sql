-- M4a follow-up: expose the stable-id dual-read star aggregate to authorized
-- student profiles without letting clients enumerate arbitrary students.

begin;

create function public.get_student_star_total(p_student_id uuid)
returns integer
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  target_exists boolean;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;

  select exists (
    select 1 from public.students student_row where student_row.id = p_student_id
  ) into target_exists;
  if not target_exists then raise exception 'NOT_FOUND'; end if;

  if not (
    public.can_access_student(p_student_id, uid)
    or exists (
      select 1
        from public.students student_row
       where student_row.id = p_student_id
         and student_row.user_id = uid
    )
    or exists (
      select 1
        from public.student_guardians guardian_row
       where guardian_row.student_id = p_student_id
         and guardian_row.guardian_id = uid
    )
  ) then
    raise exception 'FORBIDDEN';
  end if;

  return coalesce(public.student_star_total(p_student_id), 0);
end;
$$;

revoke all on function public.get_student_star_total(uuid)
  from public, anon, authenticated;
grant execute on function public.get_student_star_total(uuid) to authenticated;

comment on function public.get_student_star_total(uuid) is
  'Authorized stable-student star total: legacy claimed-user events plus v2 award/revoke sets.';

commit;
