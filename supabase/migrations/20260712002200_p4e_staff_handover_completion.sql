-- P4E-O §7.1：交接预览、管理员保护与成员访问撤销。
create or replace function public.get_staff_handover_preview(p_target uuid)
returns table(student_count bigint,future_override_count bigint,classroom_count bigint)
language plpgsql security definer stable set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not public.has_perm(auth.uid(),'staff.manage') then raise exception 'FORBIDDEN'; end if;
 return query select
  (select count(*) from public.students where assigned_to=p_target and deleted_at is null),
  (select count(*) from public.class_sessions where teacher_override=p_target and coalesce(scheduled_at,now())>=now() and deleted_at is null),
  (select count(*) from public.classroom_members where user_id=p_target and role='teacher');
end $$;

create or replace function public.deactivate_staff(p_target uuid,p_reassign_to uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare target_role text; students_moved bigint; sessions_moved bigint; classrooms_removed bigint;
begin
 if auth.uid() is null or not public.has_perm(auth.uid(),'staff.manage') or p_target=auth.uid() then raise exception 'FORBIDDEN'; end if;
 select role into target_role from public.profiles where id=p_target and role in('staff','admin') and is_active for update;
 if target_role is null then raise exception 'TARGET_NOT_STAFF'; end if;
 if target_role='admin' and (select count(*) from public.profiles where role='admin' and is_active)<=1 then raise exception 'LAST_ACTIVE_ADMIN'; end if;
 if p_reassign_to=p_target or (p_reassign_to is not null and not public.is_staff(p_reassign_to)) then raise exception 'INVALID_REPLACEMENT'; end if;
 update public.students set assigned_to=p_reassign_to where assigned_to=p_target and deleted_at is null; get diagnostics students_moved=row_count;
 update public.class_sessions set teacher_override=p_reassign_to where teacher_override=p_target and coalesce(scheduled_at,now())>=now() and deleted_at is null; get diagnostics sessions_moved=row_count;
 if p_reassign_to is not null then
   insert into public.classroom_members(classroom_id,user_id,role)
   select classroom_id,p_reassign_to,'teacher' from public.classroom_members where user_id=p_target and role='teacher' on conflict do nothing;
 end if;
 delete from public.classroom_members where user_id=p_target and role='teacher'; get diagnostics classrooms_removed=row_count;
 update public.profiles set is_active=false where id=p_target;
 perform public.emit_domain_event('staff.deactivated','profile',p_target,
  jsonb_build_object('reassignedTo',p_reassign_to,'studentsMoved',students_moved,'sessionsMoved',sessions_moved,'classroomsRemoved',classrooms_removed),null,null);
end $$;
revoke all on function public.get_staff_handover_preview(uuid) from public,anon,authenticated;
grant execute on function public.get_staff_handover_preview(uuid) to authenticated;
