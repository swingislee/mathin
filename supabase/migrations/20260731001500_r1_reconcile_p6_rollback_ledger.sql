-- R1-6 prerequisite: reconcile the one known pre-commit P6 migration checksum.
-- The development database applied this migration before its Git commit. Only repair
-- the ledger when the exact legacy checksum and the expected live contract both match.
do $$
declare
  migration_version constant text := '20260719000400_p6_adapt_release_rollback';
  legacy_checksum constant text := 'f43b314562335d88177f09d9f0ca6929cf7f1a54b462dbd18db5e0100a733522';
  canonical_checksum constant text := 'ee65c4aeeae676c523bb78e280153a080cadb53842230eb8a4bc846a33d3979c';
  current_checksum text;
  rollback_function regprocedure := to_regprocedure('public.rollback_cw_lecture_release(uuid,uuid,text)');
  function_definition text;
begin
  select checksum
    into current_checksum
    from public.schema_migrations
   where version = migration_version
   for update;

  -- Fresh databases do not have post-snapshot rows yet; the generated ledger adds them.
  if current_checksum is null or current_checksum = canonical_checksum then
    return;
  end if;

  if current_checksum <> legacy_checksum then
    raise exception 'UNEXPECTED_P6_ROLLBACK_LEDGER_CHECKSUM: %', current_checksum;
  end if;

  if rollback_function is null then
    raise exception 'P6_ROLLBACK_FUNCTION_MISSING';
  end if;

  function_definition := lower(pg_get_functiondef(rollback_function));
  if function_definition not like '%insert into public.cw_lecture_releases%'
     or function_definition not like '%draft_revision_id = null%'
     or function_definition not like '%current_release_id = release_id%' then
    raise exception 'P6_ROLLBACK_FUNCTION_CONTRACT_MISMATCH';
  end if;

  if has_function_privilege('anon', rollback_function, 'execute')
     or exists (
       select 1
         from pg_proc p
         cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
        where p.oid = rollback_function
          and privilege.grantee = 0
          and privilege.privilege_type = 'EXECUTE'
     )
     or not has_function_privilege('authenticated', rollback_function, 'execute') then
    raise exception 'P6_ROLLBACK_FUNCTION_PRIVILEGE_MISMATCH';
  end if;

  update public.schema_migrations
     set checksum = canonical_checksum
   where version = migration_version
     and checksum = legacy_checksum;

  if not found then
    raise exception 'P6_ROLLBACK_LEDGER_RECONCILIATION_RACE';
  end if;
end;
$$;
