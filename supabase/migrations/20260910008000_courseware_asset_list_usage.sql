-- 按候选素材一次汇总引用，保留原函数的身份检查、参数校验及元数据。
do $asset_list_usage$
declare definition text;
  old_query text := $old$  return query
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
   limit p_limit offset p_offset;$old$;
  new_query text := $new$  return query
  with candidates as materialized (
    select asset.id, asset.name, asset.kind, asset.role, asset.updated_at,
           coalesce(variant.published_revision_id, variant.draft_revision_id, asset.published_revision_id) as revision_id
      from public.cw_shared_assets asset
      left join public.cw_asset_variant_heads variant
        on variant.shared_asset_id = asset.id and variant.track = p_track
     where (v_query = '' or asset.name ilike '%' || v_query || '%' or coalesce(asset.candidate_key, '') ilike '%' || v_query || '%')
       and (p_kind is null or asset.kind = p_kind)
       and (p_role is null or asset.role = p_role)
       and coalesce(variant.published_revision_id, variant.draft_revision_id, asset.published_revision_id) is not null
  ), usage_counts as (
    select binding.shared_asset_id, count(*) as usage_count
      from public.cw_page_asset_bindings binding
      join candidates candidate on candidate.id = binding.shared_asset_id
      join public.cw_page_docs page on page.id = binding.page_doc_id and page.deleted_at is null
      join public.course_lectures lecture on lecture.id = page.lecture_id
     where binding.track = p_track
     group by binding.shared_asset_id
  ), page_assets as materialized (
    select asset.*, coalesce(usage.usage_count, 0) as usage_count
      from candidates asset
      left join usage_counts usage on usage.shared_asset_id = asset.id
     where coalesce(usage.usage_count, 0) >= p_min_usage
     order by coalesce(usage.usage_count, 0) desc, asset.updated_at desc, asset.id
     limit p_limit offset p_offset
  ), page_usage_details as (
    select binding.shared_asset_id, count(distinct lecture.course_id) as course_count,
           count(distinct page.lecture_id) as lecture_count
      from public.cw_page_asset_bindings binding
      join page_assets asset on asset.id = binding.shared_asset_id
      join public.cw_page_docs page on page.id = binding.page_doc_id and page.deleted_at is null
      join public.course_lectures lecture on lecture.id = page.lecture_id
     where binding.track = p_track
     group by binding.shared_asset_id
  )
  select asset.id, asset.name, asset.kind, asset.role, asset.revision_id,
         revision.revision_no, object.sha256, object.mime, object.byte_count, object.width, object.height,
         asset.usage_count, coalesce(usage.course_count, 0), coalesce(usage.lecture_count, 0), asset.updated_at
    from page_assets asset
    left join page_usage_details usage on usage.shared_asset_id = asset.id
    left join public.cw_asset_revisions revision on revision.id = asset.revision_id
    left join public.cw_asset_objects object on object.id = revision.object_id
   order by asset.usage_count desc, asset.updated_at desc, asset.id;$new$;
begin
  select pg_get_functiondef('public.list_cw_shared_assets(text,text,text,text,integer,integer,integer)'::regprocedure) into definition;
  if array_length(string_to_array(definition,old_query),1) <> 2 then
    raise exception 'COURSEWARE_ASSET_LIST_QUERY_CHANGED';
  end if;
  execute replace(definition,old_query,new_query);
  -- 搜索、类型与分页范围差异较大，按本次参数选择计划，保持连续筛选时的读取性能。
  alter function public.list_cw_shared_assets(text,text,text,text,integer,integer,integer)
    set plan_cache_mode = force_custom_plan;
end;
$asset_list_usage$;
