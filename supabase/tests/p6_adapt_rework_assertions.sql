\set ON_ERROR_STOP on
-- P6：人工退回原因、不可变审计、修复 successor 与发布闸门。全程回滚。
begin;

select id as admin_id from public.profiles where display_name='测试-管理员' limit 1 \gset
\if :{?admin_id}
\else
  \echo P6 adapt rework fixtures missing: 测试-管理员
  select 1 / 0;
\endif
select set_config('request.jwt.claim.sub', :'admin_id', true);

insert into public.courses(title,product_code,grade,term,class_type,created_by)
values('__P6_ADAPT_REWORK__','__P6_ADAPT_REWORK__'||replace(gen_random_uuid()::text,'-',''),1,1,'audit',:'admin_id')
returning id as course_id \gset
insert into public.course_lectures(course_id,no,name)
values(:'course_id',1,'__P6_ADAPT_REWORK_LECTURE__') returning id as lecture_id \gset
insert into public.course_staff_assignments(user_id,scope_type,course_id,responsibility,created_by)
values(:'admin_id','variant',:'course_id','editor',:'admin_id');

select repeat('6',64) source_hash,repeat('7',64) rejected_hash,repeat('8',64) repaired_hash \gset
insert into public.cw_asset_objects(sha256,mime,byte_count,width,height,kind,storage_path)
values(:'source_hash','image/png',1,1280,720,'image','sha256/66/'||:'source_hash')
returning id as source_object_id \gset
insert into public.cw_asset_objects(sha256,mime,byte_count,width,height,kind,storage_path)
values(:'rejected_hash','image/png',1,960,720,'image','sha256/77/'||:'rejected_hash')
returning id as rejected_object_id \gset
insert into public.cw_shared_assets(name,kind,role,candidate_key,created_by)
values('__P6_ADAPT_REWORK_BG__','image','background','adapt-rework:'||gen_random_uuid()::text,:'admin_id')
returning id as asset_id \gset
insert into public.cw_asset_revisions(shared_asset_id,revision_no,object_id,variant,created_by)
values(:'asset_id',1,:'source_object_id','source',:'admin_id') returning id as source_revision_id \gset
insert into public.cw_asset_revisions(shared_asset_id,revision_no,object_id,derived_from_revision_id,variant,created_by)
values(:'asset_id',2,:'rejected_object_id',:'source_revision_id','mathin-4x3',:'admin_id') returning id as rejected_revision_id \gset
update public.cw_shared_assets set published_revision_id=:'source_revision_id' where id=:'asset_id';
insert into public.cw_asset_variant_heads(shared_asset_id,track,draft_revision_id)
values(:'asset_id','adapted-4x3',:'rejected_revision_id');

insert into public.cw_page_docs(lecture_id,page_no,title,source_courseware_id,source_page_id,adapt_class)
values(:'lecture_id',1,'page 1','adapt-rework','one','A') returning id as page_id \gset
insert into public.cw_page_revisions(page_doc_id,revision_no,doc,origin,track,created_by)
values(:'page_id',1,jsonb_build_object(
  'docVersion','page-doc-v1','sourceCoursewareId','adapt-rework','sourcePageId','one',
  'sourcePageDatabaseId',1,'sourceSnapshotId',1,'sourceContentHash',repeat('a',64),
  'canvas',jsonb_build_object('width',960,'height',720,'backgroundColor',null,'backgroundBindingKey',:'source_hash'),
  'nodes','[]'::jsonb,'interactions','[]'::jsonb
),'adapt-4x3','adapted-4x3',:'admin_id') returning id as page_revision_id \gset
insert into public.cw_page_track_heads(page_doc_id,track,draft_revision_id)
values(:'page_id','adapted-4x3',:'page_revision_id');
insert into public.cw_page_asset_bindings(page_doc_id,binding_key,role,kind,shared_asset_id,pinned_revision_id,track)
values(:'page_id',:'source_hash','background','image',:'asset_id',:'rejected_revision_id','adapted-4x3')
returning id as binding_id \gset
insert into public.cw_adapt_backgrounds(source_asset_revision_id,derived_asset_revision_id,crop_x,crop_y)
values(:'source_revision_id',:'rejected_revision_id',0,0) returning id as adaptation_id \gset

select set_config('p6_adapt_rework.adaptation_id', :'adaptation_id', true);
do $$ begin
  begin
    perform public.review_cw_adapt_backgrounds(array[current_setting('p6_adapt_rework.adaptation_id')::uuid],false,'');
    raise exception 'P6_REJECTION_WITHOUT_REASON_ACCEPTED';
  exception when others then
    if SQLERRM <> 'REJECTION_REASON_REQUIRED' then raise; end if;
  end;
end $$;

select public.review_cw_adapt_backgrounds(array[:'adaptation_id'::uuid],false,'crop_error','keep the title');
select (
  select status='rejected' and rejection_code='crop_error' and note='keep the title'
  from public.cw_adapt_backgrounds where id=:'adaptation_id'
) p6_adapt_rejection_reason_ok \gset
\if :p6_adapt_rejection_reason_ok
\else
  \echo P6 adapt rework failed: structured rejection was not stored
  select 1 / 0;
\endif

do $$ begin
  begin
    update public.cw_adapt_backgrounds set note='tampered'
     where id=current_setting('p6_adapt_rework.adaptation_id')::uuid;
    raise exception 'P6_REJECTED_AUDIT_WAS_MUTABLE';
  exception when others then
    if SQLERRM <> 'ADAPT_BACKGROUND_DECISION_IMMUTABLE' then raise; end if;
  end;
end $$;

select count(*)=1 p6_adapt_rework_queue_ok
from public.list_cw_adapt_background_rework_queue(:'course_id',:'lecture_id',0,24) \gset
\if :p6_adapt_rework_queue_ok
\else
  \echo P6 adapt rework failed: current rejected binding did not create work
  select 1 / 0;
\endif

insert into public.cw_replacement_uploads(sha256,mime,byte_count,width,height,storage_path,original_name,created_by)
values(:'repaired_hash','image/png',1,960,720,'sha256/88/'||:'repaired_hash','repair.png',:'admin_id')
returning id as upload_id \gset
select adaptation_id as successor_id,revision_id as successor_revision_id,affected_count
from public.repair_cw_adapt_background(:'adaptation_id',:'upload_id',160,0,'center crop') \gset

select (
  :'affected_count'::int=1
  and (select superseded_by_id=:'successor_id'::uuid from public.cw_adapt_backgrounds where id=:'adaptation_id')
  and (select status='pending' and supersedes_id=:'adaptation_id'::uuid and crop_x=160
       from public.cw_adapt_backgrounds where id=:'successor_id')
  and (select pinned_revision_id=:'successor_revision_id'::uuid from public.cw_page_asset_bindings where id=:'binding_id')
) p6_adapt_repair_lineage_ok \gset
\if :p6_adapt_repair_lineage_ok
\else
  \echo P6 adapt rework failed: repair did not create and select a successor
  select 1 / 0;
\endif

select count(*)=0 p6_adapt_rework_resolved_queue_ok
from public.list_cw_adapt_background_rework_queue(:'course_id',:'lecture_id',0,24) \gset
select count(*)=1 p6_adapt_history_ok
from public.list_cw_adapt_background_history(:'course_id',:'lecture_id',0,24) \gset
\if :p6_adapt_rework_resolved_queue_ok
\else
  \echo P6 adapt rework failed: repaired record stayed in work queue
  select 1 / 0;
\endif
\if :p6_adapt_history_ok
\else
  \echo P6 adapt rework failed: repaired record missing from history
  select 1 / 0;
\endif

select public.review_cw_adapt_backgrounds(array[:'successor_id'::uuid],true,null,'re-reviewed');
select public.publish_cw_track_release(:'lecture_id','adapted-4x3','approved repair') adapted_release \gset
select (:'adapted_release'::uuid is not null) p6_adapt_historical_reject_does_not_block_ok \gset
\if :p6_adapt_historical_reject_does_not_block_ok
\else
  \echo P6 adapt rework failed: historical rejection blocked approved successor release
  select 1 / 0;
\endif

rollback;
\echo P6 adapt rework assertions passed
