-- ============================================================================
-- P2-2 游戏对局与成绩（docs/plan/03-3.2）
-- 反作弊模型：两张表都启用 RLS 且不给 anon/authenticated 任何写策略——
-- 浏览器直接 POST 一律被拒；写入只能由 Next 服务端（service role）在
-- Server Action 中完成：开局时服务端生成 seed 存入 game_sessions，
-- 提交时服务端校验解的正确性且 now() - started_at ≈ duration_ms（容差 10s）。
-- ============================================================================

-- 对局凭据：一次「开始游戏」= 一行；提交成绩时核销（写 completed_at）
create table public.game_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  game_id      text not null,            -- 对应 features/games/registry.ts 的 id
  difficulty   text not null,
  seed         text not null,            -- 服务端生成的题目种子，题面由 seed 确定性推导
  started_at   timestamptz not null default now(),
  completed_at timestamptz               -- 非空 = 已核销，不可重复提交
);

comment on table public.game_sessions is
  '对局凭据，仅 service role 可读写（RLS 无策略即全拒）；客户端经 Server Action 间接使用';

create index game_sessions_user_idx on public.game_sessions (user_id, game_id);

alter table public.game_sessions enable row level security;
-- 故意不建任何策略：普通角色读写全部被拒（反作弊边界）

-- 有效成绩：仅由服务端校验通过后写入
create table public.game_scores (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  game_id     text not null,
  difficulty  text not null,
  seed        text not null,
  duration_ms integer not null check (duration_ms > 3000),
  proof       jsonb,                     -- 完整解，供复核与展示
  created_at  timestamptz not null default now(),
  unique (user_id, game_id, difficulty, seed)
);

comment on table public.game_scores is
  '有效成绩；所有人可读（排行榜），写入仅 service role（经 Server Action 校验）';

-- 排行榜按 (游戏, 难度) 取最好用时
create index game_scores_board_idx on public.game_scores (game_id, difficulty, duration_ms);

alter table public.game_scores enable row level security;

create policy "game_scores_select_all" on public.game_scores
  for select using (true);
-- 故意不建 insert/update/delete 策略：成绩只能由服务端写入
