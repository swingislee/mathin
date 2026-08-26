-- DEV-TMC-1: ordinary-teacher single-lecture microcourse projects.
--
-- This migration is intentionally fail-closed. It establishes the catalog kind,
-- immutable metadata heads, controlled topics, author scope, and draft RLS. Page
-- authoring/review/publication is added by the following microcourse migrations.

begin;

-- ---------------------------------------------------------------------------
-- 1. Feature and permission contracts
-- ---------------------------------------------------------------------------

create or replace function public.school_permission_keys()
returns text[] language sql immutable
as $$
  select array[
    'student.view.all','student.view.assigned','student.edit','student.create','student.assign','student.import','student.delete',
    'followup.view','followup.write','activity.manage','activity.register','review.write','video.review',
    'course.view','course.manage','course.view.all','course.product.create','course.assignment.manage',
    'courseware.template.edit','courseware.overlay.edit','courseware.microcourse.author','courseware.page.edit','courseware.asset.manage',
    'courseware.release.publish','courseware.review','courseware.emergency_publish',
    'class.view.all','class.view.mine','class.create','class.manage','enrollment.manage',
    'schedule.view.all','schedule.manage','attendance.mark','grading.write','report.view.all','session.void','session.postwork.manage',
    'finance.order.view','finance.order.create','finance.payment.record','finance.refund.request','finance.refund.approve',
    'finance.coupon.manage','finance.scholarship.grant','finance.account.adjust','finance.report.view',
    'staff.manage','permission.configure','registration.invite.manage','organization.settings.manage','system.operations.manage',
    'account.support.manage','work_item.manage','approval.manage','audit.view','testdata.purge'
  ]::text[]
$$;

insert into public.role_permissions(role_id, perm_key)
select role_row.id, 'courseware.microcourse.author'
from public.staff_roles role_row
where role_row.key = 'teacher'
on conflict do nothing;

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
    'teaching.classroom_board_checkpoint_v2',
    'teaching.classroom_input_v2',
    'teaching.classroom_h5_pointer_v1',
    'teaching.classroom_layout_v2',
    'teaching.teacher_microcourses_v1'
  ]::text[]
$$;

insert into public.feature_flag_versions(
  organization_id, flag_key, version, enabled, effective_from, reason
)
select organization_row.id, 'teaching.teacher_microcourses_v1', 1, false, now(),
       'DEV-TMC-1 fail-closed default'
from public.organizations organization_row
where organization_row.singleton_key = 1
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Curriculum and microcourse catalog kinds
-- ---------------------------------------------------------------------------

alter table public.courses
  add column course_kind text not null default 'curriculum';

alter table public.courses
  add constraint courses_course_kind_check
    check (course_kind in ('curriculum', 'microcourse'));

alter table public.courses alter column term drop not null;

alter table public.courses
  add constraint courses_curriculum_term_required
    check (course_kind = 'microcourse' or term is not null);

drop index public.courses_active_variant_idx;
create unique index courses_active_curriculum_variant_idx
  on public.courses (family_id, catalog_version_id, grade, term, class_type)
  where trashed_at is null and course_kind = 'curriculum';

create index courses_microcourse_catalog_idx
  on public.courses (status, grade, term, class_type, updated_at desc)
  where trashed_at is null and course_kind = 'microcourse';

create function public.guard_course_kind_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.course_kind is distinct from old.course_kind then
    raise exception 'COURSE_KIND_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger courses_guard_kind_immutable
  before update of course_kind on public.courses
  for each row execute function public.guard_course_kind_immutable();

insert into public.course_families(
  slug, title, publisher, stage, subject, edition, description, purpose, status
)
values (
  'teacher-microcourses',
  '教师微课',
  'Mathin 校内',
  '小学',
  '数学',
  '校内共享',
  '普通教师从自由课次孵化并经教研审核发布的单讲微课。',
  'production',
  'enabled'
)
on conflict (slug) do update set
  title = excluded.title,
  publisher = excluded.publisher,
  stage = excluded.stage,
  subject = excluded.subject,
  edition = excluded.edition,
  description = excluded.description,
  purpose = excluded.purpose,
  status = excluded.status;

update public.course_catalog_versions version_row
set title = '教师微课',
    notes = 'DEV-TMC-1 单讲教师作品目录；课程自身使用不可变 release 版本化。',
    status = 'enabled',
    is_current = true
from public.course_families family_row
where family_row.id = version_row.family_id
  and family_row.slug = 'teacher-microcourses'
  and version_row.slug = 'default';

-- ---------------------------------------------------------------------------
-- 3. Controlled topics, project identity, and immutable metadata revisions
-- ---------------------------------------------------------------------------

create table public.teacher_microcourse_topics (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 1 and 60),
  title_zh text not null check (char_length(btrim(title_zh)) between 1 and 40),
  title_en text not null check (char_length(btrim(title_en)) between 1 and 80),
  sort_order smallint not null default 0,
  enabled boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger teacher_microcourse_topics_set_updated_at
  before update on public.teacher_microcourse_topics
  for each row execute function public.set_updated_at();

insert into public.teacher_microcourse_topics(slug, title_zh, title_en, sort_order)
values
  ('number-algebra', '数与代数', 'Number & Algebra', 10),
  ('geometry', '图形与几何', 'Geometry', 20),
  ('statistics-probability', '统计与概率', 'Statistics & Probability', 30),
  ('logic-strategy', '逻辑与策略', 'Logic & Strategy', 40),
  ('integrated-practice', '综合与实践', 'Integrated Practice', 50)
on conflict (slug) do nothing;

create table public.teacher_microcourses (
  id uuid primary key default gen_random_uuid(),
  source_session_id uuid not null unique
    references public.class_sessions(id) on delete restrict,
  author_id uuid not null references public.profiles(id) on delete restrict,
  course_id uuid not null unique references public.courses(id) on delete restrict,
  lecture_id uuid not null unique references public.course_lectures(id) on delete restrict,
  draft_metadata_revision_id uuid,
  published_metadata_revision_id uuid,
  first_published_at timestamptz,
  last_published_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index teacher_microcourses_author_idx
  on public.teacher_microcourses(author_id, updated_at desc);
create index teacher_microcourses_lecture_idx
  on public.teacher_microcourses(lecture_id);

create trigger teacher_microcourses_set_updated_at
  before update on public.teacher_microcourses
  for each row execute function public.set_updated_at();

create function public.teacher_microcourse_keywords_are_valid(p_keywords text[])
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select cardinality(coalesce(p_keywords, '{}'::text[])) <= 12
    and coalesce(bool_and(char_length(btrim(keyword)) between 1 and 32), true)
  from unnest(coalesce(p_keywords, '{}'::text[])) keyword
$$;

create table public.teacher_microcourse_metadata_revisions (
  id uuid primary key default gen_random_uuid(),
  microcourse_id uuid not null references public.teacher_microcourses(id) on delete restrict,
  revision_no integer not null check (revision_no > 0),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  description text not null default '' check (char_length(description) <= 2000),
  grade smallint not null check (grade between 1 and 9),
  course_season smallint check (course_season is null or course_season between 1 and 4),
  class_type text not null default '' check (char_length(class_type) <= 40),
  primary_topic_id uuid not null references public.teacher_microcourse_topics(id) on delete restrict,
  keywords text[] not null default '{}'::text[] check (cardinality(keywords) <= 12),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (microcourse_id, revision_no),
  unique (microcourse_id, id),
  constraint teacher_microcourse_keywords_valid check (
    public.teacher_microcourse_keywords_are_valid(keywords)
  )
);

alter table public.teacher_microcourses
  add constraint teacher_microcourses_draft_metadata_fk
    foreign key (id, draft_metadata_revision_id)
    references public.teacher_microcourse_metadata_revisions(microcourse_id, id)
    on delete restrict,
  add constraint teacher_microcourses_published_metadata_fk
    foreign key (id, published_metadata_revision_id)
    references public.teacher_microcourse_metadata_revisions(microcourse_id, id)
    on delete restrict;

create table public.teacher_microcourse_review_snapshots (
  id uuid primary key default gen_random_uuid(),
  microcourse_id uuid not null references public.teacher_microcourses(id) on delete restrict,
  review_cycle_id uuid not null unique references public.cw_review_cycles(id) on delete restrict,
  metadata_revision_id uuid not null,
  h5_hashes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (microcourse_id, review_cycle_id),
  foreign key (microcourse_id, metadata_revision_id)
    references public.teacher_microcourse_metadata_revisions(microcourse_id, id)
    on delete restrict,
  constraint teacher_microcourse_review_h5_hashes_check check (
    jsonb_typeof(h5_hashes) = 'array'
    and jsonb_array_length(h5_hashes) <= 200
  )
);

create function public.guard_teacher_microcourse_revision_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'MICROCOURSE_REVISION_IMMUTABLE';
end;
$$;

create trigger teacher_microcourse_metadata_revisions_immutable
  before update or delete on public.teacher_microcourse_metadata_revisions
  for each row execute function public.guard_teacher_microcourse_revision_immutable();

create trigger teacher_microcourse_review_snapshots_immutable
  before update or delete on public.teacher_microcourse_review_snapshots
  for each row execute function public.guard_teacher_microcourse_revision_immutable();

create function public.guard_teacher_microcourse_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.courses course_row
    join public.course_lectures lecture_row
      on lecture_row.id = new.lecture_id
     and lecture_row.course_id = course_row.id
    where course_row.id = new.course_id
      and course_row.course_kind = 'microcourse'
      and lecture_row.no = 1
  ) then
    raise exception 'INVALID_MICROCOURSE_COURSE_LECTURE';
  end if;
  if not exists (
    select 1
    from public.class_sessions session_row
    join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
    where session_row.id = new.source_session_id
      and session_row.deleted_at is null
      and session_row.lecture_id is null
      and classroom_row.course_id is null
  ) then
    raise exception 'MICROCOURSE_SOURCE_MUST_BE_FREE_SESSION';
  end if;
  return new;
end;
$$;

create trigger teacher_microcourses_guard_integrity
  before insert or update of source_session_id, course_id, lecture_id
  on public.teacher_microcourses
  for each row execute function public.guard_teacher_microcourse_integrity();

create function public.guard_microcourse_single_lecture()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.courses course_row
    where course_row.id = new.course_id and course_row.course_kind = 'microcourse'
  ) then
    if new.no <> 1 or exists (
      select 1 from public.course_lectures lecture_row
      where lecture_row.course_id = new.course_id and lecture_row.id <> new.id
    ) then
      raise exception 'MICROCOURSE_REQUIRES_ONE_LECTURE';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.course_id is distinct from new.course_id and exists (
    select 1 from public.courses course_row
    where course_row.id = old.course_id and course_row.course_kind = 'microcourse'
  ) then
    raise exception 'MICROCOURSE_LECTURE_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger course_lectures_guard_microcourse_single
  before insert or update of course_id, no on public.course_lectures
  for each row execute function public.guard_microcourse_single_lecture();

create function public.guard_teacher_microcourse_review_snapshot()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.teacher_microcourses microcourse_row
    join public.cw_review_cycles cycle_row
      on cycle_row.id = new.review_cycle_id
     and cycle_row.lecture_id = microcourse_row.lecture_id
    where microcourse_row.id = new.microcourse_id
  ) then
    raise exception 'MICROCOURSE_REVIEW_SNAPSHOT_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger teacher_microcourse_review_snapshots_guard
  before insert on public.teacher_microcourse_review_snapshots
  for each row execute function public.guard_teacher_microcourse_review_snapshot();

-- ---------------------------------------------------------------------------
-- 4. Scope helpers and RLS. Draft page heads never become school-wide reads.
-- ---------------------------------------------------------------------------

create function public.can_author_teacher_microcourse(p_microcourse_id uuid, p_uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select p_uid is not null
    and public.has_perm(p_uid, 'courseware.microcourse.author')
    and exists (
      select 1
      from public.teacher_microcourses microcourse_row
      where microcourse_row.id = p_microcourse_id
        and microcourse_row.author_id = p_uid
        and public.is_session_teacher(microcourse_row.source_session_id, p_uid)
    )
$$;

create function public.can_read_teacher_microcourse_draft(p_microcourse_id uuid, p_uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select p_uid is not null and (
    public.is_admin(p_uid)
    or public.has_perm(p_uid, 'courseware.review')
    or exists (
      select 1
      from public.teacher_microcourses microcourse_row
      where microcourse_row.id = p_microcourse_id
        and (
          microcourse_row.author_id = p_uid
          or public.is_session_teacher(microcourse_row.source_session_id, p_uid)
        )
    )
  )
$$;

create function public.can_read_teacher_microcourse(p_microcourse_id uuid, p_uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select public.can_read_teacher_microcourse_draft(p_microcourse_id, p_uid)
    or (
      public.has_perm(p_uid, 'course.view')
      and exists (
        select 1
        from public.teacher_microcourses microcourse_row
        join public.courses course_row on course_row.id = microcourse_row.course_id
        join public.course_lectures lecture_row on lecture_row.id = microcourse_row.lecture_id
        where microcourse_row.id = p_microcourse_id
          and course_row.status = 'enabled'
          and course_row.trashed_at is null
          and lecture_row.status = 'active'
          and lecture_row.current_release_id is not null
      )
    )
$$;

create function public.can_read_teacher_microcourse_draft_for_course(p_course_id uuid, p_uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.teacher_microcourses microcourse_row
    where microcourse_row.course_id = p_course_id
      and public.can_read_teacher_microcourse_draft(microcourse_row.id, p_uid)
  )
$$;

create function public.can_read_teacher_microcourse_draft_for_lecture(p_lecture_id uuid, p_uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.teacher_microcourses microcourse_row
    where microcourse_row.lecture_id = p_lecture_id
      and public.can_read_teacher_microcourse_draft(microcourse_row.id, p_uid)
  )
$$;

create function public.can_read_cw_page_revision_scoped(p_revision_id uuid, p_uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.cw_page_revisions revision_row
    join public.cw_page_docs page_row on page_row.id = revision_row.page_doc_id
    join public.course_lectures lecture_row on lecture_row.id = page_row.lecture_id
    join public.courses course_row on course_row.id = lecture_row.course_id
    where revision_row.id = p_revision_id
      and (
        (course_row.course_kind = 'curriculum' and public.is_staff(p_uid))
        or public.can_read_teacher_microcourse_draft_for_lecture(lecture_row.id, p_uid)
        or (
          course_row.course_kind = 'microcourse'
          and public.has_perm(p_uid, 'course.view')
          and exists (
            select 1
            from public.cw_lecture_releases release_row
            cross join lateral jsonb_array_elements(
              case when jsonb_typeof(release_row.snapshot) = 'array'
                then release_row.snapshot else '[]'::jsonb end
            ) snapshot_item
            where release_row.lecture_id = lecture_row.id
              and snapshot_item ->> 'pageDocId' = page_row.id::text
              and snapshot_item ->> 'revisionId' = revision_row.id::text
          )
        )
      )
  )
$$;

alter table public.teacher_microcourse_topics enable row level security;
alter table public.teacher_microcourses enable row level security;
alter table public.teacher_microcourse_metadata_revisions enable row level security;
alter table public.teacher_microcourse_review_snapshots enable row level security;

create policy teacher_microcourse_topics_select_staff
on public.teacher_microcourse_topics for select to authenticated
using (public.is_staff((select auth.uid())));

create policy teacher_microcourses_select_scope
on public.teacher_microcourses for select to authenticated
using (public.can_read_teacher_microcourse(id, (select auth.uid())));

create policy teacher_microcourse_metadata_revisions_select_scope
on public.teacher_microcourse_metadata_revisions for select to authenticated
using (public.can_read_teacher_microcourse(microcourse_id, (select auth.uid())));

create policy teacher_microcourse_review_snapshots_select_scope
on public.teacher_microcourse_review_snapshots for select to authenticated
using (public.can_read_teacher_microcourse_draft(microcourse_id, (select auth.uid())));

revoke all on public.teacher_microcourse_topics,
  public.teacher_microcourses,
  public.teacher_microcourse_metadata_revisions,
  public.teacher_microcourse_review_snapshots
from anon, authenticated;
grant select on public.teacher_microcourse_topics,
  public.teacher_microcourses,
  public.teacher_microcourse_metadata_revisions,
  public.teacher_microcourse_review_snapshots
to authenticated;

drop policy if exists "courses_select_course_view" on public.courses;
create policy "courses_select_course_view" on public.courses
  for select to authenticated
  using (
    (
      public.has_perm((select auth.uid()), 'course.view')
      and (status = 'enabled' or public.has_perm((select auth.uid()), 'course.manage'))
    )
    or (
      course_kind = 'microcourse'
      and public.can_read_teacher_microcourse_draft_for_course(id, (select auth.uid()))
    )
  );

drop policy if exists "lectures_select_course_view" on public.course_lectures;
create policy "lectures_select_course_view" on public.course_lectures
  for select to authenticated
  using (
    (
      public.has_perm((select auth.uid()), 'course.view')
      and exists (
        select 1 from public.courses course_row
        where course_row.id = course_id
          and (course_row.status = 'enabled' or public.has_perm((select auth.uid()), 'course.manage'))
      )
    )
    or public.can_read_teacher_microcourse_draft_for_lecture(id, (select auth.uid()))
  );

drop policy if exists "cw_page_docs_select_staff" on public.cw_page_docs;
create policy "cw_page_docs_select_scoped" on public.cw_page_docs
  for select to authenticated
  using (
    exists (
      select 1
      from public.course_lectures lecture_row
      join public.courses course_row on course_row.id = lecture_row.course_id
      where lecture_row.id = cw_page_docs.lecture_id
        and (
          (course_row.course_kind = 'curriculum' and public.is_staff((select auth.uid())))
          or public.can_read_teacher_microcourse_draft_for_lecture(lecture_row.id, (select auth.uid()))
        )
    )
  );

drop policy if exists "cw_page_revisions_select_staff" on public.cw_page_revisions;
create policy "cw_page_revisions_select_scoped" on public.cw_page_revisions
  for select to authenticated
  using (public.can_read_cw_page_revision_scoped(id, (select auth.uid())));

drop policy if exists "cw_page_asset_bindings_select_staff" on public.cw_page_asset_bindings;
create policy "cw_page_asset_bindings_select_scoped" on public.cw_page_asset_bindings
  for select to authenticated
  using (
    exists (
      select 1
      from public.cw_page_docs page_row
      join public.course_lectures lecture_row on lecture_row.id = page_row.lecture_id
      join public.courses course_row on course_row.id = lecture_row.course_id
      where page_row.id = cw_page_asset_bindings.page_doc_id
        and (
          (course_row.course_kind = 'curriculum' and public.is_staff((select auth.uid())))
          or public.can_read_teacher_microcourse_draft_for_lecture(lecture_row.id, (select auth.uid()))
        )
    )
  );

drop policy if exists "cw_page_track_heads_select_staff" on public.cw_page_track_heads;
create policy "cw_page_track_heads_select_scoped" on public.cw_page_track_heads
  for select to authenticated
  using (
    exists (
      select 1
      from public.cw_page_docs page_row
      join public.course_lectures lecture_row on lecture_row.id = page_row.lecture_id
      join public.courses course_row on course_row.id = lecture_row.course_id
      where page_row.id = cw_page_track_heads.page_doc_id
        and (
          (course_row.course_kind = 'curriculum' and public.is_staff((select auth.uid())))
          or public.can_read_teacher_microcourse_draft_for_lecture(lecture_row.id, (select auth.uid()))
        )
    )
  );

drop policy if exists "cw_lecture_track_heads_select_staff" on public.cw_lecture_track_heads;
create policy "cw_lecture_track_heads_select_scoped" on public.cw_lecture_track_heads
  for select to authenticated
  using (
    exists (
      select 1
      from public.course_lectures lecture_row
      join public.courses course_row on course_row.id = lecture_row.course_id
      where lecture_row.id = cw_lecture_track_heads.lecture_id
        and (
          (course_row.course_kind = 'curriculum' and public.is_staff((select auth.uid())))
          or public.can_read_teacher_microcourse_draft_for_lecture(lecture_row.id, (select auth.uid()))
        )
    )
  );

drop policy if exists "cw_lecture_releases_select_staff" on public.cw_lecture_releases;
create policy "cw_lecture_releases_select_scoped" on public.cw_lecture_releases
  for select to authenticated
  using (
    exists (
      select 1
      from public.course_lectures lecture_row
      join public.courses course_row on course_row.id = lecture_row.course_id
      where lecture_row.id = cw_lecture_releases.lecture_id
        and (
          (course_row.course_kind = 'curriculum' and public.is_staff((select auth.uid())))
          or public.can_read_teacher_microcourse_draft_for_lecture(lecture_row.id, (select auth.uid()))
          or (course_row.course_kind = 'microcourse' and public.has_perm((select auth.uid()), 'course.view'))
        )
    )
  );

drop policy if exists "cw_lecture_workflows_select_staff" on public.cw_lecture_workflows;
create policy "cw_lecture_workflows_select_scoped" on public.cw_lecture_workflows
  for select to authenticated
  using (
    exists (
      select 1
      from public.course_lectures lecture_row
      join public.courses course_row on course_row.id = lecture_row.course_id
      where lecture_row.id = cw_lecture_workflows.lecture_id
        and (
          (course_row.course_kind = 'curriculum' and public.is_staff((select auth.uid())))
          or public.can_read_teacher_microcourse_draft_for_lecture(lecture_row.id, (select auth.uid()))
        )
    )
  );

drop policy if exists "cw_review_cycles_select_staff" on public.cw_review_cycles;
create policy "cw_review_cycles_select_scoped" on public.cw_review_cycles
  for select to authenticated
  using (
    exists (
      select 1
      from public.course_lectures lecture_row
      join public.courses course_row on course_row.id = lecture_row.course_id
      where lecture_row.id = cw_review_cycles.lecture_id
        and (
          (course_row.course_kind = 'curriculum' and public.is_staff((select auth.uid())))
          or public.can_read_teacher_microcourse_draft_for_lecture(lecture_row.id, (select auth.uid()))
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Author-scoped creation, metadata revisions, and topic maintenance
-- ---------------------------------------------------------------------------

create function public.normalize_teacher_microcourse_keywords(p_keywords text[])
returns text[]
language sql immutable
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(keyword order by keyword), '{}'::text[])
  from (
    select distinct btrim(value) as keyword
    from unnest(coalesce(p_keywords, '{}'::text[])) value
    where char_length(btrim(value)) between 1 and 32
  ) normalized
$$;

create function public.assert_teacher_microcourse_metadata(
  p_title text,
  p_description text,
  p_grade smallint,
  p_course_season smallint,
  p_class_type text,
  p_primary_topic_slug text,
  p_keywords text[]
)
returns uuid
language plpgsql stable
set search_path = public, pg_temp
as $$
declare topic_id uuid;
begin
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 100
     or char_length(coalesce(p_description, '')) > 2000
     or p_grade not between 1 and 9
     or (p_course_season is not null and p_course_season not between 1 and 4)
     or char_length(coalesce(p_class_type, '')) > 40
     or cardinality(coalesce(p_keywords, '{}'::text[])) > 12
     or exists (
       select 1 from unnest(coalesce(p_keywords, '{}'::text[])) keyword
       where char_length(btrim(keyword)) not between 1 and 32
     ) then
    raise exception 'VALIDATION';
  end if;
  select topic_row.id into topic_id
  from public.teacher_microcourse_topics topic_row
  where topic_row.slug = p_primary_topic_slug and topic_row.enabled;
  if topic_id is null then raise exception 'INVALID_MICROCOURSE_TOPIC'; end if;
  return topic_id;
end;
$$;

create function public.create_teacher_microcourse(
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
declare
  uid uuid := auth.uid();
  family_id uuid;
  catalog_version_id uuid;
  course_id uuid;
  lecture_id uuid;
  microcourse_id uuid;
  metadata_revision_id uuid;
  topic_id uuid;
  clean_keywords text[];
begin
  if uid is null or not public.has_perm(uid, 'courseware.microcourse.author') then
    raise exception 'FORBIDDEN';
  end if;
  if not public.is_feature_enabled('teaching.teacher_microcourses_v1') then
    raise exception 'FEATURE_DISABLED';
  end if;
  if not public.is_session_teacher(p_source_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  topic_id := public.assert_teacher_microcourse_metadata(
    p_title, p_description, p_grade, p_course_season,
    p_class_type, p_primary_topic_slug, p_keywords
  );
  clean_keywords := public.normalize_teacher_microcourse_keywords(p_keywords);

  perform pg_advisory_xact_lock(hashtext('teacher-microcourse:' || p_source_session_id::text));
  select existing.id into microcourse_id
  from public.teacher_microcourses existing
  where existing.source_session_id = p_source_session_id;
  if microcourse_id is not null then
    if not public.can_author_teacher_microcourse(microcourse_id, uid) then raise exception 'FORBIDDEN'; end if;
    return microcourse_id;
  end if;

  if not exists (
    select 1
    from public.class_sessions session_row
    join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
    where session_row.id = p_source_session_id
      and session_row.deleted_at is null
      and session_row.lecture_id is null
      and classroom_row.course_id is null
  ) then
    raise exception 'MICROCOURSE_SOURCE_MUST_BE_FREE_SESSION';
  end if;

  select family_row.id, version_row.id into family_id, catalog_version_id
  from public.course_families family_row
  join public.course_catalog_versions version_row
    on version_row.family_id = family_row.id and version_row.is_current
  where family_row.slug = 'teacher-microcourses'
    and family_row.status = 'enabled';
  if family_id is null or catalog_version_id is null then raise exception 'MICROCOURSE_FAMILY_MISSING'; end if;

  insert into public.courses(
    family_id, catalog_version_id, title, grade, term, class_type,
    status, purpose, course_kind, created_by
  ) values (
    family_id, catalog_version_id, btrim(p_title), p_grade, p_course_season,
    btrim(coalesce(p_class_type, '')), 'draft', 'production', 'microcourse', uid
  ) returning id into course_id;

  insert into public.course_lectures(course_id, no, name, objectives, status)
  values (course_id, 1, btrim(p_title), coalesce(p_description, ''), 'active')
  returning id into lecture_id;

  insert into public.teacher_microcourses(
    source_session_id, author_id, course_id, lecture_id
  ) values (p_source_session_id, uid, course_id, lecture_id)
  returning id into microcourse_id;

  insert into public.teacher_microcourse_metadata_revisions(
    microcourse_id, revision_no, title, description, grade, course_season,
    class_type, primary_topic_id, keywords, created_by
  ) values (
    microcourse_id, 1, btrim(p_title), coalesce(p_description, ''), p_grade,
    p_course_season, btrim(coalesce(p_class_type, '')), topic_id, clean_keywords, uid
  ) returning id into metadata_revision_id;

  update public.teacher_microcourses
  set draft_metadata_revision_id = metadata_revision_id
  where id = microcourse_id;

  perform public.emit_domain_event(
    'teacher_microcourse.created', 'teacher_microcourse', microcourse_id,
    jsonb_build_object(
      'sourceSessionId', p_source_session_id,
      'courseId', course_id,
      'lectureId', lecture_id,
      'metadataRevisionId', metadata_revision_id
    ), null, null
  );
  return microcourse_id;
end;
$$;

create function public.save_teacher_microcourse_metadata(
  p_microcourse_id uuid,
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
  topic_id uuid;
  clean_keywords text[];
  next_revision_no integer;
  revision_id uuid;
begin
  if uid is null or not public.can_author_teacher_microcourse(p_microcourse_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  if not public.is_feature_enabled('teaching.teacher_microcourses_v1') then
    raise exception 'FEATURE_DISABLED';
  end if;
  topic_id := public.assert_teacher_microcourse_metadata(
    p_title, p_description, p_grade, p_course_season,
    p_class_type, p_primary_topic_slug, p_keywords
  );
  clean_keywords := public.normalize_teacher_microcourse_keywords(p_keywords);

  perform 1 from public.teacher_microcourses
  where id = p_microcourse_id for update;
  select coalesce(max(revision_no), 0) + 1 into next_revision_no
  from public.teacher_microcourse_metadata_revisions
  where microcourse_id = p_microcourse_id;

  insert into public.teacher_microcourse_metadata_revisions(
    microcourse_id, revision_no, title, description, grade, course_season,
    class_type, primary_topic_id, keywords, created_by
  ) values (
    p_microcourse_id, next_revision_no, btrim(p_title), coalesce(p_description, ''),
    p_grade, p_course_season, btrim(coalesce(p_class_type, '')),
    topic_id, clean_keywords, uid
  ) returning id into revision_id;

  update public.teacher_microcourses
  set draft_metadata_revision_id = revision_id
  where id = p_microcourse_id;

  perform public.emit_domain_event(
    'teacher_microcourse.metadata_revised', 'teacher_microcourse', p_microcourse_id,
    jsonb_build_object('metadataRevisionId', revision_id, 'revisionNo', next_revision_no),
    null, null
  );
  return revision_id;
end;
$$;

create function public.set_teacher_microcourse_topic(
  p_slug text,
  p_title_zh text,
  p_title_en text,
  p_sort_order smallint,
  p_enabled boolean
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); topic_id uuid;
begin
  if uid is null or not (
    public.is_admin(uid)
    or public.has_perm(uid, 'courseware.review')
    or public.has_perm(uid, 'organization.settings.manage')
  ) then raise exception 'FORBIDDEN'; end if;
  if coalesce(p_slug, '') !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     or char_length(p_slug) not between 1 and 60
     or char_length(btrim(coalesce(p_title_zh, ''))) not between 1 and 40
     or char_length(btrim(coalesce(p_title_en, ''))) not between 1 and 80 then
    raise exception 'VALIDATION';
  end if;
  insert into public.teacher_microcourse_topics(
    slug, title_zh, title_en, sort_order, enabled, created_by
  ) values (
    p_slug, btrim(p_title_zh), btrim(p_title_en), coalesce(p_sort_order, 0),
    coalesce(p_enabled, false), uid
  )
  on conflict (slug) do update set
    title_zh = excluded.title_zh,
    title_en = excluded.title_en,
    sort_order = excluded.sort_order,
    enabled = excluded.enabled
  returning id into topic_id;
  return topic_id;
end;
$$;

create function public.get_teacher_microcourse_for_session(p_session_id uuid)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); result jsonb; microcourse_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select microcourse_row.id into microcourse_id
  from public.teacher_microcourses microcourse_row
  where microcourse_row.source_session_id = p_session_id;
  if microcourse_id is null then
    if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
    return null;
  end if;
  if not public.can_read_teacher_microcourse_draft(microcourse_id, uid) then
    raise exception 'FORBIDDEN';
  end if;

  select jsonb_build_object(
    'id', microcourse_row.id,
    'sourceSessionId', microcourse_row.source_session_id,
    'authorId', microcourse_row.author_id,
    'courseId', microcourse_row.course_id,
    'lectureId', microcourse_row.lecture_id,
    'courseStatus', course_row.status,
    'currentReleaseId', lecture_row.current_release_id,
    'draftMetadataRevisionId', microcourse_row.draft_metadata_revision_id,
    'publishedMetadataRevisionId', microcourse_row.published_metadata_revision_id,
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
    'workflow', case when workflow_row.lecture_id is null then null else jsonb_build_object(
      'stage', workflow_row.stage,
      'currentReviewRound', workflow_row.current_review_round,
      'requiredReviewRounds', workflow_row.required_review_rounds_snapshot,
      'activeReviewCycleId', workflow_row.active_review_cycle_id,
      'updatedAt', workflow_row.updated_at
    ) end,
    'firstPublishedAt', microcourse_row.first_published_at,
    'lastPublishedAt', microcourse_row.last_published_at,
    'withdrawnAt', microcourse_row.withdrawn_at
  ) into result
  from public.teacher_microcourses microcourse_row
  join public.courses course_row on course_row.id = microcourse_row.course_id
  join public.course_lectures lecture_row on lecture_row.id = microcourse_row.lecture_id
  left join public.teacher_microcourse_metadata_revisions draft_revision
    on draft_revision.id = microcourse_row.draft_metadata_revision_id
  left join public.teacher_microcourse_topics draft_topic
    on draft_topic.id = draft_revision.primary_topic_id
  left join public.teacher_microcourse_metadata_revisions published_revision
    on published_revision.id = microcourse_row.published_metadata_revision_id
  left join public.teacher_microcourse_topics published_topic
    on published_topic.id = published_revision.primary_topic_id
  left join public.cw_lecture_workflows workflow_row
    on workflow_row.lecture_id = microcourse_row.lecture_id
   and workflow_row.track = 'native-16x9'
  where microcourse_row.id = microcourse_id;
  return result;
end;
$$;

revoke all on function public.normalize_teacher_microcourse_keywords(text[]) from public, anon, authenticated;
revoke all on function public.teacher_microcourse_keywords_are_valid(text[]) from public, anon, authenticated;
revoke all on function public.assert_teacher_microcourse_metadata(text, text, smallint, smallint, text, text, text[]) from public, anon, authenticated;
revoke all on function public.can_author_teacher_microcourse(uuid, uuid) from public, anon, authenticated;
revoke all on function public.can_read_teacher_microcourse_draft(uuid, uuid) from public, anon, authenticated;
revoke all on function public.can_read_teacher_microcourse(uuid, uuid) from public, anon, authenticated;
revoke all on function public.can_read_teacher_microcourse_draft_for_course(uuid, uuid) from public, anon, authenticated;
revoke all on function public.can_read_teacher_microcourse_draft_for_lecture(uuid, uuid) from public, anon, authenticated;
revoke all on function public.can_read_cw_page_revision_scoped(uuid, uuid) from public, anon, authenticated;

grant execute on function public.can_author_teacher_microcourse(uuid, uuid) to authenticated;
grant execute on function public.can_read_teacher_microcourse_draft(uuid, uuid) to authenticated;
grant execute on function public.can_read_teacher_microcourse(uuid, uuid) to authenticated;
grant execute on function public.can_read_teacher_microcourse_draft_for_course(uuid, uuid) to authenticated;
grant execute on function public.can_read_teacher_microcourse_draft_for_lecture(uuid, uuid) to authenticated;
grant execute on function public.can_read_cw_page_revision_scoped(uuid, uuid) to authenticated;

revoke all on function public.create_teacher_microcourse(uuid, text, text, smallint, smallint, text, text, text[]) from public, anon, authenticated;
revoke all on function public.save_teacher_microcourse_metadata(uuid, text, text, smallint, smallint, text, text, text[]) from public, anon, authenticated;
revoke all on function public.set_teacher_microcourse_topic(text, text, text, smallint, boolean) from public, anon, authenticated;
revoke all on function public.get_teacher_microcourse_for_session(uuid) from public, anon, authenticated;

grant execute on function public.create_teacher_microcourse(uuid, text, text, smallint, smallint, text, text, text[]) to authenticated;
grant execute on function public.save_teacher_microcourse_metadata(uuid, text, text, smallint, smallint, text, text, text[]) to authenticated;
grant execute on function public.set_teacher_microcourse_topic(text, text, text, smallint, boolean) to authenticated;
grant execute on function public.get_teacher_microcourse_for_session(uuid) to authenticated;

comment on table public.teacher_microcourses is
  'DEV-TMC-1 one free-session project = one hidden draft course = one lecture. Publishing never rewrites the source session.';
comment on table public.teacher_microcourse_metadata_revisions is
  'Immutable teacher-entered catalog metadata. Draft and published heads advance independently.';
comment on table public.teacher_microcourse_review_snapshots is
  'Immutable link from a Courseware review submission to the exact metadata revision and H5 content hashes submitted with it.';

notify pgrst, 'reload schema';

commit;
