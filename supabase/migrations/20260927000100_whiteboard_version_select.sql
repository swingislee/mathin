-- 画板使用列级 SELECT 保护 invite_code；乐观锁读取同时需要 version。
-- 保留成员 RLS、邀请码专属 RPC 和快照写入 RPC 的权限边界。
grant select (version) on public.whiteboards to authenticated;
