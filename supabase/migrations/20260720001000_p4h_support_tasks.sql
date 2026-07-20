-- P4H-9 §9：学辅任务模型。不接第三方通知，只记录任务闭环；
-- 首期只生成 preclass_notice（课次创建）与 postclass_followup（课次下课）两种，
-- absence_check/makeup_followup 枚举值保留给后续任务，本期不自动生成、无定时 cron。

create table public.class_support_tasks (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  session_id uuid references public.class_sessions(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  kind text not null check (kind in (
    'preclass_notice','absence_check','makeup_followup','postclass_followup'
  )),
  status text not null default 'pending'
    check (status in ('pending','done','skipped')),
  due_at timestamptz,
  assigned_to uuid references public.profiles(id) on delete set null,
  note text not null default '',
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index class_support_tasks_classroom_idx on public.class_support_tasks (classroom_id, status);
create index class_support_tasks_assigned_idx on public.class_support_tasks (assigned_to, status);

alter table public.class_support_tasks enable row level security;

create policy "class_support_tasks_select_scope" on public.class_support_tasks
  for select to authenticated
  using (
    public.is_admin((select auth.uid()))
    or public.has_perm((select auth.uid()), 'class.view.all')
    or public.is_classroom_staff_assigned(classroom_id, (select auth.uid()))
  );

-- 没有直接 INSERT/UPDATE/DELETE grant：生成靠下面的触发器（超级用户身份绕过 RLS），
-- 完成/跳过靠 complete_support_task RPC，避免绕过状态机直接改状态。
revoke all on table public.class_support_tasks from anon, authenticated;
grant select on table public.class_support_tasks to authenticated;

-- ---------------------------------------------------------------------------
-- 生成触发器
-- ---------------------------------------------------------------------------

create or replace function public.generate_preclass_support_task()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  support_row record;
begin
  for support_row in
    select user_id from public.classroom_staff_assignments
     where classroom_id = new.classroom_id and responsibility = 'learning_support'
  loop
    insert into public.class_support_tasks (classroom_id, session_id, kind, due_at, assigned_to)
    values (new.classroom_id, new.id, 'preclass_notice', new.scheduled_at, support_row.user_id);
  end loop;
  return new;
end;
$$;

create trigger class_sessions_generate_preclass_task
  after insert on public.class_sessions
  for each row execute function public.generate_preclass_support_task();

create or replace function public.generate_postclass_support_task()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  support_row record;
begin
  if old.ended_at is null and new.ended_at is not null then
    for support_row in
      select user_id from public.classroom_staff_assignments
       where classroom_id = new.classroom_id and responsibility = 'learning_support'
    loop
      insert into public.class_support_tasks (classroom_id, session_id, kind, due_at, assigned_to)
      values (new.classroom_id, new.id, 'postclass_followup', new.ended_at + interval '2 days', support_row.user_id);
    end loop;
  end if;
  return new;
end;
$$;

create trigger class_sessions_generate_postclass_task
  after update on public.class_sessions
  for each row execute function public.generate_postclass_support_task();

-- ---------------------------------------------------------------------------
-- 完成/跳过任务：唯一的状态变更入口
-- ---------------------------------------------------------------------------

create or replace function public.complete_support_task(
  p_task_id uuid,
  p_status text,
  p_note text default ''
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  task_row public.class_support_tasks%rowtype;
  can_view boolean;
  can_complete boolean;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_status not in ('done', 'skipped') then raise exception 'INVALID_STATUS'; end if;

  select * into task_row from public.class_support_tasks where id = p_task_id for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if task_row.status <> 'pending' then raise exception 'TASK_ALREADY_COMPLETED'; end if;

  can_view := public.is_admin(uid)
    or public.has_perm(uid, 'class.view.all')
    or public.is_classroom_staff_assigned(task_row.classroom_id, uid);
  if not can_view then raise exception 'FORBIDDEN_SCOPE'; end if;

  can_complete := case task_row.kind
    when 'postclass_followup' then public.has_perm(uid, 'followup.write')
    when 'absence_check' then public.has_perm(uid, 'attendance.mark') or public.has_perm(uid, 'class.manage')
    else public.is_classroom_staff_assigned(task_row.classroom_id, uid) or public.has_perm(uid, 'class.manage')
  end;
  if not can_complete then raise exception 'FORBIDDEN'; end if;

  update public.class_support_tasks
     set status = p_status, completed_at = now(), completed_by = uid, note = left(btrim(coalesce(p_note, '')), 1000)
   where id = p_task_id;

  perform public.emit_domain_event(
    'support_task.completed', 'class_support_task', p_task_id,
    jsonb_build_object('kind', task_row.kind, 'status', p_status), uid, null
  );
end;
$$;

revoke all on function public.complete_support_task(uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_support_task(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 我的学辅任务列表
-- ---------------------------------------------------------------------------

create or replace function public.list_my_support_tasks(p_status text default 'pending')
returns table(
  id uuid,
  classroom_id uuid,
  classroom_name text,
  session_id uuid,
  session_title text,
  kind text,
  status text,
  due_at timestamptz,
  note text
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  can_view_all boolean;
  v_status text := nullif(lower(trim(coalesce(p_status, ''))), '');
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if v_status is not null and v_status not in ('pending', 'done', 'skipped') then raise exception 'INVALID_STATUS'; end if;
  can_view_all := public.has_perm(uid, 'class.view.all');

  return query
  select
    task_row.id,
    task_row.classroom_id,
    classroom_row.name,
    task_row.session_id,
    session_row.title,
    task_row.kind,
    task_row.status,
    task_row.due_at,
    task_row.note
  from public.class_support_tasks task_row
  join public.classrooms classroom_row on classroom_row.id = task_row.classroom_id
  left join public.class_sessions session_row on session_row.id = task_row.session_id
  where (v_status is null or task_row.status = v_status)
    and (
      can_view_all
      or public.is_classroom_staff_assigned(task_row.classroom_id, uid)
    )
  order by task_row.due_at asc nulls last, task_row.created_at asc
  limit 100;
end;
$$;

revoke all on function public.list_my_support_tasks(text) from public, anon, authenticated;
grant execute on function public.list_my_support_tasks(text) to authenticated;
