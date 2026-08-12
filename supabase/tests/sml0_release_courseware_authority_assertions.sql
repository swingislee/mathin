\set ON_ERROR_STOP on
-- SML-0：release 页面投影、legacy 兼容投影、session track 选择与 freeze 权威。全程回滚。
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
\if :{?admin_id}
\else
  \echo SML-0 release authority fixtures missing: 测试-管理员
  select 1 / 0;
\endif
\if :{?teacher_id}
\else
  \echo SML-0 release authority fixtures missing: 测试-教师
  select 1 / 0;
\endif

insert into public.courses(title, product_code, grade, term, class_type, status, created_by)
values (
  '__SML0_AUTHORITY__',
  '__SML0_AUTHORITY__' || replace(gen_random_uuid()::text, '-', ''),
  1, 1, 'audit', 'enabled', :'admin_id'
)
returning id as course_id \gset

insert into public.course_lectures(
  course_id, no, name, status, courseware_template
) values (
  :'course_id', 1, '__SML0_AUTHORITY_LECTURE__', 'active',
  jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid(), 'type', 'board', 'title', 'stale legacy template'
  ))
)
returning id as lecture_id \gset

insert into public.course_staff_assignments(
  user_id, scope_type, course_id, responsibility, created_by
) values (
  :'admin_id', 'variant', :'course_id', 'editor', :'admin_id'
);

insert into public.cw_page_docs(
  lecture_id, page_no, title, source_courseware_id, source_page_id, adapt_class
) values
  (:'lecture_id', 1, 'Native page one', 'sml0-authority', 'page-1', 'A'),
  (:'lecture_id', 2, 'Native page two', 'sml0-authority', 'page-2', 'A');

select id as page_1 from public.cw_page_docs
where lecture_id = :'lecture_id' and source_page_id = 'page-1' \gset
select id as page_2 from public.cw_page_docs
where lecture_id = :'lecture_id' and source_page_id = 'page-2' \gset

create temporary table sml0_authority_revisions(
  page_id uuid primary key,
  native_revision_id uuid not null,
  adapted_revision_id uuid not null
) on commit drop;

with pages as (
  select :'page_1'::uuid id, 1 no
  union all
  select :'page_2'::uuid, 2
), native as (
  insert into public.cw_page_revisions(
    page_doc_id, revision_no, doc, origin, track, created_by
  )
  select id, 1, jsonb_build_object(
    'docVersion', 'page-doc-v1',
    'sourceCoursewareId', 'sml0-authority',
    'sourcePageId', 'page-' || no,
    'sourcePageDatabaseId', no,
    'sourceSnapshotId', 1,
    'sourceContentHash', repeat('a', 64),
    'canvas', jsonb_build_object(
      'width', 1280, 'height', 720,
      'backgroundColor', null, 'backgroundBindingKey', null
    ),
    'nodes', '[]'::jsonb,
    'interactions', '[]'::jsonb
  ), 'import', 'native-16x9', :'admin_id'
  from pages
  returning page_doc_id, id
), adapted as (
  insert into public.cw_page_revisions(
    page_doc_id, revision_no, doc, origin, track, created_by
  )
  select id, 2, jsonb_build_object(
    'docVersion', 'page-doc-v1',
    'sourceCoursewareId', 'sml0-authority',
    'sourcePageId', 'page-' || no,
    'sourcePageDatabaseId', no,
    'sourceSnapshotId', 1,
    'sourceContentHash', repeat('b', 64),
    'canvas', jsonb_build_object(
      'width', 960, 'height', 720,
      'backgroundColor', null, 'backgroundBindingKey', null
    ),
    'nodes', '[]'::jsonb,
    'interactions', '[]'::jsonb
  ), 'adapt-4x3', 'adapted-4x3', :'admin_id'
  from pages
  returning page_doc_id, id
)
insert into sml0_authority_revisions
select native.page_doc_id, native.id, adapted.id
from native join adapted using(page_doc_id);

update public.cw_page_docs page
set current_revision_id = revision.native_revision_id
from sml0_authority_revisions revision
where revision.page_id = page.id;

insert into public.cw_page_track_heads(page_doc_id, track, current_revision_id)
select page_id, 'native-16x9', native_revision_id from sml0_authority_revisions
union all
select page_id, 'adapted-4x3', adapted_revision_id from sml0_authority_revisions
on conflict(page_doc_id, track) do update
set current_revision_id = excluded.current_revision_id,
    draft_revision_id = null,
    updated_at = now();

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.publish_cw_track_release(
  :'lecture_id', 'native-16x9', 'authority native one'
) as native_release_1 \gset
reset role;

select (
  (select courseware_pages -> 0 ->> 'docId' = :'page_1'
     and courseware_pages -> 1 ->> 'docId' = :'page_2'
   from public.cw_lecture_releases where id = :'native_release_1')
  and (select courseware_template -> 0 ->> 'docId' = :'page_1'
       and courseware_template -> 1 ->> 'docId' = :'page_2'
       from public.course_lectures where id = :'lecture_id')
) as native_projection_ok \gset
\if :native_projection_ok
\else
  \echo SML-0 release authority failed: native publish did not rebuild legacy projection
  select 1 / 0;
\endif

set constraints cw_page_docs_lecture_id_page_no_key deferred;
update public.cw_page_docs set page_no = page_no + 100 where lecture_id = :'lecture_id';
update public.cw_page_docs
set page_no = case id when :'page_2'::uuid then 1 else 2 end,
    title = case id when :'page_2'::uuid then 'Adapted page two' else 'Adapted page one' end
where lecture_id = :'lecture_id';

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.publish_cw_track_release(
  :'lecture_id', 'adapted-4x3', 'authority adapted'
) as adapted_release \gset
select public.publish_cw_track_release(
  :'lecture_id', 'native-16x9', 'authority native two'
) as native_release_2 \gset
select public.rollback_cw_track_release(
  :'lecture_id', 'native-16x9', :'native_release_1', 'authority rollback'
) as native_rollback_release \gset
reset role;

select (
  (select courseware_pages -> 0 ->> 'docId' = :'page_2'
     and courseware_pages -> 1 ->> 'docId' = :'page_1'
     and courseware_pages -> 0 ->> 'title' = 'Adapted page two'
   from public.cw_lecture_releases where id = :'adapted_release')
  and (select courseware_pages = (
         select courseware_pages from public.cw_lecture_releases where id = :'native_release_1'
       ) from public.cw_lecture_releases where id = :'native_rollback_release')
  and (select courseware_template = (
         select courseware_pages from public.cw_lecture_releases where id = :'native_release_1'
       ) from public.course_lectures where id = :'lecture_id')
) as release_and_rollback_projection_ok \gset
\if :release_and_rollback_projection_ok
\else
  \echo SML-0 release authority failed: adapted or rollback projection drifted
  select 1 / 0;
\endif

-- 后续标题/页序编辑不能反向改写既有 immutable release。
update public.cw_page_docs
set title = 'Mutable current title', page_no = case id when :'page_1'::uuid then 1 else 2 end
where lecture_id = :'lecture_id';
select (
  courseware_pages -> 0 ->> 'docId' = :'page_2'
  and courseware_pages -> 0 ->> 'title' = 'Adapted page two'
) adapted_release_remained_immutable
from public.cw_lecture_releases where id = :'adapted_release' \gset
\if :adapted_release_remained_immutable
\else
  \echo SML-0 release authority failed: mutable page metadata changed release projection
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select set_config('sml0.authority.lecture_id', :'lecture_id', true);
do $$
begin
  begin
    update public.course_lectures
    set courseware_template = '[]'::jsonb
    where id = current_setting('sml0.authority.lecture_id')::uuid;
    raise exception 'RELEASE_TEMPLATE_MUTATION_ACCEPTED';
  exception when others then
    if SQLERRM <> 'RELEASE_TEMPLATE_PROJECTION_READ_ONLY' then raise; end if;
  end;
end
$$;
reset role;

insert into public.classrooms(
  owner_id, name, invite_code, course_id, courseware_track
) values (
  :'teacher_id', '__SML0_AUTHORITY_CLASS__', substr(md5(gen_random_uuid()::text), 1, 8),
  :'course_id', 'adapted-4x3'
)
returning id as classroom_id \gset
insert into public.classroom_members(classroom_id, user_id, role)
values (:'classroom_id', :'teacher_id', 'teacher')
on conflict do nothing;
insert into public.class_sessions(
  classroom_id, lecture_id, title, courseware_overlay
) values (
  :'classroom_id', :'lecture_id', '__SML0_AUTHORITY_SESSION__',
  jsonb_build_array(
    jsonb_build_object('ref', :'page_1'),
    jsonb_build_object('page', jsonb_build_object(
      'id', gen_random_uuid(), 'type', 'board', 'title', 'Session board'
    ))
  )
)
returning id as session_id \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.get_session_courseware_template(:'session_id') selected_template \gset
reset role;
select public.resolve_cw_courseware_overlay(
  :'selected_template'::jsonb,
  (select courseware_overlay from public.class_sessions where id = :'session_id')
) expected_courseware \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select set_config('sml0.authority.session_id', :'session_id', true);
select set_config('sml0.authority.release_id', :'adapted_release', true);
select set_config('sml0.authority.forged_courseware',
  (select courseware_pages::text from public.cw_lecture_releases where id = :'native_release_1'), true);
do $$
begin
  begin
    perform public.freeze_session_courseware(
      current_setting('sml0.authority.session_id')::uuid,
      current_setting('sml0.authority.forged_courseware')::jsonb,
      jsonb_build_object(
        'version', 'cw-session-resolved-v1',
        'track', 'adapted-4x3',
        'releaseId', current_setting('sml0.authority.release_id'),
        'bindings', '[]'::jsonb
      )
    );
    raise exception 'FORGED_RELEASE_COURSEWARE_ACCEPTED';
  exception when others then
    if SQLERRM <> 'COURSEWARE_RELEASE_PROJECTION_MISMATCH' then raise; end if;
  end;
end
$$;

select public.freeze_session_courseware(
  :'session_id',
  :'expected_courseware'::jsonb,
  jsonb_build_object(
    'version', 'cw-session-resolved-v1',
    'track', 'adapted-4x3',
    'releaseId', :'adapted_release',
    'bindings', '[]'::jsonb
  )
);

select (
  :'selected_template'::jsonb -> 0 ->> 'docId' = :'page_2'
  and :'selected_template'::jsonb -> 1 ->> 'docId' = :'page_1'
  and :'expected_courseware'::jsonb -> 0 ->> 'docId' = :'page_2'
  and :'expected_courseware'::jsonb -> 1 ->> 'docId' = :'page_1'
  and :'expected_courseware'::jsonb -> 2 ->> 'type' = 'board'
  and (select courseware = :'expected_courseware'::jsonb
       and courseware_resolved ->> 'releaseId' = :'adapted_release'
       from public.class_sessions where id = :'session_id')
) selected_release_freeze_ok \gset
\if :selected_release_freeze_ok
\else
  \echo SML-0 release authority failed: selected release or overlay freeze drifted
  select 1 / 0;
\endif

select array_agg(page_doc_id order by page_no) = array[:'page_2'::uuid, :'page_1'::uuid]
  as release_page_doc_order_ok
from public.get_session_page_docs(:'session_id') \gset
\if :release_page_doc_order_ok
\else
  \echo SML-0 release authority failed: page docs ignored release order
  select 1 / 0;
\endif
reset role;

do $$
declare failures text[] := '{}';
begin
  if public.cw_courseware_page_is_valid(jsonb_build_object(
    'id', gen_random_uuid(), 'type', 'doc', 'docId', gen_random_uuid()
  )) is not false then
    failures := array_append(failures, 'missing title page validator did not fail closed');
  end if;
  if public.cw_courseware_page_is_valid(jsonb_build_object(
    'id', gen_random_uuid(), 'type', 'game', 'title', 'broken game'
  )) is not false then
    failures := array_append(failures, 'missing game fields validator did not fail closed');
  end if;
  if not has_function_privilege(
    'authenticated', 'public.get_session_courseware_template(uuid)', 'EXECUTE'
  ) then failures := array_append(failures, 'public template resolver grant missing'); end if;
  if has_function_privilege(
    'authenticated', 'public.cw_session_courseware_template(uuid)', 'EXECUTE'
  ) or has_function_privilege(
    'authenticated', 'public.cw_session_selected_courseware_template(uuid)', 'EXECUTE'
  ) or has_function_privilege(
    'authenticated', 'public.resolve_cw_courseware_overlay(jsonb,jsonb)', 'EXECUTE'
  ) then failures := array_append(failures, 'internal resolver execute grant leaked'); end if;
  if cardinality(failures) > 0 then
    raise exception 'SML0_RELEASE_AUTHORITY_STRUCTURE_FAILED: %', array_to_string(failures, ', ');
  end if;
end
$$;

rollback;
\echo SML-0 release courseware authority assertions passed
