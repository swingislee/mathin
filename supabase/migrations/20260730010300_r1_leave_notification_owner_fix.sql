-- R1-5: replace the legacy leave notification trigger without mutating its
-- supabase_admin-owned function. The new trigger qualifies every identifier
-- and sends decisions to the student plus all currently linked guardians.

begin;

create or replace function public.notify_leave_request_roles_r1()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  recipient uuid;
  source_classroom_id uuid;
  student_name text;
begin
  select session_row.classroom_id, student_row.name
    into source_classroom_id, student_name
    from public.class_sessions session_row
    join public.students student_row on student_row.id = new.student_id
   where session_row.id = new.session_id;
  if tg_op = 'INSERT' then
    for recipient in
      select assignment_row.user_id
        from public.classroom_staff_assignments assignment_row
       where assignment_row.classroom_id = source_classroom_id
         and assignment_row.responsibility in ('primary_teacher', 'assistant_teacher', 'learning_support')
    loop
      perform public.emit_domain_event(
        'leave_request.submitted', 'session_leave_request', new.id,
        jsonb_build_object('studentId', new.student_id, 'studentName', student_name, 'reason', new.reason),
        recipient, '/dashboard/sessions/' || new.session_id::text
      );
    end loop;
  elsif new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    for recipient in
      select student_row.user_id from public.students student_row
       where student_row.id = new.student_id and student_row.user_id is not null
      union
      select guardian_row.guardian_id from public.student_guardians guardian_row
       where guardian_row.student_id = new.student_id
    loop
      perform public.emit_domain_event(
        'leave_request.' || new.status, 'session_leave_request', new.id,
        jsonb_build_object('studentId', new.student_id, 'studentName', student_name, 'reason', new.reason),
        recipient, '/dashboard/children?child=' || new.student_id::text || '#leave'
      );
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists session_leave_requests_notify_roles on public.session_leave_requests;
drop trigger if exists session_leave_requests_notify_family_decision on public.session_leave_requests;
create trigger session_leave_requests_notify_roles
after insert or update of status on public.session_leave_requests
for each row execute function public.notify_leave_request_roles_r1();

revoke all on function public.notify_leave_request_roles_r1() from public, anon, authenticated;

commit;
