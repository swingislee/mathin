-- P4E-O1 §7.2：按课次代课与实际教师课时归属。

create or replace function public.list_substitute_candidates(p_session_id uuid)
returns table(id uuid, display_name text)
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); cid uuid;
begin
  select classroom_id into cid from public.class_sessions
   where class_sessions.id=p_session_id and deleted_at is null;
  if uid is null or cid is null or not public.can_manage_classroom(cid,uid) then
    raise exception 'FORBIDDEN';
  end if;
  return query
    select p.id,coalesce(nullif(trim(p.display_name),''),left(p.id::text,8))
      from public.profiles p
     where p.is_active and p.role in ('staff','admin')
     order by p.display_name nulls last,p.id;
end $$;

create or replace function public.assign_session_substitute(
  p_session_id uuid,p_teacher_id uuid,p_reason text default ''
) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); cid uuid; old_teacher uuid;
begin
  select classroom_id,teacher_override into cid,old_teacher
    from public.class_sessions
   where id=p_session_id and deleted_at is null for update;
  if uid is null or cid is null or not public.can_manage_classroom(cid,uid) then
    raise exception 'FORBIDDEN';
  end if;
  if p_teacher_id is not null and not exists(
    select 1 from public.profiles where id=p_teacher_id and is_active and role in ('staff','admin')
  ) then
    raise exception 'INVALID_TEACHER';
  end if;

  update public.class_sessions set teacher_override=p_teacher_id where id=p_session_id;
  insert into public.session_changes(session_id,kind,from_session,reason,operated_by)
  values(p_session_id,'substitute',p_session_id,
    left(trim(coalesce(p_reason,'')),1000),uid);
  perform public.emit_domain_event('session_change.substitute','class_session',p_session_id,
    jsonb_build_object('previousTeacherId',old_teacher,'teacherId',p_teacher_id,'reason',left(trim(coalesce(p_reason,'')),1000)),null,null);
end $$;

-- 课表和统计统一使用此视图中的 actual_teacher_id，避免仍按班级教师误算代课课时。
create or replace view public.session_actual_teachers
with (security_invoker=true) as
select cs.id as session_id,cs.classroom_id,
       coalesce(cs.teacher_override,base_teacher.user_id) as actual_teacher_id,
       cs.scheduled_at,cs.duration_min,cs.started_at,cs.ended_at
  from public.class_sessions cs
  left join lateral (
    select cm.user_id from public.classroom_members cm
     where cm.classroom_id=cs.classroom_id and cm.role='teacher'
     order by cm.created_at,cm.user_id limit 1
  ) base_teacher on true
 where cs.deleted_at is null;

revoke all on function public.list_substitute_candidates(uuid) from public,anon,authenticated;
revoke all on function public.assign_session_substitute(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.list_substitute_candidates(uuid) to authenticated;
grant execute on function public.assign_session_substitute(uuid,uuid,text) to authenticated;
revoke all on public.session_actual_teachers from anon,authenticated;
grant select on public.session_actual_teachers to authenticated;
