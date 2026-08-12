\set ON_ERROR_STOP on
-- SML-0：spatial-page-v1 的 4:3-first 双 head、paired review/release 与成组回退。全程回滚。
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
\if :{?admin_id}
\else
  \echo SML-0 spatial delivery fixtures missing: 测试-管理员
  select 1 / 0;
\endif

insert into public.courses(
  title, product_code, grade, term, class_type, status, created_by
) values (
  '__SML0_SPATIAL_DELIVERY__',
  '__SML0_SPATIAL_DELIVERY__' || replace(gen_random_uuid()::text, '-', ''),
  1, 1, 'audit', 'enabled', :'admin_id'
)
returning id as course_id \gset

insert into public.course_lectures(course_id, no, name, status)
values (:'course_id', 1, '__SML0_SPATIAL_DELIVERY_LECTURE__', 'active')
returning id as lecture_id \gset

insert into public.course_staff_assignments(
  user_id, scope_type, course_id, responsibility, created_by
) values
  (:'admin_id', 'variant', :'course_id', 'editor', :'admin_id'),
  (:'admin_id', 'variant', :'course_id', 'reviewer', :'admin_id');

create temporary table sml0_spatial_docs(
  name text primary key,
  doc jsonb not null
) on commit drop;

insert into sml0_spatial_docs(name, doc)
values ('standard-1', jsonb_build_object(
  'docVersion', 'spatial-page-v1',
  'layout', jsonb_build_object('profile', 'standard-4x3'),
  'sceneHash', repeat('a', 64),
  'scene', jsonb_build_object('contract', 'sml0-db-assertion'),
  'source', jsonb_build_object('kind', 'scratch'),
  'presentation', jsonb_build_object(
    'viewport', jsonb_build_object('width', 1200, 'height', 900)
  ),
  'classroom', jsonb_build_object('ownership', 'teacher-follow'),
  'learningCheck', jsonb_build_object('mode', 'disabled'),
  'fallback', jsonb_build_object('strategy', 'scene-accessibility-v1')
));

insert into sml0_spatial_docs(name, doc)
select 'standard-2', jsonb_set(doc, '{sceneHash}', to_jsonb(repeat('b', 64)))
from sml0_spatial_docs where name = 'standard-1';

insert into sml0_spatial_docs(name, doc)
select 'standard-3', jsonb_set(doc, '{sceneHash}', to_jsonb(repeat('c', 64)))
from sml0_spatial_docs where name = 'standard-1';

insert into sml0_spatial_docs(name, doc)
select 'wide-2',
  jsonb_set(
    jsonb_set(
      doc,
      '{layout}',
      jsonb_build_object(
        'profile', 'wide-16x9-exception',
        'reason', jsonb_build_object('zh', '宽屏特例', 'en', 'Wide exception')
      )
    ),
    '{presentation,viewport}',
    jsonb_build_object('width', 1600, 'height', 900)
  )
from sml0_spatial_docs where name = 'standard-2';

grant select on sml0_spatial_docs to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.create_cw_spatial_page(
  :'lecture_id', null, '空间 4:3 页面',
  (select doc from sml0_spatial_docs where name = 'standard-1')
) as page_id \gset
reset role;

select (
  (select doc_version = 'spatial-page-v1' and aspect = '4:3'
   from public.cw_page_docs where id = :'page_id')
  and (select count(*) = 2 from public.cw_page_track_heads where page_doc_id = :'page_id')
  and (select count(distinct draft_revision_id) = 1
       from public.cw_page_track_heads where page_doc_id = :'page_id')
  and (select bool_and(draft_layout_profile = 'standard-4x3')
       from public.cw_page_track_heads where page_doc_id = :'page_id')
) as create_shared_head_ok \gset
\if :create_shared_head_ok
\else
  \echo SML-0 spatial delivery failed: create did not establish one 4:3 revision for both heads
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select * from public.save_cw_track_page_draft(
  :'page_id', 'native-16x9',
  (select doc from sml0_spatial_docs where name = 'standard-2'),
  1, 'shared standard save'
) \gset shared_
reset role;

select (
  :'shared_revision_no'::integer = 2
  and (select count(*) = 2
       from public.cw_page_track_heads
       where page_doc_id = :'page_id'
         and draft_revision_id = :'shared_revision_id')
  and (select track = 'adapted-4x3'
              and doc_version = 'spatial-page-v1'
              and layout_profile = 'standard-4x3'
       from public.cw_page_revisions where id = :'shared_revision_id')
) as shared_save_ok \gset
\if :shared_save_ok
\else
  \echo SML-0 spatial delivery failed: standard save forked the compatibility heads
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select * from public.save_cw_track_page_draft(
  :'page_id', 'native-16x9',
  (select doc from sml0_spatial_docs where name = 'wide-2'),
  2, 'explicit wide exception'
) \gset wide_
reset role;

select (
  :'wide_revision_no'::integer = 3
  and (select draft_revision_id = :'wide_revision_id'
              and draft_layout_profile = 'wide-16x9-exception'
       from public.cw_page_track_heads
       where page_doc_id = :'page_id' and track = 'native-16x9')
  and (select draft_revision_id = :'shared_revision_id'
              and draft_layout_profile = 'standard-4x3'
       from public.cw_page_track_heads
       where page_doc_id = :'page_id' and track = 'adapted-4x3')
  and public.cw_paired_delivery_is_ready(:'lecture_id')
  and public.cw_paired_delivery_mode(:'lecture_id') = 'wide-16x9-exception'
) as wide_exception_ok \gset
\if :wide_exception_ok
\else
  \echo SML-0 spatial delivery failed: explicit wide exception mapping is invalid
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.copy_cw_page(
  :'page_id', :'lecture_id', :'page_id', 'Copied spatial layout set'
) as copied_page_id \gset
reset role;

select (
  (select count(*) = 2 from public.cw_page_revisions where page_doc_id = :'copied_page_id')
  and (select draft_layout_profile = 'wide-16x9-exception'
       from public.cw_page_track_heads
       where page_doc_id = :'copied_page_id' and track = 'native-16x9')
  and (select draft_layout_profile = 'standard-4x3'
       from public.cw_page_track_heads
       where page_doc_id = :'copied_page_id' and track = 'adapted-4x3')
) as copied_layout_set_ok \gset
\if :copied_layout_set_ok
\else
  \echo SML-0 spatial delivery failed: copy did not preserve the standard and wide layout set
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.soft_delete_cw_page(:'copied_page_id');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select * from public.revert_cw_track_page_revision(
  :'page_id', 'native-16x9', :'shared_revision_id', 3, 'return to shared 4:3'
) \gset reverted_
reset role;

select (
  :'reverted_revision_no'::integer = 4
  and (select count(*) = 2
       from public.cw_page_track_heads
       where page_doc_id = :'page_id'
         and draft_revision_id = :'reverted_revision_id')
  and public.cw_paired_delivery_mode(:'lecture_id') = 'shared-standard-4x3'
) as shared_revert_ok \gset
\if :shared_revert_ok
\else
  \echo SML-0 spatial delivery failed: reverting a standard revision did not restore shared heads
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.publish_cw_track_release(
  :'lecture_id', 'native-16x9', 'paired direct publish'
) as direct_native_release \gset
reset role;

select delivery_group_id as direct_group_id
from public.cw_lecture_releases where id = :'direct_native_release' \gset
select id as direct_adapted_release
from public.cw_lecture_releases
where delivery_group_id = :'direct_group_id' and track = 'adapted-4x3' \gset

select (
  (select count(*) = 2 from public.cw_lecture_releases
   where delivery_group_id = :'direct_group_id')
  and (select bool_and(delivery_mode = 'shared-standard-4x3')
       from public.cw_lecture_releases where delivery_group_id = :'direct_group_id')
  and (select (snapshot -> 0 ->> 'revisionId') = :'reverted_revision_id'
       from public.cw_lecture_releases where id = :'direct_native_release')
  and (select (snapshot -> 0 ->> 'revisionId') = :'reverted_revision_id'
       from public.cw_lecture_releases where id = :'direct_adapted_release')
  and (select current_revision_id = :'reverted_revision_id'
              and aspect = '4:3'
       from public.cw_page_docs where id = :'page_id')
) as paired_direct_publish_ok \gset
\if :paired_direct_publish_ok
\else
  \echo SML-0 spatial delivery failed: direct publish did not atomically create two releases
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select * from public.save_cw_track_page_draft(
  :'page_id', 'adapted-4x3',
  (select doc from sml0_spatial_docs where name = 'standard-3'),
  4, 'reviewed shared save'
) \gset reviewed_
select public.submit_cw_review(
  :'lecture_id', 'adapted-4x3', 'paired review'
) as review_cycle_id \gset
reset role;

select (
  (select delivery_mode = 'shared-standard-4x3'
              and content_snapshot ->> 'deliveryVersion' = 'cw-paired-delivery-v1'
       from public.cw_review_cycles where id = :'review_cycle_id')
  and (select count(*) = 2
       from public.cw_lecture_workflows
       where lecture_id = :'lecture_id'
         and active_review_cycle_id = :'review_cycle_id'
         and stage = 'in_review')
) as paired_submit_ok \gset
\if :paired_submit_ok
\else
  \echo SML-0 spatial delivery failed: one submission did not synchronize both workflows
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.approve_cw_review(:'review_cycle_id', 'approved', null) as passed_cycle_id \gset
select public.publish_cw_review_cycle(
  :'lecture_id', 'native-16x9', 'paired reviewed publish'
) as reviewed_native_release \gset
reset role;

select delivery_group_id as reviewed_group_id
from public.cw_lecture_releases where id = :'reviewed_native_release' \gset
select id as reviewed_adapted_release
from public.cw_lecture_releases
where delivery_group_id = :'reviewed_group_id' and track = 'adapted-4x3' \gset

select (
  :'passed_cycle_id' = :'review_cycle_id'
  and (select count(*) = 2 from public.cw_lecture_releases
       where delivery_group_id = :'reviewed_group_id')
  and (select published_release_ids ->> 'native-16x9' = :'reviewed_native_release'
              and published_release_ids ->> 'adapted-4x3' = :'reviewed_adapted_release'
       from public.cw_review_cycles where id = :'review_cycle_id')
  and (select count(*) = 2 from public.cw_lecture_workflows
       where lecture_id = :'lecture_id' and stage = 'idle'
         and active_review_cycle_id is null)
) as paired_review_publish_ok \gset
\if :paired_review_publish_ok
\else
  \echo SML-0 spatial delivery failed: one approved cycle did not publish and close both tracks
  select 1 / 0;
\endif

insert into public.classrooms(
  owner_id, name, invite_code, course_id, courseware_track
) values (
  :'admin_id', '__SML0_SPATIAL_DELIVERY_CLASS__',
  substr(md5(gen_random_uuid()::text), 1, 8), :'course_id', 'adapted-4x3'
)
returning id as classroom_id \gset
insert into public.classroom_members(classroom_id, user_id, role)
values (:'classroom_id', :'admin_id', 'teacher')
on conflict do nothing;
insert into public.class_sessions(classroom_id, lecture_id, title)
values (:'classroom_id', :'lecture_id', '__SML0_SPATIAL_DELIVERY_SESSION__')
returning id as session_id \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.freeze_session_courseware(
  :'session_id',
  (select courseware_pages from public.cw_lecture_releases where id = :'reviewed_adapted_release'),
  jsonb_build_object(
    'version', 'cw-session-resolved-v1',
    'track', 'adapted-4x3',
    'releaseId', :'reviewed_adapted_release',
    'bindings', '[]'::jsonb
  )
);
select (
  count(*) = 1
  and bool_and(page_doc_id = :'page_id'::uuid)
  and bool_and(doc ->> 'docVersion' = 'spatial-page-v1')
  and bool_and(doc ->> 'sceneHash' = repeat('c', 64))
) as frozen_spatial_page_ok
from public.get_session_page_docs(:'session_id') \gset
reset role;
\if :frozen_spatial_page_ok
\else
  \echo SML-0 spatial delivery failed: selected paired release did not freeze the spatial page
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.rollback_cw_track_release(
  :'lecture_id', 'adapted-4x3', :'reviewed_adapted_release', 'paired rollback'
) as rollback_adapted_release \gset
reset role;

select delivery_group_id as rollback_group_id
from public.cw_lecture_releases where id = :'rollback_adapted_release' \gset
select (
  (select count(*) = 2 from public.cw_lecture_releases
   where delivery_group_id = :'rollback_group_id')
  and (select count(distinct current_revision_id) = 1
       from public.cw_page_track_heads where page_doc_id = :'page_id')
  and (select bool_and(current_revision_id = :'reviewed_revision_id')
       from public.cw_page_track_heads where page_doc_id = :'page_id')
) as paired_rollback_ok \gset
\if :paired_rollback_ok
\else
  \echo SML-0 spatial delivery failed: rollback did not restore the paired revision group
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select (
  count(*) = 1
  and bool_and(doc ->> 'sceneHash' = repeat('c', 64))
) as frozen_reconnect_ok
from public.get_session_page_docs(:'session_id') \gset
reset role;
\if :frozen_reconnect_ok
\else
  \echo SML-0 spatial delivery failed: later rollback changed the frozen session replay
  select 1 / 0;
\endif

select (
  not has_function_privilege('authenticated', 'public.cw_spatial_page_doc_is_valid(jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.perform_cw_paired_publish(uuid,text,jsonb,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.create_cw_spatial_page(uuid,uuid,text,jsonb)', 'EXECUTE')
) as helper_grants_ok \gset
\if :helper_grants_ok
\else
  \echo SML-0 spatial delivery failed: helper/public RPC grants drifted
  select 1 / 0;
\endif

rollback;
\echo SML-0 spatial delivery lifecycle assertions passed
