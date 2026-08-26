\set ON_ERROR_STOP on
-- DEV-TMC-1 content assertions. Every fixture write is rolled back.
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
select id as other_teacher_id from public.profiles where display_name = '测试-学辅' limit 1 \gset

select
  lecture_row.id as source_lecture_id,
  release_row.id as source_release_id,
  (item.value ->> 'pageDocId')::uuid as source_page_id,
  (item.value ->> 'revisionId')::uuid as source_revision_id
from public.courses course_row
join public.course_lectures lecture_row on lecture_row.course_id = course_row.id
left join public.cw_lecture_track_heads track_head
  on track_head.lecture_id = lecture_row.id and track_head.track = 'native-16x9'
join public.cw_lecture_releases release_row
  on release_row.id = coalesce(track_head.current_release_id, lecture_row.current_release_id)
cross join lateral jsonb_array_elements(release_row.snapshot) item
where course_row.course_kind = 'curriculum'
  and course_row.status = 'enabled'
  and course_row.trashed_at is null
limit 1 \gset

\if :{?teacher_id}
\else
  \echo DEV-TMC-1 content fixtures missing: teacher
  select 1 / 0;
\endif

insert into public.cw_lecture_track_heads(lecture_id, track, current_release_id)
values (:'source_lecture_id', 'native-16x9', :'source_release_id')
on conflict (lecture_id, track) do update
set current_release_id = excluded.current_release_id;
update public.course_lectures
set current_release_id = null
where id = :'source_lecture_id';
\if :{?source_release_id}
\else
  \echo DEV-TMC-1 content fixtures missing: published curriculum source page
  select 1 / 0;
\endif

do $$
declare
  failures text[] := '{}';
  unique_puzzle jsonb := to_jsonb(string_to_array(
    '5,3,0,0,7,0,0,0,0,6,0,0,1,9,5,0,0,0,0,9,8,0,0,0,0,6,0,8,0,0,0,6,0,0,0,3,4,0,0,8,0,3,0,0,1,7,0,0,0,2,0,0,0,6,0,6,0,0,0,0,2,8,0,0,0,0,4,1,9,0,0,5,0,0,0,0,8,0,0,7,9',
    ','
  )::integer[]);
begin
  if public.teacher_microcourse_sudoku_analysis(unique_puzzle) ->> 'status' <> 'unique' then
    failures := array_append(failures, 'unique Sudoku analysis mismatch');
  end if;
  if public.teacher_microcourse_sudoku_analysis(to_jsonb(array_fill(0, array[81]))) ->> 'status' <> 'multiple' then
    failures := array_append(failures, 'multiple Sudoku analysis mismatch');
  end if;
  if public.teacher_microcourse_sudoku_analysis(
    jsonb_set(unique_puzzle, '{2}', '5'::jsonb)
  ) ->> 'status' <> 'conflict' then
    failures := array_append(failures, 'conflict Sudoku analysis mismatch');
  end if;
  if not has_function_privilege(
    'authenticated',
    'public.create_teacher_microcourse_composition_page(uuid,uuid,text,uuid,uuid,uuid)',
    'EXECUTE'
  ) then failures := array_append(failures, 'composition RPC grant missing'); end if;
  if not exists (
    select 1 from storage.buckets
    where id = 'cw-h5-drafts' and not public and file_size_limit = 5242880
  ) then failures := array_append(failures, 'private H5 bucket mismatch'); end if;
  if cardinality(failures) > 0 then
    raise exception 'DEV_TMC_CONTENT_STRUCTURE_FAILED: %', array_to_string(failures, ', ');
  end if;
end
$$;

insert into public.staff_role_members(user_id, role_id)
select :'other_teacher_id', role_row.id
from public.staff_roles role_row
where role_row.key = 'teacher'
on conflict do nothing;

insert into public.classrooms(id, owner_id, name, invite_code)
values (
  '00000000-0000-4000-8000-000000000911',
  :'teacher_id',
  '__DEV_TMC_CONTENT_CLASS__',
  'TMC911'
);
insert into public.classroom_members(classroom_id, user_id, role)
values (
  '00000000-0000-4000-8000-000000000911',
  :'teacher_id',
  'teacher'
);
insert into public.class_sessions(id, classroom_id, title, scheduled_at, duration_min)
values (
  '00000000-0000-4000-8000-000000000912',
  '00000000-0000-4000-8000-000000000911',
  '__DEV_TMC_CONTENT_SESSION__',
  now() + interval '2 days',
  60
);

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.set_feature_flag(
  'teaching.teacher_microcourses_v1', null, true, now(), 'content assertion enable'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.create_teacher_microcourse(
  '00000000-0000-4000-8000-000000000912',
  '内容合同微课',
  '验证三种页面',
  3::smallint,
  null::smallint,
  '',
  'logic-strategy',
  array['快照', '数独', 'H5']
) as microcourse_id \gset

select exists (
  select 1
  from public.search_teacher_microcourse_source_pages(
    '', null, null, :'source_lecture_id', 100
  ) source_row
  where source_row.release_id = :'source_release_id'
    and source_row.revision_id = :'source_revision_id'
) as track_head_source_visible \gset
\if :track_head_source_visible
\else
  \echo DEV-TMC-1 failed: native track-head source release is not discoverable
  select 1 / 0;
\endif

select public.create_teacher_microcourse_composition_page(
  :'microcourse_id', null, '空白图文页', null, null, null
) as blank_page_id \gset
select public.create_teacher_microcourse_composition_page(
  :'microcourse_id', :'blank_page_id', '来源快照页',
  :'source_release_id', :'source_page_id', :'source_revision_id'
) as source_copy_page_id \gset
select public.create_teacher_microcourse_sudoku_page(
  :'microcourse_id', :'source_copy_page_id', '唯一解数独',
  string_to_array(
    '5,3,0,0,7,0,0,0,0,6,0,0,1,9,5,0,0,0,0,9,8,0,0,0,0,6,0,8,0,0,0,6,0,0,0,3,4,0,0,8,0,3,0,0,1,7,0,0,0,2,0,0,0,6,0,6,0,0,0,0,2,8,0,0,0,0,4,1,9,0,0,5,0,0,0,0,8,0,0,7,9',
    ','
  )::integer[],
  jsonb_build_object(
    'showCoordinates', true,
    'allowCandidates', true,
    'allowAnswerReveal', false,
    'showTeachingTools', true
  )
) as sudoku_page_id \gset
select public.register_teacher_microcourse_h5_artifact(
  :'microcourse_id', repeat('b', 64), 42,
  :'teacher_id' || '/' || :'microcourse_id' || '/' || repeat('b', 64) || '/index.html'
) as h5_artifact_id \gset
select public.create_teacher_microcourse_h5_page(
  :'microcourse_id', :'h5_artifact_id', :'sudoku_page_id', '离线 H5'
) as h5_page_id \gset
select public.register_teacher_microcourse_image(
  :'microcourse_id', :'blank_page_id', repeat('c', 64), 'image/png',
  68, 1, 1, 'dot.png', 'image'
) as image_registration \gset
select public.freeze_teacher_microcourse_source_session(:'microcourse_id');
select (
  count(*) = 1
  and max(object_hash) = repeat('c', 64)
) as frozen_asset_preload_ok
from public.list_session_resolved_assets('00000000-0000-4000-8000-000000000912') \gset
reset role;

\if :frozen_asset_preload_ok
\else
  \echo DEV-TMC-1 failed: frozen microcourse asset preload
  select 1 / 0;
\endif

select lecture_id as lecture_id from public.teacher_microcourses
where id = :'microcourse_id' \gset
select object_id as private_object_id from public.teacher_microcourse_assets
where microcourse_id = :'microcourse_id' \gset

select (
  (select count(*) = 4 from public.cw_page_docs
   where lecture_id = :'lecture_id' and deleted_at is null
     and doc_version = 'microcourse-page-v1' and aspect = '4:3')
  and (select count(*) = 4 from public.cw_page_revisions revision_row
       join public.cw_page_docs page_row on page_row.id = revision_row.page_doc_id
       where page_row.lecture_id = :'lecture_id'
         and revision_row.layout_profile = 'microcourse-4x3')
  and (select count(*) = 1 from public.teacher_microcourse_page_sources
       where target_page_doc_id = :'source_copy_page_id'
         and source_release_id = :'source_release_id'
         and source_revision_id = :'source_revision_id')
  and (select doc #>> '{analysis,status}' = 'unique'
       from public.cw_page_revisions revision_row
       join public.cw_page_docs page_row on page_row.draft_revision_id = revision_row.id
       where page_row.id = :'sudoku_page_id')
) as authored_content_ok \gset
\if :authored_content_ok
\else
  \echo DEV-TMC-1 failed: authored page contracts
  select 1 / 0;
\endif

-- Source provenance and H5 bytes are immutable even for the owning author.
select set_config('dev_tmc.source_copy_page', :'source_copy_page_id', true);
select set_config('dev_tmc.h5_artifact', :'h5_artifact_id', true);
select set_config('dev_tmc.teacher_id', :'teacher_id', true);
do $$
declare base_doc jsonb; base_no integer;
begin
  select revision_row.doc, revision_row.revision_no into base_doc, base_no
  from public.cw_page_docs page_row
  join public.cw_page_revisions revision_row on revision_row.id = page_row.draft_revision_id
  where page_row.id = current_setting('dev_tmc.source_copy_page')::uuid;
  perform set_config('request.jwt.claim.sub', current_setting('dev_tmc.teacher_id', true), true);
  begin
    perform public.save_teacher_microcourse_page(
      current_setting('dev_tmc.source_copy_page')::uuid,
      jsonb_set(base_doc, '{source,sourceTitle}', '"mutated"'::jsonb),
      base_no, '来源快照页', ''
    );
    raise exception 'SOURCE_PROVENANCE_MUTATION_ACCEPTED';
  exception when others then
    if sqlerrm <> 'SOURCE_PROVENANCE_IMMUTABLE' then raise; end if;
  end;
  begin
    update public.teacher_microcourse_h5_artifacts set sha256 = repeat('d', 64)
    where id = current_setting('dev_tmc.h5_artifact')::uuid;
    raise exception 'H5_HASH_MUTATION_ACCEPTED';
  exception when others then
    if sqlerrm <> 'MICROCOURSE_CONTENT_IDENTITY_IMMUTABLE' then raise; end if;
  end;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'other_teacher_id', true);
select (
  (select count(*) from public.cw_page_docs where lecture_id = :'lecture_id') = 0
  and (select count(*) from public.cw_page_revisions revision_row
       join public.cw_page_docs page_row on page_row.id = revision_row.page_doc_id
       where page_row.lecture_id = :'lecture_id') = 0
  and (select count(*) from public.cw_asset_objects where id = :'private_object_id') = 0
  and (select count(*) from public.teacher_microcourse_h5_artifacts
       where id = :'h5_artifact_id') = 0
) as other_teacher_isolated \gset
reset role;
\if :other_teacher_isolated
\else
  \echo DEV-TMC-1 failed: draft page/asset isolation
  select 1 / 0;
\endif

rollback;
