-- 班型是业务身份，教材难度是课程选择；按开班批次保存不可变规则版本。
begin;

create table public.course_material_rules (
  id uuid primary key default gen_random_uuid(),
  current_revision_id uuid,
  created_at timestamptz not null default now()
);

create table public.course_material_rule_revisions (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.course_material_rules(id) on delete restrict,
  version integer not null check (version > 0),
  title text not null check (char_length(title) between 1 and 100),
  family_id uuid not null references public.course_families(id) on delete restrict,
  business_class_type text not null check (char_length(business_class_type) between 1 and 20),
  material_class_type text not null check (char_length(material_class_type) between 1 and 20),
  from_year integer check (from_year between 2000 and 2200),
  from_season integer check (from_season between 1 and 4),
  to_year integer check (to_year between 2000 and 2200),
  to_season integer check (to_season between 1 and 4),
  entry_grade integer check (entry_grade between 1 and 12),
  enabled boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(rule_id, version),
  check ((from_year is null) = (from_season is null)),
  check ((to_year is null) = (to_season is null)),
  check (from_year is null or to_year is null or from_year * 4 + from_season <= to_year * 4 + to_season)
);
alter table public.course_material_rules add constraint course_material_current_revision_fk
  foreign key(current_revision_id) references public.course_material_rule_revisions(id) on delete restrict;

create table public.classroom_material_settings (
  classroom_id uuid primary key references public.classrooms(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  business_class_type text not null check (char_length(business_class_type) between 1 and 20),
  cohort_year integer check (cohort_year between 2000 and 2200),
  cohort_season integer check (cohort_season between 1 and 4),
  cohort_grade integer check (cohort_grade between 1 and 12),
  rule_revision_id uuid references public.course_material_rule_revisions(id) on delete restrict,
  inherited_from_classroom_id uuid references public.classrooms(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  check ((cohort_year is null and cohort_season is null and cohort_grade is null)
    or (cohort_year is not null and cohort_season is not null and cohort_grade is not null))
);

create table public.classroom_material_changes (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete restrict,
  before_data jsonb not null,
  after_data jsonb not null,
  changed_session_ids uuid[] not null default '{}',
  preserved_session_ids uuid[] not null default '{}',
  reason text not null check (char_length(reason) between 1 and 500),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index classroom_material_changes_recent on public.classroom_material_changes(classroom_id,created_at desc);
create index classroom_material_settings_rule on public.classroom_material_settings(rule_revision_id);

alter table public.course_material_rules enable row level security;
alter table public.course_material_rule_revisions enable row level security;
alter table public.classroom_material_settings enable row level security;
alter table public.classroom_material_changes enable row level security;
revoke all on public.course_material_rules, public.course_material_rule_revisions,
  public.classroom_material_settings, public.classroom_material_changes from public, anon, authenticated;
grant select on public.course_material_rules, public.course_material_rule_revisions,
  public.classroom_material_settings, public.classroom_material_changes to authenticated;
create policy course_material_rules_read on public.course_material_rules for select to authenticated
  using (public.has_perm((select auth.uid()),'course.manage') or public.has_perm((select auth.uid()),'class.create') or public.has_perm((select auth.uid()),'class.manage'));
create policy course_material_rule_revisions_read on public.course_material_rule_revisions for select to authenticated
  using (public.has_perm((select auth.uid()),'course.manage') or public.has_perm((select auth.uid()),'class.create') or public.has_perm((select auth.uid()),'class.manage'));
create policy classroom_material_settings_read on public.classroom_material_settings for select to authenticated
  using (public.can_manage_classroom(classroom_id,(select auth.uid())));
create policy classroom_material_changes_read on public.classroom_material_changes for select to authenticated
  using (public.can_manage_classroom(classroom_id,(select auth.uid())));

create function mathin_internal.material_rule_json(p_revision public.course_material_rule_revisions)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'id',p_revision.rule_id,'revisionId',p_revision.id,'version',p_revision.version,
    'title',p_revision.title,'familyId',p_revision.family_id,
    'familyTitle',(select title from public.course_families where id=p_revision.family_id),
    'businessClassType',p_revision.business_class_type,'materialClassType',p_revision.material_class_type,
    'fromYear',p_revision.from_year,'fromSeason',p_revision.from_season,
    'toYear',p_revision.to_year,'toSeason',p_revision.to_season,'entryGrade',p_revision.entry_grade,
    'enabled',p_revision.enabled,
    'isCurrent',exists(select 1 from public.course_material_rules where id=p_revision.rule_id and current_revision_id=p_revision.id),
    'classroomCount',(select count(*) from public.classroom_material_settings where rule_revision_id=p_revision.id)
  );
$$;

create function mathin_internal.material_selection_json(p_classroom_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('businessClassType',s.business_class_type,'cohortYear',s.cohort_year,
    'cohortSeason',s.cohort_season,'cohortGrade',s.cohort_grade,
    'ruleRevisionId',s.rule_revision_id,'inheritedFromClassroomId',s.inherited_from_classroom_id)
  from public.classroom_material_settings s where s.classroom_id=p_classroom_id;
$$;

create function public.get_course_material_options(p_purpose text default 'production',p_source_classroom_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); result jsonb;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not (public.has_perm(uid,'course.manage') or public.has_perm(uid,'class.create') or public.has_perm(uid,'class.manage')) then raise exception 'FORBIDDEN'; end if;
  if p_purpose not in ('production','test') then raise exception 'MATERIAL_INVALID'; end if;
  if p_source_classroom_id is not null and not public.can_manage_classroom(p_source_classroom_id,uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
  select jsonb_build_object(
    'families',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'title',f.title,'slug',f.slug,
      'materialTypes',(select coalesce(jsonb_agg(v.class_type order by v.class_type),'[]') from
        (select distinct c.class_type from public.courses c where c.family_id=f.id and c.course_kind='curriculum' and c.trashed_at is null and c.status='enabled') v))
      order by f.title) from public.course_families f where f.status='enabled' and f.purpose=p_purpose),'[]'),
    'courses',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'familyId',c.family_id,'familyTitle',f.title,
      'catalogVersionId',v.id,'catalogVersionTitle',v.title,'catalogVersionSlug',v.slug,
      'grade',c.grade,'season',c.term,'classType',c.class_type,'isSuperseded',c.superseded_by_course_id is not null)
      order by f.title,v.sort_order desc,c.grade,c.term,c.class_type)
      from public.courses c join public.course_families f on f.id=c.family_id join public.course_catalog_versions v on v.id=c.catalog_version_id
      where c.status='enabled' and c.trashed_at is null and c.course_kind='curriculum' and c.purpose=p_purpose
        and f.status='enabled' and v.status='enabled'),'[]'),
    'rules',coalesce((select jsonb_agg(mathin_internal.material_rule_json(r) order by r.title,r.version desc)
      from public.course_material_rule_revisions r join public.course_material_rules head on head.id=r.rule_id
      join public.course_families f on f.id=r.family_id
      where f.purpose=p_purpose and (head.current_revision_id=r.id or r.id in
        (select rule_revision_id from public.classroom_material_settings where classroom_id=p_source_classroom_id))),'[]'),
    'inheritedSelection',case when p_source_classroom_id is null then null else mathin_internal.material_selection_json(p_source_classroom_id) end
  ) into result;
  return result;
end;
$$;

create function public.save_course_material_rule(p_rule_id uuid,p_expected_version integer,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); head public.course_material_rules%rowtype;
  previous public.course_material_rule_revisions%rowtype; candidate public.course_material_rule_revisions%rowtype;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid,'course.manage') then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' or p_input - array['title','familyId','businessClassType','materialClassType','fromYear','fromSeason','toYear','toSeason','entryGrade','enabled'] <> '{}'::jsonb then raise exception 'MATERIAL_INVALID'; end if;
  candidate.title:=btrim(p_input->>'title'); candidate.family_id:=(p_input->>'familyId')::uuid;
  candidate.business_class_type:=upper(btrim(p_input->>'businessClassType'));
  candidate.material_class_type:=upper(btrim(p_input->>'materialClassType'));
  candidate.from_year:=(p_input->>'fromYear')::int; candidate.from_season:=(p_input->>'fromSeason')::int;
  candidate.to_year:=(p_input->>'toYear')::int; candidate.to_season:=(p_input->>'toSeason')::int;
  candidate.entry_grade:=(p_input->>'entryGrade')::int; candidate.enabled:=(p_input->>'enabled')::boolean;
  if candidate.title is null or char_length(candidate.title) not between 1 and 100
    or candidate.business_class_type is null or char_length(candidate.business_class_type) not between 1 and 20
    or candidate.material_class_type is null or char_length(candidate.material_class_type) not between 1 and 20
    or candidate.enabled is null
    or (candidate.from_year is null) <> (candidate.from_season is null)
    or (candidate.to_year is null) <> (candidate.to_season is null)
    or candidate.from_year not between 2000 and 2200 or candidate.to_year not between 2000 and 2200
    or candidate.from_season not between 1 and 4 or candidate.to_season not between 1 and 4
    or candidate.entry_grade not between 1 and 12
    or candidate.from_year*4+candidate.from_season > candidate.to_year*4+candidate.to_season
    then raise exception 'MATERIAL_INVALID'; end if;
  if not exists(select 1 from public.course_families f join public.courses c on c.family_id=f.id
    where f.id=candidate.family_id and f.status='enabled' and c.status='enabled' and c.trashed_at is null
      and c.course_kind='curriculum' and c.class_type=candidate.material_class_type)
    then raise exception 'MATERIAL_COURSE_UNAVAILABLE'; end if;
  -- 对同一课程族的规则串行校验，避免并发创建重叠默认值。
  perform pg_advisory_xact_lock(hashtext('course-material-rules:'||candidate.family_id::text));
  if p_rule_id is null then
    if p_expected_version is distinct from 0 then raise exception 'MATERIAL_STALE'; end if;
    insert into public.course_material_rules default values returning * into head;
    candidate.version:=1;
  else
    select * into head from public.course_material_rules where id=p_rule_id for update;
    if not found then raise exception 'MATERIAL_RULE_NOT_FOUND'; end if;
    select * into previous from public.course_material_rule_revisions where id=head.current_revision_id;
    if previous.version is distinct from p_expected_version then raise exception 'MATERIAL_STALE'; end if;
    candidate.version:=previous.version+1;
  end if;
  if candidate.enabled and exists(select 1 from public.course_material_rule_revisions r
    join public.course_material_rules h on h.current_revision_id=r.id
    where h.id<>head.id and r.enabled and r.family_id=candidate.family_id and r.business_class_type=candidate.business_class_type
      and (r.entry_grade is null or candidate.entry_grade is null or r.entry_grade=candidate.entry_grade)
      and coalesce(r.from_year*4+r.from_season,0)<=coalesce(candidate.to_year*4+candidate.to_season,99999)
      and coalesce(candidate.from_year*4+candidate.from_season,0)<=coalesce(r.to_year*4+r.to_season,99999))
    then raise exception 'MATERIAL_RULE_OVERLAP'; end if;
  candidate.id:=gen_random_uuid(); candidate.rule_id:=head.id; candidate.created_by:=uid; candidate.created_at:=now();
  insert into public.course_material_rule_revisions select (candidate).*;
  update public.course_material_rules set current_revision_id=candidate.id where id=head.id;
  perform public.emit_domain_event('course.material_rule.changed','course_material_rule',head.id,
    jsonb_build_object('revisionId',candidate.id,'version',candidate.version),null,'/dashboard/courses/material-rules');
  return mathin_internal.material_rule_json(candidate);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'MATERIAL_INVALID';
end;
$$;

create function mathin_internal.validate_material_selection(p_classroom_id uuid,p_course_id uuid,p_selection jsonb)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare selected public.courses%rowtype; r public.course_material_rule_revisions%rowtype;
  band text; cohort_year int; cohort_season int; cohort_grade int; revision_id uuid; inherited uuid; original jsonb;
begin
  if jsonb_typeof(p_selection) is distinct from 'object' or p_selection - array['businessClassType','cohortYear','cohortSeason','cohortGrade','ruleRevisionId','inheritedFromClassroomId'] <> '{}'::jsonb then raise exception 'MATERIAL_INVALID'; end if;
  band:=upper(btrim(p_selection->>'businessClassType')); cohort_year:=(p_selection->>'cohortYear')::int;
  cohort_season:=(p_selection->>'cohortSeason')::int; cohort_grade:=(p_selection->>'cohortGrade')::int;
  revision_id:=(p_selection->>'ruleRevisionId')::uuid; inherited:=(p_selection->>'inheritedFromClassroomId')::uuid;
  if band is null or char_length(band) not between 1 and 20 or cohort_year not between 2000 and 2200
    or cohort_season not between 1 and 4 or cohort_grade not between 1 and 12
    or num_nonnulls(cohort_year,cohort_season,cohort_grade) not in (0,3) then raise exception 'MATERIAL_INVALID'; end if;
  select c.* into selected from public.courses c join public.course_families f on f.id=c.family_id
    join public.course_catalog_versions v on v.id=c.catalog_version_id
    where c.id=p_course_id and c.status='enabled' and c.trashed_at is null and c.course_kind='curriculum'
      and f.status='enabled' and v.status='enabled';
  if not found then raise exception 'MATERIAL_COURSE_UNAVAILABLE'; end if;
  if inherited is not null then
    if inherited=p_classroom_id or not public.can_manage_classroom(inherited,auth.uid()) then raise exception 'FORBIDDEN_SCOPE'; end if;
    original:=mathin_internal.material_selection_json(inherited);
    if original is null or (original - 'inheritedFromClassroomId') is distinct from (p_selection - 'inheritedFromClassroomId')
      then raise exception 'MATERIAL_INHERITANCE_STALE'; end if;
  end if;
  if revision_id is not null then
    select * into r from public.course_material_rule_revisions where id=revision_id;
    if not found then raise exception 'MATERIAL_RULE_NOT_FOUND'; end if;
    if r.family_id<>selected.family_id or r.material_class_type<>selected.class_type or r.business_class_type<>band
      then raise exception 'MATERIAL_RULE_MISMATCH'; end if;
    if num_nonnulls(cohort_year,cohort_season,cohort_grade)<>3 then raise exception 'MATERIAL_COHORT_REQUIRED'; end if;
    if (r.entry_grade is not null and r.entry_grade<>cohort_grade)
      or (r.from_year is not null and cohort_year*4+cohort_season<r.from_year*4+r.from_season)
      or (r.to_year is not null and cohort_year*4+cohort_season>r.to_year*4+r.to_season)
      then raise exception 'MATERIAL_RULE_MISMATCH'; end if;
    if not (exists(select 1 from public.course_material_rules h where h.current_revision_id=r.id and r.enabled)
      or exists(select 1 from public.classroom_material_settings s where s.classroom_id=p_classroom_id and s.rule_revision_id=r.id)
      or (inherited is not null and original->>'ruleRevisionId'=r.id::text))
      then raise exception 'MATERIAL_STALE'; end if;
  end if;
  return jsonb_build_object('businessClassType',band,'cohortYear',cohort_year,'cohortSeason',cohort_season,
    'cohortGrade',cohort_grade,'ruleRevisionId',revision_id,'inheritedFromClassroomId',inherited);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'MATERIAL_INVALID';
end;
$$;

create function mathin_internal.class_material_session_plan(p_classroom_id uuid,p_course_id uuid,p_include_drafts boolean)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'no',x.lecture_no,'title',x.title,'scheduledAt',x.scheduled_at,
    'beforeLectureId',x.lecture_id,'afterLectureId',x.new_lecture_id,'afterTitle',x.new_title,'status',x.disposition,
    'hasDraft',x.has_draft,'updatedAt',x.updated_at,'dependencyHash',x.dependency_hash) order by x.lecture_no,x.id),'[]')
  from (
    select d.*,case
      when d.lecture_id=d.new_lecture_id then 'unchanged'
      when d.protected then 'preserve_history'
      when d.source_course_id is distinct from d.class_course_id or d.selected_teacher_microcourse_id is not null
        or d.has_custom_courseware then 'preserve_override'
      when d.review_locked then 'preserve_review'
      when d.has_draft and not p_include_drafts then 'preserve_draft'
      when d.new_lecture_id is null then 'missing_lecture'
      else 'change' end disposition
    from (
      select s.id,s.lecture_no,s.title,s.scheduled_at,s.lecture_id,s.updated_at,s.selected_teacher_microcourse_id,
        (s.courseware_overlay<>'[]'::jsonb or s.courseware<>'[]'::jsonb) has_custom_courseware,
        old_l.course_id source_course_id,c.course_id class_course_id,new_l.id new_lecture_id,new_l.name new_title,
        (s.started_at is not null or s.ended_at is not null or s.courseware_frozen_at is not null
          or s.deleted_at is not null or s.voided_at is not null or s.cancelled_by is not null or s.postwork_completed_at is not null
          or exists(select 1 from public.session_attendance where session_id=s.id)
          or exists(select 1 from public.session_reviews where session_id=s.id)
          or exists(select 1 from public.session_learning_check_results r join public.session_learning_checks q on q.id=r.check_id where q.session_id=s.id)) protected,
        (exists(select 1 from public.session_preparations p where p.session_id=s.id and (p.status='ready' or p.prepared_at is not null or p.source_release_id is not null))
          or exists(select 1 from public.session_preparation_reviews r where r.session_id=s.id and r.status in ('pending','approved'))
          or exists(select 1 from public.lesson_plans l where l.session_id=s.id and l.status in ('pending','approved'))) review_locked,
        (exists(select 1 from public.session_preparations where session_id=s.id)
          or exists(select 1 from public.lesson_plans where session_id=s.id)
          or exists(select 1 from public.courseware_annotations where session_id=s.id)
          or exists(select 1 from public.solution_records where session_id=s.id)
          or exists(select 1 from public.session_learning_checks where session_id=s.id)
          or exists(select 1 from public.session_preparation_artifacts where session_id=s.id)) has_draft,
        md5(jsonb_build_object(
          'preparation',(select to_jsonb(p) from public.session_preparations p where p.session_id=s.id),
          'plans',(select jsonb_agg(to_jsonb(p) order by p.id) from public.lesson_plans p where p.session_id=s.id),
          'annotations',(select jsonb_agg(to_jsonb(a) order by a.id) from public.courseware_annotations a where a.session_id=s.id),
          'reviews',(select jsonb_agg(to_jsonb(r) order by r.artifact_kind) from public.session_preparation_reviews r where r.session_id=s.id),
          'artifacts',(select to_jsonb(a) from public.session_preparation_artifacts a where a.session_id=s.id),
          'solutions',(select jsonb_agg(to_jsonb(a) order by a.id) from public.solution_records a where a.session_id=s.id),
          'checks',(select jsonb_agg(to_jsonb(q) order by q.id) from public.session_learning_checks q where q.session_id=s.id)
        )::text) dependency_hash
      from public.class_sessions s join public.classrooms c on c.id=s.classroom_id
      left join public.course_lectures old_l on old_l.id=s.lecture_id
      left join public.course_lectures new_l on new_l.course_id=p_course_id and new_l.no=coalesce(old_l.no,s.lecture_no)
        and new_l.status='active' and new_l.archived_at is null
      where s.classroom_id=p_classroom_id
    ) d
  ) x;
$$;

create function public.preview_classroom_material_change(p_classroom_id uuid,p_course_id uuid,p_selection jsonb,p_include_drafts boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c public.classrooms%rowtype; old_course public.courses%rowtype; target public.courses%rowtype;
  selection jsonb; plan jsonb; token text; settings_version int;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(auth.uid(),'class.manage') or not public.can_manage_classroom(p_classroom_id,auth.uid()) then raise exception 'FORBIDDEN_SCOPE'; end if;
  select * into c from public.classrooms where id=p_classroom_id;
  if not found or c.trashed_at is not null or c.archived_at is not null then raise exception 'MATERIAL_CLASS_UNAVAILABLE'; end if;
  select * into old_course from public.courses where id=c.course_id;
  if not found or old_course.course_kind<>'curriculum' then raise exception 'MATERIAL_REQUIRES_COURSE'; end if;
  selection:=mathin_internal.validate_material_selection(p_classroom_id,p_course_id,p_selection);
  select * into target from public.courses where id=p_course_id;
  if target.purpose<>c.purpose or target.grade<>old_course.grade or target.term<>old_course.term then raise exception 'MATERIAL_COURSE_MISMATCH'; end if;
  if p_include_drafts is null then raise exception 'MATERIAL_INVALID'; end if;
  plan:=mathin_internal.class_material_session_plan(p_classroom_id,p_course_id,p_include_drafts);
  select version into settings_version from public.classroom_material_settings where classroom_id=c.id;
  token:=md5(jsonb_build_object('classroom',to_jsonb(c),'settingsVersion',coalesce(settings_version,0),
    'selection',selection,'target',to_jsonb(target),'plan',plan,'includeDrafts',p_include_drafts)::text);
  return jsonb_build_object('token',token,'selection',selection,'sessions',plan,
    'changeCount',(select count(*) from jsonb_array_elements(plan) p where p->>'status'='change'),
    'preserveCount',(select count(*) from jsonb_array_elements(plan) p where p->>'status' like 'preserve_%'),
    'missingCount',(select count(*) from jsonb_array_elements(plan) p where p->>'status'='missing_lecture'),
    'draftChangeCount',(select count(*) from jsonb_array_elements(plan) p where p->>'status'='change' and (p->>'hasDraft')::boolean));
end;
$$;

create function mathin_internal.store_material_selection(p_classroom_id uuid,p_selection jsonb)
returns void language sql security definer set search_path=public,pg_temp as $$
  insert into public.classroom_material_settings(classroom_id,business_class_type,cohort_year,cohort_season,cohort_grade,rule_revision_id,inherited_from_classroom_id,updated_by)
  values(p_classroom_id,p_selection->>'businessClassType',(p_selection->>'cohortYear')::int,(p_selection->>'cohortSeason')::int,
    (p_selection->>'cohortGrade')::int,(p_selection->>'ruleRevisionId')::uuid,(p_selection->>'inheritedFromClassroomId')::uuid,auth.uid())
  on conflict(classroom_id) do update set version=classroom_material_settings.version+1,
    business_class_type=excluded.business_class_type,cohort_year=excluded.cohort_year,cohort_season=excluded.cohort_season,
    cohort_grade=excluded.cohort_grade,rule_revision_id=excluded.rule_revision_id,
    inherited_from_classroom_id=excluded.inherited_from_classroom_id,updated_by=excluded.updated_by,updated_at=now();
$$;

create function public.apply_classroom_material_change(p_classroom_id uuid,p_course_id uuid,p_selection jsonb,p_include_drafts boolean,p_expected_token text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare preview jsonb; before_data jsonb; after_data jsonb; affected uuid[]; preserved uuid[]; changed integer; change_id uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(auth.uid(),'class.manage') or not public.can_manage_classroom(p_classroom_id,auth.uid()) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then raise exception 'MATERIAL_REASON_REQUIRED'; end if;
  perform 1 from public.classrooms where id=p_classroom_id for update;
  perform 1 from public.class_sessions where classroom_id=p_classroom_id order by id for update;
  perform 1 from public.session_preparations where session_id in (select id from public.class_sessions where classroom_id=p_classroom_id) order by session_id for update;
  perform 1 from public.lesson_plans where session_id in (select id from public.class_sessions where classroom_id=p_classroom_id) order by id for update;
  perform 1 from public.session_preparation_reviews where session_id in (select id from public.class_sessions where classroom_id=p_classroom_id) order by session_id,artifact_kind for update;
  perform 1 from public.session_preparation_artifacts where session_id in (select id from public.class_sessions where classroom_id=p_classroom_id) order by session_id for update;
  perform 1 from public.courseware_annotations where session_id in (select id from public.class_sessions where classroom_id=p_classroom_id) order by id for update;
  perform 1 from public.solution_records where session_id in (select id from public.class_sessions where classroom_id=p_classroom_id) order by id for update;
  perform 1 from public.session_learning_checks where session_id in (select id from public.class_sessions where classroom_id=p_classroom_id) order by id for update;
  preview:=public.preview_classroom_material_change(p_classroom_id,p_course_id,p_selection,p_include_drafts);
  if p_expected_token is distinct from preview->>'token' then raise exception 'MATERIAL_STALE'; end if;
  if (preview->>'missingCount')::int>0 then raise exception 'MATERIAL_LECTURE_MISSING'; end if;
  select jsonb_build_object('courseId',c.course_id,'courseTitle',course.title,'materialClassType',course.class_type,
    'selection',mathin_internal.material_selection_json(c.id))
    into before_data from public.classrooms c join public.courses course on course.id=c.course_id where c.id=p_classroom_id;
  select coalesce(array_agg((p->>'id')::uuid),'{}') into affected from jsonb_array_elements(preview->'sessions') p where p->>'status'='change';
  select coalesce(array_agg((p->>'id')::uuid),'{}') into preserved from jsonb_array_elements(preview->'sessions') p where p->>'status' like 'preserve_%';
  update public.class_sessions s set lecture_id=(p->>'afterLectureId')::uuid,
    title=case when s.title=old_l.name then p->>'afterTitle' else s.title end
    from jsonb_array_elements(preview->'sessions') p,public.course_lectures old_l
    where p->>'status'='change' and s.id=(p->>'id')::uuid and old_l.id=s.lecture_id;
  get diagnostics changed=row_count;
  if changed<>(preview->>'changeCount')::int then raise exception 'MATERIAL_STALE'; end if;
  update public.classrooms set course_id=p_course_id where id=p_classroom_id;
  perform mathin_internal.store_material_selection(p_classroom_id,preview->'selection');
  select jsonb_build_object('courseId',c.id,'courseTitle',c.title,'materialClassType',c.class_type,'selection',preview->'selection')
    into after_data from public.courses c where c.id=p_course_id;
  insert into public.classroom_material_changes(classroom_id,before_data,after_data,changed_session_ids,preserved_session_ids,reason,created_by)
    values(p_classroom_id,before_data,after_data,affected,preserved,btrim(p_reason),auth.uid()) returning id into change_id;
  perform public.emit_domain_event('classroom.material_changed','classroom',p_classroom_id,
    jsonb_build_object('changeId',change_id,'before',before_data,'after',after_data,'changedSessions',changed,
      'preservedSessions',cardinality(preserved),'reason',btrim(p_reason)),null,'/dashboard/classes/'||p_classroom_id::text);
  return jsonb_build_object('changedSessions',changed,'preservedSessions',cardinality(preserved),'changeId',change_id);
end;
$$;

create function public.get_classroom_material_workspace(p_classroom_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c public.classrooms%rowtype; course public.courses%rowtype;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(auth.uid(),'class.manage') or not public.can_manage_classroom(p_classroom_id,auth.uid()) then raise exception 'FORBIDDEN_SCOPE'; end if;
  select * into c from public.classrooms where id=p_classroom_id;
  if not found then raise exception 'MATERIAL_CLASS_UNAVAILABLE'; end if;
  select * into course from public.courses where id=c.course_id;
  return jsonb_build_object('courseId',c.course_id,'courseTitle',course.title,'grade',course.grade,'season',course.term,
    'selection',mathin_internal.material_selection_json(c.id),'options',public.get_course_material_options(c.purpose,c.id),
    'editable',coalesce(c.trashed_at is null and c.archived_at is null and course.course_kind='curriculum',false),
    'history',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'createdAt',h.created_at,'reason',h.reason,
      'before',h.before_data,'after',h.after_data,'changedSessions',cardinality(h.changed_session_ids),
      'preservedSessions',cardinality(h.preserved_session_ids)) order by h.created_at desc)
      from (select * from public.classroom_material_changes where classroom_id=c.id order by created_at desc limit 20) h),'[]'));
end;
$$;

create function public.create_class_with_material(p_input jsonb,p_selection jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare classroom_id uuid; selected jsonb; course_id uuid; sessions jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(auth.uid(),'class.create') then raise exception 'FORBIDDEN'; end if;
  course_id:=(p_input->>'courseId')::uuid;
  selected:=mathin_internal.validate_material_selection(null,course_id,p_selection);
  select coalesce(jsonb_agg(jsonb_build_object('lecture_id',s->'lectureId','title',s->'name',
    'scheduled_at',s->'scheduledAt','duration_min',s->'durationMin','closed_day_reason',coalesce(s->>'closedDayReason',''))),'[]')
    into sessions from jsonb_array_elements(p_input->'sessions') s;
  classroom_id:=public.create_class_v2(
    p_name:=p_input->>'name',p_course_id:=course_id,p_capacity:=(p_input->>'capacity')::smallint,
    p_room_id:=(p_input->>'roomId')::uuid,p_primary_teacher_id:=(p_input->>'primaryTeacherId')::uuid,
    p_learning_support_id:=(p_input->>'learningSupportId')::uuid,p_term_id:=(p_input->>'schoolTermId')::uuid,
    p_purpose:=p_input->>'purpose',p_offering_type:=p_input->>'offeringType',
    p_sessions:=sessions,p_activate:=(p_input->>'activateNow')::boolean);
  perform mathin_internal.store_material_selection(classroom_id,selected);
  insert into public.classroom_material_changes(classroom_id,before_data,after_data,reason,created_by)
    select classroom_id,'{}',jsonb_build_object('courseId',c.id,'courseTitle',c.title,'materialClassType',c.class_type,'selection',selected),
      'initial_material_selection',auth.uid() from public.courses c where c.id=course_id;
  return classroom_id;
end;
$$;

revoke all on function mathin_internal.material_rule_json(public.course_material_rule_revisions),
  mathin_internal.material_selection_json(uuid),mathin_internal.validate_material_selection(uuid,uuid,jsonb),
  mathin_internal.class_material_session_plan(uuid,uuid,boolean),mathin_internal.store_material_selection(uuid,jsonb)
  from public,anon,authenticated;
revoke all on function public.get_course_material_options(text,uuid),public.save_course_material_rule(uuid,integer,jsonb),
  public.preview_classroom_material_change(uuid,uuid,jsonb,boolean),public.apply_classroom_material_change(uuid,uuid,jsonb,boolean,text,text),
  public.get_classroom_material_workspace(uuid),public.create_class_with_material(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.get_course_material_options(text,uuid),public.save_course_material_rule(uuid,integer,jsonb),
  public.preview_classroom_material_change(uuid,uuid,jsonb,boolean),public.apply_classroom_material_change(uuid,uuid,jsonb,boolean,text,text),
  public.get_classroom_material_workspace(uuid),public.create_class_with_material(jsonb,jsonb) to authenticated;

-- 已确认的初始业务对应作为可管理数据；不推断或重写任何既有班级。
do $$
declare family uuid; rule_id uuid; revision_id uuid; seed record;
begin
  select id into family from public.course_families where slug='xueersi-e-primary-math-cn';
  if family is null then return; end if;
  for seed in select * from (values
    ('E 系列 A 班教材对应','A','A',null::int,null::int,null::int,null::int,null::int),
    ('E 系列原有 A+ 班教材对应','A+','B',null::int,null::int,2025,4,null::int),
    ('E 系列 2026 暑秋一年级新班','A+','A',2026,1,2026,2,1)
  ) x(title,band,material,from_year,from_season,to_year,to_season,entry_grade) loop
    insert into public.course_material_rules default values returning id into rule_id;
    insert into public.course_material_rule_revisions(rule_id,version,title,family_id,business_class_type,material_class_type,from_year,from_season,to_year,to_season,entry_grade)
      values(rule_id,1,seed.title,family,seed.band,seed.material,seed.from_year,seed.from_season,seed.to_year,seed.to_season,seed.entry_grade) returning id into revision_id;
    update public.course_material_rules set current_revision_id=revision_id where id=rule_id;
  end loop;
end;
$$;

commit;
