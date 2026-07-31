-- Reconcile the known pre-commit checksum for the P6 center-title adaptation constraint.
-- Fresh databases have no row yet; unexpected legacy states remain fail-closed.
do $$
declare
  migration_version constant text := '20260719000600_p6_center_title_4x3';
  legacy_checksum constant text := '2771422798988be850187d6d51899e9a39b5faface7f7b5ead7d46d44ae0f9d3';
  canonical_checksum constant text := '765819b936ffa73d9d287ea8929842a1fa8b463cbdc8010c2a134612dc39f4df';
  current_checksum text;
  constraint_definition text;
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
    raise exception 'UNEXPECTED_P6_CENTER_TITLE_LEDGER_CHECKSUM: %', current_checksum;
  end if;

  select pg_get_constraintdef(oid)
    into constraint_definition
    from pg_constraint
   where conrelid = 'public.cw_page_docs'::regclass
     and conname = 'cw_page_docs_adapt_class_check'
     and contype = 'c';

  if constraint_definition is null
     or constraint_definition not like '%''A''%'
     or constraint_definition not like '%''B''%'
     or constraint_definition not like '%''C''%'
     or constraint_definition not like '%''D''%'
     or constraint_definition not like '%''E''%'
     or constraint_definition not like '%''F''%' then
    raise exception 'P6_CENTER_TITLE_CONSTRAINT_MISMATCH';
  end if;

  update public.schema_migrations
     set checksum = canonical_checksum
   where version = migration_version
     and checksum = legacy_checksum;

  if not found then
    raise exception 'P6_CENTER_TITLE_LEDGER_RECONCILIATION_RACE';
  end if;
end;
$$;
