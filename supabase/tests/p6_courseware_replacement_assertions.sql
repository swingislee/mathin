\set ON_ERROR_STOP on
-- P6-8：公共资源替换必须在当前画幅轨道内完成，含部分重绑、全量指针、回滚与越权断言。
begin;

select id as admin_id from public.profiles where display_name='测试-管理员' limit 1 \gset
select id as student_id from public.profiles where display_name='测试-学生' limit 1 \gset
\if :{?admin_id}
\else
  \echo P6 replacement fixtures missing: 测试-管理员
  \quit 1
\endif

insert into public.courses (title, product_code, grade, term, class_type, created_by)
values ('__P6_REPLACEMENT_AUDIT__', '__P6_REPLACE__' || replace(gen_random_uuid()::text, '-', ''), 1, 1, 'audit', :'admin_id')
returning id as course_id \gset
insert into public.course_lectures(course_id,no,name) values
  (:'course_id',1,'__P6_REPLACE_L1__'),
  (:'course_id',2,'__P6_REPLACE_L2__'),
  (:'course_id',3,'__P6_REPLACE_L3__');
select id as lecture_1 from public.course_lectures where course_id=:'course_id' and no=1 \gset
select id as lecture_2 from public.course_lectures where course_id=:'course_id' and no=2 \gset
select id as lecture_3 from public.course_lectures where course_id=:'course_id' and no=3 \gset

select repeat('a',64) as source_hash \gset
insert into public.cw_asset_objects(sha256,mime,byte_count,width,height,kind,storage_path)
values(:'source_hash','image/png',1,1,1,'image','sha256/aa/' || :'source_hash')
returning id as source_object_id \gset
insert into public.cw_shared_assets(name,kind,role,candidate_key,created_by)
values('__P6_REPLACEMENT_SOURCE__','image','background','replacement-test:' || :'source_hash',:'admin_id')
returning id as source_asset_id \gset
insert into public.cw_asset_revisions(shared_asset_id,revision_no,object_id,created_by)
values(:'source_asset_id',1,:'source_object_id',:'admin_id') returning id as source_revision_id \gset
update public.cw_shared_assets set published_revision_id=:'source_revision_id' where id=:'source_asset_id';

insert into public.cw_page_docs(lecture_id,page_no,title) values
  (:'lecture_1',1,'p1'), (:'lecture_2',1,'p2'), (:'lecture_3',1,'p3');
select id as page_1 from public.cw_page_docs where lecture_id=:'lecture_1' \gset
select id as page_2 from public.cw_page_docs where lecture_id=:'lecture_2' \gset
select id as page_3 from public.cw_page_docs where lecture_id=:'lecture_3' \gset
select repeat('1',64) as binding_key_1, repeat('2',64) as binding_key_2, repeat('3',64) as binding_key_3 \gset
insert into public.cw_page_asset_bindings(page_doc_id,binding_key,role,kind,shared_asset_id,track) values
  (:'page_1',:'binding_key_1','background','image',:'source_asset_id','native-16x9'),
  (:'page_2',:'binding_key_2','background','image',:'source_asset_id','native-16x9'),
  (:'page_3',:'binding_key_3','background','image',:'source_asset_id','native-16x9');
select id as binding_1 from public.cw_page_asset_bindings where page_doc_id=:'page_1' and track='native-16x9' \gset
select id as binding_2 from public.cw_page_asset_bindings where page_doc_id=:'page_2' and track='native-16x9' \gset
select id as binding_3 from public.cw_page_asset_bindings where page_doc_id=:'page_3' and track='native-16x9' \gset

-- 非资源管理员不能读取任何轨道使用树，也不能借 RPC 写批次。
select set_config('p6_replace.source_asset_id', :'source_asset_id', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', :'student_id', true);
do $$ begin
  begin
    perform public.list_cw_shared_asset_usages(current_setting('p6_replace.source_asset_id')::uuid, 'native-16x9');
    raise exception 'P6_REPLACEMENT_STUDENT_READ_ACCEPTED';
  exception when others then
    if SQLERRM <> 'FORBIDDEN' then raise; end if;
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', :'admin_id', true);
do $$
declare v_usage_count int;
begin
  select count(*) into v_usage_count
    from public.list_cw_shared_asset_usages(current_setting('p6_replace.source_asset_id')::uuid, 'native-16x9');
  if v_usage_count <> 3 then raise exception 'P6_REPLACEMENT_NATIVE_USAGE_TREE_BAD_COUNT:%', v_usage_count; end if;
end $$;

-- 原生 16:9：选择 2/3 个位置必须建分支且不改 source 指针。
select repeat('b',64) as branch_hash \gset
insert into public.cw_replacement_uploads(sha256,mime,byte_count,width,height,storage_path,original_name,created_by)
values(:'branch_hash','image/png',2,2,1,'sha256/bb/' || :'branch_hash','branch.png',:'admin_id')
returning id as branch_upload_id \gset
select batch_id as branch_batch_id, mode as branch_mode, affected_count as branch_count
  from public.apply_cw_asset_replacement(:'source_asset_id',array[:'binding_1'::uuid,:'binding_2'::uuid],:'branch_upload_id','native-16x9','native partial') \gset
select (
  :'branch_mode' = 'branch_rebind' and :'branch_count'::int = 2
  and (select track from public.cw_replacement_batches where id=:'branch_batch_id') = 'native-16x9'
  and (select count(*) from public.cw_replacement_items where batch_id=:'branch_batch_id' and track='native-16x9') = 2
  and (select shared_asset_id from public.cw_page_asset_bindings where id=:'binding_1') <> :'source_asset_id'::uuid
  and (select shared_asset_id from public.cw_page_asset_bindings where id=:'binding_2') <> :'source_asset_id'::uuid
  and (select shared_asset_id from public.cw_page_asset_bindings where id=:'binding_3') = :'source_asset_id'::uuid
  and (select published_revision_id from public.cw_shared_assets where id=:'source_asset_id') = :'source_revision_id'::uuid
) as p6_replacement_native_partial_ok \gset
\if :p6_replacement_native_partial_ok
\else
  \echo P6 replacement failed: native partial branch rebind
  \quit 1
\endif
select public.rollback_cw_asset_replacement(:'branch_batch_id');
select (
  (select status from public.cw_replacement_batches where id=:'branch_batch_id') = 'rolled_back'
  and (select count(*) from public.cw_page_asset_bindings where id in (:'binding_1'::uuid,:'binding_2'::uuid,:'binding_3'::uuid) and shared_asset_id=:'source_asset_id') = 3
) as p6_replacement_native_partial_rollback_ok \gset
\if :p6_replacement_native_partial_rollback_ok
\else
  \echo P6 replacement failed: native partial rollback
  \quit 1
\endif

-- 原生 16:9：全选只推进原生 variant/legacy 指针，不重写 binding。
select repeat('c',64) as pointer_hash \gset
insert into public.cw_replacement_uploads(sha256,mime,byte_count,width,height,storage_path,original_name,created_by)
values(:'pointer_hash','image/png',3,3,1,'sha256/cc/' || :'pointer_hash','pointer.png',:'admin_id')
returning id as pointer_upload_id \gset
select batch_id as pointer_batch_id, mode as pointer_mode, affected_count as pointer_count
  from public.apply_cw_asset_replacement(:'source_asset_id',array[:'binding_1'::uuid,:'binding_2'::uuid,:'binding_3'::uuid],:'pointer_upload_id','native-16x9','native full') \gset
select (
  :'pointer_mode' = 'publish_pointer' and :'pointer_count'::int = 3
  and (select count(*) from public.cw_replacement_items where batch_id=:'pointer_batch_id' and track='native-16x9') = 3
  and (select count(*) from public.cw_page_asset_bindings where id in (:'binding_1'::uuid,:'binding_2'::uuid,:'binding_3'::uuid) and shared_asset_id=:'source_asset_id') = 3
  and (select published_revision_id from public.cw_shared_assets where id=:'source_asset_id') <> :'source_revision_id'::uuid
) as p6_replacement_native_pointer_ok \gset
\if :p6_replacement_native_pointer_ok
\else
  \echo P6 replacement failed: native published pointer update
  \quit 1
\endif
select public.rollback_cw_asset_replacement(:'pointer_batch_id');
select (
  (select status from public.cw_replacement_batches where id=:'pointer_batch_id') = 'rolled_back'
  and (select published_revision_id from public.cw_shared_assets where id=:'source_asset_id') = :'source_revision_id'::uuid
) as p6_replacement_native_pointer_rollback_ok \gset
\if :p6_replacement_native_pointer_rollback_ok
\else
  \echo P6 replacement failed: native published pointer rollback
  \quit 1
\endif

-- 同一页面复制 4:3 binding；随后的替换必须严格与 16:9 绑定、variant 指针隔离。
insert into public.cw_page_asset_bindings(page_doc_id,binding_key,role,kind,shared_asset_id,track) values
  (:'page_1',:'binding_key_1','background','image',:'source_asset_id','adapted-4x3'),
  (:'page_2',:'binding_key_2','background','image',:'source_asset_id','adapted-4x3'),
  (:'page_3',:'binding_key_3','background','image',:'source_asset_id','adapted-4x3');
select id as adapted_binding_1 from public.cw_page_asset_bindings where page_doc_id=:'page_1' and track='adapted-4x3' \gset
select id as adapted_binding_2 from public.cw_page_asset_bindings where page_doc_id=:'page_2' and track='adapted-4x3' \gset
select id as adapted_binding_3 from public.cw_page_asset_bindings where page_doc_id=:'page_3' and track='adapted-4x3' \gset

do $$
declare v_usage_count int;
begin
  select count(*) into v_usage_count
    from public.list_cw_shared_asset_usages(current_setting('p6_replace.source_asset_id')::uuid, 'adapted-4x3');
  if v_usage_count <> 3 then raise exception 'P6_REPLACEMENT_ADAPTED_USAGE_TREE_BAD_COUNT:%', v_usage_count; end if;
end $$;

select repeat('d',64) as adapted_branch_hash \gset
insert into public.cw_replacement_uploads(sha256,mime,byte_count,width,height,storage_path,original_name,created_by)
values(:'adapted_branch_hash','image/png',4,4,1,'sha256/dd/' || :'adapted_branch_hash','adapted-branch.png',:'admin_id')
returning id as adapted_branch_upload_id \gset
select batch_id as adapted_branch_batch_id, mode as adapted_branch_mode, affected_count as adapted_branch_count
  from public.apply_cw_asset_replacement(:'source_asset_id',array[:'adapted_binding_1'::uuid,:'adapted_binding_2'::uuid],:'adapted_branch_upload_id','adapted-4x3','adapted partial') \gset
select (
  :'adapted_branch_mode' = 'branch_rebind' and :'adapted_branch_count'::int = 2
  and (select track from public.cw_replacement_batches where id=:'adapted_branch_batch_id') = 'adapted-4x3'
  and (select count(*) from public.cw_replacement_items where batch_id=:'adapted_branch_batch_id' and track='adapted-4x3') = 2
  and (select shared_asset_id from public.cw_page_asset_bindings where id=:'adapted_binding_1') <> :'source_asset_id'::uuid
  and (select shared_asset_id from public.cw_page_asset_bindings where id=:'adapted_binding_2') <> :'source_asset_id'::uuid
  and (select shared_asset_id from public.cw_page_asset_bindings where id=:'adapted_binding_3') = :'source_asset_id'::uuid
  and (select count(*) from public.cw_page_asset_bindings where id in (:'binding_1'::uuid,:'binding_2'::uuid,:'binding_3'::uuid) and shared_asset_id=:'source_asset_id') = 3
  and (select published_revision_id from public.cw_shared_assets where id=:'source_asset_id') = :'source_revision_id'::uuid
) as p6_replacement_adapted_partial_ok \gset
select target_shared_asset_id as adapted_branch_target_asset_id
  from public.cw_replacement_batches where id=:'adapted_branch_batch_id' \gset
select (
  not exists (select 1 from public.list_cw_shared_assets('__P6_REPLACEMENT_SOURCE__', null, null, 'native-16x9', 0, 101, 0) asset where asset.id=:'adapted_branch_target_asset_id'::uuid)
  and exists (select 1 from public.list_cw_shared_assets('__P6_REPLACEMENT_SOURCE__', null, null, 'adapted-4x3', 0, 101, 0) asset where asset.id=:'adapted_branch_target_asset_id'::uuid)
) as p6_replacement_track_list_guard_ok \gset
\if :p6_replacement_adapted_partial_ok
\else
  \echo P6 replacement failed: adapted partial crossed native track
  \quit 1
\endif
\if :p6_replacement_track_list_guard_ok
\else
  \echo P6 replacement failed: adapted branch leaked into native list
  \quit 1
\endif
select public.rollback_cw_asset_replacement(:'adapted_branch_batch_id');
select (
  (select status from public.cw_replacement_batches where id=:'adapted_branch_batch_id') = 'rolled_back'
  and (select count(*) from public.cw_page_asset_bindings where id in (:'adapted_binding_1'::uuid,:'adapted_binding_2'::uuid,:'adapted_binding_3'::uuid) and shared_asset_id=:'source_asset_id') = 3
) as p6_replacement_adapted_partial_rollback_ok \gset
\if :p6_replacement_adapted_partial_rollback_ok
\else
  \echo P6 replacement failed: adapted partial rollback
  \quit 1
\endif

select repeat('e',64) as adapted_pointer_hash \gset
insert into public.cw_replacement_uploads(sha256,mime,byte_count,width,height,storage_path,original_name,created_by)
values(:'adapted_pointer_hash','image/png',5,5,1,'sha256/ee/' || :'adapted_pointer_hash','adapted-pointer.png',:'admin_id')
returning id as adapted_pointer_upload_id \gset
select batch_id as adapted_pointer_batch_id, mode as adapted_pointer_mode, affected_count as adapted_pointer_count
  from public.apply_cw_asset_replacement(:'source_asset_id',array[:'adapted_binding_1'::uuid,:'adapted_binding_2'::uuid,:'adapted_binding_3'::uuid],:'adapted_pointer_upload_id','adapted-4x3','adapted full') \gset
select (
  :'adapted_pointer_mode' = 'publish_pointer' and :'adapted_pointer_count'::int = 3
  and (select published_revision_id from public.cw_asset_variant_heads where shared_asset_id=:'source_asset_id' and track='adapted-4x3') <> :'source_revision_id'::uuid
  and (select published_revision_id from public.cw_asset_variant_heads where shared_asset_id=:'source_asset_id' and track='native-16x9') = :'source_revision_id'::uuid
  and (select published_revision_id from public.cw_shared_assets where id=:'source_asset_id') = :'source_revision_id'::uuid
) as p6_replacement_adapted_pointer_ok \gset
\if :p6_replacement_adapted_pointer_ok
\else
  \echo P6 replacement failed: adapted pointer crossed native variant
  \quit 1
\endif
select public.rollback_cw_asset_replacement(:'adapted_pointer_batch_id');
select (
  (select status from public.cw_replacement_batches where id=:'adapted_pointer_batch_id') = 'rolled_back'
  and (select published_revision_id from public.cw_asset_variant_heads where shared_asset_id=:'source_asset_id' and track='adapted-4x3') = :'source_revision_id'::uuid
  and (select published_revision_id from public.cw_asset_variant_heads where shared_asset_id=:'source_asset_id' and track='native-16x9') = :'source_revision_id'::uuid
  and (select published_revision_id from public.cw_shared_assets where id=:'source_asset_id') = :'source_revision_id'::uuid
) as p6_replacement_adapted_pointer_rollback_ok \gset
\if :p6_replacement_adapted_pointer_rollback_ok
\else
  \echo P6 replacement failed: adapted pointer rollback
  \quit 1
\endif

rollback;
\echo P6 courseware replacement assertions passed