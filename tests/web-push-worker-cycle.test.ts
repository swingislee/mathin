import { describe, expect, it, vi } from "vitest";
import { jobWorkerScope, runWebPushCycle } from "../scripts/lib/web-push-worker-cycle.mjs";

const settings = { workerId: "push-test-worker", version: "test", batchSize: 10, leaseSeconds: 60 };

describe("scoped employee push worker", () => {
  it("settles 500 targets in batches of 50 with bounded concurrency", async () => {
    const queue = Array.from({ length: 500 }, (_, id) => ({ kind: "notification.web_push", id }));
    const completed = new Set<number>();
    let active = 0;
    let peak = 0;
    const rpc = vi.fn(async (name: string) => ({
      data: name === "claim_web_push_jobs" ? queue.splice(0, 50) : null, error: null,
    }));
    const started = performance.now();
    for (let batch = 0; batch < 10; batch++) {
      await runWebPushCycle({ ...settings, batchSize: 50, admin: { rpc } }, async (job) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 2));
        expect(completed.has(Number(job.id))).toBe(false);
        completed.add(Number(job.id));
        active -= 1;
      });
    }
    expect(completed.size).toBe(500);
    expect(peak).toBe(50);
    expect(active).toBe(0);
    expect(performance.now() - started).toBeLessThan(60000);
  });
  it("claims only the push RPC and starts the batch before waiting for network responses", async () => {
    const calls: string[] = [];
    const jobs = Array.from({ length: 10 }, (_, id) => ({ kind: "notification.web_push", id }));
    const rpc = vi.fn(async (name: string) => {
      calls.push(name);
      return { data: name === "claim_web_push_jobs" ? jobs : null, error: null };
    });
    const finish: Array<() => void> = [];
    const started: unknown[] = [];
    const running = runWebPushCycle({ ...settings, admin: { rpc } }, async (job) => {
      started.push(job.id);
      await new Promise<void>((resolve) => finish.push(resolve));
    });
    await vi.waitFor(() => expect(started).toHaveLength(10));
    expect(calls).toEqual(["heartbeat_job_worker", "expire_web_push_subscriptions", "claim_web_push_jobs"]);
    finish.forEach((resolve) => resolve());
    await expect(running).resolves.toBe(10);
  });

  it("rejects a foreign job before executing any handler", async () => {
    const settle = vi.fn();
    const rpc = vi.fn(async (name: string) => ({
      data: name === "claim_web_push_jobs" ? [{ kind: "file.cleanup" }] : null, error: null,
    }));
    await expect(runWebPushCycle({ ...settings, admin: { rpc } }, settle)).rejects.toThrow("WEB_PUSH_UNEXPECTED_JOB_KIND");
    expect(settle).not.toHaveBeenCalled();
  });

  it("does not claim when subscription expiry or heartbeat fails", async () => {
    for (const failure of ["heartbeat_job_worker", "expire_web_push_subscriptions"]) {
      const rpc = vi.fn(async (name: string) => ({ data: null, error: name === failure ? { message: "private" } : null }));
      await expect(runWebPushCycle({ ...settings, admin: { rpc } }, vi.fn())).rejects.not.toThrow("private");
      expect(rpc.mock.calls.map(([name]) => name)).not.toContain("claim_web_push_jobs");
    }
  });

  it("rejects unknown scope instead of silently starting generic maintenance", () => {
    expect(jobWorkerScope("web_push")).toBe("web_push");
    expect(jobWorkerScope()).toBe("all");
    expect(() => jobWorkerScope("typo")).toThrow("JOB_WORKER_SCOPE_INVALID");
  });
});
