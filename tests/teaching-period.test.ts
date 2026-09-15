import { describe, expect, it } from "vitest";
import { teachingTimeHref, teachingTimeWindow, type TeachingTerm } from "../src/features/school/teaching-workbench/teaching-period-contract";

const now = new Date("2026-09-15T04:00:00Z");
const zone = "Asia/Shanghai";
const terms: TeachingTerm[] = [
  { id: "summer", year: 2026, term: 1, startsOn: "2026-06-30", endsOn: "2026-08-31", isCurrent: false },
  { id: "autumn", year: 2026, term: 2, startsOn: "2026-09-01", endsOn: "2027-01-01", isCurrent: true },
  { id: "winter", year: 2026, term: 3, startsOn: null, endsOn: null, isCurrent: false },
];
describe("teaching time selection", () => {
  it("provides stable current and previous week shortcuts in the organization timezone", () => {
    expect(teachingTimeWindow("week", "current", undefined, terms, zone, now)).toMatchObject({ date: "2026-09-14", lastDate: "2026-09-20", start: "2026-09-13T16:00:00.000Z", current: true, previousSelected: false });
    expect(teachingTimeWindow("week", "previous", undefined, terms, zone, now)).toMatchObject({ date: "2026-09-07", lastDate: "2026-09-13", previousSelected: true });
    expect(teachingTimeWindow("week", "2026-01-01", undefined, terms, zone, now)).toMatchObject({ date: "2025-12-29", lastDate: "2026-01-04" });
  });
  it("handles month boundaries, leap years and previous months", () => {
    expect(teachingTimeWindow("month", "previous", undefined, terms, zone, now)).toMatchObject({ date: "2026-08-01", lastDate: "2026-08-31" });
    expect(teachingTimeWindow("month", "2024-02-14", undefined, terms, zone, now)).toMatchObject({ date: "2024-02-01", lastDate: "2024-02-29", next: "2024-03-01" });
  });
  it("uses configured school terms, includes the final day and navigates across school periods", () => {
    expect(teachingTimeWindow("term", "current", undefined, terms, zone, now)).toMatchObject({ termId: "autumn", start: "2026-08-31T16:00:00.000Z", end: "2027-01-01T16:00:00.000Z", lastDate: "2027-01-01", previous: "2026-06-30", next: null, current: true });
    expect(teachingTimeWindow("term", "previous", undefined, terms, zone, now)).toMatchObject({ termId: "summer", previousSelected: true });
    expect(teachingTimeWindow("term", "2026-09-07", undefined, terms, zone, now)?.termId).toBe("autumn");
    expect(teachingTimeWindow("term", "current", "summer", terms, zone, now)?.termId).toBe("summer");
    expect(teachingTimeWindow("term", "current", "winter", terms, zone, now)).toBeNull();
    expect(teachingTimeWindow("term", "current", undefined, [], zone, now)).toBeNull();
  });
  it("keeps teacher, grade grouping and other filters when changing dates", () => {
    const href = teachingTimeHref("/dashboard/teaching?view=records&group=teacher&teacher=person&classroom=class&session=old&contactPage=4&term=old", "week", "previous");
    const params = new URL(href, "https://example.test").searchParams;
    expect(Object.fromEntries(params)).toEqual({ view: "records", group: "teacher", teacher: "person", classroom: "class", period: "week", date: "previous" });
    expect(teachingTimeHref(href, "term", "current", "autumn")).toContain("term=autumn");
  });
});
