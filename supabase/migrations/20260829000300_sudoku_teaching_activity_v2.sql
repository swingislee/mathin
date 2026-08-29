-- Versioned classroom Sudoku goals. Legacy sudoku-authored-v1 stays readable
-- but new authoring uses v2 so a teacher-led or forced-target board need not
-- claim that the entire puzzle has a unique solution.

begin;

update public.cw_game_content_contracts
set authorable = false
where game_id = 'sudoku'
  and content_version = 'sudoku-authored-v1';

insert into public.cw_game_content_contracts(
  game_id, content_version, validator_version, authorable, copyable, enabled
) values (
  'sudoku', 'sudoku-authored-v2', 'sudoku-authored-v2@1', true, true, true
)
on conflict (game_id, content_version) do update
set validator_version = excluded.validator_version,
    authorable = excluded.authorable,
    copyable = excluded.copyable,
    enabled = excluded.enabled;

commit;

