-- Reconcile the known pre-commit checksum for the R1-5 family learning actions.
-- The functional family/RLS assertions remain the behavioral proof; this migration
-- additionally refuses to repair metadata unless the durable object contract exists.
do $$
declare
  migration_version constant text := '20260729000200_r1_family_learning_actions';
  legacy_checksum constant text := '474bc29f3f7ce227edb0786c868e40c160703a616fe449dc7ec27bd731c87902';
  canonical_checksum constant text := '95f93022ad698c0511739166f5f1ddcec43ae3eca03291d64e34ea90fbb30409';
  current_checksum text;
begin
  select checksum
    into current_checksum
    from public.schema_migrations
   where version = migration_version
   for update;

  if current_checksum is null or current_checksum = canonical_checksum then
    return;
  end if;

  if current_checksum <> legacy_checksum then
    raise exception 'UNEXPECTED_FAMILY_ACTIONS_LEDGER_CHECKSUM: %', current_checksum;
  end if;

  if not exists (
       select 1
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'submissions'
          and column_name = 'submitted_by'
     )
     or to_regprocedure('public.can_submit_student_assignment(uuid,uuid)') is null
     or to_regprocedure('public.submit_assignment_for_student(uuid,uuid,jsonb)') is null
     or to_regprocedure('public.can_upload_student_media(uuid,uuid)') is null
     or to_regprocedure('public.notify_family_learning_change()') is null
     or to_regprocedure('public.notify_leave_request_change()') is null
     or not exists (
       select 1
         from storage.buckets
        where id = 'assignment-submissions'
          and public = false
     )
     or not exists (
       select 1
         from pg_trigger
        where tgrelid = 'public.submissions'::regclass
          and tgname = 'submissions_link_managed_files'
          and not tgisinternal
     )
     or not exists (
       select 1
         from pg_trigger
        where tgrelid = 'public.session_leave_requests'::regclass
          and tgname = 'session_leave_requests_notify_roles'
          and not tgisinternal
     ) then
    raise exception 'FAMILY_ACTIONS_OBJECT_CONTRACT_MISMATCH';
  end if;

  update public.schema_migrations
     set checksum = canonical_checksum
   where version = migration_version
     and checksum = legacy_checksum;

  if not found then
    raise exception 'FAMILY_ACTIONS_LEDGER_RECONCILIATION_RACE';
  end if;
end;
$$;
