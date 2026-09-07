import { describe, expect, it } from "vitest";
import { communicationWorkScope, parseCommunicationWorkQuery } from "../src/features/school/communication-work-query";

describe("communication work view URL boundaries", () => {
  const today = "2026-09-05";
  const worklist = "12345678-1234-4321-8765-123456789abc";
  it("defaults teachers to their own contacts and assignment managers to the team within their read permissions", () => {
    expect(communicationWorkScope(undefined, false, false)).toBe("mine");
    expect(communicationWorkScope(undefined, true, false)).toBe("mine");
    expect(communicationWorkScope(undefined, true, true)).toBe("all");
    expect(communicationWorkScope("mine", true, true)).toBe("mine");
    expect(communicationWorkScope("all", true, false)).toBe("all");
    expect(communicationWorkScope("all", false, true)).toBe("mine");
  });
  it("opens contacts to call without requiring a planned contact date", () => {
    expect(parseCommunicationWorkQuery({}, today)).toEqual({ view: "unscheduled", date: today });
    expect(parseCommunicationWorkQuery({ status: "uncontacted", queue: "coordination" }, today)).toEqual({ view: "unscheduled", date: today });
    expect(parseCommunicationWorkQuery({ date: "2026-09-01" }, today)).toEqual({ view: "unscheduled", date: "2026-09-01" });
    expect(parseCommunicationWorkQuery({ view: "day", date: "2026-09-01" }, today)).toEqual({ view: "day", date: "2026-09-01" });
  });
  it("preserves a real date and fixed list identity and drops stale list IDs outside worklist view", () => {
    expect(parseCommunicationWorkQuery({ view: "worklist", date: "2026-09-04", worklist }, today)).toEqual({ view: "worklist", date: "2026-09-04", worklistId: worklist });
    expect(parseCommunicationWorkQuery({ view: "records", date: "2026-09-04", worklist }, today)).toEqual({ view: "records", date: "2026-09-04" });
  });
  it("returns to the contact queue for malformed views or missing list identity", () => {
    expect(parseCommunicationWorkQuery({ view: "worklist", date: "2026-02-30", worklist: "invalid" }, today)).toEqual({ view: "unscheduled", date: today });
    expect(parseCommunicationWorkQuery({ view: ["records", "all"], date: ["2026-09-04"] }, today)).toEqual({ view: "unscheduled", date: today });
  });
  it("opens a directly located student regardless of today's task membership", () => {
    expect(parseCommunicationWorkQuery({ view: "worklist", worklist }, today, true)).toEqual({ view: "all", date: today });
  });
});
