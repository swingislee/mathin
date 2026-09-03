\set ON_ERROR_STOP on
-- Step 8A: source-runtime typed patches persist as track drafts while source
-- provenance and published/current heads remain immutable. Everything rolls back.
begin;

select id as admin_id
from public.profiles
where display_name = '测试-管理员'
limit 1 \gset
\if :{?admin_id}
\else
  \echo source-runtime draft fixtures missing: 测试-管理员
  select 1 / 0;
\endif

select
  page_row.id as source_page_id,
  native_head.current_revision_id as native_current_id,
  coalesce(native_head.draft_revision_id, native_head.current_revision_id) as native_base_id,
  native_revision.revision_no as native_base_no,
  adapted_head.current_revision_id as adapted_current_id,
  coalesce(adapted_head.draft_revision_id, adapted_head.current_revision_id) as adapted_base_id,
  adapted_revision.revision_no as adapted_base_no
from public.cw_page_docs page_row
join public.cw_page_track_heads native_head
  on native_head.page_doc_id = page_row.id and native_head.track = 'native-16x9'
join public.cw_page_revisions native_revision
  on native_revision.id = coalesce(native_head.draft_revision_id, native_head.current_revision_id)
join public.cw_page_track_heads adapted_head
  on adapted_head.page_doc_id = page_row.id and adapted_head.track = 'adapted-4x3'
join public.cw_page_revisions adapted_revision
  on adapted_revision.id = coalesce(adapted_head.draft_revision_id, adapted_head.current_revision_id)
where page_row.deleted_at is null
  and page_row.doc_version = 'source-runtime-page-v1'
  and jsonb_typeof(native_revision.doc #> '{payload,data,layout,nodes}') = 'array'
  and jsonb_array_length(native_revision.doc #> '{payload,data,layout,nodes}') > 0
order by page_row.id
limit 1 \gset

\if :{?source_page_id}
\else
  \echo source-runtime draft fixtures missing: source-runtime page with both tracks
  select 1 / 0;
\endif

do $$
declare failures text[] := '{}';
begin
  if to_regprocedure('public.cw_source_runtime_page_doc_is_valid(jsonb)') is null
     or to_regprocedure('public.save_cw_source_runtime_page_draft(uuid,text,jsonb,integer,text)') is null then
    failures := array_append(failures, 'source-runtime draft functions missing');
  end if;
  if has_function_privilege(
       'authenticated',
       'public.save_cw_source_runtime_page_draft(uuid,text,jsonb,integer,text)',
       'EXECUTE'
     ) then
    failures := array_append(failures, 'private source-runtime saver leaked');
  end if;
  if not has_function_privilege(
       'authenticated',
       'public.save_cw_track_page_draft(uuid,text,jsonb,integer,text)',
       'EXECUTE'
     ) then
    failures := array_append(failures, 'public draft wrapper grant missing');
  end if;
  if cardinality(failures) > 0 then
    raise exception 'SOURCE_RUNTIME_DRAFT_STRUCTURE_FAILED: %', array_to_string(failures, ', ');
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);

select revision_id as native_saved_id, revision_no as native_saved_no
from public.save_cw_track_page_draft(
  :'source_page_id',
  'native-16x9',
  (
    select jsonb_set(
      revision_row.doc,
      '{payload,data,layout,nodes,0,x}',
      to_jsonb(coalesce((revision_row.doc #>> '{payload,data,layout,nodes,0,x}')::numeric, 0) + 1),
      true
    )
    from public.cw_page_revisions revision_row
    where revision_row.id = :'native_base_id'
  ),
  :'native_base_no',
  'source-runtime native draft assertion'
) \gset

select revision_id as adapted_saved_id, revision_no as adapted_saved_no
from public.save_cw_track_page_draft(
  :'source_page_id',
  'adapted-4x3',
  (
    select jsonb_set(
      revision_row.doc,
      '{payload,data,mathinCourseware}',
      '{"adapt43Strategy":"fit-width-center"}'::jsonb,
      true
    )
    from public.cw_page_revisions revision_row
    where revision_row.id = :'adapted_base_id'
  ),
  :'adapted_base_no',
  'source-runtime adapted draft assertion'
) \gset

select (
  (select draft_revision_id = :'native_saved_id'::uuid
   from public.cw_page_track_heads
   where page_doc_id = :'source_page_id' and track = 'native-16x9')
  and
  (select draft_revision_id = :'adapted_saved_id'::uuid
   from public.cw_page_track_heads
   where page_doc_id = :'source_page_id' and track = 'adapted-4x3')
  and
  (select current_revision_id is not distinct from :'native_current_id'::uuid
   from public.cw_page_track_heads
   where page_doc_id = :'source_page_id' and track = 'native-16x9')
  and
  (select current_revision_id is not distinct from :'adapted_current_id'::uuid
   from public.cw_page_track_heads
   where page_doc_id = :'source_page_id' and track = 'adapted-4x3')
  and
  (select (saved.doc #>> '{payload,data,layout,nodes,0,x}')::numeric
            = coalesce((base.doc #>> '{payload,data,layout,nodes,0,x}')::numeric, 0) + 1
   from public.cw_page_revisions saved
   join public.cw_page_revisions base on base.id = :'native_base_id'
   where saved.id = :'native_saved_id')
  and
  (select doc #>> '{payload,data,mathinCourseware,adapt43Strategy}' = 'fit-width-center'
   from public.cw_page_revisions where id = :'adapted_saved_id')
) as source_runtime_track_drafts_ok \gset
\if :source_runtime_track_drafts_ok
\else
  \echo source-runtime draft failed: track draft/current isolation
  select 1 / 0;
\endif

select set_config('courseware.assertion.page_id', :'source_page_id', true);
select set_config('courseware.assertion.base_id', :'native_saved_id', true);
select set_config('courseware.assertion.base_no', :'native_saved_no', true);
do $$
declare rejected boolean := false;
begin
  begin
    perform public.save_cw_track_page_draft(
      current_setting('courseware.assertion.page_id')::uuid,
      'native-16x9',
      (
        select jsonb_set(revision_row.doc, '{runtime,packageHash}', to_jsonb(repeat('f', 64)))
        from public.cw_page_revisions revision_row
        where revision_row.id = current_setting('courseware.assertion.base_id')::uuid
      ),
      current_setting('courseware.assertion.base_no')::integer,
      'must reject runtime mutation'
    );
  exception when others then
    if sqlerrm <> 'SOURCE_RUNTIME_DOCUMENT_IMMUTABLE' then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'SOURCE_RUNTIME_IMMUTABLE_WRITE_ACCEPTED'; end if;
end
$$;

reset role;
rollback;
