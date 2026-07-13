-- P4D-5：流失学生回流，状态与时间线同事务。
create or replace function public.recover_lost_student(p_student_id uuid)returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid();
begin
 if uid is null or not public.has_perm(uid,'student.edit') or not public.has_perm(uid,'followup.write') then raise exception 'FORBIDDEN';end if;
 if not public.can_access_student(p_student_id,uid) then raise exception 'FORBIDDEN_SCOPE';end if;
 update public.students set follow_up_status='following',status=case when status='invalid' then 'lead' else status end where id=p_student_id and deleted_at is null;
 if not found then raise exception 'NOT_FOUND';end if;
 insert into public.student_follow_ups(student_id,author_id,content,kind,status_after)values(p_student_id,uid,'流失回流','note','following');
end $$;
revoke all on function public.recover_lost_student(uuid) from public,anon,authenticated;grant execute on function public.recover_lost_student(uuid) to authenticated;
