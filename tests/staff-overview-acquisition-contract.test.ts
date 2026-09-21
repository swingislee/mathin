import { describe, expect, it } from "vitest";
import { buildOverviewAcquisitions, overviewAcquiredOn, type OverviewAcquisitionSource } from "@/features/school/home/staff-overview-acquisition-contract";

const source = (id: string, leadId: string | null, date: string): OverviewAcquisitionSource => ({
  id, lead_id: leadId, record_data: { cells: [
    { fieldName: "学员姓名", text: "来源学生" }, { fieldName: "获取日期", text: date },
    { fieldName: "登记日期（此列不用填，自动生成）", text: "2026/09/03" },
  ] },
});
const lead = (id: string, sourceId: string | null) => ({ id, source_record_id: sourceId, created_at: "2026-09-07T00:00:00Z", owner_id: "support" });

describe("overview acquisition source dates", () => {
  it("uses the source registration year for nearby month/day values and preserves explicit years", () => {
    expect(overviewAcquiredOn("9.2", "2026/09/03")).toBe("2026-09-02");
    expect(overviewAcquiredOn("2026-09-01 12:27:57", "2026/09/03")).toBe("2026-09-01");
    expect(overviewAcquiredOn("2025/9/24", "2026/09/03")).toBe("2025-09-24");
    for (const raw of ["202509", "202409", "2026-02-30", ""]) expect(overviewAcquiredOn(raw, "2026/09/03")).toBeNull();
    expect(overviewAcquiredOn("9.2", "2026/02/05")).toBeNull();
    expect(overviewAcquiredOn("9.2", "2026/09/30")).toBeNull();
    expect(overviewAcquiredOn("9.4", "2026/09/03")).toBeNull();
    expect(overviewAcquiredOn("9.2", "")).toBeNull();
  });

  it("retains archive-only and communication links while excluding duplicate submissions and import timestamps", () => {
    const result = buildOverviewAcquisitions({
      sources: [source("archive", "one", "9.2"), source("communication", null, "2025/9/24")],
      leads: [lead("one", "another-source"), lead("two", "another-source"), lead("three", null), lead("native", null), lead("undated", "old-source")],
      sourceLinks: [{ source_record_id: "communication", lead_id: "two" }],
      submissions: [
        { id: "same-one", lead_id: "one", submitted_at: "2026-09-02T01:00:00Z" },
        { id: "older", lead_id: "three", submitted_at: "2026-08-29T01:00:00Z" },
        { id: "again", lead_id: "three", submitted_at: "2026-09-01T01:00:00Z" },
      ],
    }, "Asia/Shanghai");
    expect(result).toHaveLength(5);
    expect(result.find(row => row.id === "archive")).toMatchObject({ at: "2026-09-01T16:00:00.000Z", personId: "support" });
    expect(result.find(row => row.id === "communication")?.at).toBe("2025-09-23T16:00:00.000Z");
    expect(result.find(row => row.id === "submission:three")?.at).toBe("2026-08-29T01:00:00.000Z");
    expect(result.find(row => row.id === "native")?.at).toBe("2026-09-07T00:00:00.000Z");
    expect(result.find(row => row.id === "undated")?.at).toBeNull();
  });

  it("retains an ambiguous source as one unattributed fact without merging lead identities", () => {
    const result = buildOverviewAcquisitions({
      sources: [source("shared", "one", "9.2")], leads: [lead("one", "shared"), lead("two", "shared")],
      sourceLinks: [], submissions: [],
    }, "Asia/Shanghai");
    expect(result).toHaveLength(1);
    expect(result[0].personId).toBeNull();
  });

  it("uses old version links for the latest row without counting the same submitted lead twice", () => {
    const current = { ...source("latest", null, "9.2"), source_alias_ids: ["old", "latest"] };
    for (const viaCommunication of [false, true]) {
      const result = buildOverviewAcquisitions({ sources: [current],
        leads: [lead("one", viaCommunication ? null : "old")],
        sourceLinks: viaCommunication ? [{ source_record_id: "old", lead_id: "one" }] : [],
        submissions: [{ id: "submission", lead_id: "one", submitted_at: "2026-09-02T01:00:00Z" }],
      }, "Asia/Shanghai");
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: "latest", personId: "support", at: "2026-09-01T16:00:00.000Z" });
    }
  });

  it("retains source staff signatures in priority order for historical acquisition attribution", () => {
    const sources = [
      { "确认人员": "学服乙", "跟进人": "学服丙", "沟通人员": "学服丁" },
      { "确认人员": "", "跟进人": "学服丙", "沟通人员": "学服丁" },
      { "确认人员": "", "跟进人": "", "沟通人员": "学服丁" },
    ].map((values, i) => {
      const row = source(String(i), "lead", "9.2");
      row.record_data.cells!.push(...Object.entries(values).map(([fieldName, text]) => ({ fieldName, text })));
      return row;
    });
    const result = buildOverviewAcquisitions({ sources, leads: [lead("lead", null)], sourceLinks: [], submissions: [] }, "Asia/Shanghai");
    expect(result.map(row => row.sourcePerson)).toEqual(["学服乙", "学服丙", "学服丁"]);
    expect(result.every(row => row.personId === "support")).toBe(true);
  });
});
