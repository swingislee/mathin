\set ON_ERROR_STOP on

do $$
begin
  if exists (
    select 1
    from public.cw_page_revisions revision_row
    join public.cw_page_docs page_row on page_row.id = revision_row.page_doc_id
    where exists (
      select 1
      from public.teacher_microcourses microcourse_row
      where microcourse_row.lecture_id = page_row.lecture_id
    )
      and revision_row.doc ->> 'docVersion' <> 'courseware-composition-v1'
  ) then raise exception 'TEACHER_EDITOR_HAS_NON_COMPOSITION_REVISION'; end if;

  if exists (
    select 1
    from public.cw_page_revisions revision_row
    join public.cw_page_docs page_row on page_row.id = revision_row.page_doc_id
    where exists (
      select 1
      from public.teacher_microcourses microcourse_row
      where microcourse_row.lecture_id = page_row.lecture_id
    )
      and not public.cw_courseware_composition_doc_is_valid(revision_row.doc)
  ) then raise exception 'TEACHER_EDITOR_HAS_INVALID_COMPOSITION'; end if;

  if has_function_privilege(
    'authenticated',
    'public.save_teacher_microcourse_page(uuid,jsonb,integer,text,text)',
    'execute'
  ) then raise exception 'LEGACY_TEACHER_PAGE_WRITER_STILL_EXECUTABLE'; end if;

  if has_function_privilege(
    'authenticated',
    'public.create_teacher_microcourse_h5_page(uuid,uuid,uuid,text)',
    'execute'
  ) then raise exception 'LEGACY_TEACHER_H5_WRITER_STILL_EXECUTABLE'; end if;
end;
$$;

\echo 'Teacher microcourse editor unification assertions passed'
