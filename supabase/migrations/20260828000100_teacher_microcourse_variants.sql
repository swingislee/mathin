-- DEV-TMC-2: one free session may carry several independently editable
-- courseware proposals. Content authors own their proposal head; the actual
-- session teacher alone chooses which proposal is used for class.

begin;

-- Research staff author proposal heads through the same narrow microcourse
-- capability as teachers. This does not grant course.page.edit, class access,
-- attendance, roster, or live-class capabilities.
insert into public.role_permissions(role_id, perm_key)
select role.id, 'courseware.microcourse.author'
from public.staff_roles role
where role.key = 'research'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 1. Variant identity and the session's explicit selection
-- ---------------------------------------------------------------------------

alter table public.teacher_microcourses
  drop constraint if exists teacher_microcourses_source_session_id_key;

alter table public.teacher_microcourses
  add column variant_name text,
  add column based_on_microcourse_id uuid
    references public.teacher_microcourses(id) on delete restrict,
  add column based_on_metadata_revision_id uuid;

update public.teacher_microcourses microcourse
set variant_name = left(
  coalesce(
    (
      select nullif(btrim(profile.display_name), '')
      from public.profiles profile
      where profile.id = microcourse.author_id
    ),
    '教师'
  ) || ' · ' ||
  coalesce(
    (
      select nullif(btrim(metadata.title), '')
      from public.teacher_microcourse_metadata_revisions metadata
      where metadata.id = microcourse.draft_metadata_revision_id
    ),
    '课件方案'
  ),
  120
)
where microcourse.variant_name is null;

update public.teacher_microcourses
set variant_name = '课件方案'
where variant_name is null;

alter table public.teacher_microcourses
  alter column variant_name set not null,
  add constraint teacher_microcourses_variant_name_check
    check (char_length(btrim(variant_name)) between 1 and 120),
  add constraint teacher_microcourses_variant_source_pair_check
    check (
      (based_on_microcourse_id is null and based_on_metadata_revision_id is null)
      or
      (based_on_microcourse_id is not null and based_on_metadata_revision_id is not null)
    ),
  add constraint teacher_microcourses_variant_source_metadata_fk
    foreign key (based_on_microcourse_id, based_on_metadata_revision_id)
    references public.teacher_microcourse_metadata_revisions(microcourse_id, id)
    on delete restrict;

create index teacher_microcourses_session_updated_idx
  on public.teacher_microcourses(source_session_id, updated_at desc);
create index teacher_microcourses_based_on_idx
  on public.teacher_microcourses(based_on_microcourse_id)
  where based_on_microcourse_id is not null;

alter table public.class_sessions
  add column selected_teacher_microcourse_id uuid
    references public.teacher_microcourses(id) on delete restrict;

create index class_sessions_selected_teacher_microcourse_idx
  on public.class_sessions(selected_teacher_microcourse_id)
  where selected_teacher_microcourse_id is not null;

-- Existing DEV-TMC-1 sessions had exactly one project. Preserve that project
-- as the classroom choice when upgrading to the multi-proposal model.
update public.class_sessions session
set selected_teacher_microcourse_id = (
  select microcourse.id
  from public.teacher_microcourses microcourse
  where microcourse.source_session_id = session.id
  limit 1
)
where session.selected_teacher_microcourse_id is null
  and 1 = (
    select count(*)
    from public.teacher_microcourses microcourse
    where microcourse.source_session_id = session.id
  );

create function public.guard_session_teacher_microcourse_selection()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.selected_teacher_microcourse_id is not distinct from old.selected_teacher_microcourse_id then
    return new;
  end if;
  if old.courseware_frozen_at is not null or old.started_at is not null then
    raise exception 'SESSION_COURSEWARE_ALREADY_FROZEN';
  end if;
  if new.selected_teacher_microcourse_id is not null and not exists (
    select 1
    from public.teacher_microcourses microcourse
    where microcourse.id = new.selected_teacher_microcourse_id
      and microcourse.source_session_id = new.id
  ) then
    raise exception 'MICROCOURSE_VARIANT_SESSION_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger class_sessions_guard_teacher_microcourse_selection
  before update of selected_teacher_microcourse_id on public.class_sessions
  for each row execute function public.guard_session_teacher_microcourse_selection();

-- H5 artifacts are content-addressed. A fork may safely point at the same
-- private immutable bytes while receiving its own artifact identity.
alter table public.teacher_microcourse_h5_artifacts
  drop constraint if exists teacher_microcourse_h5_artifacts_private_path_key;
create index teacher_microcourse_h5_artifacts_private_path_idx
  on public.teacher_microcourse_h5_artifacts(private_path);

-- Uploaded CAS assets may be referenced by more than one proposal. Keep one
-- attribution row per proposal/revision and authorize a byte if any readable
-- proposal owns that attribution.
alter table public.teacher_microcourse_assets
  drop constraint if exists teacher_microcourse_assets_shared_asset_id_key,
  drop constraint if exists teacher_microcourse_assets_asset_revision_id_key;
alter table public.teacher_microcourse_assets
  add constraint teacher_microcourse_assets_variant_revision_key
    unique (microcourse_id, asset_revision_id);
create index teacher_microcourse_assets_shared_asset_idx
  on public.teacher_microcourse_assets(shared_asset_id);
create index teacher_microcourse_assets_object_idx
  on public.teacher_microcourse_assets(object_id);

-- ---------------------------------------------------------------------------
-- 2. Capability helpers: research edits content without becoming class staff
-- ---------------------------------------------------------------------------

create function public.can_create_teacher_microcourse_variant(
  p_session_id uuid,
  p_uid uuid
)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select p_uid is not null
    and public.is_feature_enabled('teaching.teacher_microcourses_v1')
    and exists (
      select 1
      from public.class_sessions session
      join public.classrooms classroom on classroom.id = session.classroom_id
      where session.id = p_session_id
        and session.deleted_at is null
        and session.lecture_id is null
        and session.courseware_frozen_at is null
        and session.started_at is null
        and classroom.course_id is null
    )
    and (
      public.has_perm(p_uid, 'courseware.review')
      or (
        public.has_perm(p_uid, 'courseware.microcourse.author')
        and public.is_session_teacher(p_session_id, p_uid)
      )
    )
$$;

create or replace function public.can_author_teacher_microcourse(
  p_microcourse_id uuid,
  p_uid uuid
)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select p_uid is not null
    and exists (
      select 1
      from public.teacher_microcourses microcourse
      where microcourse.id = p_microcourse_id
        and microcourse.author_id = p_uid
        and (
          public.has_perm(p_uid, 'courseware.review')
          or (
            public.has_perm(p_uid, 'courseware.microcourse.author')
            and public.is_session_teacher(microcourse.source_session_id, p_uid)
          )
        )
    )
$$;

create or replace function public.can_read_teacher_microcourse_asset(
  p_asset_kind text,
  p_asset_id uuid,
  p_uid uuid
)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select p_uid is not null
    and public.is_staff(p_uid)
    and (
      not exists (
        select 1
        from public.teacher_microcourse_assets owned
        where case p_asset_kind
          when 'object' then owned.object_id = p_asset_id
          when 'shared' then owned.shared_asset_id = p_asset_id
          when 'revision' then owned.asset_revision_id = p_asset_id
          else false
        end
      )
      or exists (
        select 1
        from public.teacher_microcourse_assets owned
        where case p_asset_kind
          when 'object' then owned.object_id = p_asset_id
          when 'shared' then owned.shared_asset_id = p_asset_id
          when 'revision' then owned.asset_revision_id = p_asset_id
          else false
        end
          and public.can_read_teacher_microcourse(owned.microcourse_id, p_uid)
      )
    )
$$;

-- ---------------------------------------------------------------------------
-- 3. Create and fork proposals
-- ---------------------------------------------------------------------------

create function public.create_teacher_microcourse_variant(
  p_source_session_id uuid,
  p_variant_name text,
  p_title text,
  p_description text,
  p_grade smallint,
  p_course_season smallint default null,
  p_class_type text default '',
  p_primary_topic_slug text default 'integrated-practice',
  p_keywords text[] default '{}'::text[]
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  family_id uuid;
  catalog_version_id uuid;
  new_course_id uuid;
  new_lecture_id uuid;
  new_microcourse_id uuid;
  metadata_revision_id uuid;
  topic_id uuid;
  clean_keywords text[];
begin
  if not public.can_create_teacher_microcourse_variant(p_source_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  if char_length(btrim(coalesce(p_variant_name, ''))) not between 1 and 120 then
    raise exception 'VALIDATION';
  end if;
  topic_id := public.assert_teacher_microcourse_metadata(
    p_title, p_description, p_grade, p_course_season,
    p_class_type, p_primary_topic_slug, p_keywords
  );
  clean_keywords := public.normalize_teacher_microcourse_keywords(p_keywords);

  perform pg_advisory_xact_lock(hashtext('teacher-microcourse:' || p_source_session_id::text));
  select family.id, version.id into family_id, catalog_version_id
  from public.course_families family
  join public.course_catalog_versions version
    on version.family_id = family.id and version.is_current
  where family.slug = 'teacher-microcourses'
    and family.status = 'enabled';
  if family_id is null or catalog_version_id is null then
    raise exception 'MICROCOURSE_FAMILY_MISSING';
  end if;

  insert into public.courses(
    family_id, catalog_version_id, title, grade, term, class_type,
    status, purpose, course_kind, created_by
  ) values (
    family_id, catalog_version_id, btrim(p_title), p_grade, p_course_season,
    btrim(coalesce(p_class_type, '')), 'draft', 'production', 'microcourse', uid
  ) returning id into new_course_id;

  insert into public.course_lectures(course_id, no, name, objectives, status)
  values (new_course_id, 1, btrim(p_title), coalesce(p_description, ''), 'active')
  returning id into new_lecture_id;

  insert into public.teacher_microcourses(
    source_session_id, author_id, course_id, lecture_id, variant_name
  ) values (
    p_source_session_id, uid, new_course_id, new_lecture_id, btrim(p_variant_name)
  ) returning id into new_microcourse_id;

  insert into public.teacher_microcourse_metadata_revisions(
    microcourse_id, revision_no, title, description, grade, course_season,
    class_type, primary_topic_id, keywords, created_by
  ) values (
    new_microcourse_id, 1, btrim(p_title), coalesce(p_description, ''), p_grade,
    p_course_season, btrim(coalesce(p_class_type, '')), topic_id, clean_keywords, uid
  ) returning id into metadata_revision_id;

  update public.teacher_microcourses
  set draft_metadata_revision_id = metadata_revision_id
  where id = new_microcourse_id;

  -- The first proposal is immediately usable. Later proposals never steal the
  -- teacher's current choice.
  update public.class_sessions
  set selected_teacher_microcourse_id = new_microcourse_id
  where id = p_source_session_id
    and selected_teacher_microcourse_id is null
    and courseware_frozen_at is null
    and started_at is null;

  perform public.emit_domain_event(
    'teacher_microcourse.variant_created', 'teacher_microcourse', new_microcourse_id,
    jsonb_build_object(
      'sourceSessionId', p_source_session_id,
      'courseId', new_course_id,
      'lectureId', new_lecture_id,
      'metadataRevisionId', metadata_revision_id,
      'variantName', btrim(p_variant_name)
    ), null, null
  );
  return new_microcourse_id;
end;
$$;

create or replace function public.create_teacher_microcourse(
  p_source_session_id uuid,
  p_title text,
  p_description text,
  p_grade smallint,
  p_course_season smallint default null,
  p_class_type text default '',
  p_primary_topic_slug text default 'integrated-practice',
  p_keywords text[] default '{}'::text[]
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  return public.create_teacher_microcourse_variant(
    p_source_session_id,
    left(btrim(p_title) || ' · 方案', 120),
    p_title,
    p_description,
    p_grade,
    p_course_season,
    p_class_type,
    p_primary_topic_slug,
    p_keywords
  );
end;
$$;

create function public.fork_teacher_microcourse_variant(
  p_source_microcourse_id uuid,
  p_variant_name text
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  source_microcourse public.teacher_microcourses%rowtype;
  source_metadata public.teacher_microcourse_metadata_revisions%rowtype;
  source_topic_slug text;
  new_microcourse_id uuid;
  new_lecture_id uuid;
  page_record record;
  new_page_id uuid;
  new_revision_id uuid;
  new_doc jsonb;
  cloned_artifact_id uuid;
begin
  select * into source_microcourse
  from public.teacher_microcourses
  where id = p_source_microcourse_id;
  if not found then raise exception 'MICROCOURSE_NOT_FOUND'; end if;
  if not public.can_create_teacher_microcourse_variant(source_microcourse.source_session_id, uid)
     or not public.can_read_teacher_microcourse_draft(p_source_microcourse_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  if char_length(btrim(coalesce(p_variant_name, ''))) not between 1 and 120 then
    raise exception 'VALIDATION';
  end if;
  select metadata.* into source_metadata
  from public.teacher_microcourse_metadata_revisions metadata
  where metadata.id = source_microcourse.draft_metadata_revision_id
    and metadata.microcourse_id = source_microcourse.id;
  if not found then raise exception 'MICROCOURSE_METADATA_REQUIRED'; end if;
  select topic.slug into source_topic_slug
  from public.teacher_microcourse_topics topic
  where topic.id = source_metadata.primary_topic_id;

  new_microcourse_id := public.create_teacher_microcourse_variant(
    source_microcourse.source_session_id,
    p_variant_name,
    source_metadata.title,
    source_metadata.description,
    source_metadata.grade,
    source_metadata.course_season,
    source_metadata.class_type,
    source_topic_slug,
    source_metadata.keywords
  );

  update public.teacher_microcourses
  set based_on_microcourse_id = source_microcourse.id,
      based_on_metadata_revision_id = source_metadata.id
  where id = new_microcourse_id
  returning lecture_id into new_lecture_id;

  insert into public.teacher_microcourse_h5_artifacts(
    microcourse_id, author_id, sha256, byte_count, private_path,
    public_path, status, published_at
  )
  select new_microcourse_id, uid, artifact.sha256, artifact.byte_count,
         artifact.private_path, artifact.public_path, artifact.status,
         artifact.published_at
  from public.teacher_microcourse_h5_artifacts artifact
  where artifact.microcourse_id = source_microcourse.id
  on conflict (microcourse_id, sha256) do nothing;

  for page_record in
    select page.*,
           revision.id as source_revision_id,
           revision.doc,
           revision.doc_version as revision_doc_version,
           revision.layout_profile,
           head.draft_layout_profile,
           head.current_layout_profile
    from public.cw_page_docs page
    join public.cw_page_track_heads head
      on head.page_doc_id = page.id and head.track = 'native-16x9'
    join public.cw_page_revisions revision
      on revision.id = coalesce(head.draft_revision_id, head.current_revision_id)
    where page.lecture_id = source_microcourse.lecture_id
      and page.deleted_at is null
    order by page.page_no
  loop
    new_doc := page_record.doc;
    if new_doc ->> 'mode' = 'h5' then
      select artifact.id into cloned_artifact_id
      from public.teacher_microcourse_h5_artifacts artifact
      where artifact.microcourse_id = new_microcourse_id
        and artifact.sha256 = new_doc ->> 'sha256';
      if cloned_artifact_id is null then
        raise exception 'H5_ARTIFACT_SNAPSHOT_MISMATCH';
      end if;
      new_doc := jsonb_set(new_doc, '{artifactId}', to_jsonb(cloned_artifact_id::text), true);
    end if;

    insert into public.cw_page_docs(
      lecture_id, page_no, title, source_courseware_id, source_page_id,
      aspect, doc_version, adapt_class, adapt_reason
    ) values (
      new_lecture_id, page_record.page_no, page_record.title,
      page_record.source_courseware_id, page_record.source_page_id,
      page_record.aspect, page_record.doc_version,
      page_record.adapt_class, page_record.adapt_reason
    ) returning id into new_page_id;

    insert into public.cw_page_revisions(
      page_doc_id, revision_no, doc, origin, base_revision_id, note,
      created_by, track, doc_version, layout_profile
    ) values (
      new_page_id, 1, new_doc, 'edit', page_record.source_revision_id,
      'Forked teacher microcourse proposal', uid, 'native-16x9',
      page_record.revision_doc_version, page_record.layout_profile
    ) returning id into new_revision_id;

    update public.cw_page_docs
    set draft_revision_id = new_revision_id
    where id = new_page_id;

    insert into public.cw_page_asset_bindings(
      page_doc_id, binding_key, role, kind, shared_asset_id,
      pinned_revision_id, launch_query, track
    )
    select new_page_id, binding.binding_key, binding.role, binding.kind,
           binding.shared_asset_id, binding.pinned_revision_id,
           binding.launch_query, binding.track
    from public.cw_page_asset_bindings binding
    where binding.page_doc_id = page_record.id
      and binding.track = 'native-16x9';

    insert into public.teacher_microcourse_page_sources(
      microcourse_id, target_page_doc_id, source_family_id, source_course_id,
      source_lecture_id, source_release_id, source_page_doc_id,
      source_revision_id, source_page_no, source_title
    )
    select new_microcourse_id, new_page_id, source.source_family_id,
           source.source_course_id, source.source_lecture_id,
           source.source_release_id, source.source_page_doc_id,
           source.source_revision_id, source.source_page_no, source.source_title
    from public.teacher_microcourse_page_sources source
    where source.microcourse_id = source_microcourse.id
      and source.target_page_doc_id = page_record.id;

    insert into public.cw_game_revision_validations(
      revision_id, game_id, content_version, payload_hash,
      validator_version, publishable, code, details, created_by
    )
    select new_revision_id, validation.game_id, validation.content_version,
           validation.payload_hash, validation.validator_version,
           validation.publishable, validation.code, validation.details, uid
    from public.cw_game_revision_validations validation
    where validation.revision_id = page_record.source_revision_id;
  end loop;

  insert into public.teacher_microcourse_assets(
    microcourse_id, shared_asset_id, asset_revision_id, object_id
  )
  select new_microcourse_id, asset.shared_asset_id,
         asset.asset_revision_id, asset.object_id
  from public.teacher_microcourse_assets asset
  where asset.microcourse_id = source_microcourse.id
  on conflict (microcourse_id, asset_revision_id) do nothing;

  perform public.emit_domain_event(
    'teacher_microcourse.variant_forked', 'teacher_microcourse', new_microcourse_id,
    jsonb_build_object(
      'sourceSessionId', source_microcourse.source_session_id,
      'basedOnMicrocourseId', source_microcourse.id,
      'basedOnMetadataRevisionId', source_metadata.id,
      'variantName', btrim(p_variant_name)
    ), null, null
  );
  return new_microcourse_id;
end;
$$;

create function public.rename_teacher_microcourse_variant(
  p_microcourse_id uuid,
  p_variant_name text
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_teacher_microcourse_author(p_microcourse_id);
  if char_length(btrim(coalesce(p_variant_name, ''))) not between 1 and 120 then
    raise exception 'VALIDATION';
  end if;
  update public.teacher_microcourses
  set variant_name = btrim(p_variant_name)
  where id = p_microcourse_id;
end;
$$;

create function public.select_teacher_microcourse_variant(
  p_session_id uuid,
  p_microcourse_id uuid
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.is_session_teacher(p_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.teacher_microcourses microcourse
    where microcourse.id = p_microcourse_id
      and microcourse.source_session_id = p_session_id
  ) then raise exception 'MICROCOURSE_VARIANT_SESSION_MISMATCH'; end if;
  if not exists (
    select 1
    from public.teacher_microcourses microcourse
    join public.cw_page_docs page
      on page.lecture_id = microcourse.lecture_id
     and page.deleted_at is null
    where microcourse.id = p_microcourse_id
  ) then raise exception 'MICROCOURSE_PAGES_REQUIRED'; end if;
  update public.class_sessions
  set selected_teacher_microcourse_id = p_microcourse_id
  where id = p_session_id
    and deleted_at is null
    and started_at is null
    and courseware_frozen_at is null;
  if not found then raise exception 'SESSION_COURSEWARE_ALREADY_FROZEN'; end if;
  perform public.emit_domain_event(
    'teacher_microcourse.variant_selected', 'class_session', p_session_id,
    jsonb_build_object('microcourseId', p_microcourse_id), null, null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Exact read models for a variant workspace
-- ---------------------------------------------------------------------------

create function public.teacher_microcourse_summary_json(p_microcourse_id uuid)
returns jsonb
language sql security definer stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', microcourse.id,
    'sourceSessionId', microcourse.source_session_id,
    'authorId', microcourse.author_id,
    'authorName', coalesce(nullif(btrim(author.display_name), ''), '—'),
    'variantName', microcourse.variant_name,
    'basedOnMicrocourseId', microcourse.based_on_microcourse_id,
    'basedOnMetadataRevisionId', microcourse.based_on_metadata_revision_id,
    'basedOnVariantName', based_on.variant_name,
    'courseId', microcourse.course_id,
    'lectureId', microcourse.lecture_id,
    'courseStatus', course.status,
    'currentReleaseId', lecture.current_release_id,
    'draftMetadataRevisionId', microcourse.draft_metadata_revision_id,
    'publishedMetadataRevisionId', microcourse.published_metadata_revision_id,
    'draftMetadata', case when draft_revision.id is null then null else jsonb_build_object(
      'revisionId', draft_revision.id,
      'revisionNo', draft_revision.revision_no,
      'title', draft_revision.title,
      'description', draft_revision.description,
      'grade', draft_revision.grade,
      'courseSeason', draft_revision.course_season,
      'classType', draft_revision.class_type,
      'primaryTopicSlug', draft_topic.slug,
      'keywords', draft_revision.keywords,
      'createdAt', draft_revision.created_at
    ) end,
    'publishedMetadata', case when published_revision.id is null then null else jsonb_build_object(
      'revisionId', published_revision.id,
      'revisionNo', published_revision.revision_no,
      'title', published_revision.title,
      'description', published_revision.description,
      'grade', published_revision.grade,
      'courseSeason', published_revision.course_season,
      'classType', published_revision.class_type,
      'primaryTopicSlug', published_topic.slug,
      'keywords', published_revision.keywords,
      'createdAt', published_revision.created_at
    ) end,
    'workflow', case when workflow.lecture_id is null then null else jsonb_build_object(
      'stage', workflow.stage,
      'currentReviewRound', workflow.current_review_round,
      'requiredReviewRounds', workflow.required_review_rounds_snapshot,
      'activeReviewCycleId', workflow.active_review_cycle_id,
      'updatedAt', workflow.updated_at
    ) end,
    'firstPublishedAt', microcourse.first_published_at,
    'lastPublishedAt', microcourse.last_published_at,
    'withdrawnAt', microcourse.withdrawn_at,
    'createdAt', microcourse.created_at,
    'updatedAt', microcourse.updated_at,
    'pageCount', (
      select count(*)
      from public.cw_page_docs page
      where page.lecture_id = microcourse.lecture_id and page.deleted_at is null
    ),
    'selectedForSession', session.selected_teacher_microcourse_id = microcourse.id,
    'canEdit', public.can_author_teacher_microcourse(microcourse.id, auth.uid())
  )
  from public.teacher_microcourses microcourse
  join public.profiles author on author.id = microcourse.author_id
  join public.courses course on course.id = microcourse.course_id
  join public.course_lectures lecture on lecture.id = microcourse.lecture_id
  join public.class_sessions session on session.id = microcourse.source_session_id
  left join public.teacher_microcourses based_on
    on based_on.id = microcourse.based_on_microcourse_id
  left join public.teacher_microcourse_metadata_revisions draft_revision
    on draft_revision.id = microcourse.draft_metadata_revision_id
  left join public.teacher_microcourse_topics draft_topic
    on draft_topic.id = draft_revision.primary_topic_id
  left join public.teacher_microcourse_metadata_revisions published_revision
    on published_revision.id = microcourse.published_metadata_revision_id
  left join public.teacher_microcourse_topics published_topic
    on published_topic.id = published_revision.primary_topic_id
  left join public.cw_lecture_workflows workflow
    on workflow.lecture_id = microcourse.lecture_id
   and workflow.track = 'native-16x9'
  where microcourse.id = p_microcourse_id
$$;

create function public.list_teacher_microcourse_variants(p_session_id uuid)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); result jsonb;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not (
    public.can_create_teacher_microcourse_variant(p_session_id, uid)
    or exists (
      select 1 from public.teacher_microcourses microcourse
      where microcourse.source_session_id = p_session_id
        and public.can_read_teacher_microcourse_draft(microcourse.id, uid)
    )
  ) then raise exception 'FORBIDDEN'; end if;
  select coalesce(jsonb_agg(
    public.teacher_microcourse_summary_json(microcourse.id)
    order by (session.selected_teacher_microcourse_id = microcourse.id) desc,
             microcourse.updated_at desc,
             microcourse.id
  ), '[]'::jsonb)
  into result
  from public.teacher_microcourses microcourse
  join public.class_sessions session on session.id = microcourse.source_session_id
  where microcourse.source_session_id = p_session_id;
  return result;
end;
$$;

create or replace function public.get_teacher_microcourse_for_session(p_session_id uuid)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); microcourse_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select microcourse.id into microcourse_id
  from public.teacher_microcourses microcourse
  join public.class_sessions session on session.id = microcourse.source_session_id
  where microcourse.source_session_id = p_session_id
    and public.can_read_teacher_microcourse_draft(microcourse.id, uid)
  order by (session.selected_teacher_microcourse_id = microcourse.id) desc,
           (microcourse.author_id = uid) desc,
           microcourse.updated_at desc
  limit 1;
  if microcourse_id is null then
    if not public.can_create_teacher_microcourse_variant(p_session_id, uid) then
      raise exception 'FORBIDDEN';
    end if;
    return null;
  end if;
  return public.teacher_microcourse_summary_json(microcourse_id);
end;
$$;

create or replace function public.get_teacher_microcourse_editor(p_microcourse_id uuid)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if auth.uid() is null
     or not public.can_read_teacher_microcourse_draft(p_microcourse_id, auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;
  result := public.teacher_microcourse_summary_json(p_microcourse_id);
  if result is null then raise exception 'MICROCOURSE_NOT_FOUND'; end if;
  return result || jsonb_build_object(
    'topics', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', topic.id,
        'slug', topic.slug,
        'titleZh', topic.title_zh,
        'titleEn', topic.title_en,
        'enabled', topic.enabled
      ) order by topic.sort_order, topic.slug), '[]'::jsonb)
      from public.teacher_microcourse_topics topic
      where topic.enabled
    ),
    'pages', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'pageDocId', page.id,
        'pageNo', page.page_no,
        'title', page.title,
        'revisionId', revision.id,
        'revisionNo', revision.revision_no,
        'doc', revision.doc,
        'bindings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'bindingKey', binding.binding_key,
            'role', binding.role,
            'kind', binding.kind,
            'assetRevisionId', binding.pinned_revision_id,
            'storagePath', object.storage_path,
            'mime', object.mime
          ) order by binding.binding_key)
          from public.cw_page_asset_bindings binding
          join public.cw_asset_revisions asset_revision
            on asset_revision.id = binding.pinned_revision_id
          join public.cw_asset_objects object
            on object.id = asset_revision.object_id
          where binding.page_doc_id = page.id
            and binding.track = 'native-16x9'
        ), '[]'::jsonb)
      ) order by page.page_no), '[]'::jsonb)
      from public.teacher_microcourses microcourse
      join public.cw_page_docs page
        on page.lecture_id = microcourse.lecture_id
       and page.deleted_at is null
      join public.cw_page_track_heads head
        on head.page_doc_id = page.id and head.track = 'native-16x9'
      join public.cw_page_revisions revision
        on revision.id = coalesce(head.draft_revision_id, head.current_revision_id)
      where microcourse.id = p_microcourse_id
    )
  );
end;
$$;

create function public.get_teacher_microcourse_session_context(p_session_id uuid)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); result jsonb;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not (
    public.is_session_teacher(p_session_id, uid)
    or public.has_perm(uid, 'courseware.review')
  ) then raise exception 'FORBIDDEN'; end if;
  select jsonb_build_object(
    'id', session.id,
    'title', session.title,
    'classroomId', classroom.id,
    'classroomName', classroom.name,
    'lectureId', session.lecture_id,
    'scheduledAt', session.scheduled_at,
    'coursewareFrozenAt', session.courseware_frozen_at,
    'startedAt', session.started_at,
    'selectedMicrocourseId', session.selected_teacher_microcourse_id,
    'canCreate', public.can_create_teacher_microcourse_variant(session.id, uid),
    'canSelect', public.is_session_teacher(session.id, uid)
  ) into result
  from public.class_sessions session
  join public.classrooms classroom on classroom.id = session.classroom_id
  where session.id = p_session_id
    and session.deleted_at is null
    and session.lecture_id is null
    and classroom.course_id is null;
  return result;
end;
$$;

create function public.list_teacher_microcourse_session_workspaces(p_limit integer default 100)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); result jsonb; bounded_limit integer;
begin
  if uid is null or not public.has_perm(uid, 'courseware.review') then
    raise exception 'FORBIDDEN';
  end if;
  if not public.is_feature_enabled('teaching.teacher_microcourses_v1') then
    raise exception 'FEATURE_DISABLED';
  end if;
  bounded_limit := least(greatest(coalesce(p_limit, 100), 1), 200);
  select coalesce(jsonb_agg(jsonb_build_object(
    'sessionId', row.id,
    'sessionTitle', row.title,
    'classroomId', row.classroom_id,
    'classroomName', row.classroom_name,
    'scheduledAt', row.scheduled_at,
    'coursewareFrozenAt', row.courseware_frozen_at,
    'startedAt', row.started_at,
    'variantCount', row.variant_count,
    'selectedMicrocourseId', row.selected_teacher_microcourse_id,
    'selectedVariantName', row.selected_variant_name,
    'primaryTeacherName', row.primary_teacher_name
  ) order by row.sort_group, row.scheduled_at nulls last, row.id), '[]'::jsonb)
  into result
  from (
    select session.id, session.title, session.classroom_id, classroom.name as classroom_name,
           session.scheduled_at, session.courseware_frozen_at, session.started_at,
           session.selected_teacher_microcourse_id,
           selected.variant_name as selected_variant_name,
           count(variant.id)::integer as variant_count,
           coalesce(primary_teacher.display_name, '—') as primary_teacher_name,
           case when session.scheduled_at is null or session.scheduled_at >= now() then 0 else 1 end as sort_group
    from public.class_sessions session
    join public.classrooms classroom on classroom.id = session.classroom_id
    left join public.teacher_microcourses selected
      on selected.id = session.selected_teacher_microcourse_id
    left join public.teacher_microcourses variant
      on variant.source_session_id = session.id
    left join lateral (
      select profile.display_name
      from public.classroom_staff_assignments assignment
      join public.profiles profile on profile.id = assignment.user_id
      where assignment.classroom_id = classroom.id
        and assignment.responsibility = 'primary_teacher'
      order by assignment.created_at desc
      limit 1
    ) primary_teacher on true
    where session.deleted_at is null
      and session.cancelled_by is null
      and session.voided_at is null
      and session.lecture_id is null
      and classroom.course_id is null
      and (
        session.scheduled_at is null
        or session.scheduled_at >= now() - interval '30 days'
        or variant.id is not null
      )
    group by session.id, classroom.id, classroom.name, selected.variant_name,
             primary_teacher.display_name
    order by sort_group, session.scheduled_at nulls last, session.id
    limit bounded_limit
  ) row;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants and schema cache
-- ---------------------------------------------------------------------------

revoke all on function public.can_create_teacher_microcourse_variant(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.teacher_microcourse_summary_json(uuid)
  from public, anon, authenticated;
revoke all on function public.create_teacher_microcourse_variant(
  uuid, text, text, text, smallint, smallint, text, text, text[]
) from public, anon, authenticated;
revoke all on function public.fork_teacher_microcourse_variant(uuid, text)
  from public, anon, authenticated;
revoke all on function public.rename_teacher_microcourse_variant(uuid, text)
  from public, anon, authenticated;
revoke all on function public.select_teacher_microcourse_variant(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.list_teacher_microcourse_variants(uuid)
  from public, anon, authenticated;
revoke all on function public.get_teacher_microcourse_session_context(uuid)
  from public, anon, authenticated;
revoke all on function public.list_teacher_microcourse_session_workspaces(integer)
  from public, anon, authenticated;

grant execute on function public.create_teacher_microcourse_variant(
  uuid, text, text, text, smallint, smallint, text, text, text[]
) to authenticated;
grant execute on function public.fork_teacher_microcourse_variant(uuid, text)
  to authenticated;
grant execute on function public.rename_teacher_microcourse_variant(uuid, text)
  to authenticated;
grant execute on function public.select_teacher_microcourse_variant(uuid, uuid)
  to authenticated;
grant execute on function public.list_teacher_microcourse_variants(uuid)
  to authenticated;
grant execute on function public.get_teacher_microcourse_session_context(uuid)
  to authenticated;
grant execute on function public.list_teacher_microcourse_session_workspaces(integer)
  to authenticated;

comment on column public.class_sessions.selected_teacher_microcourse_id is
  'DEV-TMC-2 editable proposal selected by an actual session teacher; start/freeze pins its current revisions.';
comment on column public.teacher_microcourses.based_on_microcourse_id is
  'Source proposal copied to create this independent editable head; never implies shared mutation.';

notify pgrst, 'reload schema';

commit;
