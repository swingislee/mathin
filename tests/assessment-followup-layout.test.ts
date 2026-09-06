import { createElement, Fragment, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import zh from "../messages/zh.json";
import en from "../messages/en.json";
import { AssessmentUnifiedWorkbench } from "@/features/school/AssessmentUnifiedWorkbench";
import { AssessmentRecordDetails } from "@/features/school/AssessmentRecordDetails";
import { ActivityAssessmentDraftProvider } from "@/features/school/ActivityAssessmentDetails";
import { QuickFollowUpEntry } from "@/features/school/QuickFollowUpEntry";
import type { AssessmentWorkbenchRow } from "@/features/school/assessment-workbench-contract";

vi.mock("server-only", () => ({}));
vi.mock("@/features/school/activity-actions", () => ({ saveActivityAssessmentAction: vi.fn() }));
vi.mock("@/features/school/public-class-actions", () => ({ savePublicClassParticipantRecordAction: vi.fn() }));
vi.mock("@/features/school/actions/followups", () => ({ addStudentFollowUp: vi.fn() }));
vi.mock("@/features/school/assessment-assessor-actions", () => ({ reassignAssessmentAssessorAction: vi.fn() }));
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
  });

  it("makes assessor reassignment an explicit detail action and leaves the professional entry intact", () => {
    const markup = renderDetails(row("solo"));
    expect(markup).toContain("data-assessor-reassignment");
    expect(markup).toContain(zh.school.supportAssessment.confirmAssessor);
    expect(markup).toContain("逐题登记");
    expect(markup).not.toContain("data-followup-entry-actions");
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
