/** 仅清除过期的 OAuth 临时资料；账号、绑定快照和审计由各自生命周期管理。 */
export async function runWechatOAuthMaintenance({ admin, workerId, now = Date.now() }) {
  const { error: heartbeatError } = await admin.rpc("heartbeat_job_worker", {
    p_worker_id: workerId, p_version: "wechat-oauth-maintenance-v1",
  });
  if (heartbeatError) throw new Error("WECHAT_MAINTENANCE_HEARTBEAT_FAILED");
  const { error: pruneError } = await admin.rpc("prune_wechat_oauth_tickets");
  if (pruneError) throw new Error("WECHAT_MAINTENANCE_PRUNE_FAILED");

  // 两分钟宽限排除请求执行期间刚过期的行；只返回计数，不读取凭据或个人资料。
  const deadline = new Date(now - 120_000).toISOString();
  // 限流表仅允许 RPC 操作，保持原有权限；两类删除已由同一 SQL RPC 原子执行。
  const { count, error } = await admin.from("wechat_oauth_tickets")
    .select("*", { count: "exact", head: true }).lte("expires_at", deadline);
  if (error || count == null) throw new Error("WECHAT_MAINTENANCE_CHECK_FAILED");
  if (count !== 0) throw new Error("WECHAT_MAINTENANCE_OVERDUE");
}
