-- P6-8 hotfix: course_lectures.no is smallint, while the RPC contract exposes
-- lecture_no as int. RETURN QUERY requires an exact output type match.
create or replace function public.list_cw_shared_asset_usages(p_shared_asset_id uuid)
returns table(
  binding_id uuid,
  binding_key text,
  page_doc_id uuid,
  page_no int,
  page_title text,
  lecture_id uuid,
  lecture_no int,
  lecture_name text,
  course_id uuid,
  course_title text,
  product_code text,
  pinned_revision_id uuid,
  resolved_revision_id uuid,
  frozen_session_count bigint
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.has_perm(v_uid, 'courseware.asset.manage') then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (select 1 from public.cw_shared_assets where id = p_shared_asset_id and kind = 'image') then
    raise exception 'SOURCE_ASSET_NOT_FOUND';
  end if;

  return query
  with frozen as (
    select
      (entry.binding ->> 'pageDocId')::uuid as page_doc_id,
      entry.binding ->> 'bindingKey' as binding_key,
      count(*) as session_count
    from public.class_sessions as session
    cross join lateral jsonb_array_elements(coalesce(session.courseware_resolved -> 'bindings', '[]'::jsonb)) as entry(binding)
    where session.deleted_at is null
      and session.courseware_resolved ->> 'version' = 'cw-session-resolved-v1'
      and jsonb_typeof(entry.binding) = 'object'
      and entry.binding ->> 'pageDocId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    group by 1, 2
  )
  select
    binding.id,
    binding.binding_key,
    page.id,
    page.page_no,
    page.title,
    lecture.id,
    lecture.no::int,
    lecture.name,
    course.id,
    course.title,
    course.product_code,
    binding.pinned_revision_id,
    coalesce(binding.pinned_revision_id, asset.published_revision_id),
    coalesce(frozen.session_count, 0)
  from public.cw_page_asset_bindings as binding
  join public.cw_page_docs as page on page.id = binding.page_doc_id and page.deleted_at is null
  join public.course_lectures as lecture on lecture.id = page.lecture_id
  join public.courses as course on course.id = lecture.course_id
  join public.cw_shared_assets as asset on asset.id = binding.shared_asset_id
  left join frozen on frozen.page_doc_id = page.id and frozen.binding_key = binding.binding_key
  where binding.shared_asset_id = p_shared_asset_id
  order by course.product_code nulls last, course.title, lecture.no, page.page_no, binding.binding_key;
end;
$$;

revoke all on function public.list_cw_shared_asset_usages(uuid) from public, anon, authenticated;
grant execute on function public.list_cw_shared_asset_usages(uuid) to authenticated;
