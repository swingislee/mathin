\set ON_ERROR_STOP on
-- P6-7：中台写路径、版本隔离和权限断言。全程回滚，使用固定测试账号。
begin;

select id as admin_id from public.profiles where display_name='测试-管理员' limit 1 \gset
select id as student_id from public.profiles where display_name='测试-学生' limit 1 \gset
\if :{?admin_id}
\else
  \echo P6 studio fixtures missing: 测试-管理员
  \quit 1
\endif

insert into public.courses (title, product_code, grade, term, class_type, created_by)
values ('__P6_STUDIO_AUDIT__', '__P6_STUDIO__' || replace(gen_random_uuid()::text, '-', ''), 1, 1, 'audit', :'admin_id')
returning id as course_id \gset
insert into public.course_lectures (course_id, no, name) values (:'course_id', 1, '__P6_STUDIO_LECTURE__')
returning id as lecture_id \gset

select repeat('a', 64) as binding_key \gset
insert into public.cw_asset_objects (sha256,mime,byte_count,width,height,kind,storage_path)
values (:'binding_key','image/png',1,1,1,'image','sha256/aa/' || :'binding_key')
returning id as source_object_id \gset
insert into public.cw_shared_assets (name,kind,role,candidate_key,created_by)
values ('__P6_STUDIO_SOURCE__','image','source','studio:' || :'binding_key',:'admin_id')
returning id as source_asset_id \gset
insert into public.cw_asset_revisions (shared_asset_id,revision_no,object_id,created_by)
values (:'source_asset_id',1,:'source_object_id',:'admin_id') returning id as source_asset_revision_id \gset
update public.cw_shared_assets set published_revision_id=:'source_asset_revision_id' where id=:'source_asset_id';

insert into public.cw_page_docs (lecture_id,page_no,title,source_courseware_id,source_page_id)
values (:'lecture_id',1,'__P6_STUDIO_PAGE__','audit','page') returning id as page_id \gset
insert into public.cw_page_revisions (page_doc_id,revision_no,doc,origin,created_by)
values (:'page_id',1,jsonb_build_object(
  'docVersion','page-doc-v1','sourceCoursewareId','audit','sourcePageId','page',
  'sourcePageDatabaseId',1,'sourceSnapshotId',1,'sourceContentHash',repeat('b',64),
  'canvas',jsonb_build_object('width',1280,'height',720,'backgroundColor',null,'backgroundBindingKey',null),
  'nodes','[]'::jsonb,'interactions','[]'::jsonb
),'import',:'admin_id') returning id as baseline_revision_id \gset
update public.cw_page_docs set current_revision_id=:'baseline_revision_id' where id=:'page_id';
insert into public.cw_page_asset_bindings(page_doc_id,binding_key,role,kind,shared_asset_id)
values(:'page_id',:'binding_key','source','image',:'source_asset_id');

-- 仅 page.edit 可操作；学生不能借 RPC 新增页面。
set local role authenticated;
select set_config('request.jwt.claim.sub', :'student_id', true);
select set_config('p6_studio.lecture_id', :'lecture_id', true);
do $$ begin
  begin
    perform public.create_blank_cw_page(current_setting('p6_studio.lecture_id')::uuid, null, 'forbidden');
    raise exception 'P6_STUDIO_STUDENT_WRITE_ACCEPTED';
  exception when others then
    if SQLERRM <> 'FORBIDDEN' then raise; end if;
  end;
end $$;
reset role;

-- 管理员能插页、复制、排序、保存草稿，并从任意 revision 前向回退。
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.create_blank_cw_page(:'lecture_id',null,'blank') as blank_page_id \gset
select public.copy_cw_page(:'page_id',:'lecture_id',:'blank_page_id','copy') as copied_page_id \gset
select public.reorder_cw_pages(:'lecture_id',array[:'copied_page_id'::uuid,:'page_id'::uuid,:'blank_page_id'::uuid]);
select (array_agg(id order by page_no)=array[:'copied_page_id'::uuid,:'page_id'::uuid,:'blank_page_id'::uuid]) as p6_studio_page_order_ok
from public.cw_page_docs where lecture_id=:'lecture_id' and deleted_at is null \gset
\if :p6_studio_page_order_ok
\else
  \echo P6 studio failed: page ordering
  \quit 1
\endif
select revision_id as draft_revision_id, revision_no as draft_revision_no from public.save_cw_track_page_draft(
  :'page_id','native-16x9', (select doc from public.cw_page_revisions where id=:'baseline_revision_id'), 1, 'draft'
) \gset
select revision_id as revert_revision_id, revision_no as revert_revision_no from public.revert_cw_track_page_revision(
  :'page_id','native-16x9', :'baseline_revision_id', :'draft_revision_no', 'revert'
) \gset
select (origin='revert' and revision_no=:'revert_revision_no'::int) as p6_studio_revert_ok
from public.cw_page_revisions where id=:'revert_revision_id' \gset
\if :p6_studio_revert_ok
\else
  \echo P6 studio failed: page revert
  \quit 1
\endif

-- 发布 release 1 后冻结一堂课；之后发布 release 2，冻结的课次仍 pin release 1。
select public.publish_cw_track_release(:'lecture_id','native-16x9','release 1') as release_1 \gset
insert into public.classrooms(owner_id,name,invite_code) values(:'admin_id','__P6_STUDIO_CLASS__',substr(md5(gen_random_uuid()::text),1,8))
returning id as classroom_id \gset
insert into public.class_sessions(classroom_id,lecture_id,title) values(:'classroom_id',:'lecture_id','__P6_STUDIO_SESSION__')
returning id as session_id \gset
select public.freeze_session_courseware(
  :'session_id', '[]'::jsonb,
  jsonb_build_object('version','cw-session-resolved-v1','track','native-16x9','releaseId',:'release_1','bindings','[]'::jsonb)
);
select revision_id as later_draft_id, revision_no as later_draft_no from public.save_cw_track_page_draft(
  :'page_id','native-16x9', (select doc from public.cw_page_revisions where id=:'revert_revision_id'), :'revert_revision_no', 'release 2 draft'
) \gset
select public.publish_cw_track_release(:'lecture_id','native-16x9','release 2') as release_2 \gset
select (
  (select courseware_resolved->>'releaseId' from public.class_sessions where id=:'session_id')=:'release_1'
  and (select current_release_id from public.course_lectures where id=:'lecture_id')=:'release_2'::uuid
) as p6_studio_frozen_isolation_ok \gset
\if :p6_studio_frozen_isolation_ok
\else
  \echo P6 studio failed: frozen session changed after new release
  \quit 1
\endif

-- 本页图片替换必须建出新 shared_asset 分支，而不是推进原资产的 published 指针。
select repeat('d',64) as replacement_hash \gset
select revision_id as replacement_revision_id from public.replace_cw_track_image_binding(
  :'page_id',:'binding_key','native-16x9','current-page',:'replacement_hash','image/png',1,1,1,'replacement'
) \gset
select (
  (select shared_asset_id from public.cw_page_asset_bindings where page_doc_id=:'page_id' and binding_key=:'binding_key' and track='native-16x9') <> :'source_asset_id'::uuid
  and (select published_revision_id from public.cw_shared_assets where id=:'source_asset_id')=:'source_asset_revision_id'::uuid
) as p6_studio_page_only_image_ok \gset
\if :p6_studio_page_only_image_ok
\else
  \echo P6 studio failed: image replacement changed shared source
  \quit 1
\endif

rollback;
\echo P6 courseware studio assertions passed
