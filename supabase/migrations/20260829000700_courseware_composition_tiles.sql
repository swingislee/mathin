-- Unified 12x9 composition pages for teacher-authored text, image, game and H5 blocks.
-- Standalone teacher microcourse game/H5/Sudoku writers are intentionally closed.

begin;

create function public.cw_courseware_composition_doc_is_valid(p_doc jsonb)
returns boolean
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  blocks jsonb;
  block_value jsonb;
  placement jsonb;
  block_count integer;
  interactive_count integer;
  column_value integer;
  row_value integer;
  column_span integer;
  row_span integer;
begin
  if jsonb_typeof(p_doc) <> 'object'
     or p_doc ->> 'docVersion' <> 'courseware-composition-v1'
     or p_doc #>> '{canvas,width}' <> '960'
     or p_doc #>> '{canvas,height}' <> '720'
     or jsonb_typeof(p_doc -> 'overlay') <> 'object'
     or p_doc #>> '{overlay,docVersion}' <> 'page-doc-v1'
     or p_doc #>> '{overlay,canvas,width}' <> '960'
     or p_doc #>> '{overlay,canvas,height}' <> '720'
     or jsonb_typeof(p_doc #> '{overlay,nodes}') <> 'array'
     or jsonb_typeof(p_doc -> 'layout') <> 'object'
     or p_doc #>> '{layout,version}' <> 'courseware-composition-grid-v1'
     or p_doc #>> '{layout,columns}' <> '12'
     or p_doc #>> '{layout,rows}' <> '9'
     or jsonb_typeof(p_doc #> '{layout,blocks}') <> 'array'
     or octet_length(p_doc::text) > 3145728 then
    return false;
  end if;

  if not (
    p_doc -> 'source' = 'null'::jsonb
    or (
      jsonb_typeof(p_doc -> 'source') = 'object'
      and (
        p_doc #>> '{source,doc,docVersion}' in (
          'page-doc-v1', 'aixuexi-page-doc-v1',
          'source-runtime-page-v1', 'spatial-page-v1'
        )
        or public.cw_game_page_doc_is_valid(p_doc #> '{source,doc}')
      )
      and coalesce(p_doc #>> '{source,sourceReleaseId}', '')
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and coalesce(p_doc #>> '{source,sourceRevisionId}', '')
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  ) then return false; end if;

  blocks := p_doc #> '{layout,blocks}';
  block_count := jsonb_array_length(blocks);
  if block_count > 8 then return false; end if;
  if block_count <> (
    select count(distinct item.value ->> 'id')
    from jsonb_array_elements(blocks) item
  ) then return false; end if;
  select count(*) into interactive_count
  from jsonb_array_elements(blocks) item
  where item.value ->> 'type' in ('game', 'h5');
  if interactive_count > 1 then return false; end if;
  if p_doc -> 'source' <> 'null'::jsonb and interactive_count > 0 then return false; end if;

  for block_value in select item.value from jsonb_array_elements(blocks) item loop
    placement := block_value -> 'placement';
    if coalesce(block_value ->> 'id', '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
       or char_length(block_value ->> 'id') > 80
       or block_value ->> 'type' not in ('node', 'game', 'h5')
       or jsonb_typeof(placement) <> 'object'
       or coalesce(placement ->> 'column', '') !~ '^[0-9]+$'
       or coalesce(placement ->> 'row', '') !~ '^[0-9]+$'
       or coalesce(placement ->> 'columnSpan', '') !~ '^[0-9]+$'
       or coalesce(placement ->> 'rowSpan', '') !~ '^[0-9]+$' then
      return false;
    end if;
    column_value := (placement ->> 'column')::integer;
    row_value := (placement ->> 'row')::integer;
    column_span := (placement ->> 'columnSpan')::integer;
    row_span := (placement ->> 'rowSpan')::integer;
    if column_value < 0 or row_value < 0
       or column_span < 1 or row_span < 1
       or column_value + column_span > 12
       or row_value + row_span > 9 then
      return false;
    end if;
    if block_value ->> 'type' = 'node' then
      if coalesce(block_value ->> 'nodeId', '') = ''
         or column_span < 2 or row_span < 1 then return false; end if;
    elsif block_value ->> 'type' = 'game' then
      if column_span < 8 or row_span < 6
         or not public.cw_game_page_doc_is_valid(block_value -> 'game')
         or (block_value -> 'game') ? 'layout' then return false; end if;
    else
      if column_span < 4 or row_span < 3
         or jsonb_typeof(block_value -> 'h5') <> 'object'
         or coalesce(block_value #>> '{h5,artifactId}', '')
           !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         or coalesce(block_value #>> '{h5,sha256}', '') !~ '^[0-9a-f]{64}$'
         or coalesce(block_value #>> '{h5,entryPath}', '') <> 'index.html'
         or coalesce(block_value #>> '{h5,byteCount}', '') !~ '^[0-9]+$'
         or (block_value #>> '{h5,byteCount}')::bigint not between 0 and 5242880 then
        return false;
      end if;
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(blocks) with ordinality left_item(value, position)
    join jsonb_array_elements(blocks) with ordinality right_item(value, position)
      on left_item.position < right_item.position
    where (left_item.value #>> '{placement,column}')::integer
            < (right_item.value #>> '{placement,column}')::integer
              + (right_item.value #>> '{placement,columnSpan}')::integer
      and (right_item.value #>> '{placement,column}')::integer
            < (left_item.value #>> '{placement,column}')::integer
              + (left_item.value #>> '{placement,columnSpan}')::integer
      and (left_item.value #>> '{placement,row}')::integer
            < (right_item.value #>> '{placement,row}')::integer
              + (right_item.value #>> '{placement,rowSpan}')::integer
      and (right_item.value #>> '{placement,row}')::integer
            < (left_item.value #>> '{placement,row}')::integer
              + (left_item.value #>> '{placement,rowSpan}')::integer
  ) then return false; end if;

  if (select count(*) from jsonb_array_elements(blocks) item where item.value ->> 'type' = 'node')
     <> jsonb_array_length(p_doc #> '{overlay,nodes}') then return false; end if;
  if exists (
    select 1
    from jsonb_array_elements(p_doc #> '{overlay,nodes}') node
    where (
      select count(*)
      from jsonb_array_elements(blocks) item
      where item.value ->> 'type' = 'node'
        and item.value ->> 'nodeId' = node.value ->> 'id'
    ) <> 1
  ) then return false; end if;
  if exists (
    select 1
    from jsonb_array_elements(blocks) item
    where item.value ->> 'type' = 'node'
      and not exists (
        select 1
        from jsonb_array_elements(p_doc #> '{overlay,nodes}') node
        where node.value ->> 'id' = item.value ->> 'nodeId'
      )
  ) then return false; end if;

  return true;
exception when others then
  return false;
end;
$$;

alter table public.cw_page_docs drop constraint cw_page_docs_doc_version_check;
alter table public.cw_page_docs add constraint cw_page_docs_doc_version_check check (
  doc_version in (
    'page-doc-v1', 'aixuexi-page-doc-v1', 'source-runtime-page-v1',
    'spatial-page-v1', 'microcourse-page-v1', 'game-page-v1',
    'courseware-composition-v1'
  )
);

alter table public.cw_page_revisions
  drop constraint cw_page_revisions_doc_version_check,
  drop constraint cw_page_revisions_doc_check;
alter table public.cw_page_revisions
  add constraint cw_page_revisions_doc_version_check check (
    doc_version in (
      'page-doc-v1', 'aixuexi-page-doc-v1', 'source-runtime-page-v1',
      'spatial-page-v1', 'microcourse-page-v1', 'game-page-v1',
      'courseware-composition-v1'
    )
  ),
  add constraint cw_page_revisions_doc_check check (
    jsonb_typeof(doc) = 'object'
    and doc ->> 'docVersion' in (
      'page-doc-v1', 'aixuexi-page-doc-v1', 'source-runtime-page-v1',
      'spatial-page-v1', 'microcourse-page-v1', 'game-page-v1',
      'courseware-composition-v1'
    )
    and (doc ->> 'docVersion' <> 'spatial-page-v1' or public.cw_spatial_page_doc_is_valid(doc))
    and (doc ->> 'docVersion' <> 'microcourse-page-v1' or public.cw_microcourse_page_doc_is_valid(doc))
    and (doc ->> 'docVersion' <> 'game-page-v1' or public.cw_game_page_doc_is_valid(doc))
    and (doc ->> 'docVersion' <> 'courseware-composition-v1' or public.cw_courseware_composition_doc_is_valid(doc))
    and octet_length(doc::text) <= case
      when doc ->> 'docVersion' = 'courseware-composition-v1' then 3145728
      when doc ->> 'docVersion' in ('microcourse-page-v1', 'game-page-v1') then 2097152
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
        when revision.doc_version in (
          'microcourse-page-v1', 'game-page-v1', 'courseware-composition-v1'
        ) then p_track in ('native-16x9', 'adapted-4x3')
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
    when new.doc_version in ('game-page-v1', 'courseware-composition-v1') then 'standard-4x3'
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
            'spatial-page-v1', 'microcourse-page-v1', 'game-page-v1',
            'courseware-composition-v1'
          ) then '4:3'
          else aspect
        end
    where id = new.page_doc_id;
  end if;
  return new;
end;
$$;

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
    and page_row.doc_version = 'courseware-composition-v1';
  if microcourse_value is null then raise exception 'PAGE_NOT_FOUND'; end if;
  perform public.assert_teacher_microcourse_author(microcourse_value);
  return microcourse_value;
end;
$$;

create or replace function public.insert_teacher_microcourse_page(
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
     or not public.cw_courseware_composition_doc_is_valid(p_doc) then
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
    '4:3', 'courseware-composition-v1'
  ) returning id into page_id;
  if p_after_page_doc_id is not null then
    update public.cw_page_docs set page_no = page_no - 9999
    where lecture_id = lecture_value and deleted_at is null and page_no > 10000;
  end if;
  insert into public.cw_page_revisions(
    page_doc_id, revision_no, doc, origin, note, created_by, track
  ) values (
    page_id, 1, p_doc, 'edit', 'Teacher composition page', auth.uid(), 'native-16x9'
  ) returning id into revision_id;
  update public.cw_page_docs set draft_revision_id = revision_id where id = page_id;
  return page_id;
end;
$$;

create or replace function public.create_teacher_microcourse_composition_page(
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
    left join public.cw_lecture_track_heads track_head
      on track_head.lecture_id = lecture_row.id
     and track_head.track = 'native-16x9'
    join public.cw_lecture_releases release_row
      on release_row.id = coalesce(track_head.current_release_id, lecture_row.current_release_id)
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
      and public.cw_teacher_microcourse_source_revision_is_supported(revision_row.id);
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
    'sourceCoursewareId', 'teacher-composition-overlay',
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
    'docVersion', 'courseware-composition-v1',
    'canvas', jsonb_build_object(
      'width', 960, 'height', 720, 'backgroundColor', '#ffffff'
    ),
    'source', source_value,
    'overlay', overlay_value,
    'layout', jsonb_build_object(
      'version', 'courseware-composition-grid-v1',
      'columns', 12,
      'rows', 9,
      'blocks', '[]'::jsonb
    )
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

create function public.save_teacher_courseware_composition_page(
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
  head_row public.cw_page_track_heads%rowtype;
  base_doc jsonb;
  base_no integer;
  next_no integer;
  next_id uuid;
  block_value jsonb;
  artifact public.teacher_microcourse_h5_artifacts%rowtype;
  contract_row public.cw_game_content_contracts%rowtype;
begin
  if auth.role() is distinct from 'service_role' or p_actor_id is null then
    raise exception 'FORBIDDEN';
  end if;
  if not public.is_feature_enabled('teaching.teacher_microcourses_v1') then
    raise exception 'FEATURE_DISABLED';
  end if;
  if p_base_revision_no is null or p_base_revision_no < 1
     or not public.cw_courseware_composition_doc_is_valid(p_doc) then
    raise exception 'INVALID_PAGE_DOC';
  end if;
  select microcourse_row.id into microcourse_value
  from public.cw_page_docs page_row
  join public.teacher_microcourses microcourse_row
    on microcourse_row.lecture_id = page_row.lecture_id
  where page_row.id = p_page_doc_id
    and page_row.deleted_at is null
    and page_row.doc_version = 'courseware-composition-v1';
  if microcourse_value is null then raise exception 'PAGE_NOT_FOUND'; end if;
  if not public.can_author_teacher_microcourse(microcourse_value, p_actor_id) then
    raise exception 'FORBIDDEN';
  end if;

  for block_value in
    select item.value from jsonb_array_elements(p_doc #> '{layout,blocks}') item
  loop
    if block_value ->> 'type' = 'h5' then
      select * into artifact
      from public.teacher_microcourse_h5_artifacts artifact_row
      where artifact_row.id = (block_value #>> '{h5,artifactId}')::uuid
        and artifact_row.microcourse_id = microcourse_value
        and artifact_row.author_id = p_actor_id;
      if not found
         or artifact.sha256 <> block_value #>> '{h5,sha256}'
         or artifact.byte_count::text <> block_value #>> '{h5,byteCount}' then
        raise exception 'H5_ARTIFACT_SNAPSHOT_MISMATCH';
      end if;
    elsif block_value ->> 'type' = 'game' then
      select * into contract_row
      from public.cw_game_content_contracts contract
      where contract.game_id = block_value #>> '{game,gameId}'
        and contract.content_version = block_value #>> '{game,contentVersion}'
        and contract.enabled
        and contract.authorable;
      if not found then raise exception 'UNKNOWN_GAME_COURSEWARE_CONTRACT'; end if;
      if contract_row.validator_version is distinct from
         block_value #>> '{game,validation,validatorVersion}' then
        raise exception 'GAME_PAGE_VALIDATION_FAILED';
      end if;
    end if;
  end loop;

  select * into head_row
  from public.cw_page_track_heads
  where page_doc_id = p_page_doc_id and track = 'native-16x9'
  for update;
  if not found then raise exception 'PAGE_TRACK_NOT_FOUND'; end if;
  select revision_row.revision_no, revision_row.doc into base_no, base_doc
  from public.cw_page_revisions revision_row
  where revision_row.id = coalesce(head_row.draft_revision_id, head_row.current_revision_id);
  if base_no is distinct from p_base_revision_no then raise exception 'VERSION_CONFLICT'; end if;
  if base_doc ->> 'docVersion' <> 'courseware-composition-v1' then
    raise exception 'PAGE_MODE_IMMUTABLE';
  end if;
  if p_doc -> 'source' is distinct from base_doc -> 'source' then
    raise exception 'SOURCE_PROVENANCE_IMMUTABLE';
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
    where revision_row.doc_version <> 'courseware-composition-v1'
       or not public.cw_courseware_composition_doc_is_valid(revision_row.doc)
  ) then raise exception 'INVALID_MICROCOURSE_PAGE'; end if;
  if coalesce(p_require_publishable, false) and exists (
    select 1
    from jsonb_array_elements(snapshot) item
    join public.cw_page_revisions revision_row
      on revision_row.id = (item.value ->> 'revisionId')::uuid
    cross join lateral jsonb_array_elements(revision_row.doc #> '{layout,blocks}') block
    where block.value ->> 'type' = 'game'
      and coalesce((block.value #>> '{game,validation,publishable}')::boolean, false) = false
  ) then raise exception 'GAME_PAGE_NOT_PUBLISHABLE'; end if;
  if exists (
    select 1
    from jsonb_array_elements(snapshot) item
    join public.cw_page_revisions revision_row
      on revision_row.id = (item.value ->> 'revisionId')::uuid
    cross join lateral jsonb_array_elements(revision_row.doc #> '{layout,blocks}') block
    left join public.teacher_microcourse_h5_artifacts artifact
      on artifact.id = (block.value #>> '{h5,artifactId}')::uuid
     and artifact.microcourse_id = p_microcourse_id
    where block.value ->> 'type' = 'h5'
      and (
        artifact.id is null
        or artifact.sha256 <> block.value #>> '{h5,sha256}'
        or artifact.byte_count::text <> block.value #>> '{h5,byteCount}'
      )
  ) then raise exception 'H5_ARTIFACT_SNAPSHOT_MISMATCH'; end if;
  select coalesce(jsonb_agg(to_jsonb(hash_value) order by hash_value), '[]'::jsonb)
  into h5_hashes
  from (
    select distinct block.value #>> '{h5,sha256}' as hash_value
    from jsonb_array_elements(snapshot) item
    join public.cw_page_revisions revision_row
      on revision_row.id = (item.value ->> 'revisionId')::uuid
    cross join lateral jsonb_array_elements(revision_row.doc #> '{layout,blocks}') block
    where block.value ->> 'type' = 'h5'
  ) hashes;
  return jsonb_build_object('contentSnapshot', snapshot, 'h5Hashes', h5_hashes);
end;
$$;

revoke all on function public.cw_courseware_composition_doc_is_valid(jsonb)
  from public, anon, authenticated;
revoke all on function public.save_teacher_courseware_composition_page(
  uuid, uuid, jsonb, integer, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.save_teacher_courseware_composition_page(
  uuid, uuid, jsonb, integer, text, text
) to service_role;

revoke execute on function public.create_teacher_microcourse_sudoku_page(
  uuid, uuid, text, integer[], jsonb
) from authenticated;
revoke execute on function public.create_teacher_microcourse_h5_page(
  uuid, uuid, uuid, text
) from authenticated;
revoke execute on function public.save_teacher_microcourse_page(
  uuid, jsonb, integer, text, text
) from authenticated;
revoke execute on function public.create_teacher_microcourse_game_page(
  uuid, uuid, uuid, text, jsonb
) from service_role;
revoke execute on function public.save_teacher_microcourse_game_page(
  uuid, uuid, jsonb, integer, text, text
) from service_role;

comment on function public.cw_courseware_composition_doc_is_valid(jsonb)
  is 'Structural hard gate for courseware-composition-v1 and its 12x9 non-overlapping tiles.';
comment on function public.save_teacher_courseware_composition_page(
  uuid, uuid, jsonb, integer, text, text
) is 'Service-only CAS save for one composition page; checks embedded game contracts and H5 ownership.';

notify pgrst, 'reload schema';

commit;
