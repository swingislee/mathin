-- P4I-15：修复 session_attendance 的 UPDATE 授权缺口。
--
-- 发现过程：本任务把 AttendanceDrawer 接进课后 tab 后用真实教师账号走查点名保存，
-- PostgREST 直接返回 42501 permission denied，hint 精确指出
-- "GRANT UPDATE ON public.session_attendance TO authenticated"。核实
-- `20260709000700_school_attendance.sql` 当时只授予了列级 `update (status, note)`，
-- 但 PostgREST 把 `.upsert()` 编译成 `insert ... on conflict do update` 时，
-- ON CONFLICT DO UPDATE 分支需要该角色持有表级 UPDATE 权限（列级授权不够），
-- 导致点名功能自 P4B-5 建成以来在真实 PostgREST 请求路径下从未真正可用
-- （直接用 psql 模拟同一 role/claim 反而会成功，因为 psql 走的不是 PostgREST
-- 编译出的同一条语句形态，掩盖了这个缺口——纯 SQL 层面复核无法复现，只有真实
-- HTTP 请求会触发）。
--
-- 修复：表级 grant update（无列限制）。不削弱 marked_by/marked_at 的防伪造——
-- before insert or update 触发器 session_attendance_set_marker 无条件用
-- auth.uid()/now() 覆盖这两列，客户端能否在 UPDATE 语句里"提到"这两列不影响
-- 触发器的强制覆写，因此扩大表级授权不改变实际可写入的数据。

grant update on public.session_attendance to authenticated;
