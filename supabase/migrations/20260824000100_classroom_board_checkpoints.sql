-- M2-B: versioned latest-only classroom board checkpoints.
-- Business session_events stay append-only. Board state moves to an atomic
-- manifest/chunk store so a long class never depends on a single 1 MiB event.

begin;

create table public.session_board_checkpoint_versions (
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  board_key text not null,
  version bigint not null,
  checkpoint_id uuid not null unique,
  writer_id text not null,
  writer_seq bigint not null,
  item_count integer not null,
  chunk_count integer not null,
  content_bytes integer not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (session_id, board_key, version),
  constraint session_board_checkpoint_board_key check (
    board_key = 'side'
    or board_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  constraint session_board_checkpoint_writer_id check (char_length(writer_id) between 1 and 128),
  constraint session_board_checkpoint_writer_seq check (writer_seq >= 1),
  constraint session_board_checkpoint_item_count check (item_count between 0 and 4000),
  constraint session_board_checkpoint_chunk_count check (chunk_count between 1 and 64),
  constraint session_board_checkpoint_content_bytes check (content_bytes between 2 and 12582912)
);

create table public.session_board_checkpoint_chunks (
  session_id uuid not null,
  board_key text not null,
  version bigint not null,
  chunk_index integer not null,
  items jsonb not null,
  primary key (session_id, board_key, version, chunk_index),
  foreign key (session_id, board_key, version)
    references public.session_board_checkpoint_versions(session_id, board_key, version)
    on delete cascade,
  constraint session_board_checkpoint_chunk_index check (chunk_index between 0 and 63),
  constraint session_board_checkpoint_chunk_array check (jsonb_typeof(items) = 'array'),
  constraint session_board_checkpoint_chunk_bytes check (octet_length(items::text) <= 196608)
);

create table public.session_board_checkpoint_heads (
  session_id uuid not null,
  board_key text not null,
  version bigint not null,
  updated_at timestamptz not null default now(),
  primary key (session_id, board_key),
  foreign key (session_id, board_key, version)
    references public.session_board_checkpoint_versions(session_id, board_key, version)
    on delete restrict
);

create index session_board_checkpoint_versions_created_idx
  on public.session_board_checkpoint_versions(session_id, created_at desc);

alter table public.session_board_checkpoint_versions enable row level security;
alter table public.session_board_checkpoint_chunks enable row level security;
alter table public.session_board_checkpoint_heads enable row level security;

create policy session_board_checkpoint_versions_rpc_only
  on public.session_board_checkpoint_versions for all using (false) with check (false);
create policy session_board_checkpoint_chunks_rpc_only
  on public.session_board_checkpoint_chunks for all using (false) with check (false);
create policy session_board_checkpoint_heads_rpc_only
  on public.session_board_checkpoint_heads for all using (false) with check (false);

revoke all on public.session_board_checkpoint_versions,
  public.session_board_checkpoint_chunks,
  public.session_board_checkpoint_heads from public, anon, authenticated;

create or replace function public.save_session_board_checkpoint(
  p_session_id uuid,
  p_board_key text,
  p_checkpoint_id uuid,
  p_writer_id text,
  p_writer_seq bigint,
  p_base_version bigint,
  p_item_count integer,
  p_chunks jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  current_row public.session_board_checkpoint_versions;
  existing_version bigint;
  next_version bigint;
  chunk_value jsonb;
  chunk_position integer := 0;
  measured_items integer := 0;
  measured_bytes integer := 0;
begin
  if uid is null or not public.is_session_teacher(p_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  if p_board_key is null or not (
    p_board_key = 'side'
    or p_board_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'VALIDATION';
  end if;
  if p_checkpoint_id is null
     or p_writer_id is null or char_length(p_writer_id) not between 1 and 128
     or p_writer_seq is null or p_writer_seq < 1
     or p_base_version is null or p_base_version < 0
     or p_item_count is null or p_item_count not between 0 and 4000
     or p_chunks is null or jsonb_typeof(p_chunks) <> 'array' then
    raise exception 'VALIDATION';
  end if;
  if jsonb_array_length(p_chunks) not between 1 and 64 then
    raise exception 'VALIDATION';
  end if;

  -- Serialize all writers for one board, including the first insert where no row exists yet.
  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text || ':' || p_board_key, 0));

  select version into existing_version
    from public.session_board_checkpoint_versions
   where checkpoint_id = p_checkpoint_id;
  if existing_version is not null then
    return jsonb_build_object('accepted', true, 'status', 'idempotent', 'version', existing_version);
  end if;

  select version_row.* into current_row
    from public.session_board_checkpoint_heads head_row
    join public.session_board_checkpoint_versions version_row
      on version_row.session_id = head_row.session_id
     and version_row.board_key = head_row.board_key
     and version_row.version = head_row.version
   where head_row.session_id = p_session_id and head_row.board_key = p_board_key;

  if current_row.version is not null then
    if current_row.writer_id = p_writer_id and p_writer_seq <= current_row.writer_seq then
      return jsonb_build_object('accepted', false, 'status', 'stale', 'version', current_row.version);
    end if;
    if current_row.writer_id <> p_writer_id and coalesce(p_base_version, 0) <> current_row.version then
      return jsonb_build_object('accepted', false, 'status', 'conflict', 'version', current_row.version);
    end if;
  elsif coalesce(p_base_version, 0) <> 0 then
    return jsonb_build_object('accepted', false, 'status', 'conflict', 'version', 0);
  end if;

  for chunk_value in select value from jsonb_array_elements(p_chunks)
  loop
    if jsonb_typeof(chunk_value) <> 'array' or octet_length(chunk_value::text) > 196608 then
      raise exception 'CHECKPOINT_CHUNK_TOO_LARGE';
    end if;
    measured_items := measured_items + jsonb_array_length(chunk_value);
    measured_bytes := measured_bytes + octet_length(chunk_value::text);
  end loop;
  if measured_items <> p_item_count then
    raise exception 'CHECKPOINT_MANIFEST_MISMATCH';
  end if;

  next_version := coalesce(current_row.version, 0) + 1;
  insert into public.session_board_checkpoint_versions(
    session_id, board_key, version, checkpoint_id, writer_id, writer_seq,
    item_count, chunk_count, content_bytes, created_by
  ) values (
    p_session_id, p_board_key, next_version, p_checkpoint_id, p_writer_id, p_writer_seq,
    p_item_count, jsonb_array_length(p_chunks), measured_bytes, uid
  );

  chunk_position := 0;
  for chunk_value in select value from jsonb_array_elements(p_chunks)
  loop
    insert into public.session_board_checkpoint_chunks(
      session_id, board_key, version, chunk_index, items
    ) values (p_session_id, p_board_key, next_version, chunk_position, chunk_value);
    chunk_position := chunk_position + 1;
  end loop;

  insert into public.session_board_checkpoint_heads(session_id, board_key, version, updated_at)
  values (p_session_id, p_board_key, next_version, now())
  on conflict (session_id, board_key) do update
    set version = excluded.version, updated_at = excluded.updated_at;

  delete from public.session_board_checkpoint_versions
   where session_id = p_session_id and board_key = p_board_key and version < next_version;

  return jsonb_build_object('accepted', true, 'status', 'saved', 'version', next_version);
end;
$$;

create or replace function public.get_session_board_checkpoints(
  p_session_id uuid,
  p_board_key text default null
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  if not public.is_session_member(p_session_id, uid) then
    return '[]'::jsonb;
  end if;
  if p_board_key is not null and not (
    p_board_key = 'side'
    or p_board_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'VALIDATION';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'boardKey', version_row.board_key,
      'version', version_row.version,
      'checkpointId', version_row.checkpoint_id,
      'createdAt', version_row.created_at,
      'itemCount', version_row.item_count,
      'chunkCount', version_row.chunk_count,
      'contentBytes', version_row.content_bytes,
      'items', coalesce((
        select jsonb_agg(item_value.value order by chunk_row.chunk_index, item_value.ordinality)
          from public.session_board_checkpoint_chunks chunk_row
          cross join lateral jsonb_array_elements(chunk_row.items) with ordinality item_value(value, ordinality)
         where chunk_row.session_id = version_row.session_id
           and chunk_row.board_key = version_row.board_key
           and chunk_row.version = version_row.version
      ), '[]'::jsonb)
    ) order by version_row.board_key
  ), '[]'::jsonb) into result
    from public.session_board_checkpoint_heads head_row
    join public.session_board_checkpoint_versions version_row
      on version_row.session_id = head_row.session_id
     and version_row.board_key = head_row.board_key
     and version_row.version = head_row.version
   where head_row.session_id = p_session_id
     and (p_board_key is null or head_row.board_key = p_board_key);
  return result;
end;
$$;

create or replace function public.get_session_legacy_board_snapshots(p_session_id uuid)
returns table (
  id uuid,
  session_id uuid,
  user_id uuid,
  device_id text,
  seq bigint,
  type text,
  payload jsonb,
  at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  if not public.is_session_member(p_session_id, auth.uid()) then
    return;
  end if;
  return query
  select distinct on (event_row.payload ->> 'pageKey')
    event_row.id, event_row.session_id, event_row.user_id, event_row.device_id,
    event_row.seq, event_row.type, event_row.payload, event_row.at, event_row.created_at
    from public.session_events event_row
   where event_row.session_id = p_session_id
     and event_row.type = 'board_snapshot'
     and nullif(event_row.payload ->> 'pageKey', '') is not null
   order by event_row.payload ->> 'pageKey', event_row.created_at desc, event_row.id desc;
end;
$$;

revoke all on function public.save_session_board_checkpoint(uuid,text,uuid,text,bigint,bigint,integer,jsonb) from public, anon;
revoke all on function public.get_session_board_checkpoints(uuid,text) from public, anon;
revoke all on function public.get_session_legacy_board_snapshots(uuid) from public, anon;
grant execute on function public.save_session_board_checkpoint(uuid,text,uuid,text,bigint,bigint,integer,jsonb) to authenticated;
grant execute on function public.get_session_board_checkpoints(uuid,text) to authenticated;
grant execute on function public.get_session_legacy_board_snapshots(uuid) to authenticated;

create or replace function public.organization_feature_keys()
returns text[] language sql immutable
as $$
  select array[
    'finance.enabled',
    'notifications.email',
    'notifications.sms',
    'notifications.wechat',
    'public_content.publish',
    'teaching.preparation_archive_edit',
    'teaching.classroom_board_checkpoint_v2'
  ]::text[]
$$;

insert into public.feature_flag_versions(
  organization_id, flag_key, version, enabled, effective_from, reason
)
select organization_row.id, 'teaching.classroom_board_checkpoint_v2', 1, false, now(),
       'M2-B fail-closed default'
  from public.organizations organization_row
 where organization_row.singleton_key = 1
on conflict do nothing;

comment on table public.session_board_checkpoint_versions is
  'M2-B latest classroom board checkpoint manifest; old versions are removed after atomic head advance';
comment on function public.save_session_board_checkpoint(uuid,text,uuid,text,bigint,bigint,integer,jsonb) is
  'Teacher-only atomic checkpoint save; same-writer seq rejects late offline state and cross-writer updates require current base version';

commit;
