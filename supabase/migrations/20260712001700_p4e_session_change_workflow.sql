-- P4E-V §4.2：请假 -> 补课安排完整工作流与严格对象校验。

create or replace function public.get_session_change_options(p_session_id uuid)
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); cid uuid;
begin
  select classroom_id into cid from public.class_sessions where id=p_session_id and deleted_at is null;
  if uid is null or cid is null or not public.can_mark_attendance(cid,uid) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'students',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.name,s.id)
      from public.enrollments e join public.students s on s.id=e.student_id
     where e.classroom_id=cid and e.status='active' and s.deleted_at is null),'[]'::jsonb),
    'targets',coalesce((select jsonb_agg(jsonb_build_object('id',cs.id,'title',cs.title,'scheduledAt',cs.scheduled_at,'classroomName',c.name) order by cs.scheduled_at)
      from public.class_sessions cs join public.classrooms c on c.id=cs.classroom_id
     where cs.id<>p_session_id and cs.deleted_at is null and cs.scheduled_at>=now()
       and (public.can_mark_attendance(cs.classroom_id,uid) or public.can_manage_classroom(cs.classroom_id,uid))),'[]'::jsonb)
  );
end $$;

create or replace function public.record_session_change(
 p_session_id uuid,p_student_id uuid,p_kind text,p_to_session uuid default null,p_reason text default ''
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); cid uuid; target_cid uuid; change_id uuid;
begin
 select classroom_id into cid from public.class_sessions where id=p_session_id and deleted_at is null;
 if uid is null or cid is null or not public.can_mark_attendance(cid,uid) then raise exception 'FORBIDDEN'; end if;
 if p_kind not in ('leave','makeup') then raise exception 'INVALID_KIND'; end if;
 if not exists(select 1 from public.enrollments where classroom_id=cid and student_id=p_student_id and status='active')
 then raise exception 'STUDENT_NOT_ENROLLED'; end if;
 if p_kind='makeup' then
   select classroom_id into target_cid from public.class_sessions
    where id=p_to_session and id<>p_session_id and deleted_at is null and scheduled_at>=now();
   if target_cid is null or not (public.can_mark_attendance(target_cid,uid) or public.can_manage_classroom(target_cid,uid))
   then raise exception 'INVALID_TARGET_SESSION'; end if;
 else
   if p_to_session is not null then raise exception 'INVALID_TARGET_SESSION'; end if;
   insert into public.session_attendance(session_id,student_id,status,note)
   values(p_session_id,p_student_id,'leave',left(trim(coalesce(p_reason,'')),500))
   on conflict(session_id,student_id) do update set status='leave',note=excluded.note;
   select id into change_id from public.session_changes
    where session_id=p_session_id and student_id=p_student_id and kind='leave'
    order by created_at desc limit 1;
   if change_id is not null then return change_id; end if;
 end if;
 insert into public.session_changes(session_id,student_id,kind,from_session,to_session,reason,operated_by)
 values(p_session_id,p_student_id,p_kind,p_session_id,p_to_session,left(trim(coalesce(p_reason,'')),1000),uid)
 returning id into change_id;
 perform public.emit_domain_event('session_change.'||p_kind,'session_change',change_id,
   jsonb_build_object('sessionId',p_session_id,'studentId',p_student_id,'toSession',p_to_session),null,null);
 return change_id;
end $$;

revoke all on function public.get_session_change_options(uuid) from public,anon,authenticated;
grant execute on function public.get_session_change_options(uuid) to authenticated;
