\set ON_ERROR_STOP on
-- P6-2：在隔离测试库执行；全程回滚，不污染固定 CI / 开发夹具。
begin;

select id as admin_id from public.profiles where display_name='测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name='测试-教师' limit 1 \gset
select id as student_user_id from public.profiles where display_name='测试-学生' limit 1 \gset
select id as member_session_id from public.class_sessions cs
 join public.classroom_members cm on cm.classroom_id=cs.classroom_id
 where cm.user_id=:'student_user_id' and cm.role='student' and cs.deleted_at is null limit 1 \gset
\if :{?admin_id}
\else
  \echo P6 fixtures missing: 测试-管理员
  \quit 1
\endif
\if :{?member_session_id}
\else
  \echo P6 fixtures missing: 测试-学生 has no classroom session
  \quit 1
\endif

-- 事务内补一个 parent 身份，确保 student / parent 都无法直读新表。
insert into auth.users (id, email, raw_user_meta_data)
values ('00000000-0000-4000-8000-000000000005', 'ci-p6-parent@mathin.local', jsonb_build_object('display_name', '测试-P6家长'))
on conflict (id) do nothing;
update public.profiles set role='parent' where id='00000000-0000-4000-8000-000000000005';
select id as parent_id from public.profiles where id='00000000-0000-4000-8000-000000000005' \gset

-- 构造一讲带资源 binding 的最小发布基线，以及成员课次的冻结对象清单。
insert into public.courses (title, product_code, grade, term, class_type, created_by)
values ('__P6_AUDIT_COURSE__', '__P6_AUDIT__' || replace(gen_random_uuid()::text, '-', ''), 1, 1, 'audit', :'admin_id')
returning id as course_id \gset
insert into public.course_lectures (course_id, no, name)
values (:'course_id', 1, '__P6_AUDIT_LECTURE__')
returning id as lecture_id \gset
select cm.classroom_id as member_classroom_id from public.classroom_members cm
 where cm.user_id=:'student_user_id' and cm.role='student' limit 1 \gset
insert into public.class_sessions (classroom_id, title)
values (:'member_classroom_id', '__P6_AUDIT_SESSION__')
returning id as p6_session_id \gset

select repeat('a', 64) as asset_hash \gset
insert into public.cw_asset_objects (sha256, mime, byte_count, kind, storage_path)
values (:'asset_hash', 'image/png', 1, 'image', 'sha256/aa/' || :'asset_hash')
returning id as object_id \gset
insert into storage.objects (bucket_id, name, owner_id)
values ('cw-objects', 'sha256/aa/' || :'asset_hash', :'admin_id'::text);
insert into public.cw_shared_assets (name, kind, role, candidate_key, created_by)
values ('__P6_AUDIT_ASSET__', 'image', 'source', :'asset_hash', :'admin_id')
returning id as shared_asset_id \gset
insert into public.cw_asset_revisions (shared_asset_id, revision_no, object_id, created_by)
values (:'shared_asset_id', 1, :'object_id', :'admin_id')
returning id as asset_revision_id \gset
update public.cw_shared_assets set published_revision_id=:'asset_revision_id' where id=:'shared_asset_id';

-- 同一 H5 包可经 query 打开不同关卡；P6-1 导出合同要求把这一页级语义带进 binding/release。
select repeat('c', 64) as h5_asset_hash \gset
insert into public.cw_asset_objects (sha256, mime, byte_count, kind, storage_path)
values (:'h5_asset_hash', 'application/x-mathin-h5-package', 1, 'h5', 'packages/' || :'h5_asset_hash')
returning id as h5_object_id \gset
insert into public.cw_shared_assets (name, kind, role, candidate_key, created_by)
values ('__P6_AUDIT_H5__', 'h5', 'interactive', :'h5_asset_hash', :'admin_id')
returning id as h5_shared_asset_id \gset
insert into public.cw_asset_revisions (shared_asset_id, revision_no, object_id, created_by)
values (:'h5_shared_asset_id', 1, :'h5_object_id', :'admin_id')
returning id as h5_asset_revision_id \gset
update public.cw_shared_assets set published_revision_id=:'h5_asset_revision_id' where id=:'h5_shared_asset_id';

insert into public.cw_page_docs (lecture_id, page_no, title, source_courseware_id, source_page_id)
values (:'lecture_id', 1, '__P6_AUDIT_PAGE__', 'audit-courseware', 'audit-page')
returning id as page_doc_id \gset
insert into public.cw_page_revisions (page_doc_id, revision_no, doc, origin, created_by)
values (
  :'page_doc_id', 1,
  jsonb_build_object(
    'docVersion', 'page-doc-v1',
    'sourceCoursewareId', 'audit-courseware',
    'sourcePageId', 'audit-page',
    'sourcePageDatabaseId', 1,
    'sourceSnapshotId', 1,
    'sourceContentHash', repeat('b', 64),
    'canvas', jsonb_build_object('width', 1280, 'height', 720, 'backgroundColor', null, 'backgroundBindingKey', null),
    'nodes', '[]'::jsonb,
    'interactions', '[]'::jsonb
  ),
  'import', :'admin_id'
)
returning id as page_revision_id \gset
update public.cw_page_docs set current_revision_id=:'page_revision_id' where id=:'page_doc_id';
insert into public.cw_page_asset_bindings (page_doc_id, binding_key, role, kind, shared_asset_id)
values (:'page_doc_id', :'asset_hash', 'source', 'image', :'shared_asset_id');
insert into public.cw_page_asset_bindings (
  page_doc_id, binding_key, role, kind, shared_asset_id, launch_query
) values (
  :'page_doc_id', :'h5_asset_hash', 'interactive', 'h5', :'h5_shared_asset_id',
  jsonb_build_object(
    'query', jsonb_build_object('level', jsonb_build_array('3')),
    'coursewareIdParam', 'lesson'
  )
);
update public.class_sessions
   set courseware_resolved=jsonb_build_object(
     'version', 'cw-session-resolved-v1',
     'releaseId', null,
     'bindings', jsonb_build_array(jsonb_build_object(
       'pageDocId', :'page_doc_id',
       'revisionId', :'page_revision_id',
       'bindingKey', :'asset_hash',
       'assetRevisionId', :'asset_revision_id',
       'objectHash', :'asset_hash'
     ))
   )
 where id=:'p6_session_id';
select set_config('p6.member_session_id', :'p6_session_id', true);

-- 新表绝不可保留 authenticated 的直接写权限。
do $$
declare failure text;
begin
  foreach failure in array array[
    'cw_asset_objects', 'cw_shared_assets', 'cw_asset_revisions', 'cw_page_docs',
    'cw_page_revisions', 'cw_page_asset_bindings', 'cw_lecture_releases'
  ] loop
    if has_table_privilege('authenticated', 'public.' || failure, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || failure, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || failure, 'DELETE') then
      raise exception 'P6_DIRECT_WRITE_GRANTED: %', failure;
    end if;
  end loop;
end $$;

-- 学生不能直读任何课件资产元数据，也不能窥探 cw-objects bucket。
set local role authenticated;
select set_config('request.jwt.claim.sub', :'student_user_id', true);
do $$
declare table_name text; visible_count int;
begin
  foreach table_name in array array[
    'cw_asset_objects', 'cw_shared_assets', 'cw_asset_revisions', 'cw_page_docs',
    'cw_page_revisions', 'cw_page_asset_bindings', 'cw_lecture_releases'
  ] loop
    execute format('select count(*) from public.%I', table_name) into visible_count;
    if visible_count <> 0 then raise exception 'P6_STUDENT_DIRECT_READ: %', table_name; end if;
  end loop;
end $$;
select (count(*)=0) as p6_student_storage_denied
  from storage.objects where bucket_id='cw-objects' and name='sha256/aa/' || :'asset_hash' \gset
\if :p6_student_storage_denied
\else
  \echo P6 security failed: student read cw-objects metadata
  \quit 1
\endif

-- 同一个学生作为课堂成员，可以只取本课冻结清单中的对象元数据；签名由 Server Action 完成。
select (count(*)=1) as p6_member_resolved_scope_ok
  from public.list_session_resolved_assets(current_setting('p6.member_session_id')::uuid)
 where object_hash=:'asset_hash' and storage_path='sha256/aa/' || :'asset_hash' \gset
\if :p6_member_resolved_scope_ok
\else
  \echo P6 security failed: classroom member could not resolve frozen asset
  \quit 1
\endif

-- 家长既不能直读，也不能借 RPC 猜另一堂课的冻结对象。
select set_config('request.jwt.claim.sub', :'parent_id', true);
do $$
declare table_name text; visible_count int;
begin
  foreach table_name in array array[
    'cw_asset_objects', 'cw_shared_assets', 'cw_asset_revisions', 'cw_page_docs',
    'cw_page_revisions', 'cw_page_asset_bindings', 'cw_lecture_releases'
  ] loop
    execute format('select count(*) from public.%I', table_name) into visible_count;
    if visible_count <> 0 then raise exception 'P6_PARENT_DIRECT_READ: %', table_name; end if;
  end loop;
  begin
    perform * from public.list_session_resolved_assets(current_setting('p6.member_session_id')::uuid);
    raise exception 'P6_NON_MEMBER_RESOLVED_ASSET_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'FORBIDDEN' then raise; end if;
  end;
end $$;
select (count(*)=0) as p6_parent_storage_denied
  from storage.objects where bucket_id='cw-objects' and name='sha256/aa/' || :'asset_hash' \gset
\if :p6_parent_storage_denied
\else
  \echo P6 security failed: parent read cw-objects metadata
  \quit 1
\endif

-- 开课冻结必须以同一受控事务写入页面数组、resolved 清单和开始时间。
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.freeze_session_courseware(
  current_setting('p6.member_session_id')::uuid,
  '[]'::jsonb,
  (select courseware_resolved from public.class_sessions where id=current_setting('p6.member_session_id')::uuid)
);
select (
  courseware_frozen_at is not null
  and started_at is not null
  and courseware='[]'::jsonb
  and courseware_resolved ->> 'version'='cw-session-resolved-v1'
) as p6_freeze_transaction_ok
from public.class_sessions where id=current_setting('p6.member_session_id')::uuid \gset
\if :p6_freeze_transaction_ok
\else
  \echo P6 security failed: freeze transaction did not materialize all fields
  \quit 1
\endif

-- 管理员可存草稿并发布；release 固定 page revision 与 binding 的 asset revision。
select set_config('request.jwt.claim.sub', :'admin_id', true);
select revision_id as draft_revision_id, revision_no as draft_revision_no
  from public.save_page_draft(
    :'page_doc_id',
    (select doc from public.cw_page_revisions where id=:'page_revision_id'),
    1,
    'P6 audit draft'
  ) \gset
select public.publish_lecture_release(:'lecture_id', 'P6 audit release') as release_id \gset
select (current_release_id=:'release_id'::uuid) as p6_release_current_ok
  from public.course_lectures where id=:'lecture_id' \gset
\if :p6_release_current_ok
\else
  \echo P6 security failed: release not current
  \quit 1
\endif
select (
  current_revision_id=:'draft_revision_id'::uuid
  and draft_revision_id is null
) as p6_release_revision_pin_ok
from public.cw_page_docs where id=:'page_doc_id' \gset
\if :p6_release_revision_pin_ok
\else
  \echo P6 security failed: page revision was not pinned by release
  \quit 1
\endif
select (
  snapshot @> jsonb_build_array(jsonb_build_object(
    'pageDocId', :'page_doc_id',
    'bindings', jsonb_build_array(jsonb_build_object(
      'bindingKey', :'h5_asset_hash',
      'assetRevisionId', :'h5_asset_revision_id',
      'launchQuery', jsonb_build_object(
        'query', jsonb_build_object('level', jsonb_build_array('3')),
        'coursewareIdParam', 'lesson'
      )
    ))
  ))
) as p6_release_h5_launch_query_pin_ok
from public.cw_lecture_releases where id=:'release_id' \gset
\if :p6_release_h5_launch_query_pin_ok
\else
  \echo P6 security failed: release did not pin H5 launch query
  \quit 1
\endif

rollback;
\echo P6 courseware database security assertions passed
