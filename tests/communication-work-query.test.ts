import { describe, expect, it } from "vitest";
import { parseCommunicationWorkQuery } from "../src/features/school/communication-work-query";

describe("communication work view URL boundaries", () => {
  const today = "2026-09-05";
  const worklist = "12345678-1234-4321-8765-123456789abc";
  it("opens daily work independently from old status filters", () => {
    expect(parseCommunicationWorkQuery({ status: "uncontacted", queue: "coordination" }, today)).toEqual({ view: "day", date: today });
  });
  it("preserves a real date and fixed list identity and drops stale list IDs outside worklist view", () => {
    expect(parseCommunicationWorkQuery({ view: "worklist", date: "2026-09-04", worklist }, today)).toEqual({ view: "worklist", date: "2026-09-04", worklistId: worklist });
    expect(parseCommunicationWorkQuery({ view: "records", date: "2026-09-04", worklist }, today)).toEqual({ view: "records", date: "2026-09-04" });
  });
  it("uses today's work for malformed dates or missing list identity", () => {
    expect(parseCommunicationWorkQuery({ view: "worklist", date: "2026-02-30", worklist: "invalid" }, today)).toEqual({ view: "day", date: today });
    expect(parseCommunicationWorkQuery({ view: ["records", "all"], date: ["2026-09-04"] }, today)).toEqual({ view: "day", date: today });
  });
  it("opens a directly located student regardless of today's task membership", () => {
    expect(parseCommunicationWorkQuery({ view: "worklist", worklist }, today, true)).toEqual({ view: "all", date: today });
  });
});
