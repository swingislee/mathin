-- 方块结构工具的账号私有草稿；独立于正式课件、发布版本和课堂快照。
create table public.cube_structure_drafts (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  revision integer not null default 1 check (revision > 0),
  snapshot jsonb not null check (
    jsonb_typeof(snapshot) = 'object'
    and snapshot ->> 'version' = 'cube-structures-saved-draft-v1'
    and jsonb_typeof(snapshot -> 'session') = 'object'
    and jsonb_typeof(snapshot -> 'identity') = 'number'
    and snapshot #>> '{session,recording}' in ('off', 'paused')
    and snapshot #> '{session,preview}' = 'null'::jsonb
    and octet_length(snapshot::text) <= 8000000
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cube_structure_drafts_owner_updated_idx on public.cube_structure_drafts(owner_id, updated_at desc, id);

create function public.cube_drafts_account_ready()
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid()
      and p.is_active and p.account_status = 'active' and not p.password_change_required
  ) and coalesce(public.has_current_required_consents(auth.uid()), false);
$$;
revoke all on function public.cube_drafts_account_ready() from public, anon;
grant execute on function public.cube_drafts_account_ready() to authenticated;

alter table public.cube_structure_drafts enable row level security;
create policy cube_structure_drafts_owner_read on public.cube_structure_drafts
for select to authenticated
using (owner_id = (select auth.uid()) and (select public.cube_drafts_account_ready()));
revoke all on public.cube_structure_drafts from public, anon, authenticated;
grant select on public.cube_structure_drafts to authenticated;

-- 所有更新经过版本比较；直接表写入不会绕过并发保护。
create function public.save_cube_structure_draft(
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
    -- 同一账号串行检查容量，200 份上限也约束绕过页面的直接 RPC。
    perform pg_advisory_xact_lock(hashtextextended('cube-drafts:' || auth.uid()::text, 0));
    if (select count(*) from public.cube_structure_drafts where owner_id = auth.uid()) >= 200 then
      raise exception 'CUBE_DRAFT_LIMIT' using errcode = '54000';
    end if;
    insert into public.cube_structure_drafts(id, owner_id, name, snapshot)
      values (p_id, auth.uid(), btrim(p_name), p_snapshot)
      on conflict (id) do nothing returning * into saved;
    if saved.id is null then raise exception 'CUBE_DRAFT_CONFLICT' using errcode = '40001'; end if;
  else
    update public.cube_structure_drafts
      set name = btrim(p_name), snapshot = p_snapshot, revision = revision + 1, updated_at = clock_timestamp()
      where id = p_id and owner_id = auth.uid() and revision = p_expected_revision
      returning * into saved;
    if saved.id is null then
      if exists(select 1 from public.cube_structure_drafts where id = p_id and owner_id = auth.uid()) then
        raise exception 'CUBE_DRAFT_CONFLICT' using errcode = '40001';
      end if;
      raise exception 'CUBE_DRAFT_MISSING' using errcode = 'P0002';
    end if;
  end if;
  return saved;
end;
$$;
revoke all on function public.save_cube_structure_draft(uuid, text, jsonb, integer) from public, anon;
grant execute on function public.save_cube_structure_draft(uuid, text, jsonb, integer) to authenticated;
