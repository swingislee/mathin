\set ON_ERROR_STOP on

do $$
begin
  if exists (
    select 1
    from public.cw_page_revisions revision_row
    join public.cw_page_docs page_row on page_row.id = revision_row.page_doc_id
    join public.teacher_microcourses microcourse_row
      on microcourse_row.lecture_id = page_row.lecture_id
    where revision_row.doc ->> 'docVersion' = 'microcourse-page-v1'
      and revision_row.doc ->> 'mode' = 'sudoku'
  ) then raise exception 'LEGACY_TEACHER_SUDOKU_REMAINS'; end if;

  if exists (
    select 1
    from public.cw_page_revisions revision_row
    join public.cw_page_docs page_row on page_row.id = revision_row.page_doc_id
    join public.teacher_microcourses microcourse_row
      on microcourse_row.lecture_id = page_row.lecture_id
    where revision_row.doc ->> 'docVersion' = 'game-page-v1'
      and revision_row.doc ->> 'gameId' = 'sudoku'
  ) then raise exception 'STANDALONE_TEACHER_SUDOKU_REMAINS'; end if;

  if public.cw_microcourse_page_doc_is_valid(jsonb_build_object(
    'docVersion', 'microcourse-page-v1',
    'mode', 'sudoku',
    'canvas', jsonb_build_object('width', 960, 'height', 720, 'backgroundColor', null),
    'puzzle', to_jsonb(array_fill(0, array[81])),
    'display', jsonb_build_object(
      'showCoordinates', true,
      'allowCandidates', true,
      'allowAnswerReveal', false,
      'showTeachingTools', true
    ),
    'analysis', jsonb_build_object('status', 'multiple', 'solutionCount', 2, 'solution', null)
  )) then raise exception 'LEGACY_TEACHER_SUDOKU_VALIDATOR_STILL_OPEN'; end if;
end;
$$;

\echo 'Teacher microcourse composition upgrade assertions passed'
