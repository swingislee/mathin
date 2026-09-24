# 待验证数据库候选

这里的 SQL 不参与 migration ledger 和生产发布。只有在明确的隔离目标通过受影响 SQL/RLS/回退检查、生成真实数据库类型后，才晋级 `supabase/migrations/`。

- `20260924000100_wechat_oauth_tickets.sql`：网站微信 OAuth 的短期凭据、限流、资料快照和绑定审计。当前本机 Docker 启动失败，应用入口保持关闭。验证断言和后续接入条件见 [微信网站应用 OAuth](../../docs/runbooks/wechat-website-oauth.md)。
