-- 已保存的续班配置固定自己的版本；显式重新继承时才核对原班。
begin;

create or replace function mathin_internal.validate_material_selection(p_classroom_id uuid,p_course_id uuid,p_selection jsonb)
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
    if inherited=p_classroom_id then raise exception 'FORBIDDEN_SCOPE'; end if;
    -- 已保存的继承仅记录历史来源；本班配置独立于原班后续修改。
    original:=mathin_internal.material_selection_json(p_classroom_id);
    if original is distinct from p_selection then
      if not public.can_manage_classroom(inherited,auth.uid()) then raise exception 'FORBIDDEN_SCOPE'; end if;
      original:=mathin_internal.material_selection_json(inherited);
      if original is null or (original - 'inheritedFromClassroomId') is distinct from (p_selection - 'inheritedFromClassroomId')
        then raise exception 'MATERIAL_INHERITANCE_STALE'; end if;
    end if;
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

-- 记录本入口明确保留的草稿来源，允许后续勾选补切；单课另选教材时清除此标记。
alter table public.classroom_material_settings add column deferred_sources jsonb not null default '{}'::jsonb
  check (jsonb_typeof(deferred_sources)='object');

create function mathin_internal.clear_deferred_material_source()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.classroom_material_settings
    set deferred_sources=deferred_sources-old.id::text,version=version+1,updated_at=now()
    where classroom_id=old.classroom_id and deferred_sources ? old.id::text;
  return new;
end;
$$;
revoke all on function mathin_internal.clear_deferred_material_source() from public,anon,authenticated;
create trigger class_material_independent_source
  after update of lecture_id,classroom_id on public.class_sessions for each row
  when (old.lecture_id is distinct from new.lecture_id or old.classroom_id is distinct from new.classroom_id)
  execute function mathin_internal.clear_deferred_material_source();

create or replace function mathin_internal.class_material_session_plan(p_classroom_id uuid,p_course_id uuid,p_include_drafts boolean)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'no',x.lecture_no,'title',x.title,'scheduledAt',x.scheduled_at,
    'beforeLectureId',x.lecture_id,'afterLectureId',x.new_lecture_id,'afterTitle',x.new_title,'status',x.disposition,
    'hasDraft',x.has_draft,'updatedAt',x.updated_at,'dependencyHash',x.dependency_hash) order by x.lecture_no,x.id),'[]')
  from (
    select d.*,case
      when d.lecture_id=d.new_lecture_id then 'unchanged'
      when d.protected then 'preserve_history'
      when (d.source_course_id is distinct from d.class_course_id and not d.is_deferred_draft) or d.selected_teacher_microcourse_id is not null
        or d.has_custom_courseware then 'preserve_override'
      when d.review_locked then 'preserve_review'
      when d.has_draft and not p_include_drafts then 'preserve_draft'
      when d.new_lecture_id is null then 'missing_lecture'
      else 'change' end disposition
    from (
      select s.id,s.lecture_no,s.title,s.scheduled_at,s.lecture_id,s.updated_at,s.selected_teacher_microcourse_id,
        (s.courseware_overlay<>'[]'::jsonb or s.courseware<>'[]'::jsonb) has_custom_courseware,
        coalesce(ms.deferred_sources->>s.id::text=s.lecture_id::text,false) is_deferred_draft,
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
      left join public.classroom_material_settings ms on ms.classroom_id=c.id
      left join public.course_lectures old_l on old_l.id=s.lecture_id
      left join public.course_lectures new_l on new_l.course_id=p_course_id and new_l.no=coalesce(old_l.no,s.lecture_no)
        and new_l.status='active' and new_l.archived_at is null
      where s.classroom_id=p_classroom_id
    ) d
  ) x;
$$;

create or replace function public.apply_classroom_material_change(p_classroom_id uuid,p_course_id uuid,p_selection jsonb,p_include_drafts boolean,p_expected_token text,p_reason text)
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
  update public.classroom_material_settings set deferred_sources=deferred_sources || coalesce(
    (select jsonb_object_agg(p->>'id',p->>'beforeLectureId') from jsonb_array_elements(preview->'sessions') p
      where p->>'status'='preserve_draft'),'{}'::jsonb) where classroom_id=p_classroom_id;
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

commit;
