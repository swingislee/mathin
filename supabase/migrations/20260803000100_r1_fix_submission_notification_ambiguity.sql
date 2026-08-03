-- R1 人工验收 §1.2 造数时发现：notify_family_learning_change() 在 submissions 分支里
-- 用 `classroom_id` / `student_id` 同时作为 plpgsql 变量名与被查询表的列名，PostgreSQL 以
-- variable_conflict=error 解析，任何 insert into public.submissions 都会在触发器里抛
-- `column reference "classroom_id" is ambiguous`，学生提交作业（submit_assignment →
-- submit_assignment_for_student）与批改后的家庭通知因此完全不可用。
--
-- 这里只把局部变量改成 v_ 前缀消歧，通知的收件人、事件类型、payload 与 deep link 全部不变。
-- 同批清理 notify_leave_request_change()：它带同一处歧义，且已被
-- notify_leave_request_roles_r1() 取代，留在库里只会被误当作可用实现复制。

begin;

create or replace function public.notify_family_learning_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  recipient uuid;
  v_classroom_id uuid;
  v_student_id uuid;
  v_student_name text;
  v_assignment_title text;
begin
  if tg_table_name = 'assignments' then
    for v_student_id, v_student_name, recipient in
      select student_row.id, student_row.name, target.user_id
        from public.enrollments enrollment_row
        join public.students student_row on student_row.id = enrollment_row.student_id
        cross join lateral (
          select student_row.user_id as user_id
          union
          select guardian_row.guardian_id
            from public.student_guardians guardian_row
           where guardian_row.student_id = student_row.id and 'grades' = any(guardian_row.scope)
        ) target
       where enrollment_row.classroom_id = new.classroom_id
         and enrollment_row.status = 'active' and target.user_id is not null
    loop
      perform public.emit_domain_event(
        'assignment.published', 'assignment', new.id,
        jsonb_build_object('title', new.title, 'studentId', v_student_id, 'studentName', v_student_name),
        recipient, '/dashboard/assignments/' || new.id::text || '?student=' || v_student_id::text
      );
    end loop;
  elsif tg_table_name = 'submissions' then
    select assignment_row.classroom_id, assignment_row.title, student_row.id, student_row.name
      into v_classroom_id, v_assignment_title, v_student_id, v_student_name
      from public.assignments assignment_row
      join public.students student_row on student_row.user_id = new.user_id
     where assignment_row.id = new.assignment_id;
    if tg_op = 'INSERT' or new.submitted_at is distinct from old.submitted_at then
      for recipient in
        select member_row.user_id from public.classroom_members member_row
         where member_row.classroom_id = v_classroom_id and member_row.role = 'teacher'
      loop
        perform public.emit_domain_event(
          'assignment.submitted', 'submission', new.id,
          jsonb_build_object('title', v_assignment_title, 'studentId', v_student_id, 'studentName', v_student_name),
          recipient, '/classroom/' || v_classroom_id::text || '/assignment/' || new.assignment_id::text
        );
      end loop;
    end if;
    if tg_op = 'UPDATE' and new.graded_at is distinct from old.graded_at and new.graded_at is not null then
      for recipient in
        select target.user_id from (
          select new.user_id as user_id
          union
          select guardian_row.guardian_id
            from public.student_guardians guardian_row
           where guardian_row.student_id = v_student_id and 'grades' = any(guardian_row.scope)
        ) target where target.user_id is not null
      loop
        perform public.emit_domain_event(
          'assignment.graded', 'submission', new.id,
          jsonb_build_object('title', v_assignment_title, 'studentId', v_student_id, 'studentName', v_student_name, 'score', new.score),
          recipient, '/dashboard/assignments/' || new.assignment_id::text || '?student=' || v_student_id::text
        );
      end loop;
    end if;
  end if;
  return new;
end
$$;

drop function if exists public.notify_leave_request_change();

do $$
begin
  if not exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.submissions'::regclass
       and tgname = 'submissions_notify_family'
       and not tgisinternal
  ) then
    raise exception 'SUBMISSION_NOTIFICATION_TRIGGER_MISSING';
  end if;
  if not exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.session_leave_requests'::regclass
       and tgname = 'session_leave_requests_notify_roles'
       and not tgisinternal
  ) then
    raise exception 'LEAVE_REQUEST_NOTIFICATION_TRIGGER_MISSING';
  end if;
end;
$$;

commit;
