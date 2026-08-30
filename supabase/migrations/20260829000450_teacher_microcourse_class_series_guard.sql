-- Production can already contain several proposals that will become lectures
-- 2..N of one classroom course. Relax only the legacy single-lecture guard
-- before the class-series migration reparents those proposals. Newer schemas
-- already carry the class-series guard and remain untouched.

begin;

do $migration$
declare
  guard_definition text;
begin
  select pg_get_functiondef(function_row.oid)
  into guard_definition
  from pg_proc function_row
  join pg_namespace namespace_row on namespace_row.oid = function_row.pronamespace
  where namespace_row.nspname = 'public'
    and function_row.proname = 'guard_teacher_microcourse_integrity'
    and pg_get_function_identity_arguments(function_row.oid) = '';

  if guard_definition is null then
    raise exception 'TEACHER_MICROCOURSE_GUARD_MISSING';
  end if;

  if position('lecture_row.no = 1' in guard_definition) > 0 then
    execute $ddl$
      create or replace function public.guard_teacher_microcourse_integrity()
      returns trigger
      language plpgsql
      set search_path = public, pg_temp
      as $function$
      begin
        if not exists (
          select 1
          from public.courses course_row
          join public.course_lectures lecture_row
            on lecture_row.id = new.lecture_id
           and lecture_row.course_id = course_row.id
          where course_row.id = new.course_id
            and course_row.course_kind = 'microcourse'
        ) then
          raise exception 'INVALID_MICROCOURSE_COURSE_LECTURE';
        end if;
        if not exists (
          select 1
          from public.class_sessions session_row
          join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
          where session_row.id = new.source_session_id
            and session_row.deleted_at is null
            and session_row.lecture_id is null
            and classroom_row.course_id is null
        ) then
          raise exception 'MICROCOURSE_SOURCE_MUST_BE_FREE_SESSION';
        end if;
        return new;
      end;
      $function$
    $ddl$;
  end if;

  select pg_get_functiondef(function_row.oid)
  into guard_definition
  from pg_proc function_row
  join pg_namespace namespace_row on namespace_row.oid = function_row.pronamespace
  where namespace_row.nspname = 'public'
    and function_row.proname = 'guard_teacher_microcourse_integrity'
    and pg_get_function_identity_arguments(function_row.oid) = '';

  if position('lecture_row.no = 1' in guard_definition) > 0 then
    raise exception 'TEACHER_MICROCOURSE_SINGLE_LECTURE_GUARD_REMAINS';
  end if;
end
$migration$;

commit;
