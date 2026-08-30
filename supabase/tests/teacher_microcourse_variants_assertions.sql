\set ON_ERROR_STOP on
-- DEV-TMC-2 proposal/branch/selection assertions. Every fixture write rolls back.
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
select member.user_id as research_id
from public.staff_role_members member
join public.staff_roles role on role.id = member.role_id
where role.key = 'research'
order by member.created_at, member.user_id
limit 1 \gset

\if :{?admin_id}
\else
  \echo DEV-TMC-2 fixtures missing: admin
  select 1 / 0;
\endif
\if :{?teacher_id}
\else
  \echo DEV-TMC-2 fixtures missing: teacher
  select 1 / 0;
\endif
\if :{?research_id}
\else
  \echo DEV-TMC-2 fixtures missing: research
  select 1 / 0;
\endif

insert into public.staff_role_members(user_id, role_id)
select :'research_id', role.id
from public.staff_roles role
where role.key = 'research'
on conflict do nothing;

insert into public.classrooms(id, owner_id, name, invite_code)
values (
  '00000000-0000-4000-8000-000000000941',
  :'teacher_id',
  '__DEV_TMC_VARIANT_CLASS__',
  'TMC941'
);
insert into public.classroom_members(classroom_id, user_id, role)
values (
  '00000000-0000-4000-8000-000000000941',
  :'teacher_id',
  'teacher'
);
insert into public.class_sessions(id, classroom_id, title, scheduled_at, duration_min)
values
  (
    '00000000-0000-4000-8000-000000000942',
    '00000000-0000-4000-8000-000000000941',
    '__DEV_TMC_VARIANT_SESSION__',
    now() + interval '2 days',
    60
  ),
  (
    '00000000-0000-4000-8000-000000000943',
    '00000000-0000-4000-8000-000000000941',
    '__DEV_TMC_RESEARCH_FIRST_SESSION__',
    now() + interval '3 days',
    60
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.set_feature_flag(
  'teaching.teacher_microcourses_v1', null, true, now(), 'DEV-TMC-2 assertion enable'
);
reset role;

-- The session teacher creates the first head; it becomes the initial choice.
set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.create_teacher_microcourse_variant(
  '00000000-0000-4000-8000-000000000942',
  '老师初稿',
  '分支合同课件',
  '老师第一版',
  3::smallint,
  null::smallint,
  '',
  'logic-strategy',
  array['分支', '冻结']
) as teacher_variant_id \gset
select public.create_teacher_microcourse_composition_page(
  :'teacher_variant_id', null, '老师第一页', null, null, null
) as teacher_page_id \gset
reset role;

-- Research may fork and edit its own head, but it is not a session teacher and
-- cannot replace the actual teacher's current choice.
set local role authenticated;
select set_config('request.jwt.claim.sub', :'research_id', true);
select public.create_teacher_microcourse_variant(
  '00000000-0000-4000-8000-000000000943',
  '教研第一版建议稿',
  '教研从空白创建',
  '不要求任课老师先创建课件',
  3::smallint,
  null::smallint,
  '',
  'logic-strategy',
  array['教研初稿']
) as research_first_variant_id \gset
select public.create_teacher_microcourse_composition_page(
  :'research_first_variant_id', null, '教研第一页', null, null, null
);
select (
  not public.is_session_teacher('00000000-0000-4000-8000-000000000943', :'research_id')
  and public.can_author_teacher_microcourse(:'research_first_variant_id', :'research_id')
  and (select selected_teacher_microcourse_id = :'research_first_variant_id'
       from public.class_sessions where id = '00000000-0000-4000-8000-000000000943')
) as research_first_ok \gset
\if :research_first_ok
\else
  \echo DEV-TMC-2 failed: research could not create the first proposal
  select 1 / 0;
\endif

select public.fork_teacher_microcourse_variant(
  :'teacher_variant_id', '教研建议稿'
) as research_variant_id \gset
select (
  not public.is_session_teacher('00000000-0000-4000-8000-000000000942', :'research_id')
  and public.can_author_teacher_microcourse(:'research_variant_id', :'research_id')
  and not public.can_author_teacher_microcourse(:'teacher_variant_id', :'research_id')
  and (select selected_teacher_microcourse_id = :'teacher_variant_id'
       from public.class_sessions where id = '00000000-0000-4000-8000-000000000942')
  and (select based_on_microcourse_id = :'teacher_variant_id'
       from public.teacher_microcourses where id = :'research_variant_id')
  and (select count(*) = 1 from public.cw_page_docs page
       join public.teacher_microcourses microcourse on microcourse.lecture_id = page.lecture_id
       where microcourse.id = :'research_variant_id' and page.deleted_at is null)
) as research_branch_ok \gset
\if :research_branch_ok
\else
  \echo DEV-TMC-2 failed: research branch isolation or lineage
  select 1 / 0;
\endif
select set_config('dev_tmc.research_variant', :'research_variant_id', true);
do $$
begin
  begin
    perform public.select_teacher_microcourse_variant(
      '00000000-0000-4000-8000-000000000942',
      current_setting('dev_tmc.research_variant')::uuid
    );
    raise exception 'RESEARCH_SELECTION_ACCEPTED';
  exception when others then
    if sqlerrm <> 'FORBIDDEN' then raise; end if;
  end;
end
$$;
reset role;

-- Opening another author's proposal for editing creates a third independent
-- head. It copies the research snapshot and still does not steal selection.
set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.fork_teacher_microcourse_variant(
  :'research_variant_id', '老师课堂版'
) as classroom_variant_id \gset
select page.id as classroom_page_id,
       revision.revision_no as classroom_revision_no,
       revision.doc as classroom_doc
from public.teacher_microcourses microcourse
join public.cw_page_docs page on page.lecture_id = microcourse.lecture_id and page.deleted_at is null
join public.cw_page_track_heads head on head.page_doc_id = page.id and head.track = 'native-16x9'
join public.cw_page_revisions revision on revision.id = head.draft_revision_id
where microcourse.id = :'classroom_variant_id'
limit 1 \gset

select (
  public.can_author_teacher_microcourse(:'classroom_variant_id', :'teacher_id')
  and not public.can_author_teacher_microcourse(:'research_variant_id', :'teacher_id')
  and (select based_on_microcourse_id = :'research_variant_id'
       from public.teacher_microcourses where id = :'classroom_variant_id')
  and (select selected_teacher_microcourse_id = :'teacher_variant_id'
       from public.class_sessions where id = '00000000-0000-4000-8000-000000000942')
  and jsonb_array_length(public.list_teacher_microcourse_variants(
        '00000000-0000-4000-8000-000000000942'
      )) = 3
) as teacher_branch_ok \gset
\if :teacher_branch_ok
\else
  \echo DEV-TMC-2 failed: teacher branch isolation, lineage, or list
  select 1 / 0;
\endif

select public.select_teacher_microcourse_variant(
  '00000000-0000-4000-8000-000000000942', :'classroom_variant_id'
);
select public.freeze_selected_teacher_microcourse_source_session(
  '00000000-0000-4000-8000-000000000942'
);
select courseware_resolved #>> '{microcourseDraft,pages,0,revisionId}' as frozen_revision_id
from public.class_sessions
where id = '00000000-0000-4000-8000-000000000942' \gset

select (
  selected_teacher_microcourse_id = :'classroom_variant_id'
  and courseware_frozen_at is not null
  and started_at is not null
  and courseware_resolved #>> '{microcourseDraft,microcourseId}' = :'classroom_variant_id'
  and courseware_resolved #>> '{microcourseDraft,variantName}' = '老师课堂版'
  and jsonb_array_length(courseware) = 1
  and courseware #>> '{0,type}' = 'doc'
  and courseware #>> '{0,docId}' = :'classroom_page_id'
) as selected_freeze_ok
from public.class_sessions
where id = '00000000-0000-4000-8000-000000000942' \gset
\if :selected_freeze_ok
\else
  \echo DEV-TMC-2 failed: selected proposal was not frozen atomically
  select 1 / 0;
\endif

-- Editing the proposal after class advances its head without changing the
-- revision pinned into the frozen session snapshot.
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select revision_id as post_freeze_revision_id
from public.save_teacher_courseware_composition_page(
  :'teacher_id',
  :'classroom_page_id',
  :'classroom_doc'::jsonb,
  :'classroom_revision_no'::integer,
  '课后继续修改',
  'frozen session must not drift'
) \gset
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select (
  :'post_freeze_revision_id'::uuid <> :'frozen_revision_id'::uuid
  and (select courseware_resolved #>> '{microcourseDraft,pages,0,revisionId}' = :'frozen_revision_id'
       from public.class_sessions where id = '00000000-0000-4000-8000-000000000942')
) as frozen_snapshot_stable \gset
\if :frozen_snapshot_stable
\else
  \echo DEV-TMC-2 failed: frozen revision drifted after proposal edit
  select 1 / 0;
\endif

select set_config('dev_tmc.teacher_variant', :'teacher_variant_id', true);
do $$
begin
  begin
    perform public.select_teacher_microcourse_variant(
      '00000000-0000-4000-8000-000000000942',
      current_setting('dev_tmc.teacher_variant')::uuid
    );
    raise exception 'FROZEN_SELECTION_CHANGED';
  exception when others then
    if sqlerrm <> 'SESSION_COURSEWARE_ALREADY_FROZEN' then raise; end if;
  end;
end
$$;
reset role;

rollback;
