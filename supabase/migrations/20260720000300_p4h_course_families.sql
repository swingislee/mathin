-- P4H-3：课程产品（family）层与 72 个 E 系列版本的原位归组。
-- 此迁移只按 teaching-plans.json 中明确列出的 product_code 归组，绝不按标题猜测。

create table public.course_families (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  publisher text not null default '',
  stage text not null default '',
  subject text not null default '',
  edition text not null default '',
  description text not null default '',
  cover_path text,
  purpose text not null default 'production' check (purpose in ('production','test')),
  status text not null default 'enabled' check (status in ('draft','enabled','disabled')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger course_families_set_updated_at
  before update on public.course_families
  for each row execute function public.set_updated_at();

alter table public.courses
  add column family_id uuid references public.course_families(id) on delete restrict;

-- 固定快照：必须与 supabase/seed/teaching-plans.json 的 72 个产品编码一一对应。
do $$
declare
  expected_codes text[] := array[
    'MFHK00621','MFHK00622','MFHK00632','MFHK00007','MFHK00008','MFHK00009',
    'MFHK02013','MFHK02014','MFHK02015','MFHK02038','MFHK02039','MFHK02040',
    'MFHK00619','MFHK00620','MFHK00640','MFHK00010','MFHK00011','MFHK00012',
    'MFHK02016','MFHK02017','MFHK02018','MFHK02041','MFHK02042','MFHK02043',
    'MFHK00647','MFHK00646','MFHK00650','MFHK00013','MFHK00014','MFHK00015',
    'MFHK02019','MFHK02020','MFHK02021','MFHK02044','MFHK02045','MFHK02046',
    'MFHK01861','MFHK01862','MFHK00651','MFHK00016','MFHK00017','MFHK00018',
    'MFHK02022','MFHK02023','MFHK02024','MFHK02047','MFHK02048','MFHK02049',
    'MFHK01863','MFHK01864','MFHK01865','MFHK01911','MFHK01912','MFHK00021',
    'MFHK02025','MFHK02026','MFHK02027','MFHK02050','MFHK02051','MFHK02052',
    'MFHK01866','MFHK01867','MFHK01868','MFHK00022','MFHK00023','MFHK01913',
    'MFHK02028','MFHK02029','MFHK02030','MFHK02053','MFHK02054','MFHK02055'
  ];
begin
  if cardinality(expected_codes) <> 72 then
    raise exception 'P4H_SEED_CODE_SNAPSHOT_INVALID';
  end if;
  if exists (
    select code
      from unnest(expected_codes) as expected(code)
      left join public.courses course_row on course_row.product_code = expected.code
     group by code
    having count(course_row.id) <> 1
  ) then
    raise exception 'P4H_SEED_COURSE_ASSERTION_FAILED';
  end if;
  if exists (
    select 1 from public.courses
     where product_code = any(expected_codes)
       and title not like 'E系列数学%'
  ) then
    raise exception 'P4H_SEED_TITLE_ASSERTION_FAILED';
  end if;
  if exists (
    select grade, term, class_type
      from public.courses
     where product_code = any(expected_codes)
     group by grade, term, class_type
    having count(*) <> 1
  ) then
    raise exception 'P4H_SEED_VARIANT_DIMENSION_ASSERTION_FAILED';
  end if;
  if (select count(*) from public.course_lectures lecture_row
        join public.courses course_row on course_row.id = lecture_row.course_id
       where course_row.product_code = any(expected_codes)) <> 865 then
    raise exception 'P4H_SEED_LECTURE_ASSERTION_FAILED';
  end if;
end;
$$;

insert into public.course_families (slug,title,publisher,stage,subject,edition,purpose,status)
values ('xueersi-e-primary-math-cn','E 系列小学数学','学而思','小学','数学','全国版','production','enabled')
on conflict (slug) do update set
  title = excluded.title,
  publisher = excluded.publisher,
  stage = excluded.stage,
  subject = excluded.subject,
  edition = excluded.edition,
  purpose = excluded.purpose,
  status = excluded.status;

update public.courses course_row
   set family_id = family_row.id
  from public.course_families family_row
 where family_row.slug = 'xueersi-e-primary-math-cn'
   and course_row.product_code = any(array[
    'MFHK00621','MFHK00622','MFHK00632','MFHK00007','MFHK00008','MFHK00009',
    'MFHK02013','MFHK02014','MFHK02015','MFHK02038','MFHK02039','MFHK02040',
    'MFHK00619','MFHK00620','MFHK00640','MFHK00010','MFHK00011','MFHK00012',
    'MFHK02016','MFHK02017','MFHK02018','MFHK02041','MFHK02042','MFHK02043',
    'MFHK00647','MFHK00646','MFHK00650','MFHK00013','MFHK00014','MFHK00015',
    'MFHK02019','MFHK02020','MFHK02021','MFHK02044','MFHK02045','MFHK02046',
    'MFHK01861','MFHK01862','MFHK00651','MFHK00016','MFHK00017','MFHK00018',
    'MFHK02022','MFHK02023','MFHK02024','MFHK02047','MFHK02048','MFHK02049',
    'MFHK01863','MFHK01864','MFHK01865','MFHK01911','MFHK01912','MFHK00021',
    'MFHK02025','MFHK02026','MFHK02027','MFHK02050','MFHK02051','MFHK02052',
    'MFHK01866','MFHK01867','MFHK01868','MFHK00022','MFHK00023','MFHK01913',
    'MFHK02028','MFHK02029','MFHK02030','MFHK02053','MFHK02054','MFHK02055'
  ]);

-- 非 seed 课程绝不猜测归属；每一行获得可追溯的一对一 legacy family。
insert into public.course_families (slug,title,purpose,status,created_by)
select 'legacy-course-' || course_row.id::text, course_row.title, course_row.purpose, course_row.status, course_row.created_by
  from public.courses course_row
 where course_row.family_id is null
on conflict (slug) do update set
  title = excluded.title,
  purpose = excluded.purpose,
  status = excluded.status,
  created_by = excluded.created_by;

update public.courses course_row
   set family_id = family_row.id
  from public.course_families family_row
 where course_row.family_id is null
   and family_row.slug = 'legacy-course-' || course_row.id::text;

-- domain_events 是 append-only migration audit；留下每一条 legacy 映射的原始 course/family ID。
insert into public.domain_events (event_type,entity_type,entity_id,payload)
select
  'course_family.legacy_migrated',
  'course',
  course_row.id,
  jsonb_build_object(
    'migration', '20260720000300_p4h_course_families',
    'familyId', family_row.id,
    'familySlug', family_row.slug,
    'productCode', course_row.product_code
  )
  from public.courses course_row
  join public.course_families family_row on family_row.id = course_row.family_id
 where family_row.slug = 'legacy-course-' || course_row.id::text;

do $$
declare
  e_family_id uuid;
begin
  select id into e_family_id from public.course_families where slug = 'xueersi-e-primary-math-cn';
  if (select count(*) from public.courses where family_id = e_family_id) <> 72
     or (select count(*) from public.course_lectures lecture_row join public.courses course_row on course_row.id = lecture_row.course_id where course_row.family_id = e_family_id) <> 865
     or exists (select 1 from public.courses where family_id is null) then
    raise exception 'P4H_COURSE_FAMILY_BACKFILL_ASSERTION_FAILED';
  end if;
end;
$$;

alter table public.courses alter column family_id set not null;

create unique index courses_active_family_variant_idx
  on public.courses (family_id, grade, term, class_type)
  where trashed_at is null;

-- 旧课程编辑入口在 P4H-4 替换前仍可创建课程；数据库将其显式隔离为 legacy family，
-- 而不是允许 family_id 为 NULL 或把它猜测归入 E 系列。
create or replace function public.assign_legacy_course_family()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.family_id is null then
    insert into public.course_families (slug,title,purpose,status,created_by)
    values (
      'legacy-course-' || new.id::text,
      new.title,
      coalesce(new.purpose, 'production'),
      coalesce(new.status, 'enabled'),
      new.created_by
    )
    on conflict (slug) do update set
      title = excluded.title,
      purpose = excluded.purpose,
      status = excluded.status,
      created_by = excluded.created_by
    returning id into new.family_id;
  end if;
  return new;
end;
$$;

create trigger courses_assign_legacy_family
  before insert on public.courses
  for each row execute function public.assign_legacy_course_family();

-- 旧课程页在 P4H-4 重写前的原子兼容入口：新课程一律获得一对一 legacy family。
create or replace function public.create_legacy_course(
  p_title text,
  p_product_code text,
  p_grade smallint,
  p_course_season smallint,
  p_class_type text,
  p_status text default 'enabled'
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  course_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'course.manage') then raise exception 'FORBIDDEN'; end if;
  if length(trim(coalesce(p_title, ''))) = 0
     or p_grade not between 1 and 9
     or p_course_season not between 1 and 4
     or p_status not in ('draft','enabled','disabled') then
    raise exception 'VALIDATION';
  end if;

  insert into public.courses (title,product_code,grade,term,class_type,status,purpose,created_by)
  values (
    left(trim(p_title), 100),
    nullif(left(trim(coalesce(p_product_code, '')), 40), ''),
    p_grade,
    p_course_season,
    left(trim(coalesce(p_class_type, '')), 20),
    p_status,
    'production',
    uid
  )
  returning id into course_id;
  return course_id;
end;
$$;

alter table public.course_families enable row level security;

create policy "course_families_select_course_view" on public.course_families
  for select to authenticated
  using (
    public.has_perm((select auth.uid()), 'course.view')
    and (status = 'enabled' or public.has_perm((select auth.uid()), 'course.manage'))
    and exists (
      select 1 from public.courses course_row
       where course_row.family_id = public.course_families.id
         and course_row.trashed_at is null
         and (course_row.status = 'enabled' or public.has_perm((select auth.uid()), 'course.manage'))
    )
  );

create policy "course_families_insert_manage" on public.course_families
  for insert to authenticated
  with check (public.has_perm((select auth.uid()), 'course.manage'));

create policy "course_families_update_manage" on public.course_families
  for update to authenticated
  using (public.has_perm((select auth.uid()), 'course.manage'))
  with check (public.has_perm((select auth.uid()), 'course.manage'));

revoke all on public.course_families from anon, authenticated;
grant select, insert, update on public.course_families to authenticated;
revoke delete on public.course_families from authenticated;

-- 课程版本与 family 的关系由 course.manage 的既有 RLS 约束；补上新列的列级授权。
grant insert (family_id) on public.courses to authenticated;
grant update (family_id) on public.courses to authenticated;

create or replace function public.transition_course_family_status(
  p_family_id uuid,
  p_target text
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  family_row public.course_families%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'course.manage') then raise exception 'FORBIDDEN'; end if;
  if p_target not in ('draft','enabled','disabled') then raise exception 'INVALID_TRANSITION'; end if;

  select * into family_row from public.course_families where id = p_family_id for update;
  if not found then raise exception 'COURSE_FAMILY_NOT_FOUND'; end if;

  update public.course_families set status = p_target where id = p_family_id;
  perform public.emit_domain_event(
    'course_family.lifecycle.transition',
    'course_family',
    p_family_id,
    jsonb_build_object('from', family_row.status, 'to', p_target),
    null,
    null
  );
end;
$$;

create or replace function public.get_course_family_impact(p_family_id uuid)
returns table(
  variant_count integer,
  lecture_count integer,
  release_count integer,
  classroom_count integer,
  session_count integer,
  object_count integer
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'course.view') then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.course_families where id = p_family_id) then
    raise exception 'COURSE_FAMILY_NOT_FOUND';
  end if;

  return query
  select
    (select count(*)::integer from public.courses where family_id = p_family_id),
    (select count(*)::integer from public.course_lectures lecture_row join public.courses course_row on course_row.id = lecture_row.course_id where course_row.family_id = p_family_id),
    (select count(*)::integer from public.cw_lecture_releases release_row join public.course_lectures lecture_row on lecture_row.id = release_row.lecture_id join public.courses course_row on course_row.id = lecture_row.course_id where course_row.family_id = p_family_id),
    (select count(*)::integer from public.classrooms classroom_row join public.courses course_row on course_row.id = classroom_row.course_id where course_row.family_id = p_family_id),
    (select count(distinct session_row.id)::integer from public.class_sessions session_row left join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id left join public.course_lectures lecture_row on lecture_row.id = session_row.lecture_id left join public.courses course_row on course_row.id = coalesce(classroom_row.course_id, lecture_row.course_id) where course_row.family_id = p_family_id),
    (select count(distinct object_row.id)::integer from public.cw_asset_objects object_row join public.cw_asset_revisions revision_row on revision_row.object_id = object_row.id join public.cw_page_asset_bindings binding_row on true join public.cw_shared_assets asset_row on asset_row.id = binding_row.shared_asset_id join public.cw_page_docs page_row on page_row.id = binding_row.page_doc_id join public.course_lectures lecture_row on lecture_row.id = page_row.lecture_id join public.courses course_row on course_row.id = lecture_row.course_id where revision_row.id = coalesce(binding_row.pinned_revision_id, asset_row.published_revision_id) and course_row.family_id = p_family_id and page_row.deleted_at is null);
end;
$$;

create or replace function public.list_course_families(
  p_scope text default 'all',
  p_filters jsonb default '{}'::jsonb,
  p_page integer default 1
)
returns table(
  id uuid,
  slug text,
  title text,
  publisher text,
  stage text,
  subject text,
  edition text,
  purpose text,
  status text,
  variant_count integer,
  lecture_count integer,
  matched_variants jsonb,
  total_count integer
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  can_manage boolean;
  v_scope text := lower(trim(coalesce(p_scope, 'all')));
  v_query text := left(trim(coalesce(p_filters ->> 'q', '')), 80);
  v_search text;
  v_grade smallint;
  v_course_season smallint;
  v_class_type text := left(trim(coalesce(p_filters ->> 'classType', '')), 20);
  v_purpose text := nullif(lower(trim(coalesce(p_filters ->> 'purpose', ''))), '');
  v_status text := nullif(lower(trim(coalesce(p_filters ->> 'status', ''))), '');
  v_page integer := greatest(1, least(coalesce(p_page, 1), 100000));
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'course.view') then raise exception 'FORBIDDEN'; end if;
  if v_scope not in ('research','teaching','all','test') then raise exception 'INVALID_SCOPE'; end if;
  can_manage := public.has_perm(uid, 'course.manage');
  if v_scope in ('research','test') and not can_manage then raise exception 'FORBIDDEN_SCOPE'; end if;
  if coalesce(p_filters ->> 'grade', '') ~ '^[1-9]$' then v_grade := (p_filters ->> 'grade')::smallint; end if;
  if coalesce(p_filters ->> 'courseSeason', '') ~ '^[1-4]$' then v_course_season := (p_filters ->> 'courseSeason')::smallint; end if;
  if v_purpose not in ('production','test') then v_purpose := null; end if;
  if v_status not in ('draft','enabled','disabled') then v_status := null; end if;
  v_search := replace(replace(replace(v_query, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');

  return query
  with variants as (
    select family_row.id as family_id, family_row.slug, family_row.title as family_title,
      family_row.publisher, family_row.stage, family_row.subject, family_row.edition,
      family_row.purpose as family_purpose, family_row.status as family_status,
      course_row.id as variant_id, course_row.title as variant_title, course_row.product_code,
      course_row.grade, course_row.term, course_row.class_type
      from public.course_families family_row
      join public.courses course_row on course_row.family_id = family_row.id
     where course_row.trashed_at is null
       and (can_manage or (family_row.status = 'enabled' and course_row.status = 'enabled'))
       and (v_scope <> 'test' or family_row.purpose = 'test')
       and (v_scope <> 'teaching' or exists (
         select 1 from public.classrooms classroom_row
         join public.classroom_staff_assignments assignment_row on assignment_row.classroom_id = classroom_row.id
         where classroom_row.course_id = course_row.id
           and assignment_row.user_id = uid
           and assignment_row.responsibility in ('primary_teacher','assistant_teacher')
       ))
       and (v_grade is null or course_row.grade = v_grade)
       and (v_course_season is null or course_row.term = v_course_season)
       and (v_class_type = '' or course_row.class_type = v_class_type)
       and (v_purpose is null or family_row.purpose = v_purpose)
       and (v_status is null or family_row.status = v_status)
       and (
         v_query = ''
         or family_row.title ilike '%' || v_search || '%' escape E'\\'
         or family_row.slug ilike '%' || v_search || '%' escape E'\\'
         or course_row.title ilike '%' || v_search || '%' escape E'\\'
         or coalesce(course_row.product_code, '') ilike '%' || v_search || '%' escape E'\\'
         or exists (select 1 from public.course_lectures lecture_row where lecture_row.course_id = course_row.id and lecture_row.name ilike '%' || v_search || '%' escape E'\\')
       )
  ), families as (
    select
      variant_row.family_id, variant_row.slug, variant_row.family_title,
      variant_row.publisher, variant_row.stage, variant_row.subject, variant_row.edition,
      variant_row.family_purpose, variant_row.family_status,
      count(*)::integer as variant_count,
      sum((select count(*) from public.course_lectures lecture_row where lecture_row.course_id = variant_row.variant_id))::integer as lecture_count,
      jsonb_agg(jsonb_build_object(
        'id', variant_row.variant_id,
        'title', variant_row.variant_title,
        'productCode', variant_row.product_code,
        'grade', variant_row.grade,
        'courseSeason', variant_row.term,
        'classType', variant_row.class_type,
        'lectureCount', (select count(*) from public.course_lectures lecture_row where lecture_row.course_id = variant_row.variant_id),
        'releasedLectureCount', (select count(*) from public.course_lectures lecture_row where lecture_row.course_id = variant_row.variant_id and lecture_row.current_release_id is not null)
      ) order by variant_row.grade, variant_row.term, variant_row.class_type, variant_row.product_code) as matched_variants
      from variants variant_row
     group by variant_row.family_id, variant_row.slug, variant_row.family_title,
       variant_row.publisher, variant_row.stage, variant_row.subject, variant_row.edition,
       variant_row.family_purpose, variant_row.family_status
  )
  select
    family_row.family_id, family_row.slug, family_row.family_title,
    family_row.publisher, family_row.stage, family_row.subject, family_row.edition,
    family_row.family_purpose, family_row.family_status,
    family_row.variant_count, family_row.lecture_count, family_row.matched_variants, count(*) over()::integer
    from families family_row
   order by family_row.family_title, family_row.slug
   limit 30 offset ((v_page - 1) * 30);
end;
$$;

create or replace function public.get_course_family_detail(
  p_family_id uuid,
  p_variant_id uuid default null
)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  can_manage boolean;
  family_row public.course_families%rowtype;
  selected_variant public.courses%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'course.view') then raise exception 'FORBIDDEN'; end if;
  can_manage := public.has_perm(uid, 'course.manage');
  select * into family_row from public.course_families where id = p_family_id;
  if not found then raise exception 'COURSE_FAMILY_NOT_FOUND'; end if;
  if not can_manage and family_row.status <> 'enabled' then raise exception 'FORBIDDEN_SCOPE'; end if;

  if p_variant_id is not null then
    select * into selected_variant from public.courses
     where id = p_variant_id and family_id = p_family_id;
    if not found then raise exception 'COURSE_VARIANT_NOT_IN_FAMILY'; end if;
  else
    select * into selected_variant from public.courses
     where family_id = p_family_id
       and (can_manage or (trashed_at is null and status = 'enabled'))
     order by grade, term, class_type, product_code nulls last
     limit 1;
  end if;

  return jsonb_build_object(
    'family', jsonb_build_object(
      'id', family_row.id,
      'slug', family_row.slug,
      'title', family_row.title,
      'publisher', family_row.publisher,
      'stage', family_row.stage,
      'subject', family_row.subject,
      'edition', family_row.edition,
      'description', family_row.description,
      'coverPath', family_row.cover_path,
      'purpose', family_row.purpose,
      'status', family_row.status
    ),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', course_row.id,
        'title', course_row.title,
        'productCode', course_row.product_code,
        'grade', course_row.grade,
        'courseSeason', course_row.term,
        'classType', course_row.class_type,
        'status', course_row.status,
        'purpose', course_row.purpose,
        'trashedAt', course_row.trashed_at
      ) order by course_row.grade, course_row.term, course_row.class_type, course_row.product_code)
      from public.courses course_row
     where course_row.family_id = p_family_id
       and (can_manage or (course_row.trashed_at is null and course_row.status = 'enabled'))
    ), '[]'::jsonb),
    'selectedVariant', case when selected_variant.id is null then null else jsonb_build_object(
      'id', selected_variant.id,
      'title', selected_variant.title,
      'productCode', selected_variant.product_code,
      'grade', selected_variant.grade,
      'courseSeason', selected_variant.term,
      'classType', selected_variant.class_type,
      'status', selected_variant.status,
      'purpose', selected_variant.purpose,
      'updatedAt', selected_variant.updated_at
    ) end,
    'teachingPlan', case when selected_variant.id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', lecture_row.id,
        'no', lecture_row.no,
        'name', lecture_row.name,
        'objectives', lecture_row.objectives,
        'status', lecture_row.status,
        'archivedAt', lecture_row.archived_at,
        'hasRelease', lecture_row.current_release_id is not null,
        'pageCount', (select count(*) from public.cw_page_docs page_row where page_row.lecture_id = lecture_row.id and page_row.deleted_at is null)
      ) order by lecture_row.no)
      from public.course_lectures lecture_row
     where lecture_row.course_id = selected_variant.id
    ), '[]'::jsonb) end,
    'readiness', case when selected_variant.id is null then jsonb_build_object('lectureCount', 0, 'releasedLectureCount', 0, 'pageCount', 0) else jsonb_build_object(
      'lectureCount', (select count(*) from public.course_lectures lecture_row where lecture_row.course_id = selected_variant.id),
      'releasedLectureCount', (select count(*) from public.course_lectures lecture_row where lecture_row.course_id = selected_variant.id and lecture_row.current_release_id is not null),
      'pageCount', (select count(*) from public.cw_page_docs page_row join public.course_lectures lecture_row on lecture_row.id = page_row.lecture_id where lecture_row.course_id = selected_variant.id and page_row.deleted_at is null)
    ) end
  );
end;
$$;

revoke all on function public.transition_course_family_status(uuid,text) from public, anon, authenticated;
revoke all on function public.get_course_family_impact(uuid) from public, anon, authenticated;
revoke all on function public.list_course_families(text,jsonb,integer) from public, anon, authenticated;
revoke all on function public.get_course_family_detail(uuid,uuid) from public, anon, authenticated;
revoke all on function public.create_legacy_course(text,text,smallint,smallint,text,text) from public, anon, authenticated;
grant execute on function public.transition_course_family_status(uuid,text) to authenticated;
grant execute on function public.get_course_family_impact(uuid) to authenticated;
grant execute on function public.list_course_families(text,jsonb,integer) to authenticated;
grant execute on function public.get_course_family_detail(uuid,uuid) to authenticated;
grant execute on function public.create_legacy_course(text,text,smallint,smallint,text,text) to authenticated;
