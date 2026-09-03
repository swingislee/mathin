-- DATA-IMPORT-CLASS-ROSTER-6: academic years and operating periods are
-- organization-wide. A source campus selects the class location only; it must
-- not scope the operating-term lookup for an automatically created class.

begin;

do $migration$
declare
  preview_function regprocedure := to_regprocedure(
    'public.preview_mofaxiao_class_roster_import(text,jsonb,text,text,text,text,text,text,text)'
  );
  apply_function regprocedure := to_regprocedure(
    'mathin_internal.apply_mofaxiao_class_roster_import_class_type_base(uuid)'
  );
  original_definition text;
  amended_definition text;
begin
  if to_regclass('public.school_years_start_year_org_unique_idx') is null then
    raise exception 'ORGANIZATION_ACADEMIC_AXIS_REQUIRED';
  end if;
  if preview_function is null then
    raise exception 'MOFAXIAO_ROSTER_PREVIEW_FUNCTION_MISSING';
  end if;
  if apply_function is null then
    raise exception 'MOFAXIAO_ROSTER_APPLY_FUNCTION_MISSING';
  end if;

  original_definition := pg_get_functiondef(preview_function);
  amended_definition := regexp_replace(
    original_definition,
    'term\.campus_id[[:space:]]*=[[:space:]]*v_default_campus_id[[:space:]]+and[[:space:]]+term\.year[[:space:]]*=[[:space:]]*v_default_year',
    'term.year = v_default_year',
    'g'
  );
  if amended_definition = original_definition then
    raise exception 'MOFAXIAO_ROSTER_PREVIEW_TERM_SCOPE_NOT_FOUND';
  end if;
  execute amended_definition;

  original_definition := pg_get_functiondef(apply_function);
  amended_definition := regexp_replace(
    original_definition,
    'term\.campus_id[[:space:]]*=[[:space:]]*v_campus_id[[:space:]]+and[[:space:]]+term\.year[[:space:]]*=[[:space:]]*v_school_year',
    'term.year = v_school_year',
    'g'
  );
  if amended_definition = original_definition then
    raise exception 'MOFAXIAO_ROSTER_APPLY_TERM_SCOPE_NOT_FOUND';
  end if;
  execute amended_definition;

  if position(
    'term.campus_id = v_default_campus_id'
    in pg_get_functiondef(preview_function)
  ) > 0 then
    raise exception 'MOFAXIAO_ROSTER_PREVIEW_STILL_CAMPUS_SCOPED';
  end if;
  if position(
    'term.campus_id = v_campus_id'
    in pg_get_functiondef(apply_function)
  ) > 0 then
    raise exception 'MOFAXIAO_ROSTER_APPLY_STILL_CAMPUS_SCOPED';
  end if;
end
$migration$;

comment on function public.preview_mofaxiao_class_roster_import(
  text, jsonb, text, text, text, text, text, text, text
) is
  'Validates a Mofaxiao roster batch; source campus selects the location while school year and season resolve the organization-wide operating term.';
comment on function public.apply_mofaxiao_class_roster_import(uuid) is
  'Applies a validated Mofaxiao roster batch using the organization-wide operating term and keeping business class type separate from textbook variant.';

revoke all on function public.preview_mofaxiao_class_roster_import(
  text, jsonb, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.preview_mofaxiao_class_roster_import(
  text, jsonb, text, text, text, text, text, text, text
) to authenticated;
revoke all on function mathin_internal.apply_mofaxiao_class_roster_import_class_type_base(uuid)
  from public, anon, authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
