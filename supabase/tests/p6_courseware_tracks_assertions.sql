\set ON_ERROR_STOP on
-- P6-9：双轨发布、轨内资源替换、班级默认/单讲覆盖与开课冻结。全程回滚。
begin;

select id as admin_id from public.profiles where display_name='测试-管理员' limit 1 \gset
\if :{?admin_id}
\else
  \echo P6 track fixtures missing: 测试-管理员
  \quit 1
\endif
select set_config('request.jwt.claim.sub', :'admin_id', true);

insert into public.courses(title,product_code,grade,term,class_type,created_by)
values('__P6_TRACKS__','__P6_TRACKS__'||replace(gen_random_uuid()::text,'-',''),1,1,'audit',:'admin_id')
returning id as course_id \gset
insert into public.course_lectures(course_id,no,name)
values(:'course_id',1,'__P6_TRACKS_LECTURE__') returning id as lecture_id \gset

select repeat('1',64) source_hash,repeat('2',64) replacement_hash \gset
insert into public.cw_asset_objects(sha256,mime,byte_count,width,height,kind,storage_path)
values(:'source_hash','image/png',1,1280,720,'image','sha256/11/'||:'source_hash')
returning id as object_id \gset
insert into public.cw_shared_assets(name,kind,role,candidate_key,created_by)
values('__P6_TRACKS_BG__','image','background','tracks:'||gen_random_uuid()::text,:'admin_id')
returning id as asset_id \gset
insert into public.cw_asset_revisions(shared_asset_id,revision_no,object_id,variant,created_by)
values(:'asset_id',1,:'object_id','source',:'admin_id') returning id as asset_revision_id \gset
update public.cw_shared_assets set published_revision_id=:'asset_revision_id' where id=:'asset_id';

insert into public.cw_page_docs(lecture_id,page_no,title,source_courseware_id,source_page_id,adapt_class)
values(:'lecture_id',1,'page 1','tracks','one','A') returning id as page_1 \gset
insert into public.cw_page_docs(lecture_id,page_no,title,source_courseware_id,source_page_id,adapt_class)
values(:'lecture_id',2,'page 2','tracks','two','F') returning id as page_2 \gset

create temporary table p6_track_revisions(page_id uuid primary key,native_id uuid,adapted_id uuid) on commit drop;
with pages as (select :'page_1'::uuid id,1 no union all select :'page_2'::uuid,2),
native as (
  insert into public.cw_page_revisions(page_doc_id,revision_no,doc,origin,track,created_by)
  select id,1,jsonb_build_object(
    'docVersion','page-doc-v1','sourceCoursewareId','tracks','sourcePageId',no::text,
    'sourcePageDatabaseId',no,'sourceSnapshotId',1,'sourceContentHash',repeat('a',64),
    'canvas',jsonb_build_object('width',1280,'height',720,'backgroundColor',null,'backgroundBindingKey',:'source_hash'),
    'nodes','[]'::jsonb,'interactions','[]'::jsonb
  ),'import','native-16x9',:'admin_id' from pages returning page_doc_id,id
), adapted as (
  insert into public.cw_page_revisions(page_doc_id,revision_no,doc,origin,track,created_by)
  select id,2,jsonb_build_object(
    'docVersion','page-doc-v1','sourceCoursewareId','tracks','sourcePageId',no::text,
    'sourcePageDatabaseId',no,'sourceSnapshotId',1,'sourceContentHash',repeat('a',64),
    'canvas',jsonb_build_object('width',960,'height',720,'backgroundColor',null,'backgroundBindingKey',:'source_hash'),
    'nodes','[]'::jsonb,'interactions','[]'::jsonb
  ),'adapt-4x3','adapted-4x3',:'admin_id' from pages returning page_doc_id,id
)
insert into p6_track_revisions
select native.page_doc_id,native.id,adapted.id from native join adapted using(page_doc_id);

update public.cw_page_docs page set current_revision_id=revision.native_id
from p6_track_revisions revision where page.id=revision.page_id;
insert into public.cw_page_track_heads(page_doc_id,track,current_revision_id)
select page_id,'adapted-4x3',adapted_id from p6_track_revisions;
insert into public.cw_page_asset_bindings(page_doc_id,binding_key,role,kind,shared_asset_id,track)
select page_id,:'source_hash','background','image',:'asset_id','native-16x9' from p6_track_revisions;
insert into public.cw_page_asset_bindings(page_doc_id,binding_key,role,kind,shared_asset_id,track)
select page_id,:'source_hash','background','image',:'asset_id','adapted-4x3' from p6_track_revisions;

select public.publish_cw_track_release(:'lecture_id','native-16x9','native') native_release \gset
select public.publish_cw_track_release(:'lecture_id','adapted-4x3','adapted') adapted_release \gset
select (
  :'native_release'::uuid<>:'adapted_release'::uuid
  and (select current_release_id=:'native_release'::uuid from public.cw_lecture_track_heads where lecture_id=:'lecture_id' and track='native-16x9')
  and (select current_release_id=:'adapted_release'::uuid from public.cw_lecture_track_heads where lecture_id=:'lecture_id' and track='adapted-4x3')
  and (select current_release_id=:'native_release'::uuid from public.course_lectures where id=:'lecture_id')
) p6_tracks_release_isolation_ok \gset
\if :p6_tracks_release_isolation_ok
\else
  \echo P6 tracks failed: release heads are not isolated
  \quit 1
\endif

select revision_id replacement_revision,affected_count from public.replace_cw_track_image_binding(
  :'page_1',:'source_hash','adapted-4x3','all-track',:'replacement_hash','image/png',1,960,720,'4:3 replacement'
) \gset
select (
  :'affected_count'::int=2
  and (select count(*)=2 from public.cw_page_asset_bindings where shared_asset_id=:'asset_id' and track='adapted-4x3' and pinned_revision_id=:'replacement_revision')
  and (select count(*)=2 from public.cw_page_asset_bindings where shared_asset_id=:'asset_id' and track='native-16x9' and pinned_revision_id is null)
) p6_tracks_asset_isolation_ok \gset
\if :p6_tracks_asset_isolation_ok
\else
  \echo P6 tracks failed: track-scoped replacement crossed aspect tracks
  \quit 1
\endif

insert into public.classrooms(owner_id,name,invite_code,course_id)
values(:'admin_id','__P6_TRACKS_CLASS__',substr(md5(gen_random_uuid()::text),1,8),:'course_id')
returning id as classroom_id \gset
insert into public.classroom_members(classroom_id,user_id,role) values(:'classroom_id',:'admin_id','teacher') on conflict do nothing;
insert into public.class_sessions(classroom_id,lecture_id,title)
values(:'classroom_id',:'lecture_id','__P6_TRACKS_SESSION__') returning id as session_id \gset
select public.set_classroom_courseware_track(:'classroom_id','adapted-4x3');
select release_id resolved_default from public.resolve_session_courseware_release(:'session_id') where track='adapted-4x3' \gset
select public.set_session_courseware_track_override(:'session_id','native-16x9');
select release_id resolved_override from public.resolve_session_courseware_release(:'session_id') where track='native-16x9' \gset
select (:'resolved_default'::uuid=:'adapted_release'::uuid and :'resolved_override'::uuid=:'native_release'::uuid) p6_tracks_class_selection_ok \gset
\if :p6_tracks_class_selection_ok
\else
  \echo P6 tracks failed: class/session selection precedence
  \quit 1
\endif

select public.freeze_session_courseware(:'session_id','[]'::jsonb,jsonb_build_object(
  'version','cw-session-resolved-v1','track','native-16x9','releaseId',:'native_release','bindings','[]'::jsonb
));
select set_config('p6_tracks.session_id', :'session_id', true);
do $$ begin
  begin
    perform public.set_session_courseware_track_override(current_setting('p6_tracks.session_id')::uuid,'adapted-4x3');
    raise exception 'P6_TRACKS_FROZEN_OVERRIDE_ACCEPTED';
  exception when others then
    if SQLERRM<>'ALREADY_STARTED_OR_FROZEN' then raise; end if;
  end;
end $$;

rollback;
\echo P6 courseware track assertions passed
