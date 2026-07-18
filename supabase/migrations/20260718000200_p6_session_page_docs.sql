-- P6-5 课堂接入（docs/plan/16 §8）：
-- 1) 新 RPC get_session_page_docs——教室成员按课次取讲 release 的页 doc 与绑定元数据。
--    学生/家长不直读 cw_* 表（P6-2 RLS 基线不变），课堂取数只经本 RPC 的成员校验。
-- 2) list_session_resolved_assets 补「未冻结回退」——冻结发生在开课瞬间，而候课预载
--    在开课之前；未冻结时按讲次 current release 快照枚举对象（开课冻结 pin 的正是
--    current release，二者同源，不产生越权面：成员校验不变，范围仍限本课讲次）。

-- ---------------------------------------------------------------------------
-- 1) get_session_page_docs
-- ---------------------------------------------------------------------------

create function public.get_session_page_docs(p_session_id uuid)
returns table(page_doc_id uuid, page_no int, doc jsonb, bindings jsonb)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  resolved jsonb;
  session_lecture_id uuid;
  release_id uuid;
  release_snapshot jsonb;
begin
  if uid is null or not public.is_session_member(p_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;

  select s.courseware_resolved, s.lecture_id into resolved, session_lecture_id
    from public.class_sessions s
   where s.id = p_session_id and s.deleted_at is null;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  -- 冻结课次永远用冻结时 pin 的 release；未冻结（候课/试讲）回退讲次 current release。
  if resolved is not null
     and resolved ->> 'version' = 'cw-session-resolved-v1'
     and (resolved ->> 'releaseId') ~ '^[0-9a-f-]{36}$' then
    release_id := (resolved ->> 'releaseId')::uuid;
  elsif session_lecture_id is not null then
    select l.current_release_id into release_id
      from public.course_lectures l where l.id = session_lecture_id;
  end if;
  if release_id is null then
    return;
  end if;

  select r.snapshot into release_snapshot
    from public.cw_lecture_releases r where r.id = release_id;
  if release_snapshot is null then
    return;
  end if;

  return query
  select p.id,
         p.page_no,
         rev.doc,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'bindingKey', b ->> 'bindingKey',
                    'objectHash', o.sha256,
                    'kind', o.kind,
                    'launchQuery', pb.launch_query))
             from jsonb_array_elements(entry.value -> 'bindings') as b
             join public.cw_asset_revisions ar on ar.id = (b ->> 'assetRevisionId')::uuid
             join public.cw_asset_objects o on o.id = ar.object_id
             left join public.cw_page_asset_bindings pb
                    on pb.page_doc_id = p.id and pb.binding_key = b ->> 'bindingKey'
         ), '[]'::jsonb)
    from jsonb_array_elements(release_snapshot) as entry
    join public.cw_page_docs p on p.id = (entry.value ->> 'pageDocId')::uuid
    join public.cw_page_revisions rev on rev.id = (entry.value ->> 'revisionId')::uuid
   order by p.page_no;
end;
$$;

revoke all on function public.get_session_page_docs(uuid) from public, anon, authenticated;
grant execute on function public.get_session_page_docs(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) list_session_resolved_assets：未冻结回退（签名与返回形状不变）
-- ---------------------------------------------------------------------------

create or replace function public.list_session_resolved_assets(p_session_id uuid)
returns table(object_hash text, storage_path text, kind text)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  resolved jsonb;
  session_lecture_id uuid;
  release_snapshot jsonb;
begin
  if uid is null or not public.is_session_member(p_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  select s.courseware_resolved, s.lecture_id into resolved, session_lecture_id
    from public.class_sessions s
   where s.id = p_session_id and s.deleted_at is null;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  if resolved is not null and resolved ->> 'version' = 'cw-session-resolved-v1' then
    return query
    with hashes as (
      select distinct binding ->> 'objectHash' as sha256
        from jsonb_array_elements(coalesce(resolved -> 'bindings', '[]'::jsonb)) as binding
       where jsonb_typeof(binding) = 'object'
         and binding ->> 'objectHash' ~ '^[0-9a-f]{64}$'
    )
    select object.sha256, object.storage_path, object.kind
      from hashes
      join public.cw_asset_objects object on object.sha256 = hashes.sha256
     where object.kind <> 'h5'
     order by object.sha256;
    return;
  end if;

  -- 未冻结：候课/试讲预载走讲次 current release 快照（与开课冻结将 pin 的对象一致）。
  if session_lecture_id is null then
    return;
  end if;
  select r.snapshot into release_snapshot
    from public.cw_lecture_releases r
    join public.course_lectures l on l.current_release_id = r.id
   where l.id = session_lecture_id;
  if release_snapshot is null then
    return;
  end if;

  return query
  select distinct object.sha256, object.storage_path, object.kind
    from jsonb_array_elements(release_snapshot) as entry,
         jsonb_array_elements(entry.value -> 'bindings') as binding
    join public.cw_asset_revisions ar on ar.id = (binding ->> 'assetRevisionId')::uuid
    join public.cw_asset_objects object on object.id = ar.object_id
   where object.kind <> 'h5'
   order by object.sha256;
end;
$$;
