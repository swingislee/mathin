import { beforeEach, describe, expect, it, vi } from "vitest";
import { leadWorkFilter, leadWorkFilterQuery, placementClassMatchesWorkFilter, renewalMatchesWorkFilter } from "@/features/school/followup-primary-filter-contract";
import type { LeadPoolFilters } from "@/features/school/lead-contract";

const db = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  db.calls.push(["from", table]);
  const query = Object.fromEntries(["select", "is", "eq", "filter", "not", "or", "in", "order", "range"].map(method => [method,
    (...args: unknown[]) => { db.calls.push([method, ...args]); return query; },
  ])) as Record<string, (...args: unknown[]) => unknown>;
  query.returns = async () => ({ data: [], error: null, count: 42 });
  return query;
} }) }));
import { listLeadPool, parseLeadPoolFilters } from "@/features/school/leads";

describe("follow-up primary work filters", () => {
  beforeEach(() => { db.calls = []; });
  const filters: LeadPoolFilters = { scope: "mine", status: "uncontacted", q: "Sample name", page: 4, pageSize: 50 };
  it("separates lead assignment from ownership and resets pagination without losing search context", () => {
    for (const view of ["unassigned", "assigned", "all"] as const) {
      const query = new URLSearchParams(leadWorkFilterQuery(filters, view));
      expect(query.get("page")).toBeNull();
      expect(query.get("q")).toBe(filters.q); expect(query.get("status")).toBe(filters.status);
      expect(query.get("pageSize")).toBe("50");
      const parsed = parseLeadPoolFilters(Object.fromEntries(query), true);
      expect(leadWorkFilter(parsed)).toBe(view);
      expect(parsed.scope).toBe(view === "unassigned" ? "unassigned" : "mine");
    }
    expect(new URLSearchParams(leadWorkFilterQuery({ ...filters, scope: "unassigned" }, "assigned")).get("scope")).toBe("all");
  });
  it("keeps limited users in their permitted scope and accepts only the known assignment query", () => {
    expect(parseLeadPoolFilters({ scope: "all", assignment: "assigned" }, false)).toMatchObject({ scope: "all", assignment: "assigned" });
    expect(parseLeadPoolFilters({ scope: "group" }, false).scope).toBe("group");
    expect(parseLeadPoolFilters({ scope: "unassigned", assignment: "assigned" }, true).assignment).toBeUndefined();
    expect(parseLeadPoolFilters({ assignment: "owner_id.not.is.null" }, true).assignment).toBeUndefined();
  });
  it("applies assigned filtering before database pagination and the exact count, alongside mine and search", async () => {
    const result = await listLeadPool("owner", { ...filters, assignment: "assigned" });
    expect(result).toEqual({ leads: [], count: 42, pageSize: 50 });
    expect(db.calls).toContainEqual(["filter", "is_participant", "eq", true]);
    expect(db.calls).toContainEqual(["not", "owner_id", "is", null]);
    expect(db.calls).toContainEqual(["eq", "status", "uncontacted"]);
    expect(db.calls).toContainEqual(["range", 150, 199]);
    expect(db.calls.findIndex(call => call[0] === "not")).toBeLessThan(db.calls.findIndex(call => call[0] === "range"));
  });
  it.each([
    [null, 40, true], [3, 2, true], [3, 3, false], [3, 4, false], [0, 0, false],
  ] as const)("uses actual capacity %s and occupied count %s for vacancy/full views", (capacity, activeCount, available) => {
    expect(placementClassMatchesWorkFilter({ capacity, activeCount }, "vacancies")).toBe(available);
    expect(placementClassMatchesWorkFilter({ capacity, activeCount }, "full")).toBe(!available);
  });
  it("treats intent as follow-up, registration as awaiting payment, and a real payment as paid", () => {
    expect(renewalMatchesWorkFilter({ stage: "payment_pending" }, "following")).toBe(true);
    expect(renewalMatchesWorkFilter({ stage: "committed" }, "payment")).toBe(false);
    expect(renewalMatchesWorkFilter({ stage: "enrolled" }, "payment")).toBe(true);
    const paid = { stage: "enrolled", payment: { opportunity_id: "sample", period_count: 1, paid_amount: 100, note: "" } };
    expect(renewalMatchesWorkFilter(paid, "paid")).toBe(true);
    expect(renewalMatchesWorkFilter(paid, "payment")).toBe(false);
    expect(renewalMatchesWorkFilter({ stage: "unprepared" }, "uncontacted")).toBe(true);
    expect(renewalMatchesWorkFilter({ stage: "not_enrolled" }, "deferred")).toBe(true);
    expect(renewalMatchesWorkFilter({ stage: "nurturing" }, "deferred")).toBe(true);
  });
  it("keeps historical and unknown outcomes out of live renewal work queues", () => {
    for (const stage of ["unknown", "enrolled", "not_enrolled"]) {
      const row = { stage, recordState: "historical" };
      expect(renewalMatchesWorkFilter(row, "all")).toBe(true);
      for (const filter of ["uncontacted", "following", "payment", "paid", "deferred"] as const) expect(renewalMatchesWorkFilter(row, filter)).toBe(false);
    }
    expect(renewalMatchesWorkFilter({ stage: "unknown" }, "uncontacted")).toBe(false);
  });
});
