-- Keep legacy v1 revisions editable. New microcourse creation is restricted by
-- the server-side authoring-surface registry to sudoku-authored-v2; the database
-- authorable flag also gates service-attested saves and therefore cannot be
-- disabled without breaking existing pages.

begin;

update public.cw_game_content_contracts
set authorable = true
where game_id = 'sudoku'
  and content_version = 'sudoku-authored-v1';

commit;

