begin;

-- DEV-TMC-4 Phase 1: organization academic dimensions and the configurable
-- 766-backed subject scene tree. The existing single organization and course
-- family are retained as the organization/subject authorities.

create table public.teacher_microcourse_framework_items (
  code text primary key,
  group_code text not null check (group_code in ('seven_step', 'six_support', 'six_guarantee')),
  label_zh text not null,
  label_en text not null,
  default_order smallint not null unique check (default_order between 1 and 19)
);

insert into public.teacher_microcourse_framework_items(code, group_code, label_zh, label_en, default_order)
values
  ('entrance_check', 'seven_step', '进门考', 'Entrance check', 1),
  ('new_lesson', 'seven_step', '授新课', 'New lesson', 2),
  ('in_class_practice', 'seven_step', '随堂练', 'In-class practice', 3),
  ('structure_review', 'seven_step', '理结构', 'Structure review', 4),
  ('exit_check', 'seven_step', '出门测', 'Exit check', 5),
  ('explain_clearly', 'seven_step', '讲明白', 'Explain clearly', 6),
  ('homework_practice', 'seven_step', '作业练', 'Homework practice', 7),
  ('daily_calculation', 'six_support', '计算天天练', 'Daily calculation', 8),
  ('weekly_habits', 'six_support', '习惯周周练', 'Weekly habits', 9),
  ('monthly_review', 'six_support', '月清课', 'Monthly review', 10),
  ('daily_thinking', 'six_support', '思维天天练', 'Daily thinking', 11),
  ('thinking_extension', 'six_support', '思维拓展练', 'Thinking extension', 12),
  ('promotion_activity', 'six_support', '升班活动', 'Promotion activity', 13),
  ('class_performance', 'six_guarantee', '课堂表现集', 'Class performance', 14),
  ('answer_collection', 'six_guarantee', '答题集', 'Answer collection', 15),
  ('growth_record', 'six_guarantee', '成长档案', 'Growth record', 16),
  ('after_class_communication', 'six_guarantee', '课后沟通', 'After-class communication', 17),
  ('system_planning', 'six_guarantee', '体系规划', 'System planning', 18),
  ('stage_conference', 'six_guarantee', '阶段会谈', 'Stage conference', 19);

create or replace function public.school_permission_keys()
returns text[] language sql immutable
as $$
  select array[
    'student.view.all','student.view.assigned','student.edit','student.create','student.assign','student.import','student.delete',
    'followup.view','followup.write','activity.manage','activity.register','review.write','video.review',
    'course.view','course.manage','course.view.all','course.product.create','course.assignment.manage',
    'subject.microcourse.scene.manage','subject.microcourse.scope.manage','subject.microcourse.maintainer.assign',
    'subject.microcourse.course.create','subject.microcourse.branch.create','subject.microcourse.commit.create',
    'subject.microcourse.default.select',
    'courseware.template.edit','courseware.overlay.edit','courseware.microcourse.author','courseware.page.edit','courseware.asset.manage',
    'courseware.release.publish','courseware.review','courseware.emergency_publish',
    'class.view.all','class.view.mine','class.create','class.manage','enrollment.manage',
    'schedule.view.all','schedule.manage','attendance.mark','grading.write','report.view.all','session.void','session.postwork.manage',
    'finance.order.view','finance.order.create','finance.payment.record','finance.refund.request','finance.refund.approve',
    'finance.coupon.manage','finance.scholarship.grant','finance.account.adjust','finance.report.view',
    'staff.manage','permission.configure','registration.invite.manage','organization.settings.manage','organization.profile.manage',
    'location.manage','system.operations.manage','account.support.manage','work_item.manage','approval.manage','audit.view','testdata.purge'
  ]::text[]
$$;

insert into public.role_permissions(role_id, perm_key)
select distinct role_row.id, seed.perm_key
from public.staff_roles role_row
join public.role_permissions inherited on inherited.role_id = role_row.id
cross join lateral (values
  ('subject.microcourse.scene.manage'),
  ('subject.microcourse.scope.manage'),
  ('subject.microcourse.maintainer.assign'),
  ('subject.microcourse.default.select')
) seed(perm_key)
where inherited.perm_key = 'course.manage'
on conflict do nothing;

insert into public.role_permissions(role_id, perm_key)
select distinct role_row.id, seed.perm_key
from public.staff_roles role_row
join public.role_permissions inherited on inherited.role_id = role_row.id
cross join lateral (values
  ('subject.microcourse.course.create'),
  ('subject.microcourse.branch.create'),
  ('subject.microcourse.commit.create')
) seed(perm_key)
where inherited.perm_key = 'courseware.microcourse.author'
on conflict do nothing;

create or replace function public.organization_feature_keys()
returns text[] language sql immutable
as $$
  select array[
    'finance.enabled','notifications.email','notifications.sms','notifications.wechat',
    'public_content.publish','teaching.preparation_archive_edit',
    'teaching.classroom_board_checkpoint_v2','teaching.classroom_input_v2',
    'teaching.classroom_h5_pointer_v1','teaching.classroom_layout_v2',
    'teaching.teacher_microcourses_v1','teaching.teacher_microcourse_browser_v2'
  ]::text[]
$$;

create table public.organization_grade_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name_zh text not null check (char_length(btrim(name_zh)) between 1 and 40),
  name_en text not null check (char_length(btrim(name_en)) between 1 and 80),
  sort_order integer not null check (sort_order between 1 and 1000),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.organization_academic_grades (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  grade_no smallint not null check (grade_no between 1 and 99),
  name_zh text not null check (char_length(btrim(name_zh)) between 1 and 40),
  name_en text not null check (char_length(btrim(name_en)) between 1 and 80),
  stage_id uuid references public.organization_grade_stages(id) on delete restrict,
  sort_order integer not null check (sort_order between 1 and 1000),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, grade_no)
);

create table public.organization_academic_terms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name_zh text not null check (char_length(btrim(name_zh)) between 1 and 40),
  name_en text not null check (char_length(btrim(name_en)) between 1 and 80),
  legacy_season smallint check (legacy_season between 1 and 4),
  sort_order integer not null check (sort_order between 1 and 1000),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, legacy_season)
);

create table public.organization_class_systems (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name_zh text not null check (char_length(btrim(name_zh)) between 1 and 40),
  name_en text not null check (char_length(btrim(name_en)) between 1 and 80),
  sort_order integer not null check (sort_order between 1 and 1000),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.organization_class_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  system_id uuid not null references public.organization_class_systems(id) on delete restrict,
  code text not null check (char_length(btrim(code)) between 1 and 40),
  name_zh text not null check (char_length(btrim(name_zh)) between 1 and 40),
  name_en text not null check (char_length(btrim(name_en)) between 1 and 80),
  sort_order integer not null check (sort_order between 1 and 1000),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.teacher_microcourse_subject_managers (
  course_family_id uuid not null references public.course_families(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (course_family_id, user_id)
);

create table public.subject_microcourse_scene_roots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  course_family_id uuid not null references public.course_families(id) on delete cascade,
  framework_item_code text not null references public.teacher_microcourse_framework_items(code) on delete restrict,
  sort_order integer not null check (sort_order between 1 and 1000),
  enabled boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, course_family_id, framework_item_code)
);

create table public.subject_microcourse_scenes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  course_family_id uuid not null references public.course_families(id) on delete cascade,
  root_id uuid not null references public.subject_microcourse_scene_roots(id) on delete restrict,
  parent_id uuid references public.subject_microcourse_scenes(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  sort_order integer not null check (sort_order between 1 and 10000),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index subject_microcourse_scenes_tree_idx
  on public.subject_microcourse_scenes(course_family_id, root_id, parent_id, status, sort_order);
create unique index subject_microcourse_scenes_active_name_unique
  on public.subject_microcourse_scenes(
    root_id,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(btrim(name))
  )
  where status = 'active';

alter table public.teacher_microcourse_framework_items enable row level security;
alter table public.organization_grade_stages enable row level security;
alter table public.organization_academic_grades enable row level security;
alter table public.organization_academic_terms enable row level security;
alter table public.organization_class_systems enable row level security;
alter table public.organization_class_types enable row level security;
alter table public.teacher_microcourse_subject_managers enable row level security;
alter table public.subject_microcourse_scene_roots enable row level security;
alter table public.subject_microcourse_scenes enable row level security;

revoke all on table
  public.teacher_microcourse_framework_items,
  public.organization_grade_stages,
  public.organization_academic_grades,
  public.organization_academic_terms,
  public.organization_class_systems,
  public.organization_class_types,
  public.teacher_microcourse_subject_managers,
  public.subject_microcourse_scene_roots,
  public.subject_microcourse_scenes
from public, anon, authenticated;

create or replace function public.can_manage_teacher_microcourse_subject(
  p_course_family_id uuid,
  p_uid uuid default auth.uid()
)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p_uid is not null and (
    public.is_admin(p_uid)
    or (
      public.has_perm(p_uid, 'subject.microcourse.scene.manage')
      and exists (
        select 1 from public.teacher_microcourse_subject_managers manager
        where manager.course_family_id = p_course_family_id
          and manager.user_id = p_uid
      )
    )
  )
$$;

create function public.assert_teacher_microcourse_subject_manager(p_course_family_id uuid)
returns uuid
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.can_manage_teacher_microcourse_subject(p_course_family_id, uid) then
    raise exception 'FORBIDDEN_SUBJECT';
  end if;
  if not exists (
    select 1 from public.course_families family
    where family.id = p_course_family_id and family.slug = 'teacher-microcourses'
  ) then
    raise exception 'COURSE_FAMILY_NOT_FOUND';
  end if;
  return uid;
end;
$$;

-- Existing global course managers receive the current teacher-microcourse
-- family scope. Future scope changes are explicit through the manager RPC.
insert into public.teacher_microcourse_subject_managers(course_family_id, user_id)
select family.id, member.user_id
from public.course_families family
cross join lateral (
  select distinct role_member.user_id
  from public.staff_role_members role_member
  join public.role_permissions permission on permission.role_id = role_member.role_id
  where permission.perm_key = 'subject.microcourse.scene.manage'
) member
where family.slug = 'teacher-microcourses'
on conflict do nothing;

-- Default organization dimensions. They are editable configuration, not
-- course-component constants.
with organization_row as (
  select id from public.organizations where singleton_key = 1
), inserted_stage as (
  insert into public.organization_grade_stages(
    organization_id, code, name_zh, name_en, sort_order
  )
  select organization_row.id, seed.code, seed.name_zh, seed.name_en, seed.sort_order
  from organization_row
  cross join (values
    ('primary_lower', '小学低段', 'Lower primary', 10),
    ('primary_middle', '小学中段', 'Middle primary', 20),
    ('primary_upper', '小学高段', 'Upper primary', 30),
    ('secondary', '中学段', 'Secondary', 40)
  ) seed(code, name_zh, name_en, sort_order)
  on conflict (organization_id, code) do nothing
  returning id
)
select count(*) from inserted_stage;

insert into public.organization_academic_grades(
  organization_id, grade_no, name_zh, name_en, stage_id, sort_order
)
select organization_row.id, seed.grade_no, seed.name_zh, seed.name_en,
       stage.id, seed.grade_no * 10
from public.organizations organization_row
cross join (values
  (1::smallint, '一年级', 'Grade 1', 'primary_lower'),
  (2::smallint, '二年级', 'Grade 2', 'primary_lower'),
  (3::smallint, '三年级', 'Grade 3', 'primary_middle'),
  (4::smallint, '四年级', 'Grade 4', 'primary_middle'),
  (5::smallint, '五年级', 'Grade 5', 'primary_upper'),
  (6::smallint, '六年级', 'Grade 6', 'primary_upper'),
  (7::smallint, '七年级', 'Grade 7', 'secondary'),
  (8::smallint, '八年级', 'Grade 8', 'secondary'),
  (9::smallint, '九年级', 'Grade 9', 'secondary')
) seed(grade_no, name_zh, name_en, stage_code)
join public.organization_grade_stages stage
  on stage.organization_id = organization_row.id and stage.code = seed.stage_code
where organization_row.singleton_key = 1
on conflict (organization_id, grade_no) do nothing;

insert into public.organization_academic_terms(
  organization_id, code, name_zh, name_en, legacy_season, sort_order
)
select organization_row.id, seed.code, seed.name_zh, seed.name_en,
       seed.legacy_season, seed.sort_order
from public.organizations organization_row
cross join (values
  ('summer', '暑期', 'Summer', 1::smallint, 10),
  ('autumn', '秋季', 'Autumn', 2::smallint, 20),
  ('winter', '寒假', 'Winter', 3::smallint, 30),
  ('spring', '春季', 'Spring', 4::smallint, 40)
) seed(code, name_zh, name_en, legacy_season, sort_order)
where organization_row.singleton_key = 1
on conflict (organization_id, code) do nothing;

insert into public.organization_class_systems(
  organization_id, code, name_zh, name_en, sort_order
)
select organization_row.id, seed.code, seed.name_zh, seed.name_en, seed.sort_order
from public.organizations organization_row
cross join (values
  ('integrated', '贯通体系', 'Integrated', 10),
  ('enrichment', '培优体系', 'Enrichment', 20),
  ('innovation', '创新体系', 'Innovation', 30)
) seed(code, name_zh, name_en, sort_order)
where organization_row.singleton_key = 1
on conflict (organization_id, code) do nothing;

insert into public.organization_class_types(
  organization_id, system_id, code, name_zh, name_en, sort_order
)
select organization_row.id, system.id, seed.code, seed.name_zh, seed.name_en,
       seed.sort_order
from public.organizations organization_row
cross join (values
  ('integrated', 'X+', 'X+', 'X+', 10),
  ('integrated', 'G+', 'G+', 'G+', 20),
  ('enrichment', 'A+', 'A+', 'A+', 10),
  ('enrichment', 'S', 'S', 'S', 20),
  ('innovation', 'C', 'C', 'C', 10)
) seed(system_code, code, name_zh, name_en, sort_order)
join public.organization_class_systems system
  on system.organization_id = organization_row.id and system.code = seed.system_code
where organization_row.singleton_key = 1
on conflict (organization_id, code) do nothing;

-- Seed a small editable example tree for first-use orientation. The values are
-- configuration rows and can be disabled, reordered, renamed, or archived.
insert into public.subject_microcourse_scene_roots(
  organization_id, course_family_id, framework_item_code, sort_order
)
select organization_row.id, family.id, seed.code, seed.sort_order
from public.organizations organization_row
cross join public.course_families family
cross join (values
  ('new_lesson', 10),
  ('monthly_review', 20),
  ('thinking_extension', 30)
) seed(code, sort_order)
where organization_row.singleton_key = 1 and family.slug = 'teacher-microcourses'
on conflict (organization_id, course_family_id, framework_item_code) do nothing;

insert into public.subject_microcourse_scenes(
  organization_id, course_family_id, root_id, name, sort_order
)
select root.organization_id, root.course_family_id, root.id, seed.name, seed.sort_order
from public.subject_microcourse_scene_roots root
join (values
  ('new_lesson', '公开课', 10),
  ('new_lesson', '暑期收心课', 20),
  ('new_lesson', '知识点专项课', 30),
  ('monthly_review', 'E 系列阶段复习', 10),
  ('monthly_review', '外部期中专题复习', 20),
  ('monthly_review', '外部期末专题复习', 30),
  ('thinking_extension', '趣味游戏课', 10),
  ('thinking_extension', '数独系列', 20),
  ('thinking_extension', '竞赛思维专题', 30)
) seed(root_code, name, sort_order)
  on seed.root_code = root.framework_item_code
on conflict do nothing;

create function public.list_teacher_microcourse_configuration(p_course_family_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); organization_uuid uuid; result jsonb;
begin
  if uid is null or not public.has_perm(uid, 'course.view') then raise exception 'FORBIDDEN'; end if;
  if not exists (
    select 1 from public.course_families family
    where family.id = p_course_family_id and family.slug = 'teacher-microcourses'
  ) then raise exception 'COURSE_FAMILY_NOT_FOUND'; end if;
  select id into organization_uuid from public.organizations where singleton_key = 1;

  select jsonb_build_object(
    'canManageScenes', public.can_manage_teacher_microcourse_subject(p_course_family_id, uid),
    'canManageOrganization', public.is_admin(uid) or public.has_perm(uid, 'organization.profile.manage'),
    'frameworkItems', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', item.code, 'groupCode', item.group_code,
        'labelZh', item.label_zh, 'labelEn', item.label_en,
        'defaultOrder', item.default_order
      ) order by item.default_order)
      from public.teacher_microcourse_framework_items item
    ), '[]'::jsonb),
    'roots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', root.id, 'frameworkItemCode', root.framework_item_code,
        'sortOrder', root.sort_order, 'enabled', root.enabled,
        'courseCount', 0,
        'scenes', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', scene.id, 'parentId', scene.parent_id, 'name', scene.name,
            'description', scene.description, 'sortOrder', scene.sort_order,
            'status', scene.status, 'courseCount', 0
          ) order by scene.parent_id nulls first, scene.sort_order, scene.name)
          from public.subject_microcourse_scenes scene where scene.root_id = root.id
        ), '[]'::jsonb)
      ) order by root.enabled desc, root.sort_order)
      from public.subject_microcourse_scene_roots root
      where root.course_family_id = p_course_family_id
    ), '[]'::jsonb),
    'gradeStages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', stage.id, 'code', stage.code, 'nameZh', stage.name_zh,
        'nameEn', stage.name_en, 'sortOrder', stage.sort_order,
        'active', stage.active
      ) order by stage.sort_order)
      from public.organization_grade_stages stage
      where stage.organization_id = organization_uuid
    ), '[]'::jsonb),
    'grades', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', grade.id, 'gradeNo', grade.grade_no, 'nameZh', grade.name_zh,
        'nameEn', grade.name_en, 'stageId', grade.stage_id,
        'sortOrder', grade.sort_order, 'active', grade.active
      ) order by grade.sort_order)
      from public.organization_academic_grades grade
      where grade.organization_id = organization_uuid
    ), '[]'::jsonb),
    'terms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', term.id, 'code', term.code, 'nameZh', term.name_zh,
        'nameEn', term.name_en, 'legacySeason', term.legacy_season,
        'sortOrder', term.sort_order, 'active', term.active
      ) order by term.sort_order)
      from public.organization_academic_terms term
      where term.organization_id = organization_uuid
    ), '[]'::jsonb),
    'classSystems', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', system.id, 'code', system.code, 'nameZh', system.name_zh,
        'nameEn', system.name_en, 'sortOrder', system.sort_order,
        'active', system.active,
        'classTypes', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', class_type.id, 'code', class_type.code,
            'nameZh', class_type.name_zh, 'nameEn', class_type.name_en,
            'sortOrder', class_type.sort_order, 'active', class_type.active
          ) order by class_type.sort_order)
          from public.organization_class_types class_type
          where class_type.system_id = system.id
        ), '[]'::jsonb)
      ) order by system.sort_order)
      from public.organization_class_systems system
      where system.organization_id = organization_uuid
    ), '[]'::jsonb),
    'subjectManagers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', manager.user_id, 'displayName', profile.display_name
      ) order by profile.display_name)
      from public.teacher_microcourse_subject_managers manager
      join public.profiles profile on profile.id = manager.user_id
      where manager.course_family_id = p_course_family_id
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create function public.set_teacher_microcourse_subject_managers(
  p_course_family_id uuid,
  p_user_ids uuid[]
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); clean_ids uuid[];
begin
  if uid is null or not (public.is_admin(uid) or public.has_perm(uid, 'staff.manage')) then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.course_families family
    where family.id = p_course_family_id and family.slug = 'teacher-microcourses'
  ) then raise exception 'COURSE_FAMILY_NOT_FOUND'; end if;
  select coalesce(array_agg(distinct selected.user_id), '{}'::uuid[]) into clean_ids
  from unnest(coalesce(p_user_ids, '{}'::uuid[])) as selected(user_id)
  join public.profiles profile on profile.id = selected.user_id
  where profile.role in ('staff', 'admin');
  if cardinality(clean_ids) <> cardinality(coalesce(p_user_ids, '{}'::uuid[])) then
    raise exception 'INVALID_MANAGER';
  end if;
  delete from public.teacher_microcourse_subject_managers
  where course_family_id = p_course_family_id and not (user_id = any(clean_ids));
  insert into public.teacher_microcourse_subject_managers(course_family_id, user_id, created_by)
  select p_course_family_id, selected.user_id, uid
  from unnest(clean_ids) as selected(user_id)
  on conflict do nothing;
  perform public.emit_domain_event(
    'teacher_microcourse.subject_managers.updated', 'course_family', p_course_family_id,
    jsonb_build_object('managerCount', cardinality(clean_ids))
  );
end;
$$;

create function public.set_subject_microcourse_scene_roots(
  p_course_family_id uuid,
  p_codes text[]
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := public.assert_teacher_microcourse_subject_manager(p_course_family_id);
  organization_uuid uuid; clean_codes text[]; next_order integer;
begin
  select id into organization_uuid from public.organizations where singleton_key = 1;
  select coalesce(array_agg(distinct selected.code order by selected.code), '{}'::text[]) into clean_codes
  from unnest(coalesce(p_codes, '{}'::text[])) as selected(code)
  join public.teacher_microcourse_framework_items item on item.code = selected.code;
  if cardinality(clean_codes) <> cardinality(coalesce(p_codes, '{}'::text[])) then
    raise exception 'INVALID_FRAMEWORK_ITEM';
  end if;
  update public.subject_microcourse_scene_roots
  set enabled = false, archived_at = coalesce(archived_at, now()), updated_by = uid, updated_at = now()
  where course_family_id = p_course_family_id and not (framework_item_code = any(clean_codes));
  select coalesce(max(sort_order), 0) into next_order
  from public.subject_microcourse_scene_roots where course_family_id = p_course_family_id;
  insert into public.subject_microcourse_scene_roots(
    organization_id, course_family_id, framework_item_code, sort_order,
    enabled, created_by, updated_by
  )
  select organization_uuid, p_course_family_id, selected.code,
         next_order + row_number() over (order by item.default_order) * 10,
         true, uid, uid
  from unnest(clean_codes) as selected(code)
  join public.teacher_microcourse_framework_items item on item.code = selected.code
  where not exists (
    select 1 from public.subject_microcourse_scene_roots root
    where root.course_family_id = p_course_family_id and root.framework_item_code = selected.code
  );
  update public.subject_microcourse_scene_roots
  set enabled = true, archived_at = null, updated_by = uid, updated_at = now()
  where course_family_id = p_course_family_id and framework_item_code = any(clean_codes);
  perform public.emit_domain_event(
    'teacher_microcourse.scene_roots.updated', 'course_family', p_course_family_id,
    jsonb_build_object('frameworkItemCodes', to_jsonb(clean_codes))
  );
end;
$$;

create function public.reorder_subject_microcourse_scene_roots(
  p_course_family_id uuid,
  p_root_ids uuid[]
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := public.assert_teacher_microcourse_subject_manager(p_course_family_id);
begin
  if cardinality(coalesce(p_root_ids, '{}'::uuid[])) <> (
    select count(*) from public.subject_microcourse_scene_roots
    where course_family_id = p_course_family_id and enabled
  ) or cardinality(coalesce(p_root_ids, '{}'::uuid[])) <> (
    select count(distinct selected.root_id)
    from unnest(coalesce(p_root_ids, '{}'::uuid[])) as selected(root_id)
  ) or exists (
    select 1 from unnest(coalesce(p_root_ids, '{}'::uuid[])) as selected(root_id)
    left join public.subject_microcourse_scene_roots root
      on root.id = selected.root_id and root.course_family_id = p_course_family_id and root.enabled
    where root.id is null
  ) then raise exception 'INVALID_ROOT_ORDER'; end if;
  update public.subject_microcourse_scene_roots root
  set sort_order = ordering.ordinality * 10, updated_by = uid, updated_at = now()
  from unnest(p_root_ids) with ordinality as ordering(root_id, ordinality)
  where root.id = ordering.root_id;
  perform public.emit_domain_event(
    'teacher_microcourse.scene_roots.reordered', 'course_family', p_course_family_id,
    jsonb_build_object('rootIds', to_jsonb(p_root_ids))
  );
end;
$$;

create function public.create_subject_microcourse_scene(
  p_course_family_id uuid,
  p_root_id uuid,
  p_parent_id uuid,
  p_name text,
  p_description text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := public.assert_teacher_microcourse_subject_manager(p_course_family_id);
  root_row public.subject_microcourse_scene_roots%rowtype; scene_id uuid; next_order integer;
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80
     or char_length(coalesce(p_description, '')) > 500 then raise exception 'INVALID_SCENE'; end if;
  select * into root_row from public.subject_microcourse_scene_roots
  where id = p_root_id and course_family_id = p_course_family_id and enabled;
  if root_row.id is null then raise exception 'INVALID_SCENE_ROOT'; end if;
  if p_parent_id is not null and not exists (
    select 1 from public.subject_microcourse_scenes parent
    where parent.id = p_parent_id and parent.root_id = p_root_id
      and parent.course_family_id = p_course_family_id and parent.status = 'active'
  ) then raise exception 'INVALID_SCENE_PARENT'; end if;
  select coalesce(max(sort_order), 0) + 10 into next_order
  from public.subject_microcourse_scenes
  where root_id = p_root_id and parent_id is not distinct from p_parent_id;
  insert into public.subject_microcourse_scenes(
    organization_id, course_family_id, root_id, parent_id, name,
    description, sort_order, created_by, updated_by
  ) values (
    root_row.organization_id, p_course_family_id, p_root_id, p_parent_id,
    btrim(p_name), btrim(coalesce(p_description, '')), next_order, uid, uid
  ) returning id into scene_id;
  perform public.emit_domain_event(
    'teacher_microcourse.scene.created', 'microcourse_scene', scene_id,
    jsonb_build_object('courseFamilyId', p_course_family_id, 'rootId', p_root_id, 'parentId', p_parent_id)
  );
  return scene_id;
exception when unique_violation then raise exception 'SCENE_NAME_EXISTS';
end;
$$;

create function public.update_subject_microcourse_scene(
  p_scene_id uuid,
  p_name text,
  p_description text,
  p_status text
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare scene_row public.subject_microcourse_scenes%rowtype; uid uuid;
begin
  select * into scene_row from public.subject_microcourse_scenes where id = p_scene_id;
  if scene_row.id is null then raise exception 'SCENE_NOT_FOUND'; end if;
  uid := public.assert_teacher_microcourse_subject_manager(scene_row.course_family_id);
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80
     or char_length(coalesce(p_description, '')) > 500
     or p_status not in ('active', 'archived') then raise exception 'INVALID_SCENE'; end if;
  if p_status = 'archived' and exists (
    select 1 from public.subject_microcourse_scenes child
    where child.parent_id = p_scene_id and child.status = 'active'
  ) then raise exception 'SCENE_HAS_ACTIVE_CHILDREN'; end if;
  update public.subject_microcourse_scenes
  set name = btrim(p_name), description = btrim(coalesce(p_description, '')),
      status = p_status, archived_at = case when p_status = 'archived' then coalesce(archived_at, now()) else null end,
      updated_by = uid, updated_at = now()
  where id = p_scene_id;
  perform public.emit_domain_event(
    'teacher_microcourse.scene.updated', 'microcourse_scene', p_scene_id,
    jsonb_build_object('status', p_status)
  );
exception when unique_violation then raise exception 'SCENE_NAME_EXISTS';
end;
$$;

create function public.move_subject_microcourse_scenes(
  p_scene_ids uuid[],
  p_target_root_id uuid,
  p_target_parent_id uuid,
  p_target_index integer
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare target_root public.subject_microcourse_scene_roots%rowtype; uid uuid;
  clean_ids uuid[]; existing_order uuid[]; next_order uuid[];
begin
  select * into target_root from public.subject_microcourse_scene_roots
  where id = p_target_root_id and enabled;
  if target_root.id is null then raise exception 'INVALID_SCENE_ROOT'; end if;
  uid := public.assert_teacher_microcourse_subject_manager(target_root.course_family_id);
  select array_agg(distinct selected.scene_id order by selected.scene_id) into clean_ids
  from unnest(coalesce(p_scene_ids, '{}'::uuid[])) as selected(scene_id);
  if cardinality(coalesce(clean_ids, '{}'::uuid[])) not between 1 and 100
     or cardinality(clean_ids) <> cardinality(p_scene_ids)
     or exists (
       select 1 from unnest(clean_ids) as selected(scene_id)
       left join public.subject_microcourse_scenes scene
         on scene.id = selected.scene_id and scene.course_family_id = target_root.course_family_id and scene.status = 'active'
       where scene.id is null
     ) then raise exception 'INVALID_SCENE_SELECTION'; end if;
  if p_target_parent_id is not null and (
    p_target_parent_id = any(clean_ids)
    or not exists (
      select 1 from public.subject_microcourse_scenes parent
      where parent.id = p_target_parent_id and parent.root_id = p_target_root_id
        and parent.status = 'active' and parent.parent_id is null
    )
  ) then raise exception 'INVALID_SCENE_PARENT'; end if;
  if exists (
    select 1 from public.subject_microcourse_scenes child
    where child.parent_id = any(clean_ids) and not (child.id = any(clean_ids))
      and (p_target_parent_id is not null or child.root_id <> p_target_root_id)
  ) then raise exception 'SCENE_HAS_UNSELECTED_CHILDREN'; end if;

  select coalesce(array_agg(scene.id order by scene.sort_order), '{}'::uuid[]) into existing_order
  from public.subject_microcourse_scenes scene
  where scene.root_id = p_target_root_id
    and scene.parent_id is not distinct from p_target_parent_id
    and scene.status = 'active' and not (scene.id = any(clean_ids));
  p_target_index := greatest(0, least(coalesce(p_target_index, cardinality(existing_order)), cardinality(existing_order)));
  next_order := coalesce(existing_order[1:p_target_index], '{}'::uuid[])
    || clean_ids
    || coalesce(existing_order[p_target_index + 1:cardinality(existing_order)], '{}'::uuid[]);

  update public.subject_microcourse_scenes scene
  set root_id = p_target_root_id, parent_id = p_target_parent_id,
      sort_order = ordering.ordinality * 10, updated_by = uid, updated_at = now()
  from unnest(next_order) with ordinality as ordering(scene_id, ordinality)
  where scene.id = ordering.scene_id;
  update public.subject_microcourse_scenes child
  set root_id = p_target_root_id, updated_by = uid, updated_at = now()
  where child.parent_id = any(clean_ids);
  perform public.emit_domain_event(
    'teacher_microcourse.scenes.moved', 'course_family', target_root.course_family_id,
    jsonb_build_object('sceneIds', to_jsonb(clean_ids), 'targetRootId', p_target_root_id, 'targetParentId', p_target_parent_id)
  );
end;
$$;

create function public.upsert_organization_microcourse_dimension(
  p_kind text,
  p_id uuid,
  p_parent_id uuid,
  p_code text,
  p_name_zh text,
  p_name_en text,
  p_grade_no smallint,
  p_legacy_season smallint,
  p_active boolean
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); organization_uuid uuid; result_id uuid := coalesce(p_id, gen_random_uuid());
  next_order integer;
begin
  if uid is null or not (public.is_admin(uid) or public.has_perm(uid, 'organization.profile.manage')) then
    raise exception 'FORBIDDEN';
  end if;
  if p_kind not in ('grade_stage', 'grade', 'term', 'class_system', 'class_type')
     or char_length(btrim(coalesce(p_name_zh, ''))) not between 1 and 40
     or char_length(btrim(coalesce(p_name_en, ''))) not between 1 and 80
     or char_length(btrim(coalesce(p_code, ''))) not between 1 and 40 then
    raise exception 'INVALID_DIMENSION';
  end if;
  select id into organization_uuid from public.organizations where singleton_key = 1;

  if p_kind = 'grade_stage' then
    select coalesce(max(sort_order), 0) + 10 into next_order from public.organization_grade_stages where organization_id = organization_uuid;
    insert into public.organization_grade_stages(id, organization_id, code, name_zh, name_en, sort_order, active, created_by, updated_by)
    values(result_id, organization_uuid, lower(btrim(p_code)), btrim(p_name_zh), btrim(p_name_en), next_order, coalesce(p_active, true), uid, uid)
    on conflict (id) do update set code = excluded.code, name_zh = excluded.name_zh,
      name_en = excluded.name_en, active = excluded.active, updated_by = uid, updated_at = now();
  elsif p_kind = 'grade' then
    if p_grade_no not between 1 and 99 or not exists (
      select 1 from public.organization_grade_stages where id = p_parent_id and organization_id = organization_uuid
    ) then raise exception 'INVALID_DIMENSION'; end if;
    select coalesce(max(sort_order), 0) + 10 into next_order from public.organization_academic_grades where organization_id = organization_uuid;
    insert into public.organization_academic_grades(id, organization_id, grade_no, name_zh, name_en, stage_id, sort_order, active, created_by, updated_by)
    values(result_id, organization_uuid, p_grade_no, btrim(p_name_zh), btrim(p_name_en), p_parent_id, next_order, coalesce(p_active, true), uid, uid)
    on conflict (id) do update set grade_no = excluded.grade_no, name_zh = excluded.name_zh,
      name_en = excluded.name_en, stage_id = excluded.stage_id, active = excluded.active,
      updated_by = uid, updated_at = now();
  elsif p_kind = 'term' then
    if p_legacy_season is not null and p_legacy_season not between 1 and 4 then raise exception 'INVALID_DIMENSION'; end if;
    select coalesce(max(sort_order), 0) + 10 into next_order from public.organization_academic_terms where organization_id = organization_uuid;
    insert into public.organization_academic_terms(id, organization_id, code, name_zh, name_en, legacy_season, sort_order, active, created_by, updated_by)
    values(result_id, organization_uuid, lower(btrim(p_code)), btrim(p_name_zh), btrim(p_name_en), p_legacy_season, next_order, coalesce(p_active, true), uid, uid)
    on conflict (id) do update set code = excluded.code, name_zh = excluded.name_zh,
      name_en = excluded.name_en, legacy_season = excluded.legacy_season,
      active = excluded.active, updated_by = uid, updated_at = now();
  elsif p_kind = 'class_system' then
    select coalesce(max(sort_order), 0) + 10 into next_order from public.organization_class_systems where organization_id = organization_uuid;
    insert into public.organization_class_systems(id, organization_id, code, name_zh, name_en, sort_order, active, created_by, updated_by)
    values(result_id, organization_uuid, lower(btrim(p_code)), btrim(p_name_zh), btrim(p_name_en), next_order, coalesce(p_active, true), uid, uid)
    on conflict (id) do update set code = excluded.code, name_zh = excluded.name_zh,
      name_en = excluded.name_en, active = excluded.active, updated_by = uid, updated_at = now();
  else
    if not exists (
      select 1 from public.organization_class_systems where id = p_parent_id and organization_id = organization_uuid
    ) then raise exception 'INVALID_DIMENSION'; end if;
    select coalesce(max(sort_order), 0) + 10 into next_order from public.organization_class_types where system_id = p_parent_id;
    insert into public.organization_class_types(id, organization_id, system_id, code, name_zh, name_en, sort_order, active, created_by, updated_by)
    values(result_id, organization_uuid, p_parent_id, btrim(p_code), btrim(p_name_zh), btrim(p_name_en), next_order, coalesce(p_active, true), uid, uid)
    on conflict (id) do update set system_id = excluded.system_id, code = excluded.code,
      name_zh = excluded.name_zh, name_en = excluded.name_en, active = excluded.active,
      updated_by = uid, updated_at = now();
  end if;
  perform public.emit_domain_event(
    'teacher_microcourse.academic_dimension.updated', p_kind, result_id,
    jsonb_build_object('active', coalesce(p_active, true))
  );
  return result_id;
exception when unique_violation then raise exception 'DIMENSION_VALUE_EXISTS';
end;
$$;

create function public.move_organization_microcourse_dimension(
  p_kind text,
  p_id uuid,
  p_direction smallint
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); organization_uuid uuid; current_order integer; other_id uuid; other_order integer; parent_uuid uuid;
begin
  if uid is null or not (public.is_admin(uid) or public.has_perm(uid, 'organization.profile.manage')) then raise exception 'FORBIDDEN'; end if;
  if p_kind not in ('grade_stage', 'grade', 'term', 'class_system', 'class_type') or p_direction not in (-1, 1) then raise exception 'INVALID_DIMENSION'; end if;
  select id into organization_uuid from public.organizations where singleton_key = 1;
  if p_kind = 'grade_stage' then
    select sort_order into current_order from public.organization_grade_stages where id = p_id and organization_id = organization_uuid;
    select id, sort_order into other_id, other_order from public.organization_grade_stages
    where organization_id = organization_uuid and ((p_direction = -1 and sort_order < current_order) or (p_direction = 1 and sort_order > current_order))
    order by case when p_direction = -1 then -sort_order else sort_order end limit 1;
  elsif p_kind = 'grade' then
    select sort_order into current_order from public.organization_academic_grades where id = p_id and organization_id = organization_uuid;
    select id, sort_order into other_id, other_order from public.organization_academic_grades
    where organization_id = organization_uuid and ((p_direction = -1 and sort_order < current_order) or (p_direction = 1 and sort_order > current_order))
    order by case when p_direction = -1 then -sort_order else sort_order end limit 1;
  elsif p_kind = 'term' then
    select sort_order into current_order from public.organization_academic_terms where id = p_id and organization_id = organization_uuid;
    select id, sort_order into other_id, other_order from public.organization_academic_terms
    where organization_id = organization_uuid and ((p_direction = -1 and sort_order < current_order) or (p_direction = 1 and sort_order > current_order))
    order by case when p_direction = -1 then -sort_order else sort_order end limit 1;
  elsif p_kind = 'class_system' then
    select sort_order into current_order from public.organization_class_systems where id = p_id and organization_id = organization_uuid;
    select id, sort_order into other_id, other_order from public.organization_class_systems
    where organization_id = organization_uuid and ((p_direction = -1 and sort_order < current_order) or (p_direction = 1 and sort_order > current_order))
    order by case when p_direction = -1 then -sort_order else sort_order end limit 1;
  else
    select system_id, sort_order into parent_uuid, current_order from public.organization_class_types where id = p_id and organization_id = organization_uuid;
    select id, sort_order into other_id, other_order from public.organization_class_types
    where system_id = parent_uuid and ((p_direction = -1 and sort_order < current_order) or (p_direction = 1 and sort_order > current_order))
    order by case when p_direction = -1 then -sort_order else sort_order end limit 1;
  end if;
  if current_order is null then raise exception 'DIMENSION_NOT_FOUND'; end if;
  if other_id is null then return; end if;
  if p_kind = 'grade_stage' then
    update public.organization_grade_stages
    set sort_order = case when id = p_id then other_order else current_order end,
        updated_by = uid, updated_at = now()
    where id in (p_id, other_id);
  elsif p_kind = 'grade' then
    update public.organization_academic_grades
    set sort_order = case when id = p_id then other_order else current_order end,
        updated_by = uid, updated_at = now()
    where id in (p_id, other_id);
  elsif p_kind = 'term' then
    update public.organization_academic_terms
    set sort_order = case when id = p_id then other_order else current_order end,
        updated_by = uid, updated_at = now()
    where id in (p_id, other_id);
  elsif p_kind = 'class_system' then
    update public.organization_class_systems
    set sort_order = case when id = p_id then other_order else current_order end,
        updated_by = uid, updated_at = now()
    where id in (p_id, other_id);
  else
    update public.organization_class_types
    set sort_order = case when id = p_id then other_order else current_order end,
        updated_by = uid, updated_at = now()
    where id in (p_id, other_id);
  end if;
  perform public.emit_domain_event('teacher_microcourse.academic_dimension.reordered', p_kind, p_id, jsonb_build_object('direction', p_direction));
end;
$$;

-- Independent, fail-closed rollout switch. Local development can enable a new
-- version explicitly; production remains false until separately authorized.
insert into public.feature_flag_versions(
  organization_id, flag_key, version, enabled, effective_from, reason
)
select organization_row.id, 'teaching.teacher_microcourse_browser_v2', 1, false, now(),
       'DEV-TMC-4 fail-closed baseline'
from public.organizations organization_row
where organization_row.singleton_key = 1
  and not exists (
    select 1 from public.feature_flag_versions flag
    where flag.organization_id = organization_row.id
      and flag.campus_id is null
      and flag.flag_key = 'teaching.teacher_microcourse_browser_v2'
  );

revoke all on function public.can_manage_teacher_microcourse_subject(uuid, uuid) from public, anon, authenticated;
revoke all on function public.assert_teacher_microcourse_subject_manager(uuid) from public, anon, authenticated;
revoke all on function public.list_teacher_microcourse_configuration(uuid) from public, anon, authenticated;
revoke all on function public.set_teacher_microcourse_subject_managers(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.set_subject_microcourse_scene_roots(uuid, text[]) from public, anon, authenticated;
revoke all on function public.reorder_subject_microcourse_scene_roots(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.create_subject_microcourse_scene(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.update_subject_microcourse_scene(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.move_subject_microcourse_scenes(uuid[], uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.upsert_organization_microcourse_dimension(text, uuid, uuid, text, text, text, smallint, smallint, boolean) from public, anon, authenticated;
revoke all on function public.move_organization_microcourse_dimension(text, uuid, smallint) from public, anon, authenticated;

grant execute on function public.list_teacher_microcourse_configuration(uuid) to authenticated;
grant execute on function public.set_teacher_microcourse_subject_managers(uuid, uuid[]) to authenticated;
grant execute on function public.set_subject_microcourse_scene_roots(uuid, text[]) to authenticated;
grant execute on function public.reorder_subject_microcourse_scene_roots(uuid, uuid[]) to authenticated;
grant execute on function public.create_subject_microcourse_scene(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.update_subject_microcourse_scene(uuid, text, text, text) to authenticated;
grant execute on function public.move_subject_microcourse_scenes(uuid[], uuid, uuid, integer) to authenticated;
grant execute on function public.upsert_organization_microcourse_dimension(text, uuid, uuid, text, text, text, smallint, smallint, boolean) to authenticated;
grant execute on function public.move_organization_microcourse_dimension(text, uuid, smallint) to authenticated;

comment on table public.teacher_microcourse_framework_items is
  'The fixed 19-item 766 anchor dictionary. Subject roots select from this dictionary.';
comment on table public.subject_microcourse_scenes is
  'Configurable subject-scoped microcourse scene tree. Archived nodes retain course links.';
comment on table public.organization_academic_terms is
  'Reusable course applicability terms, separate from dated operational school_terms.';

notify pgrst, 'reload schema';

commit;
