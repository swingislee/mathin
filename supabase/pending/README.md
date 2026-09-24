# 待验证数据库候选

这里的 SQL 不参与 migration ledger 和生产发布。只有在明确的隔离目标通过受影响 SQL/RLS/回退检查、生成真实数据库类型后，才晋级 `supabase/migrations/`。

- `20260924000100_wechat_oauth_tickets.sql`：网站微信 OAuth 的短期凭据、限流、资料快照和绑定审计。2026-09-25 已通过本机隔离目标的 SQL／权限／RLS／事务回滚检查，并修复默认 `service_role` 权限过宽的问题；尚未持久应用、生成微信类型或晋级正式迁移，应用入口保持关闭。复现脚本、断言和后续条件见 [微信网站应用 OAuth](../../docs/runbooks/wechat-website-oauth.md)。
