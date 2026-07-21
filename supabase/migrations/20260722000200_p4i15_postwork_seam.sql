-- P4I-15：课后工作与学辅接缝——缺勤/补课生成 + 请假审批联动。详见 .claude/p4i-0-baseline.md
-- 「P4I-15 执行记录」。关键边界：
--   1) 点名/课评/总结/视频审阅的表单本身早已存在（AttendanceDrawer/ReviewDrawer/VideoReviewPanel，
--      P4B/P4D 时期），本迁移不重建它们，只补"缺勤→生成支持任务"和"请假批准→生成补课跟进任务"
--      这两条此前明确标注"保留枚举值、不接生成器"的链路（P4H-9/P4I-5 迁移头部注释）。
--   2) 不自动创建新的补课课次——doc19 没有给排课交互规格，那是独立的排课功能。makeup_followup
--      支持任务的实际内容是"学辅联系家长安排补课"，安排完成后走既有 complete_support_task 手动收尾。
--   3) decide_session_leave_request 是 create or replace 在 P4I-5 定义的既有函数体基础上扩展
--      （同签名，approve 分支追加生成逻辑），不是新函数；原有 UNAUTHENTICATED/REQUEST_NOT_FOUND/
--      REQUEST_ALREADY_DECIDED/FORBIDDEN 校验和 leave 分支行为不变。

-- ---------------------------------------------------------------------------
-- 1. class_support_tasks 新增部分唯一索引，供 absence_check/makeup_followup 去重。
--    preclass_notice/postclass_followup 的生成器 student_id 恒为 null，不受影响。
-- ---------------------------------------------------------------------------

create unique index if not exists class_support_tasks_session_student_kind_idx
  on public.class_support_tasks (session_id, student_id, kind)
  where student_id is not null;

-- ---------------------------------------------------------------------------
-- 2. 启用 absence_check/makeup_followup 两个 policy（此前 P4H-9/P4I-5 均显式保留未启用）。
--    absence_check 原 due_offset_minutes=-120 是从未生效过的占位符，锚点是"标记缺勤时刻"
--    （而非 preclass_notice 那种"上课前"的负偏移语义），改为 1440（次日内联系家长）。
--    makeup_followup 沿用原有 4320（3 天内安排补课），锚点是"请假批准时刻"。
-- ---------------------------------------------------------------------------

update public.support_task_policies
   set enabled = true, due_offset_minutes = 1440
 where kind = 'absence_check';

update public.support_task_policies
   set enabled = true
 where kind = 'makeup_followup';

-- ---------------------------------------------------------------------------
-- 3. record_attendance_absence：点名标记缺勤时生成 absence_check 支持任务。
--    由 saveAttendanceAction 在写入 session_attendance 后，对每个 status='absent' 的学生调用；
--    on conflict 幂等，重复点名编辑不会重复生成。
-- ---------------------------------------------------------------------------

create or replace function public.record_attendance_absence(
  p_session_id uuid,
  p_student_id uuid
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  policy_row public.support_task_policies%rowtype;
  support_user uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;

  select classroom_id into cid from public.class_sessions where id = p_session_id and deleted_at is null;
  if cid is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.can_mark_attendance(cid, uid) then raise exception 'FORBIDDEN'; end if;

  select * into policy_row from public.support_task_policies where kind = 'absence_check';
  if policy_row.enabled is not true then return; end if;

  select assignment.user_id into support_user
    from public.classroom_staff_assignments assignment
   where assignment.classroom_id = cid
     and assignment.responsibility = 'learning_support'
     and assignment.is_primary
   limit 1;

  insert into public.class_support_tasks (classroom_id, session_id, student_id, kind, due_at, assigned_to)
  values (
    cid, p_session_id, p_student_id, 'absence_check',
    now() + make_interval(mins => coalesce(policy_row.due_offset_minutes, 0)), support_user
  )
  on conflict (session_id, student_id, kind) where student_id is not null do nothing;
end;
$$;

revoke all on function public.record_attendance_absence(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_attendance_absence(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. decide_session_leave_request：approve 分支追加生成 makeup_followup 支持任务。
-- ---------------------------------------------------------------------------

create or replace function public.decide_session_leave_request(
  p_request_id uuid,
  p_approve boolean
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  request_row public.session_leave_requests%rowtype;
  cid uuid;
  policy_row public.support_task_policies%rowtype;
  support_user uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;

  select * into request_row from public.session_leave_requests where id = p_request_id for update;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  if request_row.status <> 'pending' then raise exception 'REQUEST_ALREADY_DECIDED'; end if;

  select classroom_id into cid from public.class_sessions where id = request_row.session_id;
  if cid is null or not public.can_mark_attendance(cid, uid) then raise exception 'FORBIDDEN'; end if;

  if p_approve then
    perform public.record_session_change(request_row.session_id, request_row.student_id, 'leave', null, request_row.reason);
    update public.session_leave_requests
       set status = 'approved', decided_by = uid, decided_at = now()
     where id = p_request_id;

    select * into policy_row from public.support_task_policies where kind = 'makeup_followup';
    if policy_row.enabled is true then
      select assignment.user_id into support_user
        from public.classroom_staff_assignments assignment
       where assignment.classroom_id = cid
         and assignment.responsibility = 'learning_support'
         and assignment.is_primary
       limit 1;

      insert into public.class_support_tasks (classroom_id, session_id, student_id, kind, due_at, assigned_to)
      values (
        cid, request_row.session_id, request_row.student_id, 'makeup_followup',
        now() + make_interval(mins => coalesce(policy_row.due_offset_minutes, 0)), support_user
      )
      on conflict (session_id, student_id, kind) where student_id is not null do nothing;
    end if;
  else
    update public.session_leave_requests
       set status = 'rejected', decided_by = uid, decided_at = now()
     where id = p_request_id;
  end if;

  perform public.emit_domain_event(
    'leave_request.' || (case when p_approve then 'approved' else 'rejected' end),
    'session_leave_request', p_request_id, '{}'::jsonb, uid, null
  );
end;
$$;
