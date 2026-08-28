-- Dashboard class library default:
--   1. prefer a real personal teaching assignment;
--   2. then prefer a real personal learning-support assignment;
--   3. only fall back to the all-classes scope when both personal scopes are empty.
-- Explicit ?scope=... requests continue to win.

create or replace function public.resolve_classroom_scope(p_requested text default null)
returns table(resolved_scope text, available_scopes text[])
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  can_view_all boolean;
  can_manage boolean;
  is_teaching boolean;
  is_support boolean;
  has_teaching_class boolean;
  has_support_class boolean;
  scopes text[] := array[]::text[];
  requested text := nullif(lower(trim(coalesce(p_requested, ''))), '');
  default_scope text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;

  can_view_all := public.has_perm(uid, 'class.view.all');
  can_manage := public.has_perm(uid, 'class.manage');

  select exists (
    select 1
    from public.classroom_staff_assignments assignment_row
    join public.classrooms classroom_row on classroom_row.id = assignment_row.classroom_id
    where assignment_row.user_id = uid
      and assignment_row.responsibility in ('primary_teacher', 'assistant_teacher')
      and classroom_row.purpose = 'production'
      and classroom_row.archived_at is null
      and classroom_row.trashed_at is null
  ) into has_teaching_class;

  select exists (
    select 1
    from public.classroom_staff_assignments assignment_row
    join public.classrooms classroom_row on classroom_row.id = assignment_row.classroom_id
    where assignment_row.user_id = uid
      and assignment_row.responsibility = 'learning_support'
      and classroom_row.purpose = 'production'
      and classroom_row.archived_at is null
      and classroom_row.trashed_at is null
  ) into has_support_class;

  is_teaching := public.has_perm(uid, 'class.view.mine') or has_teaching_class;
  is_support := has_support_class;

  if can_view_all then scopes := scopes || 'all'::text; end if;
  if is_teaching then scopes := scopes || 'teaching'::text; end if;
  if is_support then scopes := scopes || 'support'::text; end if;
  if can_manage then scopes := scopes || 'test'::text; end if;
  if array_length(scopes, 1) is null then raise exception 'FORBIDDEN'; end if;

  default_scope := case
    when has_teaching_class then 'teaching'
    when has_support_class then 'support'
    when can_view_all then 'all'
    when is_teaching then 'teaching'
    else scopes[1]
  end;

  return query select
    case when requested = any(scopes) then requested else default_scope end,
    scopes;
end;
$$;

revoke all on function public.resolve_classroom_scope(text) from public, anon, authenticated;
grant execute on function public.resolve_classroom_scope(text) to authenticated;

select pg_notify('pgrst', 'reload schema');
