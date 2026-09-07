import { beforeEach, describe, expect, it, vi } from "vitest";
import { leadContactAllowsIdentity } from "@/features/school/lead-identity-contract";
import { getStudent360Snapshot } from "@/features/school/student-360";

const state = vi.hoisted(() => ({ permissions: new Set<string>(), tables: {} as Record<string, Record<string, unknown>[]> }));
vi.mock("server-only", () => ({}));
vi.mock("next-intl/server",()=>({getLocale:async()=>"zh"}));
vi.mock("@/features/school/student-business-history-data",()=>({loadStudentBusinessHistory:async()=>null}));
vi.mock("@/lib/auth", () => ({ getMyPerms: async () => state.permissions }));
vi.mock("@/features/school/student-lifecycle-data", () => ({ readStudentLifecycle: async () => "awaiting_assessment" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  from(table: string) {
    let rows = state.tables[table] ?? [];
    let single = false;
    const query = {
      select: () => query,
      eq: (field: string, value: unknown) => { rows = rows.filter((row) => row[field] === value); return query; },
      in: (field: string, values: unknown[]) => { rows = rows.filter((row) => values.includes(row[field])); return query; },
      order: () => query, limit: () => query, returns: () => query,
      maybeSingle: () => { single = true; return query; },
      then(resolve: (value: { data: unknown; error: null }) => unknown) { return Promise.resolve(resolve({ data: single ? rows[0] ?? null : rows, error: null })); },
    };
    return query;
  },
}) }));

const at = "2026-09-06T08:00:00Z";
const contact = (outcome: string) => ({ id: outcome, lead_id: "lead", channel: "phone", outcome, note: "", wechat_added: null,
  visit_committed: null, interest_level: null, recorded_by: "owner", occurred_at: at });
const snapshot = () => getStudent360Snapshot({ leadId: "lead", studentId: null });

beforeEach(() => {
  state.permissions = new Set(["followup.view", "followup.write", "student.edit", "student.create"]);
  state.tables = { leads: [{ id: "lead", provisional_student_name: "孩子", phone: "", grade_hint: 3, grade_text: "三年级",
    status: "uncontacted", owner_id: "owner", student_id: null, identity_confirmed_at: null, created_by: "owner", created_at: at }] };
});

describe("student 360 profile state remains read-only", () => {
  it('uses source event dates without turning the import timestamp into an assessment date',async()=>{
    state.tables.activity_registrations=[{id:'registration',activity_id:'visit',lead_id:'lead',student_id:null,record_state:'current',status:'attended',outcome:'',assessment_completed_at:null}];
    state.tables.activities=[{id:'visit',kind:'assessment_1v1',title:'1v1',scheduled_at:null,occurred_on:'2025-12-29',location:'',remark:''}];
    state.tables.assessment_results=[{id:'assessment',activity_registration_id:'registration',source_record_id:'source',assessed_on:null,updated_at:at,assessment_band:'a',overall_level:null,score:null,strengths:'',focus_areas:'',parent_concerns:'',teacher_recommendation:'',recommended_class:'',teacher_observation:''}];
    const result=await snapshot();
    expect(result.events.find(event=>event.id==='activity:registration')?.occurredAt).toBe('2025-12-29');
    expect(result.events.find(event=>event.id==='assessment:assessment')?.occurredAt).toBeNull();
  });
  it.each([null, "unreachable", "invalid_number"])("keeps an unsaved or unsuccessful contact %s pending", async (outcome) => {
    state.tables.lead_communications = outcome ? [contact(outcome)] : [];
    expect(leadContactAllowsIdentity(outcome)).toBe(false);
    expect((await snapshot()).identityCreation).toMatchObject({ contactEstablished: false, canManage: true });
  });
  it.each(["connected", "declined"])("keeps a saved %s without a linked profile available for exception review", async (outcome) => {
    state.tables.lead_communications = [contact(outcome)];
    expect(leadContactAllowsIdentity(outcome)).toBe(true);
    const result = await snapshot();
    expect(result.identityCreation).toMatchObject({ contactEstablished: true, canManage: true, lead: { id: "lead", ownerId: "owner" } });
    expect(result.identity.studentId).toBeNull();
    expect(result.identity.identityState).toBe("lead");
    expect(state.tables.students).toBeUndefined();
  });
  it("preserves an established contact after a later missed call, while a closed invalid lead stays pending", async () => {
    state.tables.lead_communications = [contact("unreachable"), contact("connected")];
    expect((await snapshot()).identityCreation?.contactEstablished).toBe(true);
    state.tables.leads[0].status = "invalid";
    expect((await snapshot()).identityCreation?.contactEstablished).toBe(false);
  });
  it("requires the existing edit permission and ownership scope for the action", async () => {
    state.tables.lead_communications = [contact("connected")];
    state.permissions.delete("student.edit");
    expect((await snapshot()).identityCreation?.canManage).toBe(false);
    state.permissions.add("student.edit");
    state.tables.leads[0].owner_id = "another";
    expect((await snapshot()).identityCreation?.canManage).toBe(false);
    state.permissions.add("student.view.all");
    expect((await snapshot()).identityCreation?.canManage).toBe(true);
    state.tables.leads[0].owner_id = null;
    expect((await snapshot()).identityCreation?.canManage).toBe(false);
  });
  it("keeps an existing student profile as the destination instead of offering another identity", async () => {
    state.tables.leads[0].student_id = "student";
    state.tables.students = [{ id: "student", name: "孩子", grade: 3, phone: "", wechat: "", school: "", parent_name: "", parent_phone: "",
      assigned_to: "owner", status: "active", follow_up_status: "", remark: "", next_follow_up_at: null, updated_at: at }];
    const result = await snapshot();
    expect(result.identityCreation).toBeNull();
    expect(result.identity.studentId).toBe("student");
    expect(result.identity.identityState).toBe("student");
  });
  it("accepts matching Lead + Student references after automatic creation and rejects mismatches", async () => {
    state.tables.leads[0].student_id = "student";
    const result = await getStudent360Snapshot({ leadId: "lead", studentId: "student" });
    expect(result.identity.studentId).toBe("student");
    await expect(getStudent360Snapshot({ leadId: "lead", studentId: "another" })).rejects.toThrow("SUBJECT_MISMATCH");
    await expect(getStudent360Snapshot({ leadId: "missing", studentId: "student" })).rejects.toThrow("SUBJECT_MISMATCH");
  });
});
