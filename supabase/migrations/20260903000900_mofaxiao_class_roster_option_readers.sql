-- DATA-IMPORT-CLASS-ROSTER-2: expose only importable class metadata through a
-- permission-scoped RPC. The browser must not need broad table/column grants
-- on classrooms or its related operational tables.

create or replace function public.list_mofaxiao_class_roster_target_options()
returns table (
  id uuid,
  name text,
  grade smallint,
  term_id uuid,
  school_year smallint,
  season smallint,
  course_title text,
  course_family_slug text,
  class_type text,
  campus_name text,
  room_name text,
  primary_teacher_names text[],
  capacity smallint,
  active_enrollment_count integer
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid, 'enrollment.manage') then raise exception 'FORBIDDEN'; end if;

  return query
  select
    classroom_row.id,
    classroom_row.name,
    classroom_row.grade,
    classroom_row.term_id,
    term_row.year,
    term_row.term,
    coalesce(course_row.title, ''),
    coalesce(family_row.slug, ''),
    coalesce(course_row.class_type, ''),
    coalesce(campus_row.name, ''),
    coalesce(room_row.name, ''),
    array(
      select profile_row.display_name
        from public.classroom_staff_assignments assignment_row
        join public.profiles profile_row on profile_row.id = assignment_row.user_id
       where assignment_row.classroom_id = classroom_row.id
         and assignment_row.responsibility = 'primary_teacher'
       order by profile_row.display_name, profile_row.id
    ),
    classroom_row.capacity,
    (
      select count(*)::integer
        from public.enrollments enrollment_row
       where enrollment_row.classroom_id = classroom_row.id
         and enrollment_row.status = 'active'
    )
  from public.classrooms classroom_row
  left join public.courses course_row on course_row.id = classroom_row.course_id
  left join public.course_families family_row on family_row.id = course_row.family_id
  left join public.school_terms term_row on term_row.id = classroom_row.term_id
  left join public.campus_rooms room_row on room_row.id = classroom_row.default_room_id
  left join public.campuses campus_row on campus_row.id = room_row.campus_id
  where classroom_row.purpose = 'production'
    and classroom_row.operational_status in ('planning', 'active')
    and classroom_row.archived_at is null
    and classroom_row.trashed_at is null
    and public.can_manage_classroom(classroom_row.id, v_uid)
  order by classroom_row.name, classroom_row.id
  limit 1000;
end
$$;

comment on function public.list_mofaxiao_class_roster_target_options() is
  'Class roster import target options visible to enrollment managers and restricted to classes they may actually manage.';

revoke all on function public.list_mofaxiao_class_roster_target_options() from public, anon, authenticated;
grant execute on function public.list_mofaxiao_class_roster_target_options() to authenticated;

select pg_notify('pgrst', 'reload schema');
