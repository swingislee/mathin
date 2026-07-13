-- P4E-C §6.2：平台侧 UGC 下架/恢复入口，区别于作者自己的 hidden。
create or replace function public.moderate_post(p_post_id uuid,p_status text,p_reason text default '')
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); previous text;
begin
  if uid is null or not public.is_admin(uid) then raise exception 'FORBIDDEN'; end if;
  if p_status not in('approved','rejected','hidden') then raise exception 'INVALID_STATUS'; end if;
  select review_status into previous from public.posts where id=p_post_id for update;
  if previous is null then raise exception 'NOT_FOUND'; end if;
  update public.posts set review_status=p_status where id=p_post_id;
  perform public.emit_domain_event('post.moderated','post',p_post_id,
    jsonb_build_object('before',previous,'after',p_status,'reason',left(trim(coalesce(p_reason,'')),1000)),null,null);
end $$;
revoke all on function public.moderate_post(uuid,text,text) from public,anon,authenticated;
grant execute on function public.moderate_post(uuid,text,text) to authenticated;
