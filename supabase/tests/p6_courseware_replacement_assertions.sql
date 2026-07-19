\set ON_ERROR_STOP on
-- P6-8：资源指针全量替换、部分分支重绑、审计、回滚与越权断言。
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
-- psql 不能直接把 multi-row returning 分别装入变量，因此以讲次号回查。
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
insert into public.cw_page_asset_bindings(page_doc_id,binding_key,role,kind,shared_asset_id) values
  (:'page_1',:'binding_key_1','background','image',:'source_asset_id'),
  (:'page_2',:'binding_key_2','background','image',:'source_asset_id'),
  (:'page_3',:'binding_key_3','background','image',:'source_asset_id');
select id as binding_1 from public.cw_page_asset_bindings where page_doc_id=:'page_1' \gset
select id as binding_2 from public.cw_page_asset_bindings where page_doc_id=:'page_2' \gset
select id as binding_3 from public.cw_page_asset_bindings where page_doc_id=:'page_3' \gset

-- 非资源管理员不能读取使用树，也不能借 RPC 写批次。
select set_config('p6_replace.source_asset_id', :'source_asset_id', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', :'student_id', true);
do $$ begin
  begin
    perform public.list_cw_shared_asset_usages(current_setting('p6_replace.source_asset_id')::uuid);
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
    from public.list_cw_shared_asset_usages(current_setting('p6_replace.source_asset_id')::uuid);
  if v_usage_count <> 3 then
    raise exception 'P6_REPLACEMENT_USAGE_TREE_BAD_COUNT:%', v_usage_count;
  end if;
end $$;

select repeat('b',64) as branch_hash \gset
insert into public.cw_replacement_uploads(sha256,mime,byte_count,width,height,storage_path,original_name,created_by)
values(:'branch_hash','image/png',2,2,1,'sha256/bb/' || :'branch_hash','branch.png',:'admin_id')
returning id as branch_upload_id \gset

-- 选择 2/3 个位置必须建 shared asset branch，旧资源发布指针不动。
select batch_id as branch_batch_id, mode as branch_mode, affected_count as branch_count
  from public.apply_cw_asset_replacement(:'source_asset_id',array[:'binding_1'::uuid,:'binding_2'::uuid],:'branch_upload_id','partial') \gset
select (
  :'branch_mode' = 'branch_rebind'
  and :'branch_count'::int = 2
  and (select count(*) from public.cw_replacement_items where batch_id=:'branch_batch_id') = 2
  and (select shared_asset_id from public.cw_page_asset_bindings where id=:'binding_1') <> :'source_asset_id'::uuid
  and (select shared_asset_id from public.cw_page_asset_bindings where id=:'binding_2') <> :'source_asset_id'::uuid
  and (select shared_asset_id from public.cw_page_asset_bindings where id=:'binding_3') = :'source_asset_id'::uuid
  and (select published_revision_id from public.cw_shared_assets where id=:'source_asset_id') = :'source_revision_id'::uuid
) as p6_replacement_partial_ok \gset
\if :p6_replacement_partial_ok
\else
  \echo P6 replacement failed: partial branch rebind
  \quit 1
\endif
select public.rollback_cw_asset_replacement(:'branch_batch_id');
select (
  (select status from public.cw_replacement_batches where id=:'branch_batch_id') = 'rolled_back'
  and (select count(*) from public.cw_page_asset_bindings where id in (:'binding_1'::uuid,:'binding_2'::uuid,:'binding_3'::uuid) and shared_asset_id=:'source_asset_id') = 3
) as p6_replacement_partial_rollback_ok \gset
\if :p6_replacement_partial_rollback_ok
\else
  \echo P6 replacement failed: partial rollback
  \quit 1
\endif

select repeat('c',64) as pointer_hash \gset
insert into public.cw_replacement_uploads(sha256,mime,byte_count,width,height,storage_path,original_name,created_by)
values(:'pointer_hash','image/png',3,3,1,'sha256/cc/' || :'pointer_hash','pointer.png',:'admin_id')
returning id as pointer_upload_id \gset

-- 选中全部可跟随位置只推进 source 的一个 published 指针，不批量重写 binding。
select batch_id as pointer_batch_id, mode as pointer_mode, affected_count as pointer_count
  from public.apply_cw_asset_replacement(:'source_asset_id',array[:'binding_1'::uuid,:'binding_2'::uuid,:'binding_3'::uuid],:'pointer_upload_id','full') \gset
select (
  :'pointer_mode' = 'publish_pointer'
  and :'pointer_count'::int = 3
  and (select count(*) from public.cw_replacement_items where batch_id=:'pointer_batch_id') = 3
  and (select count(*) from public.cw_page_asset_bindings where id in (:'binding_1'::uuid,:'binding_2'::uuid,:'binding_3'::uuid) and shared_asset_id=:'source_asset_id') = 3
  and (select published_revision_id from public.cw_shared_assets where id=:'source_asset_id') <> :'source_revision_id'::uuid
) as p6_replacement_pointer_ok \gset
\if :p6_replacement_pointer_ok
\else
  \echo P6 replacement failed: published pointer update
  \quit 1
\endif
select public.rollback_cw_asset_replacement(:'pointer_batch_id');
select (
  (select status from public.cw_replacement_batches where id=:'pointer_batch_id') = 'rolled_back'
  and (select published_revision_id from public.cw_shared_assets where id=:'source_asset_id') = :'source_revision_id'::uuid
) as p6_replacement_pointer_rollback_ok \gset
\if :p6_replacement_pointer_rollback_ok
\else
  \echo P6 replacement failed: pointer rollback
  \quit 1
\endif

rollback;
\echo P6 courseware replacement assertions passed
