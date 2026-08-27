-- DEV-TMC-2: generic, registry-backed game pages for teacher microcourses.
-- Existing microcourse-page-v1 Sudoku revisions remain readable; new authored
-- games use game-page-v1 plus a service-attested immutable validation record.

begin;

-- ---------------------------------------------------------------------------
-- 1. Registered game content contracts and immutable validation attestations
-- ---------------------------------------------------------------------------

create table public.cw_game_content_contracts (
  game_id text not null check (
    char_length(game_id) between 1 and 80
    and game_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  content_version text not null check (
    char_length(content_version) between 1 and 100
    and content_version ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  validator_version text not null check (char_length(validator_version) between 1 and 100),
  authorable boolean not null default false,
  copyable boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (game_id, content_version)
);

insert into public.cw_game_content_contracts(
  game_id, content_version, validator_version, authorable, copyable, enabled
) values (
  'sudoku', 'sudoku-authored-v1', 'sudoku-authored-v1@1', true, true, true
);

create table public.cw_game_revision_validations (
  revision_id uuid primary key
    references public.cw_page_revisions(id) on delete cascade,
  game_id text not null,
  content_version text not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  validator_version text not null check (char_length(validator_version) between 1 and 100),
  publishable boolean not null,
  code text not null check (char_length(code) between 1 and 100),
  details jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (game_id, content_version)
    references public.cw_game_content_contracts(game_id, content_version)
    on update restrict on delete restrict
);

create index cw_game_revision_validations_contract_idx
  on public.cw_game_revision_validations(game_id, content_version, created_at desc);

alter table public.cw_game_content_contracts enable row level security;
alter table public.cw_game_revision_validations enable row level security;

revoke all on public.cw_game_content_contracts from public, anon, authenticated, service_role;
revoke all on public.cw_game_revision_validations from public, anon, authenticated, service_role;

comment on table public.cw_game_content_contracts is
  'Server-maintained registry of versioned game payload contracts accepted by courseware.';
comment on table public.cw_game_revision_validations is
  'Immutable service attestation for the exact payload embedded in one game-page-v1 revision.';

-- ---------------------------------------------------------------------------
-- 2. Generic game-page-v1 structural contract
-- ---------------------------------------------------------------------------

create function public.cw_game_page_doc_is_valid(p_doc jsonb)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_typeof(p_doc) = 'object'
    and p_doc ->> 'docVersion' = 'game-page-v1'
    and jsonb_typeof(p_doc -> 'canvas') = 'object'
    and p_doc #>> '{canvas,width}' = '960'
    and p_doc #>> '{canvas,height}' = '720'
    and (
      p_doc #> '{canvas,backgroundColor}' = 'null'::jsonb
      or jsonb_typeof(p_doc #> '{canvas,backgroundColor}') = 'string'
    )
    and char_length(coalesce(p_doc ->> 'gameId', '')) between 1 and 80
    and coalesce(p_doc ->> 'gameId', '') ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    and char_length(coalesce(p_doc ->> 'contentVersion', '')) between 1 and 100
    and coalesce(p_doc ->> 'contentVersion', '') ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    and p_doc ? 'payload'
    and jsonb_typeof(p_doc -> 'validation') = 'object'
    and coalesce(p_doc #>> '{validation,payloadHash}', '') ~ '^[0-9a-f]{64}$'
    and char_length(coalesce(p_doc #>> '{validation,validatorVersion}', '')) between 1 and 100
    and jsonb_typeof(p_doc #> '{validation,publishable}') = 'boolean'
    and char_length(coalesce(p_doc #>> '{validation,code}', '')) between 1 and 100
    and (p_doc -> 'validation') ? 'details'
    and octet_length(p_doc::text) <= 2097152,
    false
  )
$$;

create function public.cw_game_page_revision_validation_is_current(
  p_revision_id uuid,
  p_require_publishable boolean default false
)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select coalesce((
    select
      revision_row.doc_version = 'game-page-v1'
      and public.cw_game_page_doc_is_valid(revision_row.doc)
      and contract_row.enabled
      and validation_row.game_id = revision_row.doc ->> 'gameId'
      and validation_row.content_version = revision_row.doc ->> 'contentVersion'
      and validation_row.payload_hash = revision_row.doc #>> '{validation,payloadHash}'
      and validation_row.validator_version = contract_row.validator_version
      and validation_row.validator_version = revision_row.doc #>> '{validation,validatorVersion}'
      and to_jsonb(validation_row.publishable)
        = revision_row.doc #> '{validation,publishable}'
      and validation_row.code = revision_row.doc #>> '{validation,code}'
      and validation_row.details = revision_row.doc #> '{validation,details}'
      and validation_row.created_by is not distinct from revision_row.created_by
      and (not coalesce(p_require_publishable, false) or validation_row.publishable)
    from public.cw_page_revisions revision_row
    join public.cw_game_revision_validations validation_row
      on validation_row.revision_id = revision_row.id
    join public.cw_game_content_contracts contract_row
      on contract_row.game_id = validation_row.game_id
     and contract_row.content_version = validation_row.content_version
    where revision_row.id = p_revision_id
  ), false)
$$;

revoke all on function public.cw_game_page_revision_validation_is_current(uuid, boolean)
  from public, anon, authenticated, service_role;

-- A composition source may now pin a published game page. The nested game
-- document is still immutable; teachers only edit the overlay.
create or replace function public.cw_microcourse_page_doc_is_valid(p_doc jsonb)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_typeof(p_doc) = 'object'
    and p_doc ->> 'docVersion' = 'microcourse-page-v1'
    and p_doc ->> 'mode' in ('composition', 'sudoku', 'h5')
    and jsonb_typeof(p_doc -> 'canvas') = 'object'
    and p_doc #>> '{canvas,width}' = '960'
    and p_doc #>> '{canvas,height}' = '720'
    and (
      (
        p_doc ->> 'mode' = 'composition'
        and jsonb_typeof(p_doc -> 'overlay') = 'object'
        and p_doc #>> '{overlay,docVersion}' = 'page-doc-v1'
        and p_doc #>> '{overlay,canvas,width}' = '960'
        and p_doc #>> '{overlay,canvas,height}' = '720'
        and (
          p_doc -> 'source' = 'null'::jsonb
          or (
            jsonb_typeof(p_doc -> 'source') = 'object'
            and (
              p_doc #>> '{source,doc,docVersion}' in (
                'page-doc-v1', 'aixuexi-page-doc-v1', 'spatial-page-v1'
              )
              or public.cw_game_page_doc_is_valid(p_doc #> '{source,doc}')
            )
            and coalesce(p_doc #>> '{source,sourceReleaseId}', '')
              ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            and coalesce(p_doc #>> '{source,sourceRevisionId}', '')
              ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          )
        )
      )
      or (
        p_doc ->> 'mode' = 'sudoku'
        and public.teacher_microcourse_sudoku_puzzle_is_valid(p_doc -> 'puzzle')
        and jsonb_typeof(p_doc -> 'display') = 'object'
        and jsonb_typeof(p_doc -> 'analysis') = 'object'
        and p_doc #>> '{analysis,status}' in ('conflict', 'unsolvable', 'multiple', 'unique')
      )
      or (
        p_doc ->> 'mode' = 'h5'
        and coalesce(p_doc ->> 'artifactId', '')
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and coalesce(p_doc ->> 'sha256', '') ~ '^[0-9a-f]{64}$'
        and coalesce(p_doc ->> 'entryPath', '') = 'index.html'
        and coalesce(p_doc ->> 'byteCount', '') ~ '^[0-9]+$'
        and (p_doc ->> 'byteCount')::bigint between 0 and 5242880
      )
    )
    and octet_length(p_doc::text) <= 2097152,
    false
  )
$$;

alter table public.cw_page_docs drop constraint cw_page_docs_doc_version_check;
alter table public.cw_page_docs add constraint cw_page_docs_doc_version_check check (
  doc_version in (
    'page-doc-v1', 'aixuexi-page-doc-v1', 'spatial-page-v1',
    'microcourse-page-v1', 'game-page-v1'
  )
);

alter table public.cw_page_revisions
  drop constraint cw_page_revisions_doc_version_check,
  drop constraint cw_page_revisions_doc_check;
alter table public.cw_page_revisions
  add constraint cw_page_revisions_doc_version_check check (
    doc_version in (
      'page-doc-v1', 'aixuexi-page-doc-v1', 'spatial-page-v1',
      'microcourse-page-v1', 'game-page-v1'
    )
  ),
  add constraint cw_page_revisions_doc_check check (
    jsonb_typeof(doc) = 'object'
    and doc ->> 'docVersion' in (
      'page-doc-v1', 'aixuexi-page-doc-v1', 'spatial-page-v1',
      'microcourse-page-v1', 'game-page-v1'
    )
    and (doc ->> 'docVersion' <> 'spatial-page-v1' or public.cw_spatial_page_doc_is_valid(doc))
    and (doc ->> 'docVersion' <> 'microcourse-page-v1' or public.cw_microcourse_page_doc_is_valid(doc))
    and (doc ->> 'docVersion' <> 'game-page-v1' or public.cw_game_page_doc_is_valid(doc))
    and octet_length(doc::text) <= case
      when doc ->> 'docVersion' in ('microcourse-page-v1', 'game-page-v1')
        then 2097152
      else 1048576
    end
  );

create or replace function public.cw_revision_supports_track(
  p_revision_id uuid, p_page_doc_id uuid, p_track text
)
returns boolean
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce((
    select revision.page_doc_id = p_page_doc_id
      and case
        when revision.doc_version = 'spatial-page-v1'
          then revision.layout_profile = 'standard-4x3'
            or (revision.layout_profile = 'wide-16x9-exception' and p_track = 'native-16x9')
        when revision.doc_version in ('microcourse-page-v1', 'game-page-v1')
          then p_track in ('native-16x9', 'adapted-4x3')
        else revision.track = p_track
          or (p_track = 'adapted-4x3' and revision.track = 'native-16x9')
      end
    from public.cw_page_revisions revision
    where revision.id = p_revision_id
  ), false)
$$;

create or replace function public.cw_set_revision_document_metadata()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare page_version text; existing_revision boolean;
begin
  new.doc_version := new.doc ->> 'docVersion';
  if new.doc_version is null then raise exception 'INVALID_PAGE_DOC'; end if;
  new.layout_profile := case
    when new.doc_version = 'spatial-page-v1' then new.doc #>> '{layout,profile}'
    when new.doc_version = 'microcourse-page-v1' then 'microcourse-4x3'
    when new.doc_version = 'game-page-v1' then 'standard-4x3'
    when new.track = 'adapted-4x3' then 'legacy-4x3-adaptation'
    else 'legacy-16x9-import'
  end;
  select page.doc_version into page_version
  from public.cw_page_docs page where page.id = new.page_doc_id for update;
  if not found then raise exception 'PAGE_NOT_FOUND'; end if;
  if page_version is distinct from new.doc_version then
    select exists (
      select 1 from public.cw_page_revisions revision
      where revision.page_doc_id = new.page_doc_id
        and (tg_op = 'INSERT' or revision.id <> new.id)
    ) into existing_revision;
    if existing_revision then raise exception 'PAGE_DOC_VERSION_IMMUTABLE'; end if;
    update public.cw_page_docs
    set doc_version = new.doc_version,
        aspect = case
          when new.doc_version in (
            'spatial-page-v1', 'microcourse-page-v1', 'game-page-v1'
          ) then '4:3'
          else aspect
        end
    where id = new.page_doc_id;
  end if;
  return new;
end;
$$;

-- Existing author-scoped helpers must recognize both the legacy page envelope
-- and the new generic game envelope.
create or replace function public.assert_teacher_microcourse_page_author(p_page_doc_id uuid)
returns uuid
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare microcourse_value uuid;
begin
  select microcourse_row.id into microcourse_value
  from public.cw_page_docs page_row
  join public.teacher_microcourses microcourse_row
    on microcourse_row.lecture_id = page_row.lecture_id
  where page_row.id = p_page_doc_id
    and page_row.deleted_at is null
    and page_row.doc_version in ('microcourse-page-v1', 'game-page-v1');
  if microcourse_value is null then raise exception 'PAGE_NOT_FOUND'; end if;
  perform public.assert_teacher_microcourse_author(microcourse_value);
  return microcourse_value;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Service-only create/save boundary
-- ---------------------------------------------------------------------------

create function public.create_teacher_microcourse_game_page(
  p_actor_id uuid,
  p_microcourse_id uuid,
  p_after_page_doc_id uuid,
  p_title text,
  p_doc jsonb
)
returns table(page_id uuid, revision_id uuid, revision_no integer)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  lecture_value uuid;
  after_no integer;
  new_page_id uuid;
  new_revision_id uuid;
  contract_row public.cw_game_content_contracts%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_actor_id is null
     or not public.can_author_teacher_microcourse(p_microcourse_id, p_actor_id) then
    raise exception 'FORBIDDEN';
  end if;
  if not public.is_feature_enabled('teaching.teacher_microcourses_v1') then
    raise exception 'FEATURE_DISABLED';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 200
     or not public.cw_game_page_doc_is_valid(p_doc) then
    raise exception 'INVALID_PAGE_DOC';
  end if;

  select * into contract_row
  from public.cw_game_content_contracts contract
  where contract.game_id = p_doc ->> 'gameId'
    and contract.content_version = p_doc ->> 'contentVersion'
    and contract.enabled
    and contract.authorable;
  if not found then raise exception 'UNKNOWN_GAME_COURSEWARE_CONTRACT'; end if;
  if contract_row.validator_version is distinct from
     p_doc #>> '{validation,validatorVersion}' then
    raise exception 'GAME_PAGE_VALIDATION_FAILED';
  end if;

  select microcourse_row.lecture_id into lecture_value
  from public.teacher_microcourses microcourse_row
  where microcourse_row.id = p_microcourse_id;
  if lecture_value is null then raise exception 'MICROCOURSE_NOT_FOUND'; end if;

  perform 1 from public.course_lectures where id = lecture_value for update;
  if (select count(*) from public.cw_page_docs
      where lecture_id = lecture_value and deleted_at is null) >= 200 then
    raise exception 'MICROCOURSE_PAGE_LIMIT';
  end if;
  if p_after_page_doc_id is null then
    select coalesce(max(page_no), 0) into after_no
    from public.cw_page_docs where lecture_id = lecture_value and deleted_at is null;
  else
    select page_no into after_no
    from public.cw_page_docs
    where id = p_after_page_doc_id
      and lecture_id = lecture_value
      and deleted_at is null;
    if not found then raise exception 'AFTER_PAGE_NOT_FOUND'; end if;
    update public.cw_page_docs set page_no = page_no + 10000
    where lecture_id = lecture_value and deleted_at is null and page_no > after_no;
  end if;

  insert into public.cw_page_docs(
    lecture_id, page_no, title, source_courseware_id, source_page_id,
    aspect, doc_version
  ) values (
    lecture_value, after_no + 1, btrim(p_title), 'teacher-microcourse', null,
    '4:3', 'game-page-v1'
  ) returning id into new_page_id;

  if p_after_page_doc_id is not null then
    update public.cw_page_docs set page_no = page_no - 9999
    where lecture_id = lecture_value and deleted_at is null and page_no > 10000;
  end if;

  insert into public.cw_page_revisions(
    page_doc_id, revision_no, doc, origin, note, created_by, track
  ) values (
    new_page_id, 1, p_doc, 'edit', 'Teacher microcourse game page',
    p_actor_id, 'native-16x9'
  ) returning id into new_revision_id;

  insert into public.cw_game_revision_validations(
    revision_id, game_id, content_version, payload_hash, validator_version,
    publishable, code, details, created_by
  ) values (
    new_revision_id,
    p_doc ->> 'gameId',
    p_doc ->> 'contentVersion',
    p_doc #>> '{validation,payloadHash}',
    p_doc #>> '{validation,validatorVersion}',
    (p_doc #>> '{validation,publishable}')::boolean,
    p_doc #>> '{validation,code}',
    p_doc #> '{validation,details}',
    p_actor_id
  );

  update public.cw_page_docs
  set draft_revision_id = new_revision_id
  where id = new_page_id;

  return query select new_page_id, new_revision_id, 1;
end;
$$;

create function public.save_teacher_microcourse_game_page(
  p_actor_id uuid,
  p_page_doc_id uuid,
  p_doc jsonb,
  p_base_revision_no integer,
  p_title text default null,
  p_note text default ''
)
returns table(revision_id uuid, revision_no integer)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  microcourse_value uuid;
  page_row public.cw_page_docs%rowtype;
  head_row public.cw_page_track_heads%rowtype;
  base_doc jsonb;
  base_no integer;
  next_no integer;
  next_id uuid;
  contract_row public.cw_game_content_contracts%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_actor_id is null then raise exception 'FORBIDDEN'; end if;
  if not public.is_feature_enabled('teaching.teacher_microcourses_v1') then
    raise exception 'FEATURE_DISABLED';
  end if;
  if p_base_revision_no is null or p_base_revision_no < 1
     or not public.cw_game_page_doc_is_valid(p_doc) then
    raise exception 'INVALID_PAGE_DOC';
  end if;

  select microcourse_row.id into microcourse_value
  from public.cw_page_docs target_page
  join public.teacher_microcourses microcourse_row
    on microcourse_row.lecture_id = target_page.lecture_id
  where target_page.id = p_page_doc_id
    and target_page.deleted_at is null
    and target_page.doc_version = 'game-page-v1';
  if microcourse_value is null then raise exception 'PAGE_NOT_FOUND'; end if;
  if not public.can_author_teacher_microcourse(microcourse_value, p_actor_id) then
    raise exception 'FORBIDDEN';
  end if;

  select * into contract_row
  from public.cw_game_content_contracts contract
  where contract.game_id = p_doc ->> 'gameId'
    and contract.content_version = p_doc ->> 'contentVersion'
    and contract.enabled
    and contract.authorable;
  if not found then raise exception 'UNKNOWN_GAME_COURSEWARE_CONTRACT'; end if;
  if contract_row.validator_version is distinct from
     p_doc #>> '{validation,validatorVersion}' then
    raise exception 'GAME_PAGE_VALIDATION_FAILED';
  end if;

  select * into page_row
  from public.cw_page_docs
  where id = p_page_doc_id and deleted_at is null
  for update;
  select * into head_row
  from public.cw_page_track_heads
  where page_doc_id = p_page_doc_id and track = 'native-16x9'
  for update;
  if not found then raise exception 'PAGE_TRACK_NOT_FOUND'; end if;

  select revision_row.revision_no, revision_row.doc into base_no, base_doc
  from public.cw_page_revisions revision_row
  where revision_row.id = coalesce(head_row.draft_revision_id, head_row.current_revision_id);
  if base_no is distinct from p_base_revision_no then raise exception 'VERSION_CONFLICT'; end if;
  if base_doc ->> 'docVersion' is distinct from 'game-page-v1'
     or p_doc ->> 'gameId' is distinct from base_doc ->> 'gameId'
     or p_doc ->> 'contentVersion' is distinct from base_doc ->> 'contentVersion' then
    raise exception 'PAGE_GAME_CONTRACT_IMMUTABLE';
  end if;

  select coalesce(max(revision_row.revision_no), 0) + 1 into next_no
  from public.cw_page_revisions revision_row
  where revision_row.page_doc_id = p_page_doc_id;
  insert into public.cw_page_revisions(
    page_doc_id, revision_no, doc, origin, base_revision_id,
    note, created_by, track
  ) values (
    p_page_doc_id, next_no, p_doc, 'edit',
    coalesce(head_row.draft_revision_id, head_row.current_revision_id),
    left(btrim(coalesce(p_note, '')), 1000), p_actor_id, 'native-16x9'
  ) returning id into next_id;

  insert into public.cw_game_revision_validations(
    revision_id, game_id, content_version, payload_hash, validator_version,
    publishable, code, details, created_by
  ) values (
    next_id,
    p_doc ->> 'gameId',
    p_doc ->> 'contentVersion',
    p_doc #>> '{validation,payloadHash}',
    p_doc #>> '{validation,validatorVersion}',
    (p_doc #>> '{validation,publishable}')::boolean,
    p_doc #>> '{validation,code}',
    p_doc #> '{validation,details}',
    p_actor_id
  );

  update public.cw_page_track_heads
  set draft_revision_id = next_id, updated_at = now()
  where page_doc_id = p_page_doc_id and track = 'native-16x9';
  update public.cw_page_docs
  set draft_revision_id = next_id,
      title = case
        when p_title is null then title
        when char_length(btrim(p_title)) between 1 and 200 then btrim(p_title)
        else title
      end,
      aspect = '4:3'
  where id = p_page_doc_id;

  return query select next_id, next_no;
end;
$$;

revoke all on function public.create_teacher_microcourse_game_page(
  uuid, uuid, uuid, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.save_teacher_microcourse_game_page(
  uuid, uuid, jsonb, integer, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_teacher_microcourse_game_page(
  uuid, uuid, uuid, text, jsonb
) to service_role;
grant execute on function public.save_teacher_microcourse_game_page(
  uuid, uuid, jsonb, integer, text, text
) to service_role;

comment on function public.create_teacher_microcourse_game_page(
  uuid, uuid, uuid, text, jsonb
) is 'Service-only atomic insert of one validated game-page-v1 revision and its immutable attestation.';
comment on function public.save_teacher_microcourse_game_page(
  uuid, uuid, jsonb, integer, text, text
) is 'Service-only CAS save of one validated game-page-v1 revision and its immutable attestation.';

-- ---------------------------------------------------------------------------
-- 4. Draft freeze/review accepts attested games while preserving legacy Sudoku
-- ---------------------------------------------------------------------------

create or replace function public.build_teacher_microcourse_draft_snapshot(
  p_microcourse_id uuid,
  p_require_publishable boolean default false
)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  microcourse_row public.teacher_microcourses%rowtype;
  snapshot jsonb;
  h5_hashes jsonb;
begin
  select * into microcourse_row
  from public.teacher_microcourses
  where id = p_microcourse_id;
  if not found then raise exception 'MICROCOURSE_NOT_FOUND'; end if;
  if not public.cw_track_is_ready(microcourse_row.lecture_id, 'native-16x9') then
    raise exception 'PAGE_TRACK_NOT_READY';
  end if;
  snapshot := public.build_cw_track_snapshot(microcourse_row.lecture_id, 'native-16x9');
  if jsonb_typeof(snapshot) <> 'array' or jsonb_array_length(snapshot) < 1 then
    raise exception 'MICROCOURSE_REQUIRES_PAGE';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(snapshot) item
    join public.cw_page_revisions revision_row
      on revision_row.id = (item.value ->> 'revisionId')::uuid
    where case revision_row.doc_version
      when 'microcourse-page-v1' then
        public.cw_microcourse_page_doc_is_valid(revision_row.doc)
      when 'game-page-v1' then
        public.cw_game_page_doc_is_valid(revision_row.doc)
        and public.cw_game_page_revision_validation_is_current(revision_row.id, false)
      else false
    end = false
  ) then raise exception 'INVALID_MICROCOURSE_PAGE'; end if;

  if coalesce(p_require_publishable, false) and exists (
    select 1
    from jsonb_array_elements(snapshot) item
    join public.cw_page_revisions revision_row
      on revision_row.id = (item.value ->> 'revisionId')::uuid
    where revision_row.doc_version = 'game-page-v1'
      and not public.cw_game_page_revision_validation_is_current(revision_row.id, true)
  ) then raise exception 'GAME_PAGE_NOT_PUBLISHABLE'; end if;

  if coalesce(p_require_publishable, false) and exists (
    select 1
    from jsonb_array_elements(snapshot) item
    join public.cw_page_revisions revision_row
      on revision_row.id = (item.value ->> 'revisionId')::uuid
    where revision_row.doc_version = 'microcourse-page-v1'
      and revision_row.doc ->> 'mode' = 'sudoku'
      and (
        revision_row.doc #>> '{analysis,status}' <> 'unique'
        or public.teacher_microcourse_sudoku_analysis(revision_row.doc -> 'puzzle')
          ->> 'status' <> 'unique'
      )
  ) then raise exception 'SUDOKU_UNIQUE_SOLUTION_REQUIRED'; end if;

  if exists (
    select 1
    from jsonb_array_elements(snapshot) item
    join public.cw_page_revisions revision_row
      on revision_row.id = (item.value ->> 'revisionId')::uuid
    left join public.teacher_microcourse_h5_artifacts artifact
      on artifact.id = case
        when coalesce(revision_row.doc ->> 'artifactId', '')
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (revision_row.doc ->> 'artifactId')::uuid else null end
     and artifact.microcourse_id = p_microcourse_id
    where revision_row.doc_version = 'microcourse-page-v1'
      and revision_row.doc ->> 'mode' = 'h5'
      and (
        artifact.id is null
        or artifact.sha256 <> revision_row.doc ->> 'sha256'
        or artifact.byte_count::text <> revision_row.doc ->> 'byteCount'
      )
  ) then raise exception 'H5_ARTIFACT_SNAPSHOT_MISMATCH'; end if;

  select coalesce(jsonb_agg(to_jsonb(hash_value) order by hash_value), '[]'::jsonb)
  into h5_hashes
  from (
    select distinct revision_row.doc ->> 'sha256' as hash_value
    from jsonb_array_elements(snapshot) item
    join public.cw_page_revisions revision_row
      on revision_row.id = (item.value ->> 'revisionId')::uuid
    where revision_row.doc_version = 'microcourse-page-v1'
      and revision_row.doc ->> 'mode' = 'h5'
  ) hashes;

  return jsonb_build_object(
    'contentSnapshot', snapshot,
    'h5Hashes', h5_hashes
  );
end;
$$;

notify pgrst, 'reload schema';

commit;
