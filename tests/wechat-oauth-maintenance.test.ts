import { describe, expect, it, vi } from "vitest";
import { runWechatOAuthMaintenance } from "../scripts/lib/wechat-oauth-maintenance.mjs";
import { jobWorkerScope } from "../scripts/lib/web-push-worker-cycle.mjs";

const now = Date.UTC(2026, 8, 25);
function fixture({ failure = "", count = 0 as number | null } = {}) {
  const rpc = vi.fn(async (name: string) => ({ error: name === failure ? { message: "private" } : null }));
  const lte = vi.fn(async () => ({ count, error: failure === "check" ? { message: "private" } : null }));
  const select = vi.fn(() => ({ lte }));
  const from = vi.fn(() => ({ select }));
  return { admin: { rpc, from }, rpc, from, select, lte, workerId: "fixture", now };
}

describe("WeChat temporary credential maintenance", () => {
  it("limits the dedicated worker to expiry cleanup and count-only monitoring", async () => {
    expect(jobWorkerScope("wechat_oauth")).toBe("wechat_oauth");
    const f = fixture();
    await runWechatOAuthMaintenance(f);
    expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(["heartbeat_job_worker", "prune_wechat_oauth_tickets"]);
    expect(f.from.mock.calls).toEqual([["wechat_oauth_tickets"]]);
    expect(f.select).toHaveBeenCalledWith("*", { count: "exact", head: true });
    expect(f.lte).toHaveBeenCalledWith("expires_at", new Date(now - 120_000).toISOString());
  });

  it("stops on heartbeat or cleanup failures and keeps private errors out of logs", async () => {
    for (const failure of ["heartbeat_job_worker", "prune_wechat_oauth_tickets"]) {
      const f = fixture({ failure });
      await expect(runWechatOAuthMaintenance(f)).rejects.toThrow(/^WECHAT_MAINTENANCE_/);
      expect(f.from).not.toHaveBeenCalled();
      if (failure === "heartbeat_job_worker") expect(f.rpc).toHaveBeenCalledTimes(1);
    }
  });

  it("fails when cleanup leaves overdue rows or monitoring is unavailable", async () => {
    await expect(runWechatOAuthMaintenance(fixture({ count: 1 }))).rejects.toThrow("WECHAT_MAINTENANCE_OVERDUE");
    await expect(runWechatOAuthMaintenance(fixture({ count: null }))).rejects.toThrow("WECHAT_MAINTENANCE_CHECK_FAILED");
    await expect(runWechatOAuthMaintenance(fixture({ failure: "check" }))).rejects.toThrow("WECHAT_MAINTENANCE_CHECK_FAILED");
  });
});
