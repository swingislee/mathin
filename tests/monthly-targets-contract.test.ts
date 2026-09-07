import { describe, expect, it } from "vitest";
import {
  monthlyTargetCellKey, monthlyTargetCells, parseMonthlyTargetInput, sumMonthlyTargets,
  type MonthlyTargetPlan,
} from "@/features/school/home/monthly-targets-contract";
import { overviewTargetProgress } from "@/features/school/home/staff-overview-presentation-contract";

describe("monthly new enrollment allocation", () => {
  it("distinguishes an unassigned target from an explicit zero", () => {
    expect(sumMonthlyTargets([{ teacher: "甲", grade: "1年级", target: null }])).toBeNull();
    expect(sumMonthlyTargets([{ teacher: "甲", grade: "1年级", target: 0 }])).toBe(0);
    expect(parseMonthlyTargetInput("")).toBeNull();
    expect(parseMonthlyTargetInput("0")).toBe(0);
    for (const value of ["-1", "1.5", "1e3", "NaN", "10000"]) expect(parseMonthlyTargetInput(value)).toBeUndefined();
  });

  it("sums assigned teachers and grades independently without adding reference enrollments", () => {
    const cells = [
      { teacher: "甲", grade: "1年级", target: 4 },
      { teacher: "甲", grade: "2年级", target: 6 },
      { teacher: "乙", grade: "1年级", target: 8 },
      { teacher: "乙", grade: "2年级", target: null },
    ];
    expect(sumMonthlyTargets(cells)).toBe(18);
    expect(sumMonthlyTargets(cells.filter(cell => cell.teacher === "甲"))).toBe(10);
    expect(sumMonthlyTargets(cells.filter(cell => cell.grade === "1年级"))).toBe(12);
  });

  it("expands the source axes while preserving zero and leaving unassigned teachers as reference only", () => {
    const plan = {
      cells: [{ teacher: "甲", grade: "1年级", target: 0 }],
      source: { teachers: ["甲", "乙"], grades: ["1年级", "2年级"], cells: [{ teacher: "", grade: "1年级", actual: 1 }] },
    } as MonthlyTargetPlan;
    expect(monthlyTargetCells(plan)).toEqual([
      { teacher: "甲", grade: "1年级", target: 0 }, { teacher: "甲", grade: "2年级", target: null },
      { teacher: "乙", grade: "1年级", target: null }, { teacher: "乙", grade: "2年级", target: null },
    ]);
    expect(monthlyTargetCellKey("a:b", "c")).not.toBe(monthlyTargetCellKey("a", "b:c"));
  });
});

describe("principal overview progress", () => {
  it("keeps unavailable and zero targets distinct from a completion percentage", () => {
    expect(overviewTargetProgress(null, 58)).toBeNull();
    expect(overviewTargetProgress(8, null)).toBeNull();
    expect(overviewTargetProgress(8, 0)).toBeNull();
    expect(overviewTargetProgress(8, 5)).toEqual({ percent: 160, width: 100, remaining: 0, exceeded: 3 });
    expect(overviewTargetProgress(0, 5)).toEqual({ percent: 0, width: 0, remaining: 5, exceeded: 0 });
  });

});
