-- DEV-TMC-1: scoped page authoring, immutable source copies, Sudoku analysis,
-- private single-file H5 drafts, and teacher-owned CAS images.

begin;

-- ---------------------------------------------------------------------------
-- 1. microcourse-page-v1 document contract
-- ---------------------------------------------------------------------------

create function public.teacher_microcourse_sudoku_puzzle_is_valid(p_puzzle jsonb)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_typeof(p_puzzle) = 'array'
    and jsonb_array_length(p_puzzle) = 81
    and not exists (
      select 1
      from jsonb_array_elements(p_puzzle) value
      where jsonb_typeof(value) <> 'number'
        or value #>> '{}' !~ '^[0-9]$'
    ),
    false
  )
$$;

create function public.teacher_microcourse_sudoku_can_place(
  p_grid integer[], p_position integer, p_digit integer
)
returns boolean
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  row_start integer := ((p_position - 1) / 9) * 9 + 1;
  column_no integer := ((p_position - 1) % 9) + 1;
  box_row integer := ((p_position - 1) / 27) * 3;
  box_column integer := (((p_position - 1) % 9) / 3) * 3;
  loop_index integer;
  position_value integer;
begin
  if cardinality(p_grid) <> 81 or p_position not between 1 and 81
     or p_digit not between 1 and 9 then return false; end if;
  for loop_index in 0..8 loop
    position_value := row_start + loop_index;
    if position_value <> p_position and p_grid[position_value] = p_digit then return false; end if;
    position_value := column_no + loop_index * 9;
    if position_value <> p_position and p_grid[position_value] = p_digit then return false; end if;
    position_value := box_row * 9 + box_column
      + (loop_index / 3) * 9 + (loop_index % 3) + 1;
    if position_value <> p_position and p_grid[position_value] = p_digit then return false; end if;
  end loop;
  return true;
end;
$$;

create function public.teacher_microcourse_sudoku_grid_is_consistent(p_grid integer[])
returns boolean
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare position_value integer;
begin
  if cardinality(p_grid) <> 81 then return false; end if;
  for position_value in 1..81 loop
    if p_grid[position_value] not between 0 and 9 then return false; end if;
    if p_grid[position_value] <> 0 and not public.teacher_microcourse_sudoku_can_place(
      p_grid, position_value, p_grid[position_value]
    ) then return false; end if;
  end loop;
  return true;
end;
$$;

create function public.teacher_microcourse_sudoku_count_internal(
  p_grid integer[], p_limit integer
)
returns integer
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  position_value integer;
  digit integer;
  target integer := null;
  candidates integer[];
  target_candidates integer[] := null;
  next_grid integer[];
  result_count integer := 0;
begin
  if p_limit < 1 then return 0; end if;
  for position_value in 1..81 loop
    if p_grid[position_value] <> 0 then continue; end if;
    select coalesce(array_agg(candidate order by candidate), '{}'::integer[])
      into candidates
    from generate_series(1, 9) candidate
    where public.teacher_microcourse_sudoku_can_place(p_grid, position_value, candidate);
    if cardinality(candidates) = 0 then return 0; end if;
    if target is null or cardinality(candidates) < cardinality(target_candidates) then
      target := position_value;
      target_candidates := candidates;
      if cardinality(candidates) = 1 then exit; end if;
    end if;
  end loop;
  if target is null then return 1; end if;
  foreach digit in array target_candidates loop
    next_grid := p_grid;
    next_grid[target] := digit;
    result_count := result_count + public.teacher_microcourse_sudoku_count_internal(
      next_grid, p_limit - result_count
    );
    if result_count >= p_limit then return p_limit; end if;
  end loop;
  return result_count;
end;
$$;

create function public.teacher_microcourse_sudoku_solve_internal(p_grid integer[])
returns integer[]
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  position_value integer;
  digit integer;
  target integer := null;
  candidates integer[];
  target_candidates integer[] := null;
  next_grid integer[];
  solved integer[];
begin
  for position_value in 1..81 loop
    if p_grid[position_value] <> 0 then continue; end if;
    select coalesce(array_agg(candidate order by candidate), '{}'::integer[])
      into candidates
    from generate_series(1, 9) candidate
    where public.teacher_microcourse_sudoku_can_place(p_grid, position_value, candidate);
    if cardinality(candidates) = 0 then return null; end if;
    if target is null or cardinality(candidates) < cardinality(target_candidates) then
      target := position_value;
      target_candidates := candidates;
      if cardinality(candidates) = 1 then exit; end if;
    end if;
  end loop;
  if target is null then return p_grid; end if;
  foreach digit in array target_candidates loop
    next_grid := p_grid;
    next_grid[target] := digit;
    solved := public.teacher_microcourse_sudoku_solve_internal(next_grid);
    if solved is not null then return solved; end if;
  end loop;
  return null;
end;
$$;

create function public.teacher_microcourse_sudoku_analysis(p_puzzle jsonb)
returns jsonb
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare grid integer[]; solution_count integer; solution integer[];
begin
  if not public.teacher_microcourse_sudoku_puzzle_is_valid(p_puzzle) then
    raise exception 'INVALID_SUDOKU_PUZZLE';
  end if;
  select array_agg(value::integer order by ordinality) into grid
  from jsonb_array_elements_text(p_puzzle) with ordinality item(value, ordinality);
  if not public.teacher_microcourse_sudoku_grid_is_consistent(grid) then
    return jsonb_build_object('status', 'conflict', 'solutionCount', 0, 'solution', null);
  end if;
  solution_count := public.teacher_microcourse_sudoku_count_internal(grid, 2);
  if solution_count = 0 then
    return jsonb_build_object('status', 'unsolvable', 'solutionCount', 0, 'solution', null);
  end if;
  if solution_count > 1 then
    return jsonb_build_object('status', 'multiple', 'solutionCount', 2, 'solution', null);
  end if;
  solution := public.teacher_microcourse_sudoku_solve_internal(grid);
  return jsonb_build_object(
    'status', 'unique', 'solutionCount', 1, 'solution', to_jsonb(solution)
  );
end;
$$;

create function public.cw_microcourse_page_doc_is_valid(p_doc jsonb)
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
            and p_doc #>> '{source,doc,docVersion}' in (
              'page-doc-v1', 'aixuexi-page-doc-v1', 'spatial-page-v1'
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
    'page-doc-v1', 'aixuexi-page-doc-v1', 'spatial-page-v1', 'microcourse-page-v1'
  )
);

alter table public.cw_page_revisions
  drop constraint cw_page_revisions_doc_version_check,
  drop constraint cw_page_revisions_layout_profile_check,
  drop constraint cw_page_revisions_doc_check;
alter table public.cw_page_revisions
  add constraint cw_page_revisions_doc_version_check check (
    doc_version in (
      'page-doc-v1', 'aixuexi-page-doc-v1', 'spatial-page-v1', 'microcourse-page-v1'
    )
  ),
  add constraint cw_page_revisions_layout_profile_check check (
    layout_profile in (
      'legacy-16x9-import', 'legacy-4x3-adaptation',
      'standard-4x3', 'wide-16x9-exception', 'microcourse-4x3'
    )
  ),
  add constraint cw_page_revisions_doc_check check (
    jsonb_typeof(doc) = 'object'
    and doc ->> 'docVersion' in (
      'page-doc-v1', 'aixuexi-page-doc-v1', 'spatial-page-v1', 'microcourse-page-v1'
    )
    and (doc ->> 'docVersion' <> 'spatial-page-v1' or public.cw_spatial_page_doc_is_valid(doc))
    and (doc ->> 'docVersion' <> 'microcourse-page-v1' or public.cw_microcourse_page_doc_is_valid(doc))
    and octet_length(doc::text) <= case
      when doc ->> 'docVersion' = 'microcourse-page-v1' then 2097152 else 1048576 end
  );

alter table public.cw_page_track_heads
  drop constraint cw_page_track_heads_draft_layout_check,
  drop constraint cw_page_track_heads_current_layout_check;
alter table public.cw_page_track_heads
  add constraint cw_page_track_heads_draft_layout_check check (
    (draft_revision_id is null and draft_layout_profile is null)
    or (draft_revision_id is not null and draft_layout_profile in (
      'legacy-16x9-import', 'legacy-4x3-adaptation',
      'standard-4x3', 'wide-16x9-exception', 'microcourse-4x3'
    ))
  ),
  add constraint cw_page_track_heads_current_layout_check check (
    (current_revision_id is null and current_layout_profile is null)
    or (current_revision_id is not null and current_layout_profile in (
      'legacy-16x9-import', 'legacy-4x3-adaptation',
      'standard-4x3', 'wide-16x9-exception', 'microcourse-4x3'
    ))
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
        when revision.doc_version = 'microcourse-page-v1'
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
          when new.doc_version in ('spatial-page-v1', 'microcourse-page-v1') then '4:3'
          else aspect end
    where id = new.page_doc_id;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. provenance, private H5, and teacher-owned assets
-- ---------------------------------------------------------------------------

create table public.teacher_microcourse_page_sources (
  target_page_doc_id uuid primary key references public.cw_page_docs(id) on delete restrict,
  microcourse_id uuid not null references public.teacher_microcourses(id) on delete restrict,
  source_family_id uuid not null references public.course_families(id) on delete restrict,
  source_course_id uuid not null references public.courses(id) on delete restrict,
  source_lecture_id uuid not null references public.course_lectures(id) on delete restrict,
  source_release_id uuid not null references public.cw_lecture_releases(id) on delete restrict,
  source_page_doc_id uuid not null references public.cw_page_docs(id) on delete restrict,
  source_revision_id uuid not null references public.cw_page_revisions(id) on delete restrict,
  source_page_no integer not null check (source_page_no > 0),
  source_title text not null check (char_length(source_title) between 1 and 200),
  created_at timestamptz not null default now()
);

create table public.teacher_microcourse_h5_artifacts (
  id uuid primary key default gen_random_uuid(),
  microcourse_id uuid not null references public.teacher_microcourses(id) on delete restrict,
  author_id uuid not null references public.profiles(id) on delete restrict,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_count bigint not null check (byte_count between 0 and 5242880),
  private_path text not null check (char_length(private_path) between 1 and 1000),
  public_path text check (public_path is null or char_length(public_path) between 1 and 1000),
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (microcourse_id, sha256),
  unique (private_path)
);

create table public.teacher_microcourse_assets (
  id uuid primary key default gen_random_uuid(),
  microcourse_id uuid not null references public.teacher_microcourses(id) on delete restrict,
  shared_asset_id uuid not null unique references public.cw_shared_assets(id) on delete restrict,
  asset_revision_id uuid not null unique references public.cw_asset_revisions(id) on delete restrict,
  object_id uuid not null references public.cw_asset_objects(id) on delete restrict,
  created_at timestamptz not null default now()
);

create function public.guard_teacher_microcourse_content_identity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then raise exception 'MICROCOURSE_CONTENT_IDENTITY_IMMUTABLE'; end if;
  if new.microcourse_id is distinct from old.microcourse_id
     or to_jsonb(new) - array['status','public_path','published_at']
        is distinct from to_jsonb(old) - array['status','public_path','published_at'] then
    raise exception 'MICROCOURSE_CONTENT_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger teacher_microcourse_page_sources_immutable
  before update or delete on public.teacher_microcourse_page_sources
  for each row execute function public.guard_teacher_microcourse_revision_immutable();
create trigger teacher_microcourse_assets_immutable
  before update or delete on public.teacher_microcourse_assets
  for each row execute function public.guard_teacher_microcourse_revision_immutable();
create trigger teacher_microcourse_h5_artifacts_guard
  before update or delete on public.teacher_microcourse_h5_artifacts
  for each row execute function public.guard_teacher_microcourse_content_identity();

alter table public.teacher_microcourse_page_sources enable row level security;
alter table public.teacher_microcourse_h5_artifacts enable row level security;
alter table public.teacher_microcourse_assets enable row level security;

create policy teacher_microcourse_page_sources_select_scope
on public.teacher_microcourse_page_sources for select to authenticated
using (public.can_read_teacher_microcourse_draft(microcourse_id, (select auth.uid())));
create policy teacher_microcourse_h5_artifacts_select_scope
on public.teacher_microcourse_h5_artifacts for select to authenticated
using (public.can_read_teacher_microcourse(microcourse_id, (select auth.uid())));
create policy teacher_microcourse_assets_select_scope
on public.teacher_microcourse_assets for select to authenticated
using (public.can_read_teacher_microcourse(microcourse_id, (select auth.uid())));

revoke all on public.teacher_microcourse_page_sources,
  public.teacher_microcourse_h5_artifacts,
  public.teacher_microcourse_assets from anon, authenticated;
grant select on public.teacher_microcourse_page_sources,
  public.teacher_microcourse_h5_artifacts,
  public.teacher_microcourse_assets to authenticated;

-- RLS policy subqueries cannot inspect hidden ownership rows as the caller.
-- Resolve the private-asset mapping under the table owner, then return only a
-- boolean scope decision to the authenticated policy.
create function public.can_read_teacher_microcourse_asset(
  p_asset_kind text, p_asset_id uuid, p_uid uuid
)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select p_uid is not null
    and public.is_staff(p_uid)
    and not exists (
      select 1
      from public.teacher_microcourse_assets owned
      where case p_asset_kind
        when 'object' then owned.object_id = p_asset_id
        when 'shared' then owned.shared_asset_id = p_asset_id
        when 'revision' then owned.asset_revision_id = p_asset_id
        else false
      end
      and not public.can_read_teacher_microcourse(owned.microcourse_id, p_uid)
    )
$$;

drop policy if exists cw_asset_objects_select_staff on public.cw_asset_objects;
create policy cw_asset_objects_select_staff on public.cw_asset_objects
for select to authenticated using (public.can_read_teacher_microcourse_asset(
  'object', id, (select auth.uid())
));
drop policy if exists cw_shared_assets_select_staff on public.cw_shared_assets;
create policy cw_shared_assets_select_staff on public.cw_shared_assets
for select to authenticated using (public.can_read_teacher_microcourse_asset(
  'shared', id, (select auth.uid())
));
drop policy if exists cw_asset_revisions_select_staff on public.cw_asset_revisions;
create policy cw_asset_revisions_select_staff on public.cw_asset_revisions
for select to authenticated using (public.can_read_teacher_microcourse_asset(
  'revision', id, (select auth.uid())
));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('cw-h5-drafts', 'cw-h5-drafts', false, 5242880, array['text/html'])
on conflict(id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 3. author-scoped page and asset helpers
-- ---------------------------------------------------------------------------

create function public.assert_teacher_microcourse_author(p_microcourse_id uuid)
returns uuid
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare lecture_value uuid;
begin
  if auth.uid() is null
     or not public.can_author_teacher_microcourse(p_microcourse_id, auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;
  if not public.is_feature_enabled('teaching.teacher_microcourses_v1') then
    raise exception 'FEATURE_DISABLED';
  end if;
  select microcourse_row.lecture_id into lecture_value
  from public.teacher_microcourses microcourse_row
  where microcourse_row.id = p_microcourse_id;
  if lecture_value is null then raise exception 'MICROCOURSE_NOT_FOUND'; end if;
  return lecture_value;
end;
$$;

create function public.assert_teacher_microcourse_page_author(p_page_doc_id uuid)
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
    and page_row.doc_version = 'microcourse-page-v1';
  if microcourse_value is null then raise exception 'PAGE_NOT_FOUND'; end if;
  perform public.assert_teacher_microcourse_author(microcourse_value);
  return microcourse_value;
end;
$$;

create function public.insert_teacher_microcourse_page(
  p_microcourse_id uuid,
  p_after_page_doc_id uuid,
  p_title text,
  p_doc jsonb
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  lecture_value uuid;
  after_no integer;
  page_id uuid;
  revision_id uuid;
begin
  lecture_value := public.assert_teacher_microcourse_author(p_microcourse_id);
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 200
     or not public.cw_microcourse_page_doc_is_valid(p_doc) then
    raise exception 'VALIDATION';
  end if;
  perform 1 from public.course_lectures where id = lecture_value for update;
  if (select count(*) from public.cw_page_docs
      where lecture_id = lecture_value and deleted_at is null) >= 200 then
    raise exception 'MICROCOURSE_PAGE_LIMIT';
  end if;
  if p_after_page_doc_id is null then
    select coalesce(max(page_no), 0) into after_no
    from public.cw_page_docs where lecture_id = lecture_value and deleted_at is null;
  else
    select page_no into after_no from public.cw_page_docs
    where id = p_after_page_doc_id and lecture_id = lecture_value and deleted_at is null;
    if not found then raise exception 'AFTER_PAGE_NOT_FOUND'; end if;
    update public.cw_page_docs set page_no = page_no + 10000
    where lecture_id = lecture_value and deleted_at is null and page_no > after_no;
  end if;
  insert into public.cw_page_docs(
    lecture_id, page_no, title, source_courseware_id, source_page_id,
    aspect, doc_version
  ) values (
    lecture_value, after_no + 1, btrim(p_title), 'teacher-microcourse', null,
    '4:3', 'microcourse-page-v1'
  ) returning id into page_id;
  if p_after_page_doc_id is not null then
    update public.cw_page_docs set page_no = page_no - 9999
    where lecture_id = lecture_value and deleted_at is null and page_no > 10000;
  end if;
  insert into public.cw_page_revisions(
    page_doc_id, revision_no, doc, origin, note, created_by, track
  ) values (
    page_id, 1, p_doc, 'edit', 'Teacher microcourse page', auth.uid(), 'native-16x9'
  ) returning id into revision_id;
  update public.cw_page_docs set draft_revision_id = revision_id where id = page_id;
  return page_id;
end;
$$;

create function public.create_teacher_microcourse_composition_page(
  p_microcourse_id uuid,
  p_after_page_doc_id uuid default null,
  p_title text default 'Untitled',
  p_source_release_id uuid default null,
  p_source_page_doc_id uuid default null,
  p_source_revision_id uuid default null
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  source_row record;
  source_value jsonb := 'null'::jsonb;
  overlay_value jsonb;
  document_value jsonb;
  target_page_id uuid;
  copied_binding_count integer := 0;
begin
  perform public.assert_teacher_microcourse_author(p_microcourse_id);
  if (p_source_release_id is null) <> (p_source_page_doc_id is null)
     or (p_source_release_id is null) <> (p_source_revision_id is null) then
    raise exception 'INVALID_SOURCE_SELECTION';
  end if;
  if p_source_release_id is not null then
    select
      family_row.id as family_id,
      course_row.id as course_id,
      lecture_row.id as lecture_id,
      release_row.id as release_id,
      release_row.track as release_track,
      page_row.id as page_id,
      page_row.page_no,
      page_row.title,
      revision_row.id as revision_id,
      revision_row.doc,
      item.value as snapshot_item
    into source_row
    from public.course_families family_row
    join public.courses course_row on course_row.family_id = family_row.id
    join public.course_lectures lecture_row on lecture_row.course_id = course_row.id
    join public.cw_lecture_releases release_row
      on release_row.id = lecture_row.current_release_id
    cross join lateral jsonb_array_elements(release_row.snapshot) item
    join public.cw_page_docs page_row
      on page_row.id = (item.value ->> 'pageDocId')::uuid
     and page_row.lecture_id = lecture_row.id
     and page_row.deleted_at is null
    join public.cw_page_revisions revision_row
      on revision_row.id = (item.value ->> 'revisionId')::uuid
     and revision_row.page_doc_id = page_row.id
    where release_row.id = p_source_release_id
      and page_row.id = p_source_page_doc_id
      and revision_row.id = p_source_revision_id
      and course_row.course_kind = 'curriculum'
      and course_row.status = 'enabled'
      and course_row.trashed_at is null
      and lecture_row.status = 'active'
      and revision_row.doc_version in (
        'page-doc-v1', 'aixuexi-page-doc-v1', 'spatial-page-v1'
      );
    if not found then raise exception 'SOURCE_PAGE_NOT_CURRENT_PUBLISHED'; end if;
    source_value := jsonb_build_object(
      'sourceFamilyId', source_row.family_id,
      'sourceCourseId', source_row.course_id,
      'sourceLectureId', source_row.lecture_id,
      'sourceReleaseId', source_row.release_id,
      'sourcePageDocId', source_row.page_id,
      'sourceRevisionId', source_row.revision_id,
      'sourcePageNo', source_row.page_no,
      'sourceTitle', coalesce(nullif(btrim(source_row.title), ''), 'Untitled'),
      'doc', source_row.doc
    );
  end if;
  overlay_value := jsonb_build_object(
    'docVersion', 'page-doc-v1',
    'sourceCoursewareId', 'teacher-microcourse-overlay',
    'sourcePageId', null,
    'sourcePageDatabaseId', 1,
    'sourceSnapshotId', 1,
    'sourceContentHash', repeat('0', 64),
    'canvas', jsonb_build_object(
      'width', 960, 'height', 720,
      'backgroundColor', null, 'backgroundBindingKey', null
    ),
    'nodes', '[]'::jsonb,
    'interactions', '[]'::jsonb
  );
  document_value := jsonb_build_object(
    'docVersion', 'microcourse-page-v1',
    'mode', 'composition',
    'canvas', jsonb_build_object(
      'width', 960, 'height', 720, 'backgroundColor', '#ffffff'
    ),
    'source', source_value,
    'overlay', overlay_value
  );
  target_page_id := public.insert_teacher_microcourse_page(
    p_microcourse_id, p_after_page_doc_id, p_title, document_value
  );
  if p_source_release_id is not null then
    insert into public.teacher_microcourse_page_sources(
      target_page_doc_id, microcourse_id, source_family_id, source_course_id,
      source_lecture_id, source_release_id, source_page_doc_id,
      source_revision_id, source_page_no, source_title
    ) values (
      target_page_id, p_microcourse_id, source_row.family_id, source_row.course_id,
      source_row.lecture_id, source_row.release_id, source_row.page_id,
      source_row.revision_id, source_row.page_no,
      coalesce(nullif(btrim(source_row.title), ''), 'Untitled')
    );
    insert into public.cw_page_asset_bindings(
      page_doc_id, binding_key, role, kind, shared_asset_id,
      pinned_revision_id, launch_query, track
    )
    select
      target_page_id,
      binding_item.value ->> 'bindingKey',
      source_binding.role,
      source_binding.kind,
      source_binding.shared_asset_id,
      asset_revision.id,
      source_binding.launch_query,
      'native-16x9'
    from jsonb_array_elements(coalesce(source_row.snapshot_item -> 'bindings', '[]'::jsonb)) binding_item
    join public.cw_page_asset_bindings source_binding
      on source_binding.page_doc_id = source_row.page_id
     and source_binding.binding_key = binding_item.value ->> 'bindingKey'
     and source_binding.track = source_row.release_track
    join public.cw_asset_revisions asset_revision
      on asset_revision.id = (binding_item.value ->> 'assetRevisionId')::uuid
     and asset_revision.shared_asset_id = source_binding.shared_asset_id;
    get diagnostics copied_binding_count = row_count;
    if copied_binding_count <> jsonb_array_length(
      coalesce(source_row.snapshot_item -> 'bindings', '[]'::jsonb)
    ) then raise exception 'SOURCE_BINDING_SNAPSHOT_MISMATCH'; end if;
  end if;
  return target_page_id;
end;
$$;

create function public.create_teacher_microcourse_sudoku_page(
  p_microcourse_id uuid,
  p_after_page_doc_id uuid default null,
  p_title text default 'Sudoku',
  p_puzzle integer[] default array_fill(0, array[81]),
  p_display jsonb default jsonb_build_object(
    'showCoordinates', true,
    'allowCandidates', true,
    'allowAnswerReveal', false,
    'showTeachingTools', true
  )
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare puzzle_value jsonb; document_value jsonb;
begin
  perform public.assert_teacher_microcourse_author(p_microcourse_id);
  puzzle_value := to_jsonb(p_puzzle);
  if not public.teacher_microcourse_sudoku_puzzle_is_valid(puzzle_value)
     or jsonb_typeof(p_display) <> 'object'
     or jsonb_typeof(p_display -> 'showCoordinates') <> 'boolean'
     or jsonb_typeof(p_display -> 'allowCandidates') <> 'boolean'
     or jsonb_typeof(p_display -> 'allowAnswerReveal') <> 'boolean'
     or jsonb_typeof(p_display -> 'showTeachingTools') <> 'boolean' then
    raise exception 'VALIDATION';
  end if;
  document_value := jsonb_build_object(
    'docVersion', 'microcourse-page-v1', 'mode', 'sudoku',
    'canvas', jsonb_build_object(
      'width', 960, 'height', 720, 'backgroundColor', '#ffffff'
    ),
    'puzzle', puzzle_value,
    'display', jsonb_build_object(
      'showCoordinates', (p_display ->> 'showCoordinates')::boolean,
      'allowCandidates', (p_display ->> 'allowCandidates')::boolean,
      'allowAnswerReveal', (p_display ->> 'allowAnswerReveal')::boolean,
      'showTeachingTools', (p_display ->> 'showTeachingTools')::boolean
    ),
    'analysis', public.teacher_microcourse_sudoku_analysis(puzzle_value)
  );
  return public.insert_teacher_microcourse_page(
    p_microcourse_id, p_after_page_doc_id, p_title, document_value
  );
end;
$$;

create function public.register_teacher_microcourse_h5_artifact(
  p_microcourse_id uuid,
  p_sha256 text,
  p_byte_count bigint,
  p_private_path text
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare artifact_id uuid; expected_path text;
begin
  perform public.assert_teacher_microcourse_author(p_microcourse_id);
  expected_path := auth.uid()::text || '/' || p_microcourse_id::text || '/'
    || p_sha256 || '/index.html';
  if coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$'
     or p_byte_count not between 0 and 5242880
     or p_private_path is distinct from expected_path then
    raise exception 'VALIDATION';
  end if;
  insert into public.teacher_microcourse_h5_artifacts(
    microcourse_id, author_id, sha256, byte_count, private_path
  ) values (
    p_microcourse_id, auth.uid(), p_sha256, p_byte_count, p_private_path
  )
  on conflict(microcourse_id, sha256) do update
    set private_path = public.teacher_microcourse_h5_artifacts.private_path
  returning id into artifact_id;
  return artifact_id;
end;
$$;

create function public.create_teacher_microcourse_h5_page(
  p_microcourse_id uuid,
  p_artifact_id uuid,
  p_after_page_doc_id uuid default null,
  p_title text default 'H5'
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare artifact public.teacher_microcourse_h5_artifacts%rowtype; document_value jsonb;
begin
  perform public.assert_teacher_microcourse_author(p_microcourse_id);
  select * into artifact from public.teacher_microcourse_h5_artifacts
  where id = p_artifact_id and microcourse_id = p_microcourse_id and author_id = auth.uid();
  if not found then raise exception 'H5_ARTIFACT_NOT_FOUND'; end if;
  document_value := jsonb_build_object(
    'docVersion', 'microcourse-page-v1', 'mode', 'h5',
    'canvas', jsonb_build_object(
      'width', 960, 'height', 720, 'backgroundColor', '#ffffff'
    ),
    'artifactId', artifact.id,
    'sha256', artifact.sha256,
    'byteCount', artifact.byte_count,
    'entryPath', 'index.html'
  );
  return public.insert_teacher_microcourse_page(
    p_microcourse_id, p_after_page_doc_id, p_title, document_value
  );
end;
$$;

create function public.save_teacher_microcourse_page(
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
  artifact public.teacher_microcourse_h5_artifacts%rowtype;
begin
  microcourse_value := public.assert_teacher_microcourse_page_author(p_page_doc_id);
  if p_base_revision_no is null or p_base_revision_no < 1 then
    raise exception 'VALIDATION';
  end if;
  select * into page_row from public.cw_page_docs
  where id = p_page_doc_id and deleted_at is null for update;
  select * into head_row from public.cw_page_track_heads
  where page_doc_id = p_page_doc_id and track = 'native-16x9' for update;
  if not found then raise exception 'PAGE_TRACK_NOT_FOUND'; end if;
  select revision_row.revision_no, revision_row.doc into base_no, base_doc
  from public.cw_page_revisions revision_row
  where revision_row.id = coalesce(head_row.draft_revision_id, head_row.current_revision_id);
  if base_no is distinct from p_base_revision_no then raise exception 'VERSION_CONFLICT'; end if;
  if p_doc ->> 'docVersion' is distinct from 'microcourse-page-v1'
     or p_doc ->> 'mode' is distinct from base_doc ->> 'mode' then
    raise exception 'PAGE_MODE_IMMUTABLE';
  end if;
  if p_doc ->> 'mode' = 'composition'
     and p_doc -> 'source' is distinct from base_doc -> 'source' then
    raise exception 'SOURCE_PROVENANCE_IMMUTABLE';
  end if;
  if p_doc ->> 'mode' = 'sudoku' then
    if not public.teacher_microcourse_sudoku_puzzle_is_valid(p_doc -> 'puzzle') then
      raise exception 'INVALID_SUDOKU_PUZZLE';
    end if;
    p_doc := jsonb_set(
      p_doc, '{analysis}',
      public.teacher_microcourse_sudoku_analysis(p_doc -> 'puzzle'), true
    );
  elsif p_doc ->> 'mode' = 'h5' then
    if coalesce(p_doc ->> 'artifactId', '')
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'H5_ARTIFACT_NOT_FOUND';
    end if;
    select * into artifact from public.teacher_microcourse_h5_artifacts
    where id = (p_doc ->> 'artifactId')::uuid
      and microcourse_id = microcourse_value
      and author_id = auth.uid();
    if not found then raise exception 'H5_ARTIFACT_NOT_FOUND'; end if;
    p_doc := jsonb_set(p_doc, '{sha256}', to_jsonb(artifact.sha256), true);
    p_doc := jsonb_set(p_doc, '{byteCount}', to_jsonb(artifact.byte_count), true);
    p_doc := jsonb_set(p_doc, '{entryPath}', to_jsonb('index.html'::text), true);
  end if;
  if not public.cw_microcourse_page_doc_is_valid(p_doc) then
    raise exception 'INVALID_PAGE_DOC';
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
    left(btrim(coalesce(p_note, '')), 1000), auth.uid(), 'native-16x9'
  ) returning id into next_id;
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

create function public.reorder_teacher_microcourse_pages(
  p_microcourse_id uuid, p_page_ids uuid[]
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare lecture_value uuid; expected_count integer; selected_count integer;
begin
  lecture_value := public.assert_teacher_microcourse_author(p_microcourse_id);
  if p_page_ids is null or cardinality(p_page_ids) < 1 or cardinality(p_page_ids) > 200
     or cardinality(p_page_ids) <> cardinality(array(select distinct unnest(p_page_ids))) then
    raise exception 'INVALID_PAGE_ORDER';
  end if;
  perform 1 from public.course_lectures where id = lecture_value for update;
  select count(*) into expected_count from public.cw_page_docs
  where lecture_id = lecture_value and deleted_at is null;
  select count(*) into selected_count from public.cw_page_docs
  where lecture_id = lecture_value and deleted_at is null and id = any(p_page_ids);
  if expected_count <> cardinality(p_page_ids) or selected_count <> expected_count then
    raise exception 'PAGE_ORDER_MISMATCH';
  end if;
  update public.cw_page_docs page_row
  set page_no = ordered.ordinality + 10000
  from unnest(p_page_ids) with ordinality ordered(id, ordinality)
  where page_row.id = ordered.id;
  update public.cw_page_docs set page_no = page_no - 10000
  where lecture_id = lecture_value and deleted_at is null;
end;
$$;

create function public.soft_delete_teacher_microcourse_page(p_page_doc_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_teacher_microcourse_page_author(p_page_doc_id);
  update public.cw_page_docs set deleted_at = now()
  where id = p_page_doc_id and deleted_at is null;
  if not found then raise exception 'PAGE_NOT_FOUND'; end if;
end;
$$;

create function public.register_teacher_microcourse_image(
  p_microcourse_id uuid,
  p_page_doc_id uuid,
  p_sha256 text,
  p_mime text,
  p_byte_count bigint,
  p_width integer,
  p_height integer,
  p_name text,
  p_role text default 'image'
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  page_microcourse uuid;
  object_id uuid;
  shared_id uuid;
  asset_revision_id uuid;
  object_row public.cw_asset_objects%rowtype;
  storage_value text;
begin
  perform public.assert_teacher_microcourse_author(p_microcourse_id);
  page_microcourse := public.assert_teacher_microcourse_page_author(p_page_doc_id);
  if page_microcourse <> p_microcourse_id then raise exception 'FORBIDDEN'; end if;
  storage_value := 'sha256/' || left(p_sha256, 2) || '/' || p_sha256;
  if coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$'
     or p_mime not in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
     or p_byte_count not between 1 and 10485760
     or p_width not between 1 and 20000
     or p_height not between 1 and 20000
     or char_length(btrim(coalesce(p_role, ''))) not between 1 and 100 then
    raise exception 'VALIDATION';
  end if;
  insert into public.cw_asset_objects(
    sha256, mime, byte_count, width, height, kind, storage_path
  ) values (
    p_sha256, p_mime, p_byte_count, p_width, p_height, 'image', storage_value
  ) on conflict(sha256) do nothing
  returning id into object_id;
  if object_id is null then
    select * into object_row from public.cw_asset_objects where sha256 = p_sha256;
    if object_row.mime <> p_mime or object_row.byte_count <> p_byte_count
       or object_row.width is distinct from p_width
       or object_row.height is distinct from p_height
       or object_row.kind <> 'image'
       or object_row.storage_path <> storage_value then
      raise exception 'OBJECT_METADATA_CONFLICT';
    end if;
    object_id := object_row.id;
  end if;
  select owned.shared_asset_id, owned.asset_revision_id
  into shared_id, asset_revision_id
  from public.teacher_microcourse_assets owned
  join public.cw_asset_objects object_value on object_value.id = owned.object_id
  where owned.microcourse_id = p_microcourse_id and object_value.sha256 = p_sha256;
  if shared_id is null then
    insert into public.cw_shared_assets(
      name, kind, role, candidate_key, created_by
    ) values (
      left(coalesce(nullif(btrim(p_name), ''), 'image'), 500),
      'image', btrim(p_role),
      'teacher-microcourse:' || p_microcourse_id::text || ':' || p_sha256,
      auth.uid()
    ) returning id into shared_id;
    insert into public.cw_asset_revisions(
      shared_asset_id, revision_no, object_id, variant, note, created_by
    ) values (
      shared_id, 1, object_id, 'source', 'Teacher microcourse image', auth.uid()
    ) returning id into asset_revision_id;
    update public.cw_shared_assets
    set draft_revision_id = asset_revision_id
    where id = shared_id;
    insert into public.teacher_microcourse_assets(
      microcourse_id, shared_asset_id, asset_revision_id, object_id
    ) values (p_microcourse_id, shared_id, asset_revision_id, object_id);
  end if;
  insert into public.cw_page_asset_bindings(
    page_doc_id, binding_key, role, kind, shared_asset_id,
    pinned_revision_id, track
  ) values (
    p_page_doc_id, p_sha256, btrim(p_role), 'image', shared_id,
    asset_revision_id, 'native-16x9'
  )
  on conflict(page_doc_id, binding_key, track) do update
  set role = excluded.role,
      kind = excluded.kind,
      shared_asset_id = excluded.shared_asset_id,
      pinned_revision_id = excluded.pinned_revision_id;
  return jsonb_build_object(
    'bindingKey', p_sha256,
    'sharedAssetId', shared_id,
    'assetRevisionId', asset_revision_id,
    'storagePath', storage_value
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. read models for source picking, authoring, and authenticated H5 preview
-- ---------------------------------------------------------------------------

create function public.search_teacher_microcourse_source_pages(
  p_query text default '',
  p_family_id uuid default null,
  p_course_id uuid default null,
  p_lecture_id uuid default null,
  p_limit integer default 100
)
returns table(
  family_id uuid,
  family_title text,
  course_id uuid,
  course_title text,
  lecture_id uuid,
  lecture_title text,
  release_id uuid,
  page_doc_id uuid,
  revision_id uuid,
  page_no integer,
  page_title text,
  doc jsonb,
  bindings jsonb
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
     or not public.has_perm(auth.uid(), 'courseware.microcourse.author') then
    raise exception 'FORBIDDEN';
  end if;
  if not public.is_feature_enabled('teaching.teacher_microcourses_v1') then
    raise exception 'FEATURE_DISABLED';
  end if;
  if p_limit not between 1 and 200 then raise exception 'VALIDATION'; end if;
  return query
  select
    family_row.id,
    family_row.title,
    course_row.id,
    course_row.title,
    lecture_row.id,
    lecture_row.name,
    release_row.id,
    page_row.id,
    revision_row.id,
    page_row.page_no,
    page_row.title,
    revision_row.doc,
    coalesce(item.value -> 'bindings', '[]'::jsonb)
  from public.course_families family_row
  join public.courses course_row on course_row.family_id = family_row.id
  join public.course_lectures lecture_row on lecture_row.course_id = course_row.id
  join public.cw_lecture_releases release_row
    on release_row.id = lecture_row.current_release_id
  cross join lateral jsonb_array_elements(release_row.snapshot) item
  join public.cw_page_docs page_row
    on page_row.id = (item.value ->> 'pageDocId')::uuid
   and page_row.lecture_id = lecture_row.id
   and page_row.deleted_at is null
  join public.cw_page_revisions revision_row
    on revision_row.id = (item.value ->> 'revisionId')::uuid
   and revision_row.page_doc_id = page_row.id
  where course_row.course_kind = 'curriculum'
    and course_row.status = 'enabled'
    and course_row.trashed_at is null
    and lecture_row.status = 'active'
    and revision_row.doc_version in (
      'page-doc-v1', 'aixuexi-page-doc-v1', 'spatial-page-v1'
    )
    and (p_family_id is null or family_row.id = p_family_id)
    and (p_course_id is null or course_row.id = p_course_id)
    and (p_lecture_id is null or lecture_row.id = p_lecture_id)
    and (
      btrim(coalesce(p_query, '')) = ''
      or family_row.title ilike '%' || left(btrim(p_query), 100) || '%'
      or course_row.title ilike '%' || left(btrim(p_query), 100) || '%'
      or lecture_row.name ilike '%' || left(btrim(p_query), 100) || '%'
      or page_row.title ilike '%' || left(btrim(p_query), 100) || '%'
    )
  order by family_row.title, course_row.title, lecture_row.no, page_row.page_no
  limit p_limit;
end;
$$;

create function public.get_teacher_microcourse_h5_artifact(p_artifact_id uuid)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare artifact public.teacher_microcourse_h5_artifacts%rowtype;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into artifact from public.teacher_microcourse_h5_artifacts
  where id = p_artifact_id;
  if not found then return null; end if;
  if not public.can_read_teacher_microcourse(artifact.microcourse_id, auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;
  return jsonb_build_object(
    'id', artifact.id,
    'microcourseId', artifact.microcourse_id,
    'sha256', artifact.sha256,
    'byteCount', artifact.byte_count,
    'privatePath', artifact.private_path,
    'publicPath', artifact.public_path,
    'status', artifact.status
  );
end;
$$;

create function public.get_teacher_microcourse_editor(p_microcourse_id uuid)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare result jsonb; session_value uuid;
begin
  if auth.uid() is null
     or not public.can_read_teacher_microcourse_draft(p_microcourse_id, auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;
  select source_session_id into session_value
  from public.teacher_microcourses where id = p_microcourse_id;
  if session_value is null then return null; end if;
  result := public.get_teacher_microcourse_for_session(session_value);
  return result || jsonb_build_object(
    'topics', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', topic_row.id,
        'slug', topic_row.slug,
        'titleZh', topic_row.title_zh,
        'titleEn', topic_row.title_en,
        'enabled', topic_row.enabled
      ) order by topic_row.sort_order, topic_row.slug), '[]'::jsonb)
      from public.teacher_microcourse_topics topic_row
      where topic_row.enabled
    ),
    'pages', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'pageDocId', page_row.id,
        'pageNo', page_row.page_no,
        'title', page_row.title,
        'revisionId', revision_row.id,
        'revisionNo', revision_row.revision_no,
        'doc', revision_row.doc,
        'bindings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'bindingKey', binding_row.binding_key,
            'role', binding_row.role,
            'kind', binding_row.kind,
            'assetRevisionId', binding_row.pinned_revision_id,
            'storagePath', object_row.storage_path,
            'mime', object_row.mime
          ) order by binding_row.binding_key)
          from public.cw_page_asset_bindings binding_row
          join public.cw_asset_revisions asset_revision
            on asset_revision.id = binding_row.pinned_revision_id
          join public.cw_asset_objects object_row
            on object_row.id = asset_revision.object_id
          where binding_row.page_doc_id = page_row.id
            and binding_row.track = 'native-16x9'
        ), '[]'::jsonb)
      ) order by page_row.page_no), '[]'::jsonb)
      from public.teacher_microcourses microcourse_row
      join public.cw_page_docs page_row
        on page_row.lecture_id = microcourse_row.lecture_id
       and page_row.deleted_at is null
      join public.cw_page_track_heads head_row
        on head_row.page_doc_id = page_row.id
       and head_row.track = 'native-16x9'
      join public.cw_page_revisions revision_row
        on revision_row.id = coalesce(head_row.draft_revision_id, head_row.current_revision_id)
      where microcourse_row.id = p_microcourse_id
    )
  );
end;
$$;

revoke all on function public.teacher_microcourse_sudoku_puzzle_is_valid(jsonb) from public, anon, authenticated;
revoke all on function public.teacher_microcourse_sudoku_can_place(integer[], integer, integer) from public, anon, authenticated;
revoke all on function public.teacher_microcourse_sudoku_grid_is_consistent(integer[]) from public, anon, authenticated;
revoke all on function public.teacher_microcourse_sudoku_count_internal(integer[], integer) from public, anon, authenticated;
revoke all on function public.teacher_microcourse_sudoku_solve_internal(integer[]) from public, anon, authenticated;
revoke all on function public.teacher_microcourse_sudoku_analysis(jsonb) from public, anon, authenticated;
revoke all on function public.cw_microcourse_page_doc_is_valid(jsonb) from public, anon, authenticated;
revoke all on function public.can_read_teacher_microcourse_asset(text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.assert_teacher_microcourse_author(uuid) from public, anon, authenticated;
revoke all on function public.assert_teacher_microcourse_page_author(uuid) from public, anon, authenticated;
revoke all on function public.insert_teacher_microcourse_page(uuid, uuid, text, jsonb) from public, anon, authenticated;

revoke all on function public.create_teacher_microcourse_composition_page(uuid, uuid, text, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_teacher_microcourse_sudoku_page(uuid, uuid, text, integer[], jsonb) from public, anon, authenticated;
revoke all on function public.register_teacher_microcourse_h5_artifact(uuid, text, bigint, text) from public, anon, authenticated;
revoke all on function public.create_teacher_microcourse_h5_page(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.save_teacher_microcourse_page(uuid, jsonb, integer, text, text) from public, anon, authenticated;
revoke all on function public.reorder_teacher_microcourse_pages(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.soft_delete_teacher_microcourse_page(uuid) from public, anon, authenticated;
revoke all on function public.register_teacher_microcourse_image(uuid, uuid, text, text, bigint, integer, integer, text, text) from public, anon, authenticated;
revoke all on function public.search_teacher_microcourse_source_pages(text, uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.get_teacher_microcourse_h5_artifact(uuid) from public, anon, authenticated;
revoke all on function public.get_teacher_microcourse_editor(uuid) from public, anon, authenticated;

grant execute on function public.can_read_teacher_microcourse_asset(text, uuid, uuid) to authenticated;

grant execute on function public.create_teacher_microcourse_composition_page(uuid, uuid, text, uuid, uuid, uuid) to authenticated;
grant execute on function public.create_teacher_microcourse_sudoku_page(uuid, uuid, text, integer[], jsonb) to authenticated;
grant execute on function public.register_teacher_microcourse_h5_artifact(uuid, text, bigint, text) to authenticated;
grant execute on function public.create_teacher_microcourse_h5_page(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.save_teacher_microcourse_page(uuid, jsonb, integer, text, text) to authenticated;
grant execute on function public.reorder_teacher_microcourse_pages(uuid, uuid[]) to authenticated;
grant execute on function public.soft_delete_teacher_microcourse_page(uuid) to authenticated;
grant execute on function public.register_teacher_microcourse_image(uuid, uuid, text, text, bigint, integer, integer, text, text) to authenticated;
grant execute on function public.search_teacher_microcourse_source_pages(text, uuid, uuid, uuid, integer) to authenticated;
grant execute on function public.get_teacher_microcourse_h5_artifact(uuid) to authenticated;
grant execute on function public.get_teacher_microcourse_editor(uuid) to authenticated;

comment on table public.teacher_microcourse_page_sources is
  'Immutable provenance for a copied current curriculum release page; recursive microcourse sources are forbidden.';
comment on table public.teacher_microcourse_h5_artifacts is
  'Private author-domain single-file HTML drafts; publication promotes the exact reviewed hash to cw-h5.';

notify pgrst, 'reload schema';

commit;
