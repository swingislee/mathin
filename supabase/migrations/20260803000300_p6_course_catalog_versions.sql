-- P6：E 系列 2026 版接入的前置结构——课程目录版本层。
--
-- 背景：教材年度版本会在同一课程族内整体换代。E 系列现状是暑期 18 个班型已经是
-- 2026 新版，秋季/寒假/春季 54 个班型仍是 2025 旧版；即将导入的 2026 秋季 18 个班型
-- 与旧秋季复用同一批 MFHK 产品编码，且 (年级,季节,班型) 三元组完全重合。
--
-- 原结构有两处会直接冲突：
--   courses_product_code_key            全局唯一
--   courses_active_family_variant_idx   (family_id,grade,term,class_type) 族内唯一
-- course_families.edition 已经表示"全国版"这类教材地域版本，不能挪用来存年度版本；
-- 版本也不能做成新的 course_family，因为同一族内不同季节分属不同年度版本。
--
-- 本迁移只建立版本层、回填现状、收敛唯一性，不创建任何 2026 秋季课程或讲次。

-- ---------------------------------------------------------------------------
-- 1. 课程目录版本
-- ---------------------------------------------------------------------------
create table public.course_catalog_versions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.course_families(id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and length(slug) between 1 and 40),
  title text not null check (length(trim(title)) between 1 and 60),
  edition_year smallint check (edition_year is null or edition_year between 2000 and 2100),
  sort_order smallint not null default 0,
  is_current boolean not null default false,
  status text not null default 'enabled' check (status in ('draft', 'enabled', 'disabled')),
  notes text not null default '' check (length(notes) <= 2000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, slug)
);

-- 每个课程族恰好一个"当前版本"：它决定新建课程版本默认落在哪一年度版本上。
create unique index course_catalog_versions_current_idx
  on public.course_catalog_versions (family_id) where is_current;

create trigger course_catalog_versions_set_updated_at
  before update on public.course_catalog_versions
  for each row execute function public.set_updated_at();

alter table public.course_catalog_versions enable row level security;

create policy "course_catalog_versions_select_course_view" on public.course_catalog_versions
  for select to authenticated
  using (
    public.has_perm((select auth.uid()), 'course.view')
    and (status = 'enabled' or public.has_perm((select auth.uid()), 'course.manage'))
  );

create policy "course_catalog_versions_insert_manage" on public.course_catalog_versions
  for insert to authenticated
  with check (public.has_perm((select auth.uid()), 'course.manage'));

create policy "course_catalog_versions_update_manage" on public.course_catalog_versions
  for update to authenticated
  using (public.has_perm((select auth.uid()), 'course.manage'))
  with check (public.has_perm((select auth.uid()), 'course.manage'));

revoke all on public.course_catalog_versions from anon, authenticated;
grant select, insert, update on public.course_catalog_versions to authenticated;

comment on table public.course_catalog_versions is
  '课程族内的教材年度版本（如 E 系列 2025 旧版 / 2026 新版）。与 course_families.edition（全国版等地域版本）和 cw_lecture_releases.release_no（同一讲次内部发布迭代）是三个互不替代的维度。';

-- ---------------------------------------------------------------------------
-- 2. courses 挂载版本与替代关系
-- ---------------------------------------------------------------------------
alter table public.courses
  add column catalog_version_id uuid references public.course_catalog_versions(id) on delete restrict,
  add column superseded_by_course_id uuid references public.courses(id) on delete set null;

alter table public.courses
  add constraint courses_superseded_by_not_self check (superseded_by_course_id is distinct from id);

-- ---------------------------------------------------------------------------
-- 3. 回填现有 4 个课程族
--
-- E 系列按季节拆分年度版本：暑期已刷新到 2026 新版，秋/寒/春 仍是 2025 旧版。
-- 其余课程族目前只有单一年度版本，建一条默认版本承接，徽标层按"版本数 >= 2"决定
-- 是否展示，因此不会给它们凭空增加界面噪声。
-- ---------------------------------------------------------------------------
insert into public.course_catalog_versions (family_id, slug, title, edition_year, sort_order, is_current, notes)
select family_row.id, '2025', '2025旧版', 2025, 0, false,
       'E 系列秋季/寒假/春季在 2026-08-03 之前导入的教材版本。'
  from public.course_families family_row
 where family_row.slug = 'xueersi-e-primary-math-cn';

insert into public.course_catalog_versions (family_id, slug, title, edition_year, sort_order, is_current, notes)
select family_row.id, '2026', '2026新版', 2026, 1, true,
       'E 系列 2026 年度教材版本。暑期 18 个班型在本迁移前已是该版本；秋季 18 个班型由后续导入任务写入。'
  from public.course_families family_row
 where family_row.slug = 'xueersi-e-primary-math-cn';

insert into public.course_catalog_versions (family_id, slug, title, edition_year, sort_order, is_current, notes)
select family_row.id, 'default', '默认版本', null, 0, true,
       '该课程族尚未发生教材年度换代，全部课程版本归入此默认版本。'
  from public.course_families family_row
 where family_row.slug <> 'xueersi-e-primary-math-cn';

update public.courses course_row
   set catalog_version_id = version_row.id
  from public.course_catalog_versions version_row
  join public.course_families family_row on family_row.id = version_row.family_id
 where family_row.slug = 'xueersi-e-primary-math-cn'
   and course_row.family_id = family_row.id
   and version_row.slug = case when course_row.term = 1 then '2026' else '2025' end;

update public.courses course_row
   set catalog_version_id = version_row.id
  from public.course_catalog_versions version_row
 where course_row.catalog_version_id is null
   and version_row.family_id = course_row.family_id
   and version_row.slug = 'default';

alter table public.courses alter column catalog_version_id set not null;

create index courses_catalog_version_idx on public.courses (catalog_version_id);
create index courses_superseded_by_idx on public.courses (superseded_by_course_id)
  where superseded_by_course_id is not null;

-- ---------------------------------------------------------------------------
-- 4. 唯一性收敛到版本范围内
-- ---------------------------------------------------------------------------
drop index public.courses_active_family_variant_idx;
create unique index courses_active_variant_idx
  on public.courses (family_id, catalog_version_id, grade, term, class_type)
  where trashed_at is null;

-- product_code 是上游教材方的产品编码，新旧年度版本本来就会复用同一枚编码，
-- 因此唯一性只能收到版本内。它同时是 R1 正式初始化 manifest 的自然键，
-- scripts/plan-r1-initialization.mjs 已同步升级为 catalogVersion+productCode 复合键。
alter table public.courses drop constraint courses_product_code_key;
create unique index courses_product_code_idx
  on public.courses (catalog_version_id, product_code)
  where product_code is not null;

-- ---------------------------------------------------------------------------
-- 5. 默认版本填充：让既有写入路径（create_course_family / create_course_variant /
--    create_legacy_course / seed）无需逐个改造就落到课程族的当前版本上。
-- ---------------------------------------------------------------------------
create or replace function public.course_families_seed_catalog_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.course_catalog_versions (family_id, slug, title, sort_order, is_current, created_by)
  values (new.id, 'default', '默认版本', 0, true, new.created_by);
  return new;
end;
$$;

create trigger course_families_seed_catalog_version
  after insert on public.course_families
  for each row execute function public.course_families_seed_catalog_version();

create or replace function public.courses_resolve_catalog_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_id uuid;
begin
  if new.catalog_version_id is not null then
    if not exists (
      select 1 from public.course_catalog_versions version_row
       where version_row.id = new.catalog_version_id
         and version_row.family_id = new.family_id
    ) then
      raise exception 'COURSE_CATALOG_VERSION_FAMILY_MISMATCH';
    end if;
    return new;
  end if;

  select version_row.id into resolved_id
    from public.course_catalog_versions version_row
   where version_row.family_id = new.family_id and version_row.is_current;
  if resolved_id is null then raise exception 'COURSE_CATALOG_VERSION_MISSING'; end if;

  new.catalog_version_id := resolved_id;
  return new;
end;
$$;

create trigger courses_resolve_catalog_version
  before insert or update of family_id, catalog_version_id on public.courses
  for each row execute function public.courses_resolve_catalog_version();

-- ---------------------------------------------------------------------------
-- 6. 测试课程族清理必须先删版本行，否则被 on delete restrict 挡住。
-- ---------------------------------------------------------------------------
create or replace function public.purge_test_course_family(p_family_id uuid, p_confirm_name text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  family_row public.course_families%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'testdata.purge') then raise exception 'FORBIDDEN'; end if;

  select * into family_row from public.course_families where id = p_family_id for update;
  if not found then raise exception 'COURSE_FAMILY_NOT_FOUND'; end if;
  if family_row.purpose <> 'test' then raise exception 'PRODUCTION_DATA_PROTECTED'; end if;
  if exists (select 1 from public.courses c where c.family_id = p_family_id and c.trashed_at is null) then
    raise exception 'VARIANT_NOT_TRASHED';
  end if;
  if exists (select 1 from public.classrooms cl join public.courses c on c.id = cl.course_id where c.family_id = p_family_id) then
    raise exception 'COURSE_IN_USE';
  end if;
  if exists (
    select 1 from public.cw_replacement_items ri
      join public.courses c on c.id = ri.course_id
     where c.family_id = p_family_id
  ) then
    raise exception 'COURSE_HAS_REPLACEMENT_HISTORY';
  end if;
  if p_confirm_name is null or p_confirm_name <> family_row.title then raise exception 'NAME_MISMATCH'; end if;

  perform public.emit_domain_event(
    'course_family.lifecycle.purged', 'course_family', p_family_id,
    jsonb_build_object('title', family_row.title), null, null
  );

  delete from public.courses where family_id = p_family_id;
  delete from public.course_catalog_versions where family_id = p_family_id;
  delete from public.course_families where id = p_family_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. 回填断言：迁移只允许原地归类现状，不允许改变任何课程或讲次的数量。
-- ---------------------------------------------------------------------------
do $$
declare
  e_family_id uuid;
begin
  if exists (select 1 from public.courses where catalog_version_id is null) then
    raise exception 'P6_CATALOG_VERSION_BACKFILL_INCOMPLETE';
  end if;
  if exists (
    select family_row.id from public.course_families family_row
     where (select count(*) from public.course_catalog_versions version_row
             where version_row.family_id = family_row.id and version_row.is_current) <> 1
  ) then
    raise exception 'P6_CATALOG_VERSION_CURRENT_NOT_UNIQUE';
  end if;

  select id into e_family_id from public.course_families where slug = 'xueersi-e-primary-math-cn';
  if e_family_id is null then raise exception 'P6_E_FAMILY_MISSING'; end if;

  if (select count(*) from public.courses course_row
        join public.course_catalog_versions version_row on version_row.id = course_row.catalog_version_id
       where course_row.family_id = e_family_id and version_row.slug = '2026') <> 18 then
    raise exception 'P6_E_2026_COURSE_COUNT_UNEXPECTED';
  end if;
  if (select count(*) from public.courses course_row
        join public.course_catalog_versions version_row on version_row.id = course_row.catalog_version_id
       where course_row.family_id = e_family_id and version_row.slug = '2025') <> 54 then
    raise exception 'P6_E_2025_COURSE_COUNT_UNEXPECTED';
  end if;
  if (select count(*) from public.courses course_row
        join public.course_catalog_versions version_row on version_row.id = course_row.catalog_version_id
       where course_row.family_id = e_family_id and version_row.slug = '2026' and course_row.term <> 1) <> 0 then
    raise exception 'P6_E_2026_SEASON_UNEXPECTED';
  end if;
  if (select count(*) from public.course_lectures lecture_row
        join public.courses course_row on course_row.id = lecture_row.course_id
       where course_row.family_id = e_family_id) <> 865 then
    raise exception 'P6_E_LECTURE_COUNT_CHANGED';
  end if;
end;
$$;
