import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readOverviewRows, STAFF_OVERVIEW_READ_LIMIT } from "@/features/school/home/staff-overview-read";
import { overviewReadSources } from "@/features/school/home/staff-overview-read-contract";

function reader(total: number, failAt = -1) {
  const offsets: number[] = [];
  let active = 0, maximum = 0;
  const build = () => {
    let from = 0, to = 0;
    const execute = async () => {
      offsets.push(from); active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, from === 200 ? 8 : 1));
      active--;
      if (from === failAt) return { data: null, error: { message: "read failed" } };
      return { data: Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, i) => ({ id: from + i })), error: null };
    };
    const query: ReturnType<Parameters<typeof readOverviewRows>[0]> = {
      order: () => query,
      range: (start: number, end: number) => { from = start; to = end; return query; },
      then: (resolve, reject) => execute().then(resolve, reject),
    };
    return query;
  };
  return { build, offsets, maximum: () => maximum };
}

describe("bounded overview reads", () => {
  it("probes small tables once and never builds disabled queries", async () => {
    const small = reader(10);
    expect((await readOverviewRows(small.build)).data).toHaveLength(10);
    expect(small.offsets).toEqual([0]);
    const skipped = vi.fn(small.build);
    expect(await readOverviewRows(skipped, ["id"], false)).toEqual({ data: [], error: null });
    expect(skipped).not.toHaveBeenCalled();
  });
  it("keeps page order across out-of-order completions with at most four active reads", async () => {
    const large = reader(1250);
    const result = await readOverviewRows<{ id: number }>(large.build);
    expect(result.data?.map(row => row.id)).toEqual(Array.from({ length: 1250 }, (_, i) => i));
    expect(large.maximum()).toBe(4);
  });
  it("reports required-page errors and ignores speculative pages after the end", async () => {
    expect((await readOverviewRows(reader(1250, 400).build)).error?.message).toBe("read failed");
    const complete = await readOverviewRows(reader(210, 600).build);
    expect(complete.error).toBeNull();
    expect(complete.data).toHaveLength(210);
  });
  it("retains the hard limit so callers can identify incomplete counts", async () => {
    const limited = reader(11000);
    expect((await readOverviewRows(limited.build)).data).toHaveLength(STAFF_OVERVIEW_READ_LIMIT);
    expect(Math.max(...limited.offsets)).toBeLessThan(STAFF_OVERVIEW_READ_LIMIT);
  });
});

describe("detail read dependencies", () => {
  it("keeps acquisition imports only for acquisition details and the full overview", () => {
    expect(overviewReadSources().has("acquisitionSources")).toBe(true);
    for (const metric of ["contacts", "invitations", "arrivals", "assessments", "enrollments"]) {
      expect(overviewReadSources({ kind: "business", metric }).has("acquisitionSources")).toBe(false);
    }
    expect(overviewReadSources({ kind: "business", metric: "leads" })).toEqual(new Set([
      "profiles", "leads", "acquisitionSources", "leadSubmissions", "communications", "registrations", "assessments",
    ]));
  });
  it("keeps capacity independent of historical business facts", () => {
    expect(overviewReadSources({ kind: "capacity" })).toEqual(new Set(["profiles", "classrooms", "memberships", "assignments"]));
  });
  it("loads confirmation registrations together with communication details", () => {
    expect(overviewReadSources({ kind: "business", metric: "contacts" })).toEqual(new Set([
      "profiles", "leads", "communications", "activities", "registrations",
    ]));
  });
});
