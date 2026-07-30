-- R1 classroom continuity: enrollment/live membership bridge and teacher-marked learning checks.
begin;

create or replace function public.sync_enrollment_classroom_member()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  old_user_id uuid;
  new_user_id uuid;
begin
  if tg_op <> 'INSERT' then
    select user_id into old_user_id from public.students where id = old.student_id;
    if old.status = 'active' and old_user_id is not null
       and (tg_op = 'DELETE' or new.status <> 'active' or new.classroom_id <> old.classroom_id or new.student_id <> old.student_id) then
      delete from public.classroom_members member_row
       where member_row.classroom_id = old.classroom_id
         and member_row.user_id = old_user_id
         and member_row.role = 'student'
         and not exists (
           select 1
             from public.enrollments enrollment_row
             join public.students student_row on student_row.id = enrollment_row.student_id
            where enrollment_row.classroom_id = old.classroom_id
              and enrollment_row.status = 'active'
              and student_row.user_id = old_user_id
              and (tg_op = 'DELETE' or enrollment_row.id <> old.id)
         );
    end if;
  end if;

  if tg_op <> 'DELETE' and new.status = 'active' then
    select user_id into new_user_id from public.students where id = new.student_id;
    if new_user_id is not null then
      insert into public.classroom_members(classroom_id, user_id, role)
      values(new.classroom_id, new_user_id, 'student')
      on conflict(classroom_id, user_id) do nothing;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

drop trigger if exists enrollments_sync_classroom_member on public.enrollments;
create trigger enrollments_sync_classroom_member
after insert or update of classroom_id, student_id, status or delete on public.enrollments
for each row execute function public.sync_enrollment_classroom_member();

create or replace function public.sync_student_account_classroom_members()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if old.user_id is not null and old.user_id is distinct from new.user_id then
    delete from public.classroom_members member_row
     where member_row.user_id = old.user_id
       and member_row.role = 'student'
       and exists (
         select 1 from public.enrollments enrollment_row
          where enrollment_row.student_id = new.id
            and enrollment_row.classroom_id = member_row.classroom_id
       )
       and not exists (
         select 1
           from public.enrollments enrollment_row
           join public.students student_row on student_row.id = enrollment_row.student_id
          where enrollment_row.classroom_id = member_row.classroom_id
            and enrollment_row.status = 'active'
            and student_row.user_id = old.user_id
            and student_row.id <> new.id
       );
  end if;
  if new.user_id is not null and new.user_id is distinct from old.user_id then
    insert into public.classroom_members(classroom_id, user_id, role)
    select enrollment_row.classroom_id, new.user_id, 'student'
      from public.enrollments enrollment_row
     where enrollment_row.student_id = new.id
       and enrollment_row.status = 'active'
    on conflict(classroom_id, user_id) do nothing;
  end if;
  return new;
end
$$;

drop trigger if exists students_sync_classroom_members on public.students;
create trigger students_sync_classroom_members
after update of user_id on public.students
for each row execute function public.sync_student_account_classroom_members();

insert into public.classroom_members(classroom_id, user_id, role)
select distinct enrollment_row.classroom_id, student_row.user_id, 'student'
  from public.enrollments enrollment_row
  join public.students student_row on student_row.id = enrollment_row.student_id
 where enrollment_row.status = 'active'
   and student_row.user_id is not null
on conflict(classroom_id, user_id) do nothing;

create table public.session_learning_checks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  position smallint not null check(position between 0 and 29),
  title text not null check(length(btrim(title)) between 1 and 100),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id, position)
);

create trigger session_learning_checks_set_updated_at
before update on public.session_learning_checks
for each row execute function public.set_updated_at();

create table public.session_learning_check_results (
  check_id uuid not null references public.session_learning_checks(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  status text not null check(status in ('explained','independent','prompted','imitated','incomplete')),
  marked_by uuid not null references public.profiles(id) on delete restrict,
  marked_at timestamptz not null default now(),
  primary key(check_id, student_id)
);

create index session_learning_check_results_student_idx
on public.session_learning_check_results(student_id, marked_at desc);

alter table public.session_learning_checks enable row level security;
alter table public.session_learning_check_results enable row level security;

create policy session_learning_checks_select_scope on public.session_learning_checks
for select to authenticated using(
  public.is_session_member(session_id, (select auth.uid()))
);

create policy session_learning_results_select_scope on public.session_learning_check_results
for select to authenticated using(
  exists(
    select 1
      from public.session_learning_checks check_row
      join public.students student_row on student_row.id = student_id
     where check_row.id = check_id
       and (
         public.is_session_teacher(check_row.session_id, (select auth.uid()))
         or student_row.user_id = (select auth.uid())
       )
  )
);

revoke all on public.session_learning_checks, public.session_learning_check_results from anon, authenticated;
grant select on public.session_learning_checks, public.session_learning_check_results to authenticated;

create or replace function public.replace_session_learning_checks(
  p_session_id uuid,
  p_titles jsonb
)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  session_row public.class_sessions%rowtype;
  title_value text;
  item_index integer := 0;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into session_row from public.class_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  if session_row.started_at is not null then raise exception 'SESSION_ALREADY_STARTED'; end if;
  if jsonb_typeof(p_titles) <> 'array' or jsonb_array_length(p_titles) > 30 then raise exception 'VALIDATION'; end if;

  for title_value in select value from jsonb_array_elements_text(p_titles)
  loop
    title_value := btrim(title_value);
    if length(title_value) not between 1 and 100 then raise exception 'VALIDATION'; end if;
    item_index := item_index + 1;
  end loop;

  delete from public.session_learning_checks where session_id = p_session_id;
  item_index := 0;
  for title_value in select value from jsonb_array_elements_text(p_titles)
  loop
    insert into public.session_learning_checks(session_id, position, title, created_by)
    values(p_session_id, item_index, btrim(title_value), uid);
    item_index := item_index + 1;
  end loop;
end
$$;

create or replace function public.mark_session_learning_check(
  p_session_id uuid,
  p_check_id uuid,
  p_student_id uuid,
  p_status text
)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  classroom_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_status not in ('explained','independent','prompted','imitated','incomplete','unchecked') then
    raise exception 'VALIDATION';
  end if;
  select session_row.classroom_id into classroom_id
    from public.class_sessions session_row
    join public.session_learning_checks check_row
      on check_row.session_id = session_row.id and check_row.id = p_check_id
   where session_row.id = p_session_id;
  if classroom_id is null then raise exception 'NOT_FOUND'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  if not exists(
    select 1 from public.enrollments enrollment_row
     where enrollment_row.classroom_id = classroom_id
       and enrollment_row.student_id = p_student_id
       and enrollment_row.status = 'active'
  ) then raise exception 'STUDENT_NOT_ENROLLED'; end if;

  if p_status = 'unchecked' then
    delete from public.session_learning_check_results
     where check_id = p_check_id and student_id = p_student_id;
  else
    insert into public.session_learning_check_results(check_id, student_id, status, marked_by, marked_at)
    values(p_check_id, p_student_id, p_status, uid, now())
    on conflict(check_id, student_id) do update
      set status = excluded.status, marked_by = excluded.marked_by, marked_at = excluded.marked_at;
  end if;
end
$$;

revoke all on function public.replace_session_learning_checks(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.mark_session_learning_check(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.replace_session_learning_checks(uuid, jsonb) to authenticated;
grant execute on function public.mark_session_learning_check(uuid, uuid, uuid, text) to authenticated;

alter table public.session_learning_check_results replica identity full;
do $$
begin
  if not exists(
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'session_learning_check_results'
  ) then
    alter publication supabase_realtime add table public.session_learning_check_results;
  end if;
end
$$;

commit;
