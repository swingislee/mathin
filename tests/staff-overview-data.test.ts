import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, failures: new Set<string>() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/school/organization-locations", () => ({ getOrganizationTimezoneV2: async () => "Asia/Shanghai" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: query, rpc }) }));

async function rpc(name: string, args: { p_filters?: { schoolTermId: string }; p_page?: number }) {
  if (name === "resolve_classroom_scope") return { data: [{ available_scopes: ["all"], resolved_scope: "all" }], error: null };
  if (name !== "list_classrooms_for_scope") throw new Error(name);
  const rows = (state.tables.classrooms ?? []).filter(row => row.term_id === args.p_filters?.schoolTermId && row.purpose === "production");
  const offset = ((args.p_page ?? 1) - 1) * 20;
  return { data: rows.slice(offset, offset + 20).map(row => ({ id: row.id, total_count: rows.length })), error: null };
}

// 模拟 API 单次最多 1000 行，分页必须读取后面的真实记录。
function query(table: string) {
  const canonical = table.replace(/^(business_|operational_)/, "");
  const predicates: Array<(row: Record<string, unknown>) => boolean> = [];
  let start = 0, end = 999;
  const execute = () => Promise.resolve(state.failures.has(table) || state.failures.has(canonical)
    ? { data: null, error: { message: "UNAVAILABLE" } }
    : { data: (state.tables[table] ?? state.tables[canonical] ?? []).filter(row => predicates.every(test => test(row))).slice(start, Math.min(end + 1, start + 1000)), error: null });
  const api = {
    select: (columns: string) => {
      if (table === "classrooms" && columns.split(",").includes("term_id")) throw new Error("CLASSROOM_TERM_COLUMN_NOT_GRANTED");
      return api;
    },
    order: () => api,
    eq: (key: string, value: unknown) => { predicates.push(row => row[key] === value); return api; },
    neq: (key: string, value: unknown) => { predicates.push(row => row[key] !== value); return api; },
    is: (key: string, value: unknown) => { predicates.push(row => row[key] === value); return api; },
    in: (key: string, values: unknown[]) => { predicates.push(row => values.includes(row[key])); return api; },
    gte: (key: string, value: string) => { predicates.push(row => typeof row[key] === "string" && row[key] >= value); return api; },
    lt: (key: string, value: string) => { predicates.push(row => typeof row[key] === "string" && row[key] < value); return api; },
    range: (from: number, to: number) => { start = from; end = to; return api; },
    limit: (value: number) => { end = value - 1; return api; },
    returns: execute,
    then: (...args: Parameters<ReturnType<typeof execute>["then"]>) => execute().then(...args),
  };
  return api;
}

import { getStaffHomeWeekSummaryData, getStaffOverviewData } from "@/features/school/home/staff-overview-data";
import { overviewFactInstant, overviewSubjectKey, supplementOverviewContacts } from "@/features/school/home/staff-overview-source-contract";
import { OVERVIEW_ACQUISITION_SOURCE, OVERVIEW_ACQUISITION_TABLE } from "@/features/school/home/staff-overview-acquisition-contract";
import { selectOverviewSupportRows } from "@/features/school/home/staff-overview-display-contract";
import {buildSourceMetricFacts} from '../scripts/lib/source-metric-facts.mjs';

const now = new Date("2026-09-08T12:00:00+08:00");
const activity = (id: string, date: string | null) => ({ id, scheduled_at: null, occurred_on: date, source_invitation_id: null, remark: "学服老师：学服甲", record_state: "current", deleted_at: null });
const registration = (id: string, activityId: string, leadId: string, status = "attended") => ({
  id, activity_id: activityId, student_id: null, lead_id: leadId, status, record_state: "current",
  registered_on: "2026-09-01", created_at: now.toISOString(), source_record_id: id,
  assessment_started_at: null, assessment_completed_at: null,
});
const assessment = (id: string, registrationId: string, band: string | null = "a_plus") => ({
  id, activity_registration_id: registrationId, student_id: null, lead_id: null, assessed_by: "teacher",
  assessed_on: null, created_at: now.toISOString(), source_record_id: id, result_source: "legacy",
  result_finalized_at: null, assessment_band: band, score: null, strengths: "",
});
const courseEnrollment = (id: string, date: string | null, source = true) => ({
  id, student_id: id, opportunity_id: null, registered_on: date,
  confirmed_at: "2026-09-07T01:00:00Z", created_at: "2026-09-07T01:00:00Z", source_record_id: source ? id : null,
});

beforeEach(() => {
  state.failures.clear();
  state.tables = {
    school_terms: [{ id: "current", name: "本学期", is_current: true }],
    profiles: [{ id: "support", display_name: "学服甲", role: "staff", is_active: true }, { id: "teacher", display_name: "老师甲", role: "staff", is_active: true }],
  };
});

it('counts month-only confirmations and source arrivals without results, with activity registration separate',async()=>{
  const facts=(tableName:string,values:Record<string,string>,id:string)=>buildSourceMetricFacts({id,source_table_id:'export:table',source_record_id:id,
    source_data:{format:'feishu-base',filename:'2026-09-07.base'},record_data:{tableName,names:['来源姓名'],cells:Object.entries(values).map(([fieldName,text])=>({fieldName,text}))}});
  const selection=facts('到访数据与信息表1.0-总',{'确认月份':'9月','确认日期':'2026-08-31','到访月份':'9月','到访与否':'已到','报名月份':'9月','报名与否':'已报名','学服老师':'学服甲'},'selection');
  const contact=facts('获客&私域信息登记表1.0-总',{'确认月份':'9月','确认人员':'学服甲'},'contact');
  const activityFacts=facts('袋鼠报名与备考信息表',{'报名日期':'2026-09-02'},'kangaroo');
  state.tables.activities=[activity('selection',null),activity('kangaroo','2026-09-07')];
  state.tables.activity_registrations=[{...registration('selection','selection','lead'),registered_on:'2026-08-31',source_metric_facts:selection},
    {...registration('combined-copy','selection','lead'),source_metric_facts:selection},
    {...registration('kangaroo','kangaroo','lead'),registered_on:'2026-09-02',source_metric_facts:activityFacts}];
  state.tables.lead_communications=[{id:'contact',lead_id:'lead',outcome:'connected',occurred_on:null,occurred_at:null,source_metric_facts:contact,source_key:'source:confirmation'}];
  state.tables.course_enrollments=[{...courseEnrollment('kangaroo','2026-09-07'),source_metric_facts:activityFacts}];
  const baseline=await getStaffOverviewData({grain:'month',now});
  for(const metric of ['contacts','invitations','arrivals','assessments','enrollments'] as const){
    expect(baseline.businessFacts.find(row=>row.key===metric)?.current,metric).toBe(1);
    const detail=await getStaffOverviewData({grain:'month',now,detail:{kind:'business',metric}});
    expect(detail.detail?.records,metric).toHaveLength(1);
    expect(detail.detail?.records[0]).toMatchObject({sourceName:'来源姓名',sourceMonth:'2026-09',sourceConfirmed:true});
    expect(baseline.supportFunnelRows.find(row=>row.userId==='support')?.metrics[metric].current,metric).toBe(1);
  }
  expect(baseline.activityRegistrations?.current).toBe(1);
  const activityDetail=await getStaffOverviewData({grain:'month',now,detail:{kind:'business',metric:'activityRegistrations'}});
  expect(activityDetail.detail?.records).toHaveLength(1);
  expect(baseline.businessFacts.find(row=>row.key==='arrivals')?.trend?.every(row=>!row.current)).toBe(true);
  const week=await getStaffOverviewData({grain:'week',now});
  expect(week.businessFacts.find(row=>row.key==='arrivals')?.current).toBe(0);
  expect(week.businessFacts.find(row=>row.key==='enrollments')?.current).toBe(0);
});

it("attributes source acquisitions to their staff signature in the table and details", async () => {
  state.tables.leads = [{ id: "lead", source_record_id: "source", owner_id: "support", status: "contacted", student_id: null, created_at: now.toISOString() }];
  state.tables.history_import_records = [{ id: "source", lead_id: "lead",
    "source_data->>filename": OVERVIEW_ACQUISITION_SOURCE, "record_data->>tableName": OVERVIEW_ACQUISITION_TABLE,
    record_data: { cells: [{ fieldName: "获取日期", text: "2026-09-02" }, { fieldName: "学员姓名", text: "来源姓名" },
      { fieldName: "确认人员", text: "来源学服乙" }] },
  }];
  const data = await getStaffOverviewData({ grain: "month", now });
  const person = data.supportFunnelRows.find(row => row.name === "来源学服乙")!;
  expect(person.metrics.leads.current).toBe(1);
  expect(data.businessFacts.find(row => row.key === "leads")?.current).toBe(1);
  const detail = await getStaffOverviewData({ grain: "month", now, detail: { kind: "support", metric: "leads", scope: person.userId! } });
  expect(detail.detail?.records).toHaveLength(1);
  expect(detail.detail?.records[0]).toMatchObject({ leadId: "lead", sourceId: "source", person: "来源学服乙" });
});

it("includes confirmed visits for missing staff contacts and preserves linked identity in details", async () => {
  const tag = buildSourceMetricFacts({ id: "source", source_table_id: "export:table", source_record_id: "source",
    source_data: { format: "feishu-base", filename: "2026-09-07.base" }, record_data: { tableName: "到访数据与信息表1.0-总", names: ["来源姓名"],
      cells: [{ fieldName: "确认月份", text: "9月" }, { fieldName: "确认日期", text: "9.3" }, { fieldName: "学服老师", text: "来源学服乙" }] } });
  state.tables.activities = [activity("visit", null)];
  state.tables.leads = [{ id: "lead", student_id: "student", owner_id: "support", source_record_id: "old-source", created_at: now.toISOString() }];
  state.tables.activity_registrations = [{ ...registration("source", "visit", "lead"), registered_on: null, student_id: "student", source_metric_facts: tag }];
  // 另一位学服的沟通保持独立，不覆盖本次确认人员。
  state.tables.lead_communications = [{ id: "contact", lead_id: "lead", outcome: "connected", occurred_on: "2026-09-03", occurred_at: null, owner_id_at_contact: "support" }];
  const data = await getStaffOverviewData({ grain: "month", now });
  const person = data.supportFunnelRows.find(row => row.name === "来源学服乙")!;
  expect(person.metrics.contacts.current).toBe(1);
  expect(data.businessFacts.find(row => row.key === "contacts")?.current).toBe(2);
  const detail = await getStaffOverviewData({ grain: "month", now, detail: { kind: "support", metric: "contacts", scope: person.userId! } });
  expect(detail.detail?.records).toHaveLength(1);
  expect(detail.detail?.records[0]).toMatchObject({ leadId: "lead", studentId: "student", sourceId: "source", sourceMonth: "2026-09", sourceConfirmed: true });
  const week = await getStaffOverviewData({ grain: "week", date: "2026-09-03", now });
  expect(week.supportFunnelRows.find(row => row.name === "来源学服乙")?.metrics.contacts.current ?? 0).toBe(0);
  for (const source of ["activity_registrations", "leads", "profiles"]) {
    state.failures.add(source);
    const unavailable = await getStaffOverviewData({ grain: "month", now, detail: { kind: "business", metric: "contacts" } });
    expect(unavailable.detail).toEqual({ available: false, records: [] });
    state.failures.delete(source);
  }
});

it("supplements only uncovered contact subjects, staff and periods without merging independent records", () => {
  const contact = { id: "contact", at: "2026-09-02T16:00:00Z", personId: "support", subjectId: "student", sourceMonth: "2026-09" };
  const confirmations = [
    { ...contact, id: "covered", at: null },
    { ...contact, id: "other-person", personId: "support-b" },
    { ...contact, id: "other-subject", subjectId: "student-b" },
    { ...contact, id: "other-month", sourceMonth: "2026-08" },
    { ...contact, id: "unlinked", subjectId: null },
    { ...contact, id: "unassigned", personId: null },
  ];
  expect(supplementOverviewContacts([contact, { ...contact, id: "second-call" }], confirmations, "month", "Asia/Shanghai").map(row => row.id))
    .toEqual(["contact", "second-call", "other-person", "other-subject", "other-month", "unlinked", "unassigned"]);
  const dates = [{ ...contact, id: "same-local-day", at: "2026-09-03T00:00:00Z" },
    { ...contact, id: "next-local-day", at: "2026-09-03T16:00:00Z" }];
  expect(supplementOverviewContacts([contact], dates, "week", "Asia/Shanghai").map(row => row.id)).toEqual(["contact", "next-local-day"]);
});

it("drills into the same fact records and keeps unknown data distinct from zero", async () => {
  state.tables.leads = [{ id: "l", created_at: "2026-09-01T00:00:00Z", owner_id: "support", status: "uncontacted", student_id: null }];
  state.tables.activities = [activity("a", "2026-09-02")];
  state.tables.activity_registrations = [registration("r", "a", "l")];
  state.tables.assessment_results = [assessment("assessment", "r")];
  state.tables.course_enrollments = [{ ...courseEnrollment("e", "2026-09-03"), student_id: null, course_opportunities: { student_id: null, lead_id: "l" } }];
  const baseline = await getStaffOverviewData({ grain: "month", now });
  for (const metric of ["leads", "contacts", "invitations", "arrivals", "assessments", "enrollments"] as const) {
    const data = await getStaffOverviewData({ grain: "month", now, detail: { kind: "business", metric } });
    expect(data.detail?.available, metric).toBe(true);
    expect(data.detail?.records.length, metric).toBe(baseline.businessFacts.find(row => row.key === metric)?.current);
  }
  const teacher = await getStaffOverviewData({ grain: "month", now, detail: { kind: "participation", metric: "enrollments", scope: "teacher" } });
  expect(teacher.detail?.records.length).toBe(baseline.teacherParticipationRows.find(row => row.userId === "teacher")?.enrollments.current);
  expect(teacher.detail?.records[0]).toMatchObject({ leadId: "l" });
  const pending = await getStaffOverviewData({ grain: "month", now, detail: { kind: "pending", metric: "uncontactedLeads" } });
  expect(pending.detail?.records.length).toBe(pending.pendingFacts.find(row => row.key === "uncontactedLeads")?.value);
  state.failures.add("assessment_results");
  const unavailable = await getStaffOverviewData({ grain: "month", now, detail: { kind: "business", metric: "assessments" } });
  expect(unavailable.detail).toEqual({ available: false, records: [] });
});

it("keeps historical acquisitions when their leads leave the current work queue", async () => {
  state.tables.leads = [{ id: "historical", created_at: "2026-09-06T02:00:00Z", owner_id: null, status: "unassigned" }];
  state.tables.operational_leads = [];
  const data = await getStaffOverviewData({ grain: "month", now });
  expect(data.businessFacts.find(row => row.key === "leads")?.current).toBe(1);
  expect(data.pendingFacts.find(row => row.key === "unassignedLeads")?.value).toBe(0);
  state.failures.add("operational_leads");
  const unavailable = await getStaffOverviewData({ grain: "month", now });
  expect(unavailable.businessFacts.find(row => row.key === "leads")?.current).toBe(1);
  expect(unavailable.pendingFacts.find(row => row.key === "unassignedLeads")?.value).toBeNull();
});

describe("staff overview reads current business sources", () => {
  it('counts explicit current reminders while preserving historical monthly acquisitions', async () => {
    state.tables.leads = ['current', 'historical'].map(id => ({ id, created_at: '2026-09-06T02:00:00Z', owner_id: null, status: 'unassigned' }));
    state.tables.operational_leads = [state.tables.leads[0]];
    state.tables.lead_next_actions = [
      { lead_id: 'current', kind: 'initial_contact', status: 'open', due_at: '2026-09-01T00:00:00Z' },
      { lead_id: 'historical', kind: 'callback', status: 'open', due_at: '2026-09-01T00:00:00Z' },
      { lead_id: 'current', kind: 'callback', status: 'open', due_at: '2026-09-01T00:00:00Z' },
    ];
    const data = await getStaffOverviewData({ grain: 'month', now });
    expect(data.businessFacts.find(row => row.key === 'leads')?.current).toBe(2);
    expect(data.pendingFacts.find(row => row.key === 'overdueLeadActions')?.value).toBe(1);
  });
  it("builds class occupancy from current visible classes and preserves unknown counts", async () => {
    state.tables.classrooms = [
      { id: "current-class", name: "三年级甲班", term_id: "current", purpose: "production", grade: 3, capacity: 20, archived_at: null, trashed_at: null },
      { id: "old-class", name: "往期班", term_id: "old", purpose: "production", grade: 3, capacity: 20, archived_at: null, trashed_at: null },
    ];
    state.tables.enrollments = [{ id: "e", classroom_id: "current-class", student_id: "student", status: "active", joined_at: "2026-09-02T00:00:00Z" }];
    state.tables.classroom_staff_assignments = [
      { classroom_id: "current-class", user_id: "teacher", responsibility: "primary_teacher", ended_at: null },
      { classroom_id: "current-class", user_id: "support", responsibility: "learning_support", ended_at: null },
    ];
    const data = await getStaffOverviewData({ grain: "month", now });
    expect(data.classroomRows).toHaveLength(1);
    expect(data.classroomRows[0]).toMatchObject({ id: "current-class", name: "三年级甲班", enrolledSeats: 1, full: 20, teacherNames: ["老师甲"] });
    state.failures.add("enrollments");
    const unavailable = await getStaffOverviewData({ grain: "month", now });
    expect(unavailable.classroomRows[0].enrolledSeats).toBeNull();
  });

  it("loads beyond the server row cap and preserves complete totals and owner rows", async () => {
    state.tables.leads = Array.from({ length: 1103 }, (_, i) => ({ id: `lead-${i}`, created_at: "2026-09-07T02:00:00Z", owner_id: "support", status: "uncontacted", student_id: null, source_record_id: null }));
    const data = await getStaffOverviewData({ grain: "week", now });
    expect(data.businessFacts.find(row => row.key === "leads")?.current).toBe(1103);
    expect(data.pendingFacts.find(row => row.key === "uncontactedLeads")?.value).toBe(1103);
    expect(data.supportFunnelRows.find(row => row.userId === "support")?.metrics.leads.current).toBe(1103);
    expect(data.truncatedSources).toEqual([]);
  });

  it("uses actual source dates, completed results and distinct lead identities", async () => {
    state.tables.activities = [activity("old", "2026-08-03"), activity("this-month", "2026-09-02"), activity("this-week", "2026-09-07"), activity("undated", null)];
    state.tables.activity_registrations = [registration("r-old", "old", "l-old"), registration("r-month", "this-month", "l-one"), registration("r-week", "this-week", "l-two"), registration("r-unknown", "undated", "l-three"), registration("r-no-show", "this-week", "l-four", "no_show"), registration("r-notes", "this-week", "l-five")];
    state.tables.assessment_results = [assessment("a-old", "r-old"), assessment("a-month", "r-month"), assessment("a-week", "r-week"), assessment("a-unknown", "r-unknown"), assessment("a-no-show", "r-no-show"), { ...assessment("a-notes", "r-notes", null), parent_concerns: "仅有家长情况" }];
    state.tables.lead_communications = [
      { id: "contact", occurred_at: null, occurred_on: "2026-09-02", outcome: "connected", owner_id_at_contact: null, recorded_by: "support", source_record_id: "source" },
      { id: "undated-contact", occurred_at: null, occurred_on: null, outcome: "connected", source_record_id: "source" },
    ];
    const data = await getStaffOverviewData({ grain: "month", now });
    const metrics = Object.fromEntries(data.businessFacts.map(row => [row.key, row]));
    expect(metrics.contacts.current).toBe(1);
    expect(metrics.arrivals.current).toBe(3);
    expect(metrics.assessments.current).toBe(2);
    expect(metrics.assessments.previous).toBe(1);
    expect(data.missingDateCounts).toMatchObject({ contacts: 1, arrivals: 1, assessments: 1 });
    expect(data.teacherParticipationSummary.participants.current).toBe(3);
    // 老师已参与到访但结果尚未完成时，仍保留老师的参与事实。
    expect(data.teacherParticipationRows.find(row => row.userId === "teacher")?.participants.current).toBe(3);
    expect(data.supportFunnelRows.find(row => row.userId === "support")?.metrics.assessments.current).toBe(2);
    const summary = await getStaffHomeWeekSummaryData({ now });
    const weekly = await getStaffOverviewData({ grain: "week", now });
    expect(summary.businessFacts).toEqual(weekly.businessFacts.filter(row => ["arrivals", "assessments", "enrollments"].includes(row.key)));
  });

  it("counts enrollment registrations independently from roster placement and edits", async () => {
    state.tables.course_enrollments = [courseEnrollment("registered", "2026-09-02"), courseEnrollment("undated", null), courseEnrollment("native", null, false), courseEnrollment("last-month", "2026-08-02")];
    state.tables.course_enrollment_assignments = [{ id: "bridge", course_enrollment_id: "registered", classroom_membership_id: "placed" }];
    state.tables.classrooms = [{ id: "class", purpose: "production", grade: 3, capacity: 20, term_id: "current", archived_at: null, trashed_at: null }];
    state.tables.enrollments = [
      { id: "placed", classroom_id: "class", student_id: "registered", joined_at: "2026-09-03T00:00:00Z", status: "active" },
      { id: "legacy", classroom_id: "class", student_id: "legacy", joined_at: "2026-09-02T00:00:00Z", status: "active" },
      { id: "roster", classroom_id: "class", student_id: "roster", joined_at: "2026-09-02T00:00:00Z", status: "active", remark: "班级学员导入：在读名单.xlsx" },
    ];
    const data = await getStaffOverviewData({ grain: "month", now });
    expect(data.businessFacts.find(row => row.key === "enrollments")).toMatchObject({ current: 2, previous: 1 });
    expect(data.missingDateCounts.enrollments).toBe(1);
  });

  it("counts a combined source visit once and keeps its staff signature and all participating teachers", async () => {
    state.tables.activities = [activity("assessment", "2026-09-02"), activity("trial", "2026-09-02"), activity("return", "2026-09-03")]
      .map(row => ({ ...row, remark: "学服老师：来源学服乙" }));
    state.tables.activity_registrations = [
      { ...registration("assess-reg", "assessment", "child"), source_record_id: "combined-visit" },
      { ...registration("trial-reg", "trial", "child"), source_record_id: "combined-visit" },
      { ...registration("return-reg", "return", "child"), source_record_id: "another-visit" },
      { ...registration("native-a", "trial", "child"), source_record_id: null },
      { ...registration("native-b", "trial", "child"), source_record_id: null },
    ];
    state.tables.assessment_results = [assessment("result", "trial-reg")];
    const data = await getStaffOverviewData({ grain: "month", now });
    expect(data.businessFacts.find(row => row.key === "arrivals")?.current).toBe(4);
    expect(data.supportFunnelRows.find(row => row.name === "来源学服乙")).toMatchObject({
      userId: `source-staff:${encodeURIComponent("来源学服乙")}`,
      metrics: { arrivals: { current: 4 }, invitations: { current: 2 } },
    });
    expect(selectOverviewSupportRows(data.supportFunnelRows, data.supportDirectory).options.some(row => row.name === "来源学服乙")).toBe(true);
    expect(data.teacherParticipationRows.find(row => row.userId === "teacher")?.participants.current).toBe(1);
    const summary = await getStaffHomeWeekSummaryData({ now: new Date("2026-09-03T12:00:00+08:00") });
    expect(summary.businessFacts.find(row => row.key === "arrivals")?.current).toBe(4);
  });

  it("counts all current-term production rosters including planned classes, and deduplicates students", async () => {
    state.tables.classrooms = [
      { id: "planned", purpose: "production", operational_status: "planning", term_id: "current", grade: 3, capacity: 20, archived_at: null, trashed_at: null },
      { id: "open", purpose: "production", operational_status: "active", term_id: "current", grade: 3, capacity: 20, archived_at: null, trashed_at: null },
      { id: "old", purpose: "production", operational_status: "active", term_id: "old", grade: 3, capacity: 20, archived_at: null, trashed_at: null },
      { id: "test", purpose: "test", operational_status: "active", term_id: "current", grade: 3, capacity: 20, archived_at: null, trashed_at: null },
    ];
    state.tables.enrollments = [["a", "planned", "child", "active"], ["b", "open", "child", "active"], ["c", "old", "past", "active"], ["d", "test", "fixture", "active"], ["e", "planned", "left", "withdrawn"]]
      .map(([id, classroom_id, student_id, status]) => ({ id, classroom_id, student_id, status, joined_at: "2026-09-02T00:00:00Z" }));
    const data = await getStaffOverviewData({ grain: "month", now });
    expect(data.snapshot).toMatchObject({ activeClasses: 2, activeStudents: 1, enrolledSeats: 2 });
    expect(data.currentTermName).toBe("本学期");
    expect(data.capacityByGrade[0]).toMatchObject({ classCount: 2, enrolledSeats: 2 });
  });

  it("counts dated source enrollments for unlinked leads and keeps the existing independent registration", async () => {
    state.tables.activities = [activity("visit", "2026-09-02"), activity("trial", "2026-09-02")];
    const facts = { version: 1, confirmed: true, registeredOn: "2026-09-03", assessmentBand: "a_plus" };
    state.tables.activity_registrations = [
      { ...registration("source-one", "visit", "one"), source_enrollment_facts: facts },
      { ...registration("source-two", "visit", "two"), source_record_id: "two", source_enrollment_facts: facts },
      { ...registration("source-two-trial", "trial", "two"), source_record_id: "two", source_enrollment_facts: facts },
      { ...registration("source-student", "visit", ""), lead_id: null, student_id: "student", source_enrollment_facts: facts },
      { ...registration("undated", "visit", "unknown"), source_enrollment_facts: { ...facts, registeredOn: null } },
      { ...registration("old", "visit", "old"), source_enrollment_facts: { ...facts, registeredOn: "2026-08-03" } },
    ];
    state.tables.course_enrollments = [
      { ...courseEnrollment("independent", "2026-09-03"), student_id: "student" },
      { ...courseEnrollment("unbound", null), student_id: null, source_record_id: "source-one" },
    ];
    state.tables.assessment_results = [assessment("result", "source-two")];
    const data = await getStaffOverviewData({ grain: "month", now });
    expect(data.businessFacts.find(row => row.key === "enrollments")).toMatchObject({ current: 3, previous: 1 });
    expect(data.missingDateCounts.enrollments).toBe(1);
    expect(data.supportFunnelRows.find(row => row.userId === "support")?.metrics.enrollments.current).toBe(3);
    expect(data.teacherParticipationRows.find(row => row.userId === "teacher")?.enrollments.current).toBe(1);
    const weekly = await getStaffHomeWeekSummaryData({ now: new Date("2026-09-03T12:00:00+08:00") });
    expect(weekly.businessFacts.find(row => row.key === "enrollments")?.current).toBe(3);
  });

  it("keeps source teacher participation when the trial has no assessment result or matching account", async () => {
    state.tables.activities = [{ ...activity("trial", "2026-09-02"), remark: "学科老师：来源老师乙" }];
    state.tables.activity_registrations = [registration("source-trial", "trial", "one")];
    const data = await getStaffOverviewData({ grain: "month", now });
    expect(data.teacherParticipationSummary.unattributedParticipants.current).toBe(0);
    expect(data.teacherParticipationRows.find(row => row.name === "来源老师乙")?.participants.current).toBe(1);
    expect(data.businessFacts.find(row => row.key === "assessments")?.current).toBe(0);
  });

  it("shows acquisition as unavailable when archive RLS hides dates and preserves readable pending facts", async () => {
    state.tables.leads = [{ id: "imported", created_at: now.toISOString(), source_record_id: "source", status: "uncontacted", owner_id: "support" }];
    const data = await getStaffOverviewData({ grain: "month", now });
    expect(data.businessFacts.find(row => row.key === "leads")?.current).toBeNull();
    expect(data.unavailableSources).toContain("leads");
    expect(data.pendingFacts.find(row => row.key === "uncontactedLeads")?.value).toBe(1);
  });

  it("reports an unavailable source instead of showing a successful zero", async () => {
    state.failures.add("course_enrollments");
    const data = await getStaffOverviewData({ grain: "month", now });
    expect(data.unavailableSources).toContain("enrollments");
    expect(data.businessFacts.find(row => row.key === "enrollments")?.current).toBeNull();
  });

  it("switches all period facts to a full historical week while keeping today's roster and pending state", async () => {
    state.tables.activities = [activity("last-week", "2026-09-06"), activity("prior-week", "2026-08-30")];
    state.tables.activity_registrations = [registration("last-reg", "last-week", "one"), registration("prior-reg", "prior-week", "two")];
    state.tables.assessment_results = [assessment("last-result", "last-reg"), assessment("prior-result", "prior-reg")];
    state.tables.leads = [{ id: "last-lead", created_at: "2026-09-06T02:00:00Z", owner_id: "support", status: "uncontacted" }];
    state.tables.course_enrollments = [courseEnrollment("last-enrollment", "2026-09-06"), courseEnrollment("prior-enrollment", "2026-08-30")];
    state.tables.classrooms = [{ id: "class", purpose: "production", grade: 3, capacity: 20, term_id: "current", archived_at: null, trashed_at: null }];
    state.tables.enrollments = [{ id: "member", classroom_id: "class", student_id: "child", joined_at: "2026-09-07T00:00:00Z", status: "active", remark: "班级学员导入：在读名单" }];
    const historical = await getStaffOverviewData({ grain: "week", now, date: "previous" });
    const current = await getStaffOverviewData({ grain: "week", now, date: "current" });
    expect(historical.isComplete).toBe(true);
    for (const key of ["arrivals", "assessments", "enrollments"]) {
      expect(historical.businessFacts.find(row => row.key === key)).toMatchObject({ current: 1, previous: 1 });
      expect(current.businessFacts.find(row => row.key === key)?.current).toBe(0);
    }
    expect(historical.businessFacts.find(row => row.key === "leads")?.current).toBe(1);
    expect(historical.supportFunnelRows.find(row => row.userId === "support")?.metrics.arrivals).toEqual({ current: 1, previous: 1 });
    expect(historical.teacherParticipationRows.find(row => row.userId === "teacher")?.participants).toEqual({ current: 1, previous: 1 });
    expect(historical.snapshot).toEqual(current.snapshot);
    expect(historical.snapshot.activeStudents).toBe(1);
    expect(historical.pendingFacts).toEqual(current.pendingFacts);
  });

  it("places date-only records in the organization timezone and leaves missing dates empty", () => {
    expect(overviewFactInstant(null, "2026-09-01", "Asia/Shanghai")).toBe("2026-08-31T16:00:00.000Z");
    expect(overviewFactInstant(null, "2026-02-30", "Asia/Shanghai")).toBeNull();
    expect(overviewFactInstant(null, null, "Asia/Shanghai")).toBeNull();
    expect(overviewSubjectKey(null, "lead-a", "student-a", "row-a")).toBe("student-a");
    expect(overviewSubjectKey(null, "lead-b", null, "row-b")).toBe("lead:lead-b");
  });
});
