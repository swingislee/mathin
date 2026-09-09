// 推送 Worker 独立领取队列，租约恢复和到期处理也只作用于 Web Push。
export function jobWorkerScope(value = "all") {
  if (value !== "all" && value !== "web_push") throw new Error("JOB_WORKER_SCOPE_INVALID");
  return value;
}

export async function runWebPushCycle({ admin, workerId, version, batchSize, leaseSeconds }, settle) {
  const { error: heartbeatError } = await admin.rpc("heartbeat_job_worker", {
    p_worker_id: workerId, p_version: version,
  });
  if (heartbeatError) throw new Error("WEB_PUSH_HEARTBEAT_FAILED");
  const { error: expiryError } = await admin.rpc("expire_web_push_subscriptions", { p_limit: 500 });
  if (expiryError) throw new Error("WEB_PUSH_EXPIRY_FAILED");
  const { data, error } = await admin.rpc("claim_web_push_jobs", {
    p_worker_id: workerId, p_limit: batchSize, p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error("WEB_PUSH_CLAIM_FAILED");
  const jobs = data ?? [];
  if (jobs.some((job) => job.kind !== "notification.web_push")) {
    throw new Error("WEB_PUSH_UNEXPECTED_JOB_KIND");
  }
  // 批内立即处理，避免后面的任务在等待前一个网络请求时耗尽租约。
  await Promise.all(jobs.map(settle));
  return jobs.length;
}
