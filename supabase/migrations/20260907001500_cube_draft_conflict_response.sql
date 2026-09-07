-- 版本不一致属于业务冲突，使用普通应用错误，与可重试的数据库事务错误区分。
create or replace function public.save_cube_structure_draft(
  p_id uuid, p_name text, p_snapshot jsonb, p_expected_revision integer
)
returns public.cube_structure_drafts language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  saved public.cube_structure_drafts;
begin
  if auth.uid() is null or not public.cube_drafts_account_ready() then
    raise exception 'CUBE_DRAFT_FORBIDDEN' using errcode = '42501';
  end if;
  if p_id is null or p_name is null or char_length(btrim(p_name)) not between 1 and 80
    or p_snapshot is null or p_expected_revision is null or p_expected_revision < 0
    or not coalesce(
      jsonb_typeof(p_snapshot) = 'object'
      and p_snapshot ->> 'version' = 'cube-structures-saved-draft-v1'
      and jsonb_typeof(p_snapshot -> 'session') = 'object'
      and jsonb_typeof(p_snapshot -> 'identity') = 'number'
      and p_snapshot #>> '{session,recording}' in ('off', 'paused')
      and p_snapshot #> '{session,preview}' = 'null'::jsonb
      and octet_length(p_snapshot::text) <= 8000000, false
    ) then raise exception 'CUBE_DRAFT_INVALID' using errcode = '22023';
  end if;
  if p_expected_revision = 0 then
    perform pg_advisory_xact_lock(hashtextextended('cube-drafts:' || auth.uid()::text, 0));
    if (select count(*) from public.cube_structure_drafts where owner_id = auth.uid()) >= 200 then
      raise exception 'CUBE_DRAFT_LIMIT' using errcode = '54000';
    end if;
    insert into public.cube_structure_drafts(id, owner_id, name, snapshot)
      values (p_id, auth.uid(), btrim(p_name), p_snapshot)
      on conflict (id) do nothing returning * into saved;
    if saved.id is null then raise exception 'CUBE_DRAFT_CONFLICT' using errcode = 'P0001'; end if;
  else
    update public.cube_structure_drafts
      set name = btrim(p_name), snapshot = p_snapshot, revision = revision + 1, updated_at = clock_timestamp()
      where id = p_id and owner_id = auth.uid() and revision = p_expected_revision
      returning * into saved;
    if saved.id is null then
      if exists(select 1 from public.cube_structure_drafts where id = p_id and owner_id = auth.uid()) then
        raise exception 'CUBE_DRAFT_CONFLICT' using errcode = 'P0001';
      end if;
      raise exception 'CUBE_DRAFT_MISSING' using errcode = 'P0002';
    end if;
  end if;
  return saved;
end;
$$;
