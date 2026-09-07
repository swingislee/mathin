import { describe, expect, it } from "vitest";
import { STAFF_OVERVIEW_METRICS } from "@/features/school/home/staff-overview-contract";
import { selectOverviewSupportRows, staffOverviewSupportCookie } from "@/features/school/home/staff-overview-display-contract";
import type { StaffOverviewSupportFunnelRow } from "@/features/school/home/staff-overview-data";

const row = (id: string | null, value: number): StaffOverviewSupportFunnelRow => ({
  key: id ?? "__unassigned__", userId: id, name: id ?? "",
  metrics: Object.fromEntries(STAFF_OVERVIEW_METRICS.map(metric => [metric, { current: value, previous: value + 1 }])) as StaffOverviewSupportFunnelRow["metrics"],
});

describe("overview staff display", () => {
  const rows = [row("a", 2), row("b", 4), row(null, 3)];
  const directory = [{ userId: "a", name: "A" }, { userId: "b", name: "B" }, { userId: "c", name: "C" }];
  it("keeps organization totals and unassigned records when choosing staff", () => {
    const selected = selectOverviewSupportRows(rows, directory, "a,c");
    expect(selected.rows.map(row => row.key)).toEqual(["a", "c", "__other__", "__unassigned__"]);
    for (const metric of STAFF_OVERVIEW_METRICS) {
      for (const period of ["current", "previous"] as const) {
        expect(selected.rows.reduce((sum, row) => sum + row.metrics[metric][period]!, 0))
          .toBe(rows.reduce((sum, row) => sum + row.metrics[metric][period]!, 0));
      }
    }
  });
  it("accepts an empty display list and safely falls back for an unknown preference", () => {
    expect(selectOverviewSupportRows(rows, directory, "none").rows.map(row => row.key)).toEqual(["__other__", "__unassigned__"]);
    expect(selectOverviewSupportRows(rows, directory, "unknown").selectedIds).toEqual(["a", "b"]);
    expect(selectOverviewSupportRows(rows, directory).rows).toEqual(rows);
  });
  it("preserves unavailable values instead of showing false zeroes", () => {
    const incomplete = row("b", 0);
    incomplete.metrics.contacts.current = null;
    const selected = selectOverviewSupportRows([rows[0], incomplete], directory, "a,c");
    expect(selected.rows.find(row => row.key === "__other__")!.metrics.contacts.current).toBeNull();
    expect(selected.rows.find(row => row.key === "c")!.metrics.contacts.current).toBeNull();
  });
  it("keeps display preferences separate between signed-in accounts", () => {
    expect(staffOverviewSupportCookie("a")).not.toBe(staffOverviewSupportCookie("b"));
  });
});
