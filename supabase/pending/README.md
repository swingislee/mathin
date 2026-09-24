# 待验证数据库候选

这里的 SQL 不参与 migration ledger 和生产发布。只有在明确的隔离目标通过受影响 SQL/RLS/回退检查、生成真实数据库类型后，才晋级 `supabase/migrations/`。

- 微信 OAuth SQL 已于 2026-09-25 晋级为 [`20260925001000_wechat_oauth_tickets.sql`](../migrations/20260925001000_wechat_oauth_tickets.sql)，完成本机隔离库应用与增量类型生成。微信入口仍关闭，生产尚未部署；后续接入条件见 [微信网站应用 OAuth](../../docs/runbooks/wechat-website-oauth.md)。
