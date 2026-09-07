import { describe, expect, it } from "vitest";
import {
  dashboardFieldFacets, filterAndSortDashboardFields, normalizeDashboardFieldQuery,
  type DashboardFieldDefinitions, type DashboardFieldQuery,
} from "../src/features/school/dashboard-page/dashboard-table-field-contract";
import {
  dashboardDateBounds, dashboardDateBucket, dashboardDateBucketLabel, dashboardDay, formatDashboardDate,
} from "../src/features/school/dashboard-page/dashboard-table-date-contract";
import {
  ASSESSMENT_TABLE_COLUMNS, assessmentRecordDate, assessmentScheduledDate, assessmentTableBand, assessmentTableFields, assessmentTableScore,
  formatAssessmentTableScore, migrateAssessmentFieldQuery,
} from "../src/features/school/assessment-table-fields";
import type { AssessmentWorkbenchRow } from "../src/features/school/assessment-workbench-contract";

const context = { locale: "zh", timeZone: "Asia/Shanghai", now: Date.parse("2026-09-07T02:00:00Z") };
const query = (patch: Partial<DashboardFieldQuery> = {}): DashboardFieldQuery => ({ version: 2, filters: {}, sort: null, ...patch });
type Row = { id: string; name: string; phone: string; date: string | null; teacher: string; location: string; score: number | null; paper: string; note: string };
const rows: Row[] = [
  { id: "a", name: "Alpha One", phone: "00123", date: "2026-09-07T01:00:00Z", teacher: "t1", location: "east", score: 18, paper: "p20", note: "first note" },
  { id: "b", name: "Beta", phone: "00999", date: "2026-09-07T08:00:00Z", teacher: "t2", location: "east", score: 18, paper: "p100", note: "second note" },
  { id: "c", name: "Gamma", phone: "00001", date: "2026-09-08T01:00:00Z", teacher: "t1", location: "west", score: 0, paper: "p20", note: "" },
  { id: "d", name: "Delta", phone: "00002", date: null, teacher: "t1", location: "east", score: null, paper: "p20", note: "" },
];
const fields: DashboardFieldDefinitions<Row> = {
  name: { kind: "text", label: "Name", value: row => row.name },
  phone: { kind: "text", label: "Phone", value: row => row.phone },
  note: { kind: "text", label: "Note", value: row => row.note, sortable: false },
  date: { kind: "date", label: "Date", value: row => row.date },
  teacher: { kind: "enum", label: "Teacher", values: row => [{ value: row.teacher, label: "Same name" }] },
  location: { kind: "enum", label: "Location", values: row => [{ value: row.location, label: row.location }] },
  paper: { kind: "enum", label: "Paper", values: row => [{ value: row.paper, label: "Same title" }], multiple: false },
  score: { kind: "number", label: "Score", value: row => row.score, requiresSingleValue: "paper" },
};
const ids = (value: DashboardFieldQuery) => filterAndSortDashboardFields(rows, fields, normalizeDashboardFieldQuery(fields, value), context.locale, context.timeZone).map(row => row.id);

describe("typed dashboard fields", () => {
  it("combines fields in one visual column and uses OR within a field", () => {
    expect(ids(query({ filters: { date: { kind: "date", from: "2026-09-07", to: "2026-09-07" }, teacher: { kind: "enum", values: ["t1"] } } }))).toEqual(["a"]);
    expect(ids(query({ filters: { teacher: { kind: "enum", values: ["t1", "t2"] }, location: { kind: "enum", values: ["east"] } } }))).toEqual(["a", "b", "d"]);
  });
  it("searches short text without enumerating identities or long notes", () => {
    const facets = dashboardFieldFacets(rows, fields, {}, "zh", context.timeZone);
    expect(facets.name.options).toEqual([]); expect(facets.phone.options).toEqual([]); expect(facets.note.options).toEqual([]);
    expect(ids(query({ filters: { name: { kind: "text", query: " alpha ONE " }, phone: { kind: "text", query: "0012" } } }))).toEqual(["a"]);
    expect(normalizeDashboardFieldQuery(fields, query({ filters: { name: { kind: "text", query: "Alpha " } } })).filters.name).toEqual({ kind: "text", query: "Alpha " });
  });
  it("recomputes facets with other filters and preserves stable IDs for matching names", () => {
    const facets = dashboardFieldFacets(rows, fields, { date: { kind: "date", from: "2026-09-07", to: "2026-09-07" } }, "zh", context.timeZone);
    expect(facets.teacher.options.map(option => option.value)).toEqual(["t1", "t2"]);
    expect(facets.teacher.options.map(option => option.label)).toEqual(["Same name · t1", "Same name · t2"]);
    expect(facets.location.options.map(option => option.value)).toEqual(["east"]);
    expect(facets.date.days).toEqual(["2026-09-08", "2026-09-07"]);
    const selected = dashboardFieldFacets(rows, fields, { location: { kind: "enum", values: ["west"] }, teacher: { kind: "enum", values: ["t2"] } }, "zh", context.timeZone);
    expect(selected.teacher.options.map(option => option.value)).toContain("t2");
  });
  it("keeps date sorting chronological and missing values last in both directions", () => {
    expect(ids(query({ sort: { field: "date", direction: "asc" } }))).toEqual(["a", "b", "c", "d"]);
    expect(ids(query({ sort: { field: "date", direction: "desc" } }))).toEqual(["c", "b", "a", "d"]);
  });
  it("requires a score scale, accepts zero, and preserves stable score ties", () => {
    const invalid = normalizeDashboardFieldQuery(fields, query({ filters: { score: { kind: "number", min: 10 } }, sort: { field: "score", direction: "desc" } }));
    expect(invalid.filters).toEqual({}); expect(invalid.sort).toBeNull();
    expect(ids(query({ filters: { paper: { kind: "enum", values: ["p20"] }, score: { kind: "number", min: 0, max: 0 } } }))).toEqual(["c"]);
    expect(ids(query({ filters: { paper: { kind: "enum", values: ["p20"] } }, sort: { field: "score", direction: "desc" } }))).toEqual(["a", "c", "d"]);
  });
  it("rejects incompatible, malformed and prototype-key preferences", () => {
    const value = JSON.parse('{"version":2,"filters":{"__proto__":{"kind":"presence","value":"present"},"date":{"kind":"date","from":"2026-02-30","to":"2026-03-01"},"name":{"kind":"enum","values":["Alpha"]},"score":{"kind":"number","min":20,"max":10}},"sort":{"field":"constructor","direction":"asc"}}');
    expect(normalizeDashboardFieldQuery(fields, value)).toEqual(query());
    expect(normalizeDashboardFieldQuery(fields, { filters: { name: "Alpha" } })).toEqual(query());
    expect(normalizeDashboardFieldQuery(fields, query({ sort: { field: "note", direction: "asc" } })).sort).toBeNull();
  });
});

describe("business calendar dates", () => {
  it("uses institutional days, preserves date-only facts and rejects partial or invalid values", () => {
    expect(dashboardDay("2026-09-06T17:00:00Z", context.timeZone)).toBe("2026-09-07");
    expect(dashboardDay("2025-09-07", "America/Los_Angeles")).toBe("2025-09-07");
    for (const value of ["", "2026-02-30", "2026-09", "2026-09-07T14:30", "2026-02-30T14:30Z", "broken"]) expect(dashboardDay(value, context.timeZone)).toBeNull();
  });
  it("groups complete cross-year weeks and leap months without splitting at month boundaries", () => {
    expect(dashboardDateBucket("2026-01-01", "week", context.timeZone)).toEqual({ from: "2025-12-29", to: "2026-01-04" });
    expect(dashboardDateBucket("2024-02-15", "month", context.timeZone)).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(dashboardDateBucket("2025-02-15", "year", context.timeZone)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });
  it("creates half-open day bounds with calendar arithmetic through DST", () => {
    const bounds = dashboardDateBounds({ from: "2026-03-08", to: "2026-03-08" }, "America/New_York")!;
    expect(Date.parse(bounds.until) - Date.parse(bounds.from)).toBe(23 * 3_600_000);
    expect(dashboardDateBounds({ from: "2026-09-08", to: "2026-09-07" }, context.timeZone)).toBeNull();
  });
  it.each(["zh", "en"])("shows past years and recent weekdays consistently in %s", locale => {
    const c = { ...context, locale };
    const current = formatDashboardDate("2026-09-07T06:30:00Z", c, { time: true });
    expect(current).not.toContain("2026"); expect(current).toContain("14:30"); expect(current).toContain(locale === "zh" ? "周一" : "Mon");
    expect(formatDashboardDate("2025-09-07", c)).toContain("2025");
    expect(formatDashboardDate("2026-07-07", c)).not.toContain(locale === "zh" ? "周" : "Tue");
    expect(formatDashboardDate("2026-09-07", c, { time: true })).not.toContain("00:00");
    expect(formatDashboardDate("2026-09-07T06:30:00Z", c, { full: true, time: true })).toContain("Asia/Shanghai");
    expect(dashboardDateBucketLabel({ from: "2025-12-29", to: "2026-01-04" }, "week", c)).toContain("2025");
  });
});

function assessment(id: string, overrides: Partial<AssessmentWorkbenchRow> = {}): AssessmentWorkbenchRow {
  return { id, assessmentKind: "one_to_one", activityId: id, activityTitle: "Assessment", publicClassRecord: null,
    invitationId: null, registrationId: id, studentId: id, leadId: null, name: id, phone: "", grade: 3, gradeText: "",
    scheduledAt: "2026-09-07T01:00:00Z", location: "East", assessorId: "teacher", assessorName: "Teacher", assessorSource: "actual",
    background: "", participationStatus: "attended", assessmentStartedAt: "2026-09-07T01:00:00Z", assessmentCompletedAt: "2026-09-07T02:00:00Z",
    paperVersionId: "paper-20", assessment: { id, assessmentBand: "a", score: 18, strengths: "", focusAreas: "", parentConcerns: "", teacherRecommendation: "",
      recommendedClass: "", teacherObservation: "", updatedAt: "2026-09-07T02:00:00Z", resultSource: "teacher", finalizedAt: "2026-09-07T02:00:00Z" },
    questionSummary: { paperTitle: "Same title", totalScore: 20, questionCount: 4, answeredCount: 4, outcomeCounts: { explained: 0, independent: 4, prompted: 0, imitated: 0, incomplete: 0 }, keyNotes: [] },
    route: null, updatedAt: "2026-09-07T02:00:00Z", ...overrides };
}

describe("assessment field adapter", () => {
  it("keeps 1v1 available in the type filter when its row label is hidden", () => {
    const t = (key: string) => key;
    const definitions = assessmentTableFields({ locale: "zh", timeZone: context.timeZone, tableT: t, assessmentT: t, t, teacherT: t, quickT: t, stageFor: () => "feedback" });
    const fixtures = [assessment("solo", { assessmentKind: "one_to_one" }), assessment("group", { assessmentKind: "activity" })];
    const facets = dashboardFieldFacets(fixtures, definitions, {}, "zh", context.timeZone);
    expect(facets.kind.options).toContainEqual({ value: "one_to_one", label: "type_one_to_one" });
    expect(filterAndSortDashboardFields(fixtures, definitions, query({ filters: { kind: { kind: "enum", values: ["one_to_one"] } } }), "zh", context.timeZone)
      .map(row => row.id)).toEqual(["solo"]);
  });
  it("filters preserved source support names even when no employee account is linked", () => {
    const t = (key: string) => key;
    const definitions = assessmentTableFields({ locale: "zh", timeZone: context.timeZone, tableT: t, assessmentT: t, t, teacherT: t, quickT: t, stageFor: () => "feedback" });
    const field = definitions.supportOwner;
    expect(field.kind).toBe("enum");
    if (field.kind !== "enum") throw new Error("SUPPORT_FIELD_TYPE");
    const row = assessment("source", { supportOwnerId: null, supportOwnerName: "来源学服" });
    expect(field.values(row)).toEqual([{ value: "source:来源学服", label: "来源学服" }]);
    expect(filterAndSortDashboardFields([row], definitions, query({ filters: { supportOwner: { kind: "enum", values: ["source:来源学服"] } } }), "zh", context.timeZone)).toEqual([row]);
  });
  it("filters responsible support staff independently from the assessor, using stable IDs and missing values", () => {
    const t = (key: string) => key;
    const definitions = assessmentTableFields({ locale: "zh", timeZone: context.timeZone, tableT: t, assessmentT: t, t, teacherT: t, quickT: t, stageFor: () => "feedback" });
    const fixtures = [
      assessment("a", { supportOwnerId: "owner-a", supportOwnerName: "Same staff", assessorId: "assessor-a" }),
      assessment("b", { supportOwnerId: "owner-b", supportOwnerName: "Same staff", assessorId: "assessor-a" }),
      assessment("c", { supportOwnerId: "owner-a", supportOwnerName: "Same staff", assessorId: "assessor-b" }),
      assessment("missing", { supportOwnerId: null, supportOwnerName: "" }),
    ];
    expect(ASSESSMENT_TABLE_COLUMNS.arrangement).toContain("supportOwner");
    expect(ASSESSMENT_TABLE_COLUMNS.kind).toEqual(["status", "substatus", "kind"]);
    expect(ASSESSMENT_TABLE_COLUMNS.status).toEqual(["assessor", "assessorSource"]);
    expect(ASSESSMENT_TABLE_COLUMNS.arrangement).not.toContain("assessor");
    const facets = dashboardFieldFacets(fixtures, definitions, {}, "zh", context.timeZone);
    expect(facets.supportOwner.options).toEqual([
      { value: "owner-a", label: "Same staff · owner-a" }, { value: "owner-b", label: "Same staff · owner-b" },
    ]);
    const matching = (filters: DashboardFieldQuery["filters"]) => filterAndSortDashboardFields(fixtures, definitions, query({ filters }), "zh", context.timeZone).map(row => row.id);
    expect(matching({ supportOwner: { kind: "enum", values: ["owner-a"] } })).toEqual(["a", "c"]);
    expect(matching({ supportOwner: { kind: "enum", values: ["owner-a"] }, assessor: { kind: "enum", values: ["assessor-a"] },
      scheduledAt: { kind: "date", from: "2026-09-07", to: "2026-09-07" } })).toEqual(["a"]);
    expect(matching({ supportOwner: { kind: "enum", values: ["owner-a", "owner-b"] } })).toEqual(["a", "b", "c"]);
    expect(matching({ supportOwner: { kind: "presence", value: "missing" } })).toEqual(["missing"]);
  });

  it("does not merge the same raw score across paper versions", () => {
    const first = assessment("p20"), second = assessment("p100", { paperVersionId: "paper-100", questionSummary: { ...first.questionSummary!, totalScore: 100 } });
    const t = (key: string) => key;
    const definitions = assessmentTableFields({ locale: "zh", timeZone: context.timeZone, tableT: t, assessmentT: t, t, teacherT: t, quickT: t, stageFor: () => "feedback" });
    const facets = dashboardFieldFacets([first, second], definitions, {}, "zh", context.timeZone);
    expect(facets.paper.options.map(option => option.value)).toEqual(["paper-100", "paper-20"]);
    expect(facets.score.options).toEqual([]);
    const selected = query({ filters: { paper: { kind: "enum", values: ["paper-20"] }, score: { kind: "number", min: 18, max: 18 } } });
    expect(filterAndSortDashboardFields([first, second], definitions, selected, "zh", context.timeZone).map(row => row.id)).toEqual(["p20"]);
    expect(assessmentTableScore(first).rate).toBe(90); expect(assessmentTableScore(second).rate).toBe(18);
  });
  it("uses an explicit maximum or a teacher paper, never an unrelated quick-entry paper", () => {
    const base = assessment("base");
    const quick = assessment("quick", { assessment: { ...base.assessment!, resultSource: "quick_entry" } });
    expect(assessmentTableScore(quick)).toMatchObject({ score: 18, max: null, rate: null, comparableScore: null });
    expect(formatAssessmentTableScore(quick, "zh")).toEqual({ label: "18 分", hint: "满分未记录" });
    expect(assessmentTableScore({ ...quick, assessment: { ...quick.assessment!, scoreMax: 100 } })).toMatchObject({ max: 100, rate: 18, comparableScore: null });
    expect(formatAssessmentTableScore(base, "zh").label).toBe("18 / 20");
    expect(assessmentTableScore({ ...base, assessment: { ...base.assessment!, score: 0 } }).rate).toBe(0);
    expect(assessmentTableScore({ ...base, assessment: { ...base.assessment!, score: 25 } })).toMatchObject({ invalid: true, rate: null, comparableScore: null });
  });
  it("keeps draft scores out of final comparisons and source dates out of import-time sorting", () => {
    const base = assessment("draft");
    expect(assessmentTableScore({ ...base, assessmentCompletedAt: null, assessment: { ...base.assessment!, finalizedAt: null } }).score).toBeNull();
    const source = assessment("source", { scheduledAt: "", occurredOn: "2025-02-03", sourceRecordId: "source-id", recordState: "current" });
    expect(assessmentScheduledDate(source, context.timeZone)).toBe("2025-02-03"); expect(assessmentRecordDate(source)).toBe("2025-02-03");
    expect(assessmentRecordDate({ ...source, occurredOn: null })).toBeNull();
    expect(assessmentTableBand({ ...base, assessment: { ...base.assessment!, assessmentBand: "below_a" } })).toBeNull();
  });
  it("migrates only unambiguous old filters", () => {
    expect(migrateAssessmentFieldQuery({ filters: { status: "feedback", kind: "one_to_one", result: "score:18", student: "name:Alpha", updated: "2025年9月7日" }, sort: { column: "student", direction: "asc" } })).toEqual(query({ filters: { status: { kind: "enum", values: ["feedback"] }, kind: { kind: "enum", values: ["one_to_one"] } }, sort: { field: "name", direction: "asc" } }));
  });
});
