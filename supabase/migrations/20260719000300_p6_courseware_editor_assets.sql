-- P6-7 图片「仅本页替换」：对象先入 CAS，再由本 RPC 建独立 shared_asset 分支并重绑当前页。
-- 不推进旧 shared_asset 指针，故不影响其他页/已冻结课次。

create or replace function public.replace_cw_page_image_binding(
  p_page_doc_id uuid,
  p_binding_key text,
  p_sha256 text,
  p_mime text,
  p_byte_count bigint,
  p_width int,
  p_height int,
  p_name text default ''
)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_object uuid; v_asset uuid; v_revision uuid;
begin
  if v_uid is null or not public.has_perm(v_uid, 'courseware.asset.manage') then raise exception 'FORBIDDEN'; end if;
  if p_page_doc_id is null or p_binding_key !~ '^[0-9a-f]{64}$' or p_sha256 !~ '^[0-9a-f]{64}$'
     or p_mime not in ('image/png','image/jpeg','image/webp','image/gif')
     or p_byte_count <= 0 or p_byte_count > 52428800 or p_width <= 0 or p_height <= 0 then
    raise exception 'INVALID_IMAGE_UPLOAD';
  end if;
  if not exists (select 1 from public.cw_page_asset_bindings where page_doc_id=p_page_doc_id and binding_key=p_binding_key and kind='image') then
    raise exception 'IMAGE_BINDING_NOT_FOUND';
  end if;
  insert into public.cw_asset_objects(sha256,mime,byte_count,width,height,kind,storage_path)
  values(p_sha256,p_mime,p_byte_count,p_width,p_height,'image','sha256/' || substr(p_sha256,1,2) || '/' || p_sha256)
  on conflict (sha256) do update set sha256=excluded.sha256
  returning id into v_object;
  insert into public.cw_shared_assets(name,kind,role,candidate_key,created_by)
  values(left(trim(coalesce(p_name,'')),500),'image','source','manual:' || p_sha256 || ':' || gen_random_uuid()::text,v_uid)
  returning id into v_asset;
  insert into public.cw_asset_revisions(shared_asset_id,revision_no,object_id,variant,note,created_by)
  values(v_asset,1,v_object,'manual-edit','Page-only image replacement',v_uid) returning id into v_revision;
  update public.cw_shared_assets set published_revision_id=v_revision where id=v_asset;
  update public.cw_page_asset_bindings set shared_asset_id=v_asset,pinned_revision_id=v_revision
    where page_doc_id=p_page_doc_id and binding_key=p_binding_key;
  return v_revision;
end;
$$;
revoke all on function public.replace_cw_page_image_binding(uuid,text,text,text,bigint,int,int,text) from public, anon, authenticated;
grant execute on function public.replace_cw_page_image_binding(uuid,text,text,text,bigint,int,int,text) to authenticated;
