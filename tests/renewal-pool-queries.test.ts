import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
import { loadRenewalPoolSupplement } from "@/features/school/renewal-pool-data";
import type { RenewalWorkspaceData } from "@/features/school/renewals";

function setup(admin: boolean) {
  let active = 0; let peak = 0; let checks = 0;
  const memberships = Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, classroom_id: `c${i}`, status: i === 0 ? "left" : i === 1 ? "completed" : "active" }));
  const rpc = vi.fn(async (name: string, args?: { cid: string; uid: string }) => {
    if (name === "is_admin") return { data: admin, error: null };
    if (name === "get_renewal_health_facts") return { data: [], error: null };
    if (name === "is_classroom_teacher") {
      checks++; active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1)); active--;
      expect(args?.uid).toBe("actor");
      return { data: ["c0", "c1", "c2"].includes(args!.cid), error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  mocks.createClient.mockResolvedValue({ rpc, from: (table: string) => {
    const api = { select: () => api, in: () => api, eq: () => api, order: () => api,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "enrollments" ? memberships : [], error: null }).then(resolve) };
    return api;
  } });
  const workspace = { selectedCycleId: null, opportunities: [], candidates: memberships.map(m => ({ membershipId: m.id, studentId: "student" })) } as unknown as RenewalWorkspaceData;
  return { workspace, stats: () => ({ peak, checks }) };
}

describe("renewal pool authorization reads", () => {
  it("avoids per-class teacher checks for an administrator while retaining membership eligibility", async () => {
    const state = setup(true);
    const result = await loadRenewalPoolSupplement(state.workspace, "actor");
    expect(state.stats().checks).toBe(0);
    expect(result.observationMemberships).toEqual(Array.from({ length: 8 }, (_, i) => `m${i + 1}`));
  });
  it("keeps each non-administrator class check and caps concurrency at four", async () => {
    const state = setup(false);
    const result = await loadRenewalPoolSupplement(state.workspace, "actor");
    expect(state.stats()).toEqual({ checks: 9, peak: 4 });
    expect(result.observationMemberships).toEqual(["m1", "m2"]);
  });
});
