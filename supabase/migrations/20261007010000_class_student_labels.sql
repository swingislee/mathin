-- Shared class labels: everyone who can read the roster can see them;
-- only the student's current class teachers can set or clear them.
create table public.class_student_labels (
  enrollment_id uuid primary key references public.enrollments(id) on delete cascade,
  label text not null check (label in ('A', 'B', 'C', 'D')),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.class_student_labels enable row level security;
revoke all on public.class_student_labels from public, anon, authenticated;
comment on table public.class_student_labels is 'Shared A/B/C/D label for a class roster membership; accessed through scoped RPCs.';

create function mathin_internal.can_edit_class_student_label(p_classroom_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_staff(auth.uid()) and (
    public.is_classroom_teacher(p_classroom_id, auth.uid())
    or public.is_classroom_staff_assigned(p_classroom_id, auth.uid(), 'primary_teacher')
    or public.is_classroom_staff_assigned(p_classroom_id, auth.uid(), 'assistant_teacher')
  );
$$;
revoke all on function mathin_internal.can_edit_class_student_label(uuid) from public, anon, authenticated;

create function public.get_class_student_labels(p_classroom_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  can_read_placement boolean;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) then raise exception 'FORBIDDEN'; end if;
  can_read_placement := public.can_access_enrollment_placement();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'enrollmentId', e.id, 'label', label.label,
      'canEdit', e.status = 'active' and c.archived_at is null and c.trashed_at is null
        and mathin_internal.can_edit_class_student_label(c.id)
    ) order by e.id)
    from public.enrollments e
    join public.classrooms c on c.id = e.classroom_id
    left join public.class_student_labels label on label.enrollment_id = e.id
    where c.id = any(p_classroom_ids) and (
      public.can_view_enrollment(c.id, e.student_id, actor)
      or (can_read_placement and e.status = 'active' and c.archived_at is null and c.trashed_at is null
        and c.purpose = 'production' and c.offering_type = 'long_term_formal'
        and c.operational_status in ('planning', 'active') and c.course_id is not null and c.term_id is not null)
    )
  ), '[]'::jsonb);
end;
$$;

create function public.set_class_student_label(p_enrollment_id uuid, p_label text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  membership public.enrollments%rowtype;
  classroom public.classrooms%rowtype;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) then raise exception 'FORBIDDEN'; end if;
  if p_label is not null and p_label not in ('A', 'B', 'C', 'D') then raise exception 'VALIDATION'; end if;
  select * into membership from public.enrollments where id = p_enrollment_id for update;
  if not found then raise exception 'CLASS_MEMBERSHIP_NOT_ACTIVE'; end if;
  if not mathin_internal.can_edit_class_student_label(membership.classroom_id) then raise exception 'FORBIDDEN'; end if;
  if membership.status <> 'active' then raise exception 'CLASS_MEMBERSHIP_NOT_ACTIVE'; end if;
  select * into classroom from public.classrooms where id = membership.classroom_id for share;
  if classroom.archived_at is not null or classroom.trashed_at is not null then raise exception 'CLASS_NOT_EDITABLE'; end if;
  if p_label is null then
    delete from public.class_student_labels where enrollment_id = p_enrollment_id;
  else
    insert into public.class_student_labels(enrollment_id, label, updated_by)
    values (p_enrollment_id, p_label, actor)
    on conflict (enrollment_id) do update set label = excluded.label, updated_by = actor, updated_at = now();
  end if;
  return jsonb_build_object('enrollmentId', p_enrollment_id, 'label', p_label, 'canEdit', true);
end;
$$;

revoke all on function public.get_class_student_labels(uuid[]) from public, anon, authenticated;
revoke all on function public.set_class_student_label(uuid, text) from public, anon, authenticated;
grant execute on function public.get_class_student_labels(uuid[]) to authenticated;
grant execute on function public.set_class_student_label(uuid, text) to authenticated;
notify pgrst, 'reload schema';
