-- P6-8 补丁：4:3 专用 semantic branch 在 16:9 视图中没有 variant，不得以空 revision 出现在资源库。
create or replace function public.list_cw_shared_assets(
  p_query text default '',
  p_kind text default null,
  p_role text default null,
  p_track text default 'native-16x9',
  p_min_usage int default 0,
  p_limit int default 101,
  p_offset int default 0
)
returns table(
  id uuid,
  name text,
  kind text,
  role text,
  published_revision_id uuid,
  published_revision_no int,
  object_sha256 text,
  mime text,
  byte_count bigint,
  width int,
  height int,
  usage_count bigint,
  course_count bigint,
  lecture_count bigint,
  updated_at timestamptz
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_query text := trim(coalesce(p_query, ''));
begin
  if v_uid is null or not public.has_perm(v_uid, 'courseware.asset.manage') then raise exception 'FORBIDDEN'; end if;
  if p_track not in ('native-16x9', 'adapted-4x3')
     or length(v_query) > 200
     or (p_kind is not null and p_kind not in ('image', 'video', 'audio', 'svg', 'h5'))
     or (p_role is not null and (length(trim(p_role)) = 0 or length(p_role) > 100))
     or p_min_usage < 0 or p_limit < 1 or p_limit > 101 or p_offset < 0 or p_offset > 100000 then
    raise exception 'INVALID_ASSET_FILTER';
  end if;

  return query
  select asset.id, asset.name, asset.kind, asset.role,
         coalesce(variant.published_revision_id, variant.draft_revision_id, asset.published_revision_id),
         revision.revision_no, object.sha256, object.mime, object.byte_count, object.width, object.height,
         coalesce(usage.usage_count, 0), coalesce(usage.course_count, 0), coalesce(usage.lecture_count, 0), asset.updated_at
    from public.cw_shared_assets asset
    left join public.cw_asset_variant_heads variant
      on variant.shared_asset_id = asset.id and variant.track = p_track
    left join public.cw_asset_revisions revision
      on revision.id = coalesce(variant.published_revision_id, variant.draft_revision_id, asset.published_revision_id)
    left join public.cw_asset_objects object on object.id = revision.object_id
    left join lateral (
      select count(*) usage_count, count(distinct lecture.course_id) course_count, count(distinct page.lecture_id) lecture_count
        from public.cw_page_asset_bindings binding
        join public.cw_page_docs page on page.id = binding.page_doc_id and page.deleted_at is null
        join public.course_lectures lecture on lecture.id = page.lecture_id
       where binding.shared_asset_id = asset.id and binding.track = p_track
    ) usage on true
   where (v_query = '' or asset.name ilike '%' || v_query || '%' or coalesce(asset.candidate_key, '') ilike '%' || v_query || '%')
     and (p_kind is null or asset.kind = p_kind)
     and (p_role is null or asset.role = p_role)
     and coalesce(variant.published_revision_id, variant.draft_revision_id, asset.published_revision_id) is not null
     and coalesce(usage.usage_count, 0) >= p_min_usage
   order by coalesce(usage.usage_count, 0) desc, asset.updated_at desc, asset.id
   limit p_limit offset p_offset;
end;
$$;

revoke all on function public.list_cw_shared_assets(text, text, text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.list_cw_shared_assets(text, text, text, text, integer, integer, integer) to authenticated;