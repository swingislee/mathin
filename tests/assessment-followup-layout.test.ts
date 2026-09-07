import { createElement, Fragment, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import zh from "../messages/zh.json";
import en from "../messages/en.json";
import { AssessmentUnifiedWorkbench } from "@/features/school/AssessmentUnifiedWorkbench";
import { AssessmentRecordDetails } from "@/features/school/AssessmentRecordDetails";
import { AssessmentRegistrationFields } from "@/features/school/AssessmentRegistrationFields";
import { ActivityAssessmentDraftProvider } from "@/features/school/ActivityAssessmentDetails";
import { QuickFollowUpEntry } from "@/features/school/QuickFollowUpEntry";
import type { AssessmentWorkbenchRow } from "@/features/school/assessment-workbench-contract";

vi.mock("server-only", () => ({}));
vi.mock("@/features/school/activity-actions", () => ({ saveActivityAssessmentAction: vi.fn() }));
vi.mock("@/features/school/public-class-actions", () => ({ savePublicClassParticipantRecordAction: vi.fn() }));
vi.mock("@/features/school/actions/followups", () => ({ addStudentFollowUp: vi.fn() }));
vi.mock("@/features/school/assessment-assessor-actions", () => ({ reassignAssessmentAssessorAction: vi.fn() }));
vi.mock("@/features/school/assessment-quick-entry-actions", () => ({ saveAssessmentQuickEntryAction: vi.fn() }));
vi.mock("@/features/school/EnrollmentHandoffButton", () => ({ PostActivityHandoff: () => createElement("div", null, "handoff") }));
vi.mock("@/features/school/TeacherAssessmentEntryButton", () => ({ TeacherAssessmentEntryButton: () => createElement("button", null, "逐题登记") }));
vi.mock("@/features/school/Student360Sheet", () => ({
  Student360Trigger: ({ children }: { children: ReactNode }) => createElement("button", { type: "button", "data-student-360-trigger": true }, children),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => createElement("a", props, children),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/dashboard/followups/assessments",
}));

function row(id: string, overrides: Partial<AssessmentWorkbenchRow> = {}): AssessmentWorkbenchRow {
  return {
    id, assessmentKind: "one_to_one", activityId: null, activityTitle: "测评", publicClassRecord: null,
    invitationId: `invitation-${id}`, registrationId: `registration-${id}`, studentId: `student-${id}`, leadId: null,
    name: `同学${id}`, phone: "13800000000", grade: 3, gradeText: "三年级", scheduledAt: "2026-09-06T02:00:00Z",
    location: "测评教室", assessorId: "teacher", assessorName: "测评老师", assessorSource: "assigned", background: "前序沟通",
    participationStatus: "booked", assessmentStartedAt: null, assessmentCompletedAt: null, assessment: null,
    questionSummary: null, route: null, updatedAt: "2026-09-06T02:00:00Z", ...overrides,
  };
}

function render(element: ReactNode, locale: "zh" | "en" = "zh") {
  const provider: ComponentProps<typeof NextIntlClientProvider> = {
    locale, messages: locale === "zh" ? zh : en, timeZone: "Asia/Shanghai", children: element,
  };
  return renderToStaticMarkup(createElement(NextIntlClientProvider, provider));
}

function renderDetails(record: AssessmentWorkbenchRow, canAssess = true) {
  const detail: ComponentProps<typeof AssessmentRecordDetails> = {
    row: record, stage: record.assessment ? "feedback" : "pending", conclusion: record.assessment?.teacherObservation ?? "",
    locale: "zh", canAssess, canSupport: true, canManageAssessor: true,
    assessors: [{ userId: "teacher", displayName: "测评老师" }], reassigning: false,
    onReassign: vi.fn(), onSaved: vi.fn(), onNoteSaved: vi.fn(), onHandoffSaved: vi.fn(), onSaveAndNext: vi.fn(),
  };
  const provider: ComponentProps<typeof ActivityAssessmentDraftProvider> = {
    row: record, children: createElement(AssessmentRecordDetails, detail),
  };
  return render(createElement(ActivityAssessmentDraftProvider, provider));
}

describe("assessment page aligned with first contact", () => {
  it.each(["zh", "en"] as const)("uses the general assessment title and compact shared row identity in %s", (locale) => {
    const rows = [row("solo"), row("group", { assessmentKind: "activity" }), row("history", { recordState: "historical", scheduledAt: "", occurredOn: null })];
    const markup = render(createElement(AssessmentUnifiedWorkbench, {
      initialRows: rows, assessors: [], locale, canAssess: true, canSupport: true, canManageAssessor: true,
    }), locale);
    expect(markup).toContain(`>${locale === "zh" ? "测评" : "Assessments"}</h1>`);
    expect(markup).toContain("data-followup-workbench");
    expect(markup).toContain("data-followup-scroll");
    expect(markup).not.toContain("min-w-[94rem]");
    expect(markup).not.toContain("100dvh-11rem");
    const body = markup.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)?.[1];
    expect(body?.match(/data-followup-person/g)).toHaveLength(3);
    expect(body?.match(/data-student-360-trigger/g)).toHaveLength(3);
    expect(body?.match(/<td\b/g)).toHaveLength(21);
    expect(body).not.toMatch(/<input|<textarea|role="combobox"/);
    expect(body).not.toContain('aria-selected="true"');
    expect(body).toContain('data-followup-expanded="false"');
    expect(body).toContain('data-record-state="historical"');
    expect(body?.match(/逐题登记/g)).toHaveLength(1);
    expect(body).toContain('data-assessment-question-entry');
  });

  it("shows the question entry only for authorized current one-to-one rows, including unstarted invitations", () => {
    const rows = [row("booked", { registrationId: null }), row("group", { assessmentKind: "activity" }), row("history", { recordState: "historical" })];
    for (const canAssess of [true, false]) {
      const markup = render(createElement(AssessmentUnifiedWorkbench, {
        initialRows: rows, assessors: [], locale: "zh", canAssess, canSupport: true, canManageAssessor: true,
      }));
      expect(markup.match(/逐题登记/g) ?? []).toHaveLength(canAssess ? 1 : 0);
    }
  });

  it("separates read-only progress from the labeled entry switcher in one detail header", () => {
    const markup = renderDetails(row("header"));
    const header = markup.slice(markup.indexOf("data-assessment-detail-header"), markup.indexOf('role="tabpanel"'));
    expect(header).toContain('data-assessment-progress');
    expect(header).toContain(zh.school.supportAssessment.progressLabel);
    expect(header).toContain('data-assessment-entry-switcher');
    expect(header).toContain(zh.school.supportAssessment.entryLabel);
    expect(header.match(/role="tablist"/g)).toHaveLength(1);
    expect(header.match(/aria-current="step"/g)).toHaveLength(1);
    expect(header.match(/<ol\b[\s\S]*?<\/ol>/)?.[0]).not.toContain("<button");
    expect(header).toContain("bg-transparent p-0");
  });

  it("keeps public-class assessment and parent feedback in one explicit entry layout", () => {
    const record = row("group", { assessmentKind: "activity", publicClassRecord: {
      id: null, segmentId: "group-segment", segmentTitle: "集中测评", studentPresence: "expected", guardianPresence: "expected",
      learningObservation: "", assessmentSummary: "", parentFeedback: "", recommendation: "",
    } });
    const markup = renderDetails(record);
    expect(markup).toContain("data-assessment-progress");
    expect(markup.match(/aria-current="step"/g)).toHaveLength(1);
    expect(markup.match(/data-followup-entry-fields/g)).toHaveLength(1);
    expect(markup.match(/data-followup-entry-actions/g)).toHaveLength(1);
    expect(markup.match(/<textarea\b/g)).toHaveLength(4);
    expect(markup).toMatch(/maxLength="3000"/i);
    expect(markup).toContain(zh.school.followupEntry.saveAndNext);
    expect(markup).toContain('aria-keyshortcuts="Control+Enter Meta+Enter"');
    expect(markup).not.toContain(zh.school.supportAssessment.savedInSession);
    expect(markup).not.toContain("xl:grid-cols-4");
  });

  it("keeps aggregate score, band and teacher fields separate from one parent note and action footer", () => {
    const markup = renderDetails(row("aggregate", { assessmentKind: "activity" }));
    expect(markup.match(/data-followup-entry-actions/g)).toHaveLength(1);
    expect(markup).toContain('type="number"');
    expect(markup).toContain(zh.school.activities.teacherRecommendation);
    expect(markup).toContain(zh.school.activities.parentConcerns);
    expect(markup).toContain("data-followup-notes");
    expect(markup).toMatch(/maxLength="2000"/i);
    expect(markup.match(/data-followup-field-icon/g)).toHaveLength(3);
    expect(markup).not.toContain('data-assessment-field="route"');
  });

  it("keeps quick entry and explicit assessor reassignment in details without a second professional button", () => {
    const markup = renderDetails(row("solo"));
    expect(markup).toContain("data-assessor-reassignment");
    expect(markup).toContain(zh.school.supportAssessment.confirmAssessor);
    expect(markup.match(/data-followup-entry-actions/g)).toHaveLength(1);
    expect(markup).not.toContain("逐题登记");
    expect(markup).not.toContain("data-assessment-question-entry");
    expect(markup).toContain(zh.school.assessmentQuickEntry.optionalHint);
    expect(markup).toContain("data-assessment-quick-entry");
  });

  it("renders historical feedback without live progress, reassignment, or editable modules", () => {
    const record = row("history", { recordState: "historical", assessment: {
      id: "historical", assessmentBand: null, score: null, strengths: "", focusAreas: "", parentConcerns: "保留原反馈",
      teacherRecommendation: "", recommendedClass: "", teacherObservation: "保留原反馈", updatedAt: "",
    } });
    const markup = renderDetails(record);
    expect(markup.match(/保留原反馈/g)).toHaveLength(1);
    expect(markup).not.toMatch(/data-assessment-progress|data-assessor-reassignment|<input|<textarea|aria-keyshortcuts/);
    expect(markup).not.toContain("role=\"tab\"");
  });

  it("uses the same note-and-save layout for an independent student note", () => {
    const markup = render(createElement(QuickFollowUpEntry, { studentId: "student-note", layout: "followup", onSaveAndNext: vi.fn() }));
    expect(markup.match(/<textarea\b/g)).toHaveLength(1);
    expect(markup.match(/data-followup-entry-actions/g)).toHaveLength(1);
    expect(markup).toContain(zh.school.quickFollowUp.independentHint);
    expect(markup).toContain(zh.school.followupEntry.saveAndNext);
  });

  it("gives two assessment notes for the same student distinct field identities", () => {
    const markup = render(createElement(Fragment, null,
      createElement(QuickFollowUpEntry, { studentId: "same-student", layout: "followup" }),
      createElement(QuickFollowUpEntry, { studentId: "same-student", layout: "followup" }),
    ));
    const ids = [...markup.matchAll(/<textarea\b[^>]*id="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("optional teacher assessment", () => {
  it("lets support enter scores and routing before teacher completion without duplicating the teacher button", () => {
    const record = row("support-first", { registrationId: null, studentId: null, leadId: "lead" });
    const markup = render(createElement(AssessmentRecordDetails, {
      row: record, stage: "pending", conclusion: "", locale: "zh", canAssess: false, canQuickEntry: true,
      canRoute: true, canSupport: true, canManageAssessor: false, assessors: [], reassigning: false,
      onReassign: vi.fn(), onSaved: vi.fn(), onNoteSaved: vi.fn(), onHandoffSaved: vi.fn(),
    }));
    expect(markup).toContain("data-assessment-quick-entry");
    expect(markup).toContain('type="number"');
    expect(markup).toContain(zh.school.enrollmentWorkflow.nextStep);
    expect(markup).toContain(zh.school.assessmentQuickEntry.optionalHint);
    expect(markup).not.toContain("逐题登记");
    expect(markup).toContain(zh.school.followupEntry.save);
  });

  it("keeps inputs available under the required-teacher policy and distinguishes both contributors", () => {
    const record = row("required", { teacherRequired: true, entryActors: [
      { id: "support", name: "学服甲", kind: "quick_entry", recordedAt: "2026-09-07T01:00:00Z" },
      { id: "teacher", name: "教师乙", kind: "teacher", recordedAt: "2026-09-07T02:00:00Z" },
    ] });
    const markup = renderDetails(record);
    expect(markup).toContain(zh.school.assessmentQuickEntry.requiredHint);
    expect(markup).toContain("快速登记：学服甲");
    expect(markup).toContain("逐题测评：教师乙");
    expect(markup).toMatch(/<input\b[^>]*type="number"/);
    expect(markup.match(/<input\b[^>]*type="number"[^>]*>/)?.[0]).not.toContain(' disabled=""');
    expect(markup).not.toContain("逐题登记");
    expect(markup).toContain(zh.school.supportAssessment.entryHandoff);
  });
});

describe("assessment registration field language", () => {
  it.each(["zh", "en"] as const)("pairs four soft field icons with compact accessible controls in %s", (locale) => {
    const markup = render(createElement(AssessmentRegistrationFields, {
      value: { assessmentBand: "a", score: 80, recommendedClass: "A" }, disabled: false, onChange: vi.fn(),
      routing: { value: "continue_follow_up", onChange: vi.fn() },
    }), locale);
    const messages = locale === "zh" ? zh : en;
    expect(markup.match(/data-followup-field-icon/g)).toHaveLength(4);
    expect(markup.match(/data-assessment-field=/g)).toHaveLength(4);
    expect(markup).toContain('lucide-award');
    expect(markup).toContain('lucide-gauge');
    expect(markup).toContain('lucide-graduation-cap');
    expect(markup).toContain('lucide-signpost');
    expect(markup).toContain('fill-leaf/50');
    expect(markup).toContain('fill-cheek/60');
    expect(markup).toContain('fill-moon text-crater');
    expect(markup).toContain(`aria-label="${messages.school.activities.assessmentBand}"`);
    expect(markup).toContain(`aria-label="${messages.school.enrollmentWorkflow.nextStep}"`);
    expect(markup).toContain('value="80"');
    expect(markup).not.toContain('<label');
    for (const [, labelledBy] of markup.matchAll(/<input\b[^>]*aria-labelledby="([^"]+)"/g)) {
      expect(markup).toContain(`id="${labelledBy}"`);
    }
    expect(markup.match(/<input\b[^>]*aria-labelledby=/g)).toHaveLength(2);
  });

  it("keeps a zero score and legacy band visible while disabling every read-only control", () => {
    const markup = render(createElement(AssessmentRegistrationFields, {
      value: { assessmentBand: "below_a", score: 0, recommendedClass: "" }, disabled: true, onChange: vi.fn(),
      routing: { value: "enrollment_pending", onChange: vi.fn() },
    }));
    expect(markup).toContain('value="0"');
    expect(markup).toContain(zh.school.activities.band_below_a);
    expect(markup).toContain(zh.school.enrollmentWorkflow.route_enrollment_pending);
    const controls = markup.match(/<(?:input|button)\b[^>]*>/g) ?? [];
    expect(controls).toHaveLength(4);
    for (const control of controls) expect(control).toContain(' disabled=""');
  });
});
