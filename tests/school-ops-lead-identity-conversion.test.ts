import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  leadIdentityHasPossibleDuplicate,
  type LeadIdentityInput,
  type LeadIdentityOptions,
} from "@/features/school/lead-identity-contract";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

const options: LeadIdentityOptions = {
  lead: {
    id: "00000000-0000-0000-0000-000000000001",
    studentName: "小满",
    phone: "13800000001",
    grade: 6,
    gradeText: "六年级",
    wechatNickname: "星星",
    ownerId: "00000000-0000-0000-0000-000000000002",
    suggestedStudentId: "00000000-0000-0000-0000-000000000003",
  },
  canCreateStudent: true,
  students: [{
    id: "00000000-0000-0000-0000-000000000003",
    name: "小满",
    grade: 6,
    phone: "",
    parentName: "满妈",
    parentPhone: "13800000001",
    suggested: true,
    phoneMatch: true,
    nameMatch: true,
  }],
  families: [],
  contacts: [{
    id: "00000000-0000-0000-0000-000000000004",
    displayName: "满妈",
    phone: "13800000001",
    wechat: "星星",
    familyNames: ["小满家庭"],
  }],
};

const createInput: LeadIdentityInput = {
  student: { mode: "create", name: "小满", grade: 6 },
  family: { mode: "create", displayName: "小满家庭" },
  contact: { mode: "create", displayName: "满妈", phone: "13800000001", wechat: "星星" },
  relationship: {
    relation: "母亲",
    isPrimaryFamily: true,
    isPrimaryContact: true,
    isDecisionMaker: true,
    preferredChannel: "wechat",
  },
  allowPossibleDuplicate: false,
  allowAdditionalRelationship: false,
};

describe("SCHOOL-OPS explicit Lead identity conversion", () => {
  it("creates stable Family and Contact identities without making phone globally unique", () => {
    const migration = read("supabase", "migrations", "20260905000100_school_ops_identity_conversion.sql");

    expect(migration).toContain("create table public.families");
    expect(migration).toContain("create table public.contacts");
    expect(migration).toContain("create table public.family_contacts");
    expect(migration).toContain("create table public.family_students");
    expect(migration).toContain("create table public.student_contacts");
    expect(migration).toContain("create table public.lead_identity_conversions");
    expect(migration).toContain("create trigger lead_identity_conversions_append_only");
    expect(migration).toContain("phone_normalized text not null default ''");
    expect(migration).toContain("create index contacts_phone_idx");
    expect(migration).not.toContain("create unique index contacts_phone_idx");
    expect(migration).toContain("family_id uuid not null references public.families(id) on delete restrict");
    expect(migration).toContain("contact_id uuid not null references public.contacts(id) on delete restrict");
    expect(migration).toContain("student_id uuid not null references public.students(id) on delete restrict");
  });

  it("enforces one explicit primary relationship at every household boundary", () => {
    const migration = read("supabase", "migrations", "20260905000100_school_ops_identity_conversion.sql");

    expect(migration).toContain("create unique index family_contacts_one_primary_idx");
    expect(migration).toContain("on public.family_contacts(family_id) where is_primary");
    expect(migration).toContain("create unique index family_students_one_primary_idx");
    expect(migration).toContain("on public.family_students(student_id) where is_primary");
    expect(migration).toContain("create unique index student_contacts_one_primary_idx");
    expect(migration).toContain("on public.student_contacts(student_id) where is_primary");
    expect(migration).toContain("set is_primary = false");
  });

  it("uses one locked, idempotent mutation for existing or newly created identities", () => {
    const migration = read("supabase", "migrations", "20260905000100_school_ops_identity_conversion.sql");
    const mutation = migration.slice(migration.indexOf("create or replace function public.confirm_lead_identity"));

    expect(mutation).toContain("p_lead_id uuid");
    expect(mutation).toContain("p_idempotency_key text");
    expect(mutation).toContain("p_identity jsonb");
    expect(mutation).toContain("jsonb_typeof(p_identity #> '{relationship,isPrimaryFamily}') is distinct from 'boolean'");
    expect(mutation).toContain("jsonb_typeof(p_identity -> 'allowAdditionalRelationship') is distinct from 'boolean'");
    expect(mutation).toContain("where id = p_lead_id for update");
    expect(migration).toContain("unique(lead_id, idempotency_key)");
    expect(migration).toContain("request_hash text not null");
    expect(mutation).toContain("extensions.digest(convert_to(p_identity::text, 'UTF8'), 'sha256')");
    expect(mutation).toContain("IDEMPOTENCY_CONFLICT");
    expect(mutation).toContain("POSSIBLE_FAMILY_DUPLICATE");
    expect(mutation).toContain("'lead-identity-contact:'");
    expect(mutation).toContain("'lead-identity-student:'");
    expect(mutation).toContain("'lead-identity-family:'");
    expect(mutation).toContain("v_student_mode is null or v_student_mode not in ('existing','create')");
    expect(mutation).toContain("v_family_mode is null or v_family_mode not in ('existing','create')");
    expect(mutation).toContain("v_contact_mode is null or v_contact_mode not in ('existing','create')");
    expect(mutation).toContain("RELATIONSHIP_CONFLICT");
    expect(mutation).toContain("PRIMARY_RELATION_REQUIRED");
    expect(mutation).toContain("v_allow_additional_relationship");
    expect(mutation).toContain("set family_id = v_family_id");
    expect(mutation).toContain("student_id = v_student_id");
    expect(mutation).toContain("status = 'converted'");
    expect(mutation).toContain("exception when unique_violation then");
    expect(mutation).toContain("raise exception 'LEAD_IDENTITY_HISTORY_CONFLICT'");
  });

  it("preserves Lead facts, projects only empty legacy parent fields, and carries reminders forward", () => {
    const migration = read("supabase", "migrations", "20260905000100_school_ops_identity_conversion.sql");
    const mutation = migration.slice(migration.indexOf("create or replace function public.confirm_lead_identity"));

    expect(mutation).toContain("when btrim(parent_name) = '' then v_contact_name else parent_name end");
    expect(mutation).toContain("when btrim(parent_relation) = '' then v_relation else parent_relation end");
    expect(mutation).toContain("when btrim(parent_phone) = '' then v_contact_phone else parent_phone end");
    expect(mutation).toContain("next_follow_up_at");
    expect(mutation).toContain("v_next_action.due_at");
    expect(mutation).toContain("else least(next_follow_up_at, v_next_action.due_at)");
    expect(mutation).toContain("v_next_action_migrated := v_next_action.id is not null");
    expect(mutation).toContain("'sourceNextAction'");
    expect(mutation).toContain("'nextActionDueAt', v_next_action.due_at");
    expect(mutation).toContain("'nextActionMigrated', v_next_action_migrated");
    expect(mutation).not.toContain("insert into public.student_follow_ups");
    expect(mutation).not.toContain("delete from public.leads");
    expect(mutation).not.toContain("delete from public.lead_source_records");
    expect(mutation).not.toContain("delete from public.lead_communications");
    expect(mutation).not.toContain("delete from public.lead_invitation_threads");
    expect(mutation).not.toContain("update public.lead_source_records");
    expect(mutation).not.toContain("update public.lead_communications");
    expect(mutation).not.toContain("update public.lead_invitation_threads");
  });

  it("keeps intake, contact, assessment, and enrollment outside the Student-creation boundary", () => {
    const intake = read("supabase", "migrations", "20260902000800_school_ops_xiaoditui_intake.sql");
    const contact = read("supabase", "migrations", "20260902001300_school_ops_lead_contact_workbench.sql");
    const assessment = read("supabase", "migrations", "20260904000200_school_ops_assessment_aggregate_workbench.sql");
    const phase3 = read("supabase", "migrations", "20260905000200_school_ops_phase3_enrollment_handoff.sql");
    const enrollmentMarker = phase3.indexOf("create or replace function public.confirm_course_enrollment");
    expect(enrollmentMarker).toBeGreaterThan(-1);
    const enrollmentMutation = phase3.slice(enrollmentMarker);

    expect(intake).not.toContain("insert into public.students");
    expect(contact).not.toContain("insert into public.students");
    expect(assessment).not.toContain("insert into public.students");
    expect(enrollmentMutation).not.toContain("confirm_lead_identity");
    expect(enrollmentMutation).not.toContain("insert into public.students");
  });

  it("keeps CRM contacts staff-scoped and relationship writes RPC-only", () => {
    const migration = read("supabase", "migrations", "20260905000100_school_ops_identity_conversion.sql");

    expect(migration).toContain("create or replace function public.can_access_family");
    expect(migration).toContain("create or replace function public.can_access_contact");
    expect(migration).toContain("p_uid is not null and public.is_staff(p_uid)");
    expect(migration).toContain("public.can_access_student(membership.student_id, p_uid)");
    expect(migration).toContain("revoke all on public.families, public.contacts");
    expect(migration).toContain("grant select on public.families, public.contacts");
    expect(migration).not.toContain("grant insert on public.contacts");
    expect(migration).not.toContain("grant update on public.contacts");
  });

  it("requires an explicit duplicate acknowledgement for new matching identities", () => {
    expect(leadIdentityHasPossibleDuplicate(options, createInput)).toBe(true);
    expect(leadIdentityHasPossibleDuplicate(options, {
      ...createInput,
      student: { mode: "existing", id: options.students[0].id },
      contact: { mode: "existing", id: options.contacts[0].id },
    })).toBe(false);
    expect(leadIdentityHasPossibleDuplicate({
      ...options,
      families: [{
        id: "00000000-0000-0000-0000-000000000005",
        displayName: "小满家庭",
        studentNames: ["小满"],
        contactNames: ["满妈"],
      }],
    }, {
      ...createInput,
      student: { mode: "existing", id: options.students[0].id },
      contact: { mode: "existing", id: options.contacts[0].id },
    })).toBe(true);
    expect(leadIdentityHasPossibleDuplicate(options, {
      ...createInput,
      student: { mode: "create", name: "另一位学生", grade: 6 },
      family: { mode: "create", displayName: "另一户家庭" },
      contact: { mode: "create", displayName: "另一位家长", phone: "13900000009", wechat: "" },
    })).toBe(false);
  });

  it("exposes the frozen RPC through one Server Action and a distinct seed-pool control", () => {
    const actions = read("src", "features", "school", "actions", "leads.ts");
    const control = read("src", "features", "school", "LeadIdentityControl.tsx");
    const table = read("src", "features", "school", "LeadPoolTable.tsx");

    expect(actions).toContain("confirmLeadIdentityAction");
    expect(actions).toContain('rpc(supabase)("confirm_lead_identity"');
    expect(actions).toContain("p_idempotency_key");
    expect(actions).toContain("allowAdditionalRelationship: z.boolean()");
    expect(actions).toContain('"COURSE_OPPORTUNITY_IDENTITY_CONFLICT"');
    expect(actions).toContain('"LEAD_IDENTITY_HISTORY_CONFLICT"');
    expect(control).toContain('COURSE_OPPORTUNITY_IDENTITY_CONFLICT: t("identityOpportunityConflict")');
    expect(control).toContain('LEAD_IDENTITY_HISTORY_CONFLICT: t("identityHistoryConflict")');
    expect(control).toContain("identityChooseResolution");
    expect(control).toContain("allowPossibleDuplicate");
    expect(control).toContain("allowAdditionalRelationship");
    expect(table).toContain("LeadIdentityControl");
    expect(table).toContain("canManageIdentity");
  });
});
