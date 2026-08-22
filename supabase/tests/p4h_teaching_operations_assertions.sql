\set ON_ERROR_STOP on
-- P4H-2：在 CI 一次性数据库中验证状态转换的原子性与历史保留。
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
\if :{?admin_id}
\else
  \echo P4H fixtures missing: 测试-管理员
  select 1 / 0;
\endif
\if :{?teacher_id}
\else
  \echo P4H fixtures missing: 测试-教师
  select 1 / 0;
\endif

-- P4H-3：90 个明确的 E 系列版本归入唯一 family；非空关系、元数据和唯一索引均须成立。
select id as e_family_id from public.course_families where slug = 'xueersi-e-primary-math-cn' limit 1 \gset
\if :{?e_family_id}
\else
  \echo P4H course family missing: xueersi-e-primary-math-cn
  select 1 / 0;
\endif
select (
  title = 'E 系列小学数学'
  and publisher = '学而思'
  and stage = '小学'
  and subject = '数学'
  and edition = '全国版'
  and purpose = 'production'
  and status = 'enabled'
  and (select count(*) from public.courses where family_id = :'e_family_id'::uuid) = 90
  and (select count(*) from public.course_lectures lecture_row join public.courses course_row on course_row.id = lecture_row.course_id where course_row.family_id = :'e_family_id'::uuid) = 1135
  and not exists (select 1 from public.courses where family_id is null)
) as p4h_family_backfill_ok
from public.course_families where id = :'e_family_id'::uuid \gset
\if :p4h_family_backfill_ok
\else
  \echo P4H course family failed: metadata or backfill mismatch
  select 1 / 0;
\endif
do $$
begin
  begin
    insert into public.courses (family_id,title,product_code,grade,term,class_type,status,purpose)
    values (
      (select id from public.course_families where slug = 'xueersi-e-primary-math-cn'),
      '__P4H_DUPLICATE_VARIANT__',
      '__P4H_DUP__' || replace(gen_random_uuid()::text, '-', ''),
      1, 1, 'A', 'enabled', 'test'
    );
    raise exception 'P4H_ACTIVE_VARIANT_DUPLICATE_WAS_ACCEPTED';
  exception when unique_violation then
    null;
  end;
end;
$$;
select exists (
  select 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'courses' and column_name = 'term_id'
) as p4h_course_term_id_retained \gset
\if :p4h_course_term_id_retained
\else
  \echo P4H course family failed: legacy courses.term_id was removed
  select 1 / 0;
\endif

-- 事务内构造带班级引用、release 引用、历史 event 的最小基线。
insert into public.courses (title, product_code, grade, term, class_type, status, purpose, created_by)
values ('__P4H_AUDIT_COURSE__', '__P4H__' || replace(gen_random_uuid()::text, '-', ''), 1, 1, 'audit', 'draft', 'test', :'admin_id')
returning id as audit_course_id, updated_at as audit_course_updated_at \gset

insert into public.course_lectures (course_id, no, name, objectives, status)
values (:'audit_course_id', 1, '__P4H_AUDIT_LECTURE__', 'original objective', 'active')
returning id as audit_lecture_id \gset

insert into public.cw_page_docs (
  lecture_id, page_no, title, source_courseware_id, source_page_id
)
values (
  :'audit_lecture_id', 1, '__P4H_AUDIT_PAGE__', '__P4H_AUDIT__', 'page-1'
)
returning id as audit_page_doc_id \gset

insert into public.cw_page_revisions (
  page_doc_id, revision_no, doc, origin, created_by
)
values (
  :'audit_page_doc_id',
  1,
  jsonb_build_object(
    'docVersion', 'page-doc-v1',
    'sourceCoursewareId', '__P4H_AUDIT__',
    'sourcePageId', 'page-1',
    'sourcePageDatabaseId', 1,
    'sourceSnapshotId', 1,
    'sourceContentHash', repeat('4', 64),
    'canvas', jsonb_build_object(
      'width', 1280, 'height', 720,
      'backgroundColor', null, 'backgroundBindingKey', null
    ),
    'nodes', '[]'::jsonb,
    'interactions', '[]'::jsonb
  ),
  'import',
  :'admin_id'
)
returning id as audit_page_revision_id \gset

update public.cw_page_docs
set current_revision_id = :'audit_page_revision_id'
where id = :'audit_page_doc_id';

insert into public.classrooms (owner_id, name, invite_code, course_id, purpose, operational_status)
values (:'teacher_id', '__P4H_AUDIT_CLASS__', 'P4H' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)), :'audit_course_id', 'test', 'planning')
returning id as audit_classroom_id \gset

insert into public.classroom_members (classroom_id, user_id, role)
values (:'audit_classroom_id', :'teacher_id', 'teacher')
on conflict do nothing;

insert into public.class_sessions (classroom_id, lecture_id, lecture_no, title)
values (:'audit_classroom_id', :'audit_lecture_id', 1, '__P4H_AUDIT_SESSION__')
returning id as audit_session_id \gset

insert into public.cw_lecture_releases (lecture_id, release_no, snapshot, published_by)
values (
  :'audit_lecture_id',
  1,
  jsonb_build_array(jsonb_build_object(
    'pageDocId', :'audit_page_doc_id',
    'revisionId', :'audit_page_revision_id'
  )),
  :'admin_id'
)
returning id as audit_release_id \gset
update public.course_lectures set current_release_id = :'audit_release_id' where id = :'audit_lecture_id';

insert into public.class_sessions (classroom_id, title, started_at)
values (:'audit_classroom_id', '__P4H_STARTED_SESSION__', now())
returning id as started_session_id \gset

insert into public.class_sessions (classroom_id, title, started_at, ended_at)
values (:'audit_classroom_id', '__P4H_ENDED_SESSION__', now() - interval '1 hour', now())
returning id as ended_session_id \gset
insert into public.session_events (id, session_id, user_id, device_id, seq, type, payload, at)
values (gen_random_uuid(), :'ended_session_id', :'admin_id', 'p4h-audit-device', 1, 'answer', '{}'::jsonb, now());

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select set_config('p4h.audit_course_id', :'audit_course_id', true);
select set_config('p4h.audit_lecture_id', :'audit_lecture_id', true);
select set_config('p4h.audit_classroom_id', :'audit_classroom_id', true);
select set_config('p4h.audit_started_session_id', :'started_session_id', true);
select set_config('p4h.audit_course_updated_at', :'audit_course_updated_at', true);

-- P4H-3 兼容入口必须在同一事务内创建不为空的 legacy family 关系。
select public.create_legacy_course(
  '__P4H_LEGACY_RPC_COURSE__',
  '__P4H_RPC__' || replace(gen_random_uuid()::text, '-', ''),
  9::smallint,
  4::smallint,
  'compat',
  'draft'
) as legacy_rpc_course_id \gset
select exists (
  select 1
    from public.courses course_row
    join public.course_families family_row on family_row.id = course_row.family_id
   where course_row.id = :'legacy_rpc_course_id'::uuid
     and family_row.slug = 'legacy-course-' || course_row.id::text
     and family_row.title = course_row.title
) as p4h_legacy_course_compat_ok \gset
\if :p4h_legacy_course_compat_ok
\else
  \echo P4H course family failed: legacy course RPC did not create an atomic family mapping
  select 1 / 0;
\endif

-- family 查询合同只返回版本摘要；产品总览不自动选择版本，也不下发教学计划/page doc。
with family_detail as (
  select public.get_course_family_detail(:'e_family_id'::uuid, null) as value
), family_impact as (
  select * from public.get_course_family_impact(:'e_family_id'::uuid)
)
select (
  exists (
    select 1
      from public.list_course_families('all', '{"q":"E 系列小学数学"}'::jsonb, 1) family_row
     where family_row.id = :'e_family_id'::uuid
        and family_row.variant_count = 90
        and jsonb_array_length(family_row.matched_variants) = 90
  )
  and (select jsonb_array_length(value -> 'variants') = 90 from family_detail)
  and (select value -> 'selectedVariant' = 'null'::jsonb from family_detail)
  and (select jsonb_array_length(value -> 'teachingPlan') = 0 from family_detail)
  and (select value -> 'readiness' = '{"lectureCount":0,"releasedLectureCount":0,"pageCount":0}'::jsonb from family_detail)
   and (select variant_count = 90 and lecture_count = 1135 from family_impact)
) as p4h_family_query_contract_ok \gset
\if :p4h_family_query_contract_ok
\else
  \echo P4H course family failed: list/detail/impact contract mismatch
  select 1 / 0;
\endif
create temporary table p4h_family_variant_status on commit drop as
select id, status from public.courses where family_id = :'e_family_id'::uuid;
select public.transition_course_family_status(:'e_family_id'::uuid, 'draft');
select (
  (select status = 'draft' from public.course_families where id = :'e_family_id'::uuid)
  and not exists (
    select 1
      from public.courses course_row
      join p4h_family_variant_status before_row on before_row.id = course_row.id
     where course_row.status is distinct from before_row.status
  )
) as p4h_family_transition_isolated \gset
\if :p4h_family_transition_isolated
\else
  \echo P4H course family failed: family transition changed a child variant
  select 1 / 0;
\endif
select public.transition_course_family_status(:'e_family_id'::uuid, 'enabled');

-- 有班级/release 引用的课程不可进入回收站，影响预览只给计数。
do $$
begin
  begin
    perform public.trash_course(current_setting('p4h.audit_course_id')::uuid);
    raise exception 'P4H_COURSE_TRASH_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'COURSE_IN_USE' then raise; end if;
  end;
end;
$$;
select (lecture_count = 1 and release_count = 1 and classroom_count = 1 and session_count >= 1)
  as p4h_course_impact_ok
from public.get_course_lifecycle_impact(:'audit_course_id') \gset
\if :p4h_course_impact_ok
\else
  \echo P4H lifecycle failed: course impact count mismatch
  select 1 / 0;
\endif

-- 讲次归档/恢复不改变引用、ID 或课件 release。
select public.archive_lecture(:'audit_lecture_id');
select (status = 'archived' and archived_at is not null and current_release_id = :'audit_release_id'::uuid)
  as p4h_lecture_archived
from public.course_lectures where id = :'audit_lecture_id' \gset
\if :p4h_lecture_archived
\else
  \echo P4H lifecycle failed: lecture archive mutated release or status
  select 1 / 0;
\endif
select public.restore_lecture(:'audit_lecture_id');
select (
  (select status = 'active' and current_release_id = :'audit_release_id'::uuid from public.course_lectures where id = :'audit_lecture_id')
  and (select lecture_id = :'audit_lecture_id'::uuid from public.class_sessions where id = :'audit_session_id')
) as p4h_lecture_restored
\gset
\if :p4h_lecture_restored
\else
  \echo P4H lifecycle failed: lecture restore did not preserve identity/reference
  select 1 / 0;
\endif

-- 未开课课次可取消/恢复，已开课课次拒绝取消。
select public.cancel_session(:'audit_session_id', 'audit cancellation');
select (deleted_at is not null and cancelled_by = :'admin_id'::uuid and cancel_reason = 'audit cancellation')
  as p4h_session_cancelled
from public.class_sessions where id = :'audit_session_id' \gset
\if :p4h_session_cancelled
\else
  \echo P4H lifecycle failed: session cancellation not recorded
  select 1 / 0;
\endif
select public.restore_session(:'audit_session_id');
select (deleted_at is null and cancelled_by is null and cancel_reason = '')
  as p4h_session_restored
from public.class_sessions where id = :'audit_session_id' \gset
\if :p4h_session_restored
\else
  \echo P4H lifecycle failed: session restore not recorded
  select 1 / 0;
\endif
do $$
begin
  begin
    perform public.cancel_session(current_setting('p4h.audit_started_session_id')::uuid, 'must fail');
    raise exception 'P4H_STARTED_SESSION_CANCEL_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'SESSION_ALREADY_STARTED' then raise; end if;
  end;
end;
$$;

-- 作废已结束课次时只写 void 元数据，事件流仍在。
select count(*) as before_void_event_count from public.session_events where session_id = :'ended_session_id' \gset
select public.void_session(:'ended_session_id', 'audit void');
select (
  voided_at is not null
  and voided_by = :'admin_id'::uuid
  and void_reason = 'audit void'
  and (select count(*) from public.session_events where session_id = :'ended_session_id') = :before_void_event_count
) as p4h_void_preserves_events
from public.class_sessions where id = :'ended_session_id' \gset
\if :p4h_void_preserves_events
\else
  \echo P4H lifecycle failed: void did not preserve session events
  select 1 / 0;
\endif

-- 有已开始历史的班级绝不能进入回收站。
do $$
begin
  begin
    perform public.trash_classroom(current_setting('p4h.audit_classroom_id')::uuid);
    raise exception 'P4H_HISTORY_CLASSROOM_TRASH_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'CLASSROOM_HAS_HISTORY' then raise; end if;
  end;
end;
$$;

-- stale base 必须在更新任何讲次元数据前失败。
do $$
begin
  begin
    perform public.save_teaching_plan(
      current_setting('p4h.audit_course_id')::uuid,
      current_setting('p4h.audit_course_updated_at')::timestamptz - interval '1 microsecond',
      jsonb_build_array(jsonb_build_object(
        'id', current_setting('p4h.audit_lecture_id'),
        'name', '__P4H_STALE_NAME__',
        'objectives', 'stale objective'
      ))
    );
    raise exception 'P4H_STALE_PLAN_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'STALE_WRITE' then raise; end if;
  end;
end;
$$;
select (name = '__P4H_AUDIT_LECTURE__' and objectives = 'original objective') as p4h_stale_no_partial_write
from public.course_lectures where id = :'audit_lecture_id' \gset
\if :p4h_stale_no_partial_write
\else
  \echo P4H lifecycle failed: stale plan partially wrote lecture metadata
  select 1 / 0;
\endif

-- R1-Live：未完成讲次是运营告警，不阻止正式班立即启用或从筹备中启用。
reset role;
select id as r1_live_term_id from public.school_terms order by starts_on nulls last, created_at limit 1 \gset
\if :{?r1_live_term_id}
\else
  \echo R1-Live incomplete-course activation failed: school term fixture missing
  select 1 / 0;
\endif
insert into public.course_families (slug, title, purpose, status, created_by)
values (
  'r1-live-readiness-' || replace(gen_random_uuid()::text, '-', ''),
  '__R1_LIVE_READINESS_FAMILY__',
  'production',
  'enabled',
  :'admin_id'
)
returning id as r1_live_family_id \gset
insert into public.courses (
  family_id, title, product_code, grade, term, class_type, status, purpose, created_by
)
values (
  :'r1_live_family_id',
  '__R1_LIVE_INCOMPLETE_COURSE__',
  '__R1_LIVE__' || replace(gen_random_uuid()::text, '-', ''),
  1,
  1,
  'r1-live-readiness',
  'enabled',
  'production',
  :'admin_id'
)
returning id as r1_live_course_id \gset
insert into public.course_lectures (course_id, no, name, objectives, status)
values (:'r1_live_course_id', 1, '__R1_LIVE_UNRELEASED_LECTURE__', '', 'active')
returning id as r1_live_lecture_id \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.create_class(
  p_name => '__R1_LIVE_IMMEDIATE_ACTIVE__',
  p_course_id => :'r1_live_course_id',
  p_primary_teacher_id => :'teacher_id',
  p_term_id => :'r1_live_term_id',
  p_purpose => 'production',
  p_sessions => jsonb_build_array(jsonb_build_object(
    'lecture_id', :'r1_live_lecture_id',
    'scheduled_at', now() + interval '7 days',
    'duration_min', 90
  )),
  p_activate => true
) as r1_live_immediate_classroom_id \gset
select public.create_class(
  p_name => '__R1_LIVE_PLANNING_THEN_ACTIVE__',
  p_course_id => :'r1_live_course_id',
  p_primary_teacher_id => :'teacher_id',
  p_term_id => :'r1_live_term_id',
  p_purpose => 'production',
  p_sessions => jsonb_build_array(jsonb_build_object(
    'lecture_id', :'r1_live_lecture_id',
    'scheduled_at', now() + interval '14 days',
    'duration_min', 90
  )),
  p_activate => false
) as r1_live_planning_classroom_id \gset
select public.transition_classroom_status(:'r1_live_planning_classroom_id', 'active');
select public.create_class(
  p_name => '__R1_LIVE_FREE_IMMEDIATE_ACTIVE__',
  p_course_id => null,
  p_primary_teacher_id => :'teacher_id',
  p_term_id => :'r1_live_term_id',
  p_purpose => 'production',
  p_sessions => '[]'::jsonb,
  p_activate => true
) as r1_live_free_immediate_classroom_id \gset
select public.create_class(
  p_name => '__R1_LIVE_FREE_PLANNING_THEN_ACTIVE__',
  p_course_id => null,
  p_primary_teacher_id => :'teacher_id',
  p_term_id => :'r1_live_term_id',
  p_purpose => 'production',
  p_sessions => '[]'::jsonb,
  p_activate => false
) as r1_live_free_planning_classroom_id \gset
select public.transition_classroom_status(:'r1_live_free_planning_classroom_id', 'active');
select (
  (select current_release_id is null from public.course_lectures where id = :'r1_live_lecture_id')
  and (select operational_status = 'active' from public.classrooms where id = :'r1_live_immediate_classroom_id')
  and (select operational_status = 'active' from public.classrooms where id = :'r1_live_planning_classroom_id')
  and (select operational_status = 'active' and course_id is null from public.classrooms where id = :'r1_live_free_immediate_classroom_id')
  and (select operational_status = 'active' and course_id is null from public.classrooms where id = :'r1_live_free_planning_classroom_id')
  and (select count(*) = 2 from public.class_sessions where classroom_id in (
    :'r1_live_immediate_classroom_id'::uuid,
    :'r1_live_planning_classroom_id'::uuid
  ))
) as r1_live_incomplete_course_activation_ok \gset
\if :r1_live_incomplete_course_activation_ok
\else
  \echo R1-Live operational activation failed: an advisory remained a hard gate
  select 1 / 0;
\endif

rollback;
