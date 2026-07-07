-- ============================================================================
-- P2-4 排行榜视图（docs/plan/03-3.2）
-- 每人在每个 (游戏, 难度) 下的最好成绩；security_invoker 让视图沿用查询者
-- 的 RLS（game_scores 与 profiles 均为公开可读，排行对未登录访客同样可见）。
-- ============================================================================

create view public.game_leaderboard
with (security_invoker = true) as
select distinct on (s.game_id, s.difficulty, s.user_id)
  s.game_id,
  s.difficulty,
  s.user_id,
  s.duration_ms,
  s.created_at,
  p.display_name,
  p.avatar_url
from public.game_scores s
join public.profiles p on p.id = s.user_id
order by s.game_id, s.difficulty, s.user_id, s.duration_ms, s.created_at;

grant select on public.game_leaderboard to anon, authenticated;
