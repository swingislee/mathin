-- ============================================================================
-- P4-7 作业（docs/plan/08-§6，03-§3.4）
-- assignments：教师布置，classroom_members 教师可写；content 目前是 {text} 纯文本
--   说明（不引入 BlockNote，保持轻量，与 03-§3.8 白板/笔记的富文本范围区分）。
-- submissions：学生提交答案。写入一律走 SECURITY DEFINER RPC
--   （submit_assignment / grade_submission），表本身不开放 insert/update——
--   教师与学生共用 authenticated 角色，列权限无法按「谁在写」区分，
--   RPC 内部用 auth.uid() 自行判定比 RLS 列拆分更不容易留后门（同 08-§4 建室模式）。
-- ============================================================================

create table public.assignments (
  id           uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  title        text not null default '',
  content      jsonb not null default '{}',
  due_at       timestamptz,
  created_by   uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint assignments_content_cap check (octet_length(content::text) <= 65536)
);

comment on table public.assignments is '作业；content = {text}，教师布置说明';

create index assignments_classroom_idx on public.assignments (classroom_id, created_at desc);

create trigger assignments_set_updated_at
  before update on public.assignments
  for each row execute function public.set_updated_at();

create table public.submissions (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  content       jsonb not null default '{}',
  submitted_at  timestamptz,
  score         numeric,
  feedback      text not null default '',
  graded_by     uuid references public.profiles (id) on delete set null,
  graded_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (assignment_id, user_id),
  constraint submissions_content_cap check (octet_length(content::text) <= 65536),
  constraint submissions_score_range check (score is null or (score >= 0 and score <= 100))
);

comment on table public.submissions is '学生提交；一生一题一行（upsert 覆盖重交），score/feedback 仅 grade_submission 可写';

create index submissions_assignment_idx on public.submissions (assignment_id);

create trigger submissions_set_updated_at
  before update on public.submissions
  for each row execute function public.set_updated_at();

-- RLS 辅助（security definer 防策略递归，经 classroom_members 判成员/教师）
create function public.is_assignment_teacher(aid uuid, uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.assignments a
      join public.classroom_members m on m.classroom_id = a.classroom_id
     where a.id = aid and m.user_id = uid and m.role = 'teacher'
  );
$$;

create function public.is_assignment_member(aid uuid, uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.assignments a
      join public.classroom_members m on m.classroom_id = a.classroom_id
     where a.id = aid and m.user_id = uid
  );
$$;

revoke all on function public.is_assignment_teacher(uuid, uuid) from public;
revoke all on function public.is_assignment_member(uuid, uuid) from public;
grant execute on function public.is_assignment_teacher(uuid, uuid) to authenticated;
grant execute on function public.is_assignment_member(uuid, uuid) to authenticated;

-- 学生提交：upsert，自带成员校验
create function public.submit_assignment(p_assignment_id uuid, p_content jsonb)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  if not public.is_assignment_member(p_assignment_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  insert into public.submissions (assignment_id, user_id, content, submitted_at)
  values (p_assignment_id, uid, coalesce(p_content, '{}'::jsonb), now())
  on conflict (assignment_id, user_id)
  do update set content = excluded.content, submitted_at = excluded.submitted_at;
end;
$$;

-- 教师批改：仅该作业所在教室的教师
create function public.grade_submission(p_submission_id uuid, p_score numeric, p_feedback text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  aid uuid;
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  select assignment_id into aid from public.submissions where id = p_submission_id;
  if aid is null or not public.is_assignment_teacher(aid, uid) then
    raise exception 'FORBIDDEN';
  end if;
  update public.submissions
     set score = p_score, feedback = coalesce(p_feedback, ''), graded_by = uid, graded_at = now()
   where id = p_submission_id;
end;
$$;

revoke all on function public.submit_assignment(uuid, jsonb) from public;
revoke all on function public.grade_submission(uuid, numeric, text) from public;
grant execute on function public.submit_assignment(uuid, jsonb) to authenticated;
grant execute on function public.grade_submission(uuid, numeric, text) to authenticated;

alter table public.assignments enable row level security;

create policy "assignments_select_member" on public.assignments
  for select to authenticated
  using (public.is_classroom_member(classroom_id, (select auth.uid())));
create policy "assignments_insert_teacher" on public.assignments
  for insert to authenticated
  with check (
    public.is_classroom_teacher(classroom_id, (select auth.uid()))
    and created_by = (select auth.uid())
  );
create policy "assignments_update_teacher" on public.assignments
  for update to authenticated
  using (public.is_classroom_teacher(classroom_id, (select auth.uid())))
  with check (public.is_classroom_teacher(classroom_id, (select auth.uid())));
create policy "assignments_delete_teacher" on public.assignments
  for delete to authenticated
  using (public.is_classroom_teacher(classroom_id, (select auth.uid())));

revoke all on public.assignments from anon, authenticated;
grant select on public.assignments to authenticated;
grant insert (classroom_id, title, content, due_at, created_by) on public.assignments to authenticated;
grant update (title, content, due_at) on public.assignments to authenticated;
grant delete on public.assignments to authenticated;

alter table public.submissions enable row level security;

-- 读：本人或该作业所在教室的教师；写：无表级授权，一律走上面两个 RPC
create policy "submissions_select_own_or_teacher" on public.submissions
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_assignment_teacher(assignment_id, (select auth.uid()))
  );

revoke all on public.submissions from anon, authenticated;
grant select on public.submissions to authenticated;
