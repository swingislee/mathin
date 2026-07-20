-- P4I-1: 使用环境偏好（staff/family/learning）
-- 复用现有 profiles_update_own RLS（id = auth.uid()）与 protect_profile_role 触发器
-- （该触发器只锁 role 列，不影响本列的自助更新），不需要新表或新 RPC。
alter table public.profiles
  add column if not exists last_active_environment text not null default 'staff'
  check (last_active_environment in ('staff', 'family', 'learning'));
