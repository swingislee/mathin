import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../messages/zh.json";
import { InvitationCoordinationWorkbench } from "@/features/school/InvitationCoordinationWorkbench";
import { CommunicationWorkSelectionProvider } from "@/features/school/CommunicationWorkSelection";
import type { LeadPoolRow } from "@/features/school/lead-contract";
import type { InvitationCoordinationRow } from "@/features/school/invitation-contract";
import type { ActivityEnrollmentContext } from "@/features/school/enrollment-workflow-contract";
import type { CommunicationWorkday, CommunicationWorklist } from "@/features/school/communication-workday-contract";

vi.mock("@/features/school/actions/invitations", () => ({ updateLeadInvitationAction: vi.fn(), updateAssessorAvailabilityAction: vi.fn() }));
vi.mock("@/features/school/actions/leads", () => ({
  recordLeadContactAction: vi.fn(), setLeadContactReminderAction: vi.fn(), assignLeadsAction: vi.fn(),
  confirmLeadIdentityAction: vi.fn(), getLeadIdentityOptionsAction: vi.fn(),
}));
vi.mock("@/features/school/communication-workday-actions", () => ({ completeCommunicationWorklistItemAction: vi.fn(), reviseCommunicationRecordAction: vi.fn() }));
vi.mock("@/features/school/enrollment-workflow-actions", () => ({ savePostActivityContactAction: vi.fn() }));
vi.mock("@/features/school/Student360Sheet", () => ({
  Student360Trigger: ({ children }: { children: ReactNode }) => createElement("button", { type: "button" }, children),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => createElement("a", props, children),
  useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/dashboard/followups/communication",
}));

const at = "2026-09-05T05:00:00Z";
const lead = (id: string): LeadPoolRow => ({
  id, provisionalStudentName: `学生${id}`, phone: "13812345678", gradeHint: 3, gradeText: "三年级", status: "uncontacted",
  ownerId: "owner", ownerName: "跟进老师", suggestedStudentId: null, suggestedStudentName: "", createdAt: at,
  acquiredAt: at, acquisitionLocation: "校门", acquisitionMethod: "", acquisitionPromoter: "", sourceCount: 1,
  sourceMarkedDuplicate: false, interests: [], contactCount: 0, lastContactAt: null, lastContactOutcome: null,
  lastContactNote: "", wechatAdded: null, visitCommitted: null, interestLevel: null, nextContactAt: null, activeInvitation: null,
});
const invitation = (leadId: string): InvitationCoordinationRow => ({
  id: `invitation-${leadId}`, leadId, leadName: `学生${leadId}`, phone: "13812345678", gradeText: "三年级", ownerName: "跟进老师",
  kind: "assessment_1v1", state: "confirmed", activityId: null, activityTitle: "", activityScheduledAt: null,
  assessorId: "assessor", assessorName: "测评老师", legacyTimeText: "", parentTimeOptions: [], assessorTimeOptions: [],
  scheduledAt: at, locationText: "教室", summary: "约好测评", updatedAt: at, nextContactAt: null, events: [],
});
const post: ActivityEnrollmentContext = {
  registrationId: "registration", studentId: null, leadId: null, name: "已结束的活动学生", phone: "13912345678", grade: 3,
  gradeText: "三年级", ownerId: "owner", leadStatus: null, activityId: "activity", activityTitle: "数学活动", activityAt: at,
  eligible: false, recommendation: "", assessmentBand: null, route: "closed", routeNote: "已结束", enrollmentId: null,
  courseTitle: null, termName: null, classroomName: null, termId: null, canContact: false, canEnroll: false, contacts: [],
};
const worklist: CommunicationWorklist = {
  id: "worklist", name: "周六联系名单", date: "2026-09-05", ownerId: "owner", createdBy: "owner", createdAt: at, closedAt: null,
  items: ["lead:b", "post:registration", "lead:a"].map((key, position) => ({ key, position, addedAt: at, completedAt: key === "lead:b" ? at : null })),
  rowKeys: ["lead:b", "post:registration", "lead:a"],
};
const workday: CommunicationWorkday = {
  date: "2026-09-05", tasks: [], events: [{
    id: "event-a", source: "contact", key: "lead:a", occurredAt: at, recordedAt: at, recordedById: "owner", recordedByName: "跟进老师",
    channel: "phone", outcome: "connected", note: "当天的原始沟通内容", revisionId: null, revisedAt: null, canRevise: true,
  }],
};
type Props = ComponentProps<typeof InvitationCoordinationWorkbench>;
function renderWorkbench(props: Partial<Props> = {}) {
  const selectionProps: ComponentProps<typeof CommunicationWorkSelectionProvider> = {
    initialSelectedKeys: ["lead:a"], children: createElement(InvitationCoordinationWorkbench, {
      rows: [], contactLeads: [lead("a")], rowOrder: ["lead:a"], activities: [], assessors: [], locale: "zh",
      currentUserId: "owner", canManageInvitation: true, canContact: true, ...props,
    }),
  };
  const providerProps: ComponentProps<typeof NextIntlClientProvider> = {
    locale: "zh", timeZone: "Asia/Shanghai", now: new Date(at), messages,
    children: createElement(CommunicationWorkSelectionProvider, selectionProps),
  };
  const markup = renderToStaticMarkup(createElement(NextIntlClientProvider, providerProps));
  const tbody = markup.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)?.[1];
  expect(tbody).toBeDefined();
  const rows = [...tbody!.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)].map((match) => ({
    attributes: match[1], content: match[2],
    key: match[1].match(/data-communication-work-key="([^"]+)"/)?.[1],
    cells: [...match[2].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)].map((cell) => ({ attributes: cell[1], content: cell[2] })),
  }));
  return { markup, rows, dataRows: rows.filter((row) => row.key) };
}

describe("communication workbench server rendering", () => {
  it("restores persistent worklist order and completion on each fresh browser load", () => {
    const props = { rows: [invitation("b")], contactLeads: [lead("a")], postActivityRows: [post], rowOrder: ["lead:a", "lead:b", "post:registration"], worklist };
    for (const result of [renderWorkbench(props), renderWorkbench(props)]) {
      expect(result.dataRows.map((row) => row.key)).toEqual(worklist.rowKeys);
      expect(result.dataRows.every((row) => row.cells.length === 4)).toBe(true);
      expect(result.dataRows[0].content).toContain('aria-pressed="true"');
      expect(result.dataRows[1].content).toContain(post.name);
      expect(result.dataRows[1].content).not.toContain('aria-keyshortcuts=');
    }
  });

  it("keeps one canonical lead row and an adjacent full-width detail row across contact to invitation", () => {
    const before = renderWorkbench({ focusLeadId: "a", workday, selectionEnabled: true });
    const after = renderWorkbench({ focusLeadId: "a", workday, rows: [invitation("a")], selectionEnabled: true });
    for (const result of [before, after]) {
      expect(result.dataRows.map((row) => row.key)).toEqual(["lead:a"]);
      expect(result.dataRows[0].cells).toHaveLength(4);
      expect(result.dataRows[0].cells[0].content).toContain('role="checkbox"');
      expect(result.rows[1].attributes).toContain("data-followup-inline-details");
      expect(result.rows[1].cells).toHaveLength(1);
      expect(result.rows[1].cells[0].attributes).toContain('colSpan="4"');
      expect(result.rows[1].content).toContain('data-communication-event="event-a"');
      expect(result.markup).toContain("table-fixed");
    }
  });

  it("shows revised day events before current facts and honors fresh revision permission", () => {
    const original = renderWorkbench({ focusLeadId: "a", workday, workMode: "records" });
    expect(original.rows[1].content).toContain("当天的原始沟通内容");
    const revisedDay: CommunicationWorkday = { ...workday, events: [{ ...workday.events[0], note: "更正后的历史内容", revisionId: "revision", revisedAt: at, canRevise: false }] };
    const revised = renderWorkbench({ focusLeadId: "a", workday: revisedDay, workMode: "records" });
    expect(revised.rows[1].content).not.toContain("当天的原始沟通内容");
    expect(revised.rows[1].content).toContain("更正后的历史内容");
    expect(revised.rows[1].content.indexOf("更正后的历史内容")).toBeLessThan(revised.rows[1].content.indexOf(messages.school.communicationWorkday.currentFacts));
    const eventContent = revised.rows[1].content.match(/<li\b[^>]*data-communication-event="event-a"[^>]*>([\s\S]*?)<\/li>/)?.[1];
    expect(eventContent).toBeDefined();
    expect(eventContent).not.toContain(`<button`);
  });

  it("does not render a stale personal row or its history outside the authoritative visible keys", () => {
    const result = renderWorkbench({ focusLeadId: "a", workday, workMode: "records", rowOrder: [] });
    expect(result.dataRows).toEqual([]);
    expect(result.markup).not.toContain("学生a");
    expect(result.markup).not.toContain("13812345678");
    expect(result.markup).not.toContain("当天的原始沟通内容");
  });

  it("only offers selection for actionable visible people, with the header reflecting that subset", () => {
    const result = renderWorkbench({ selectionEnabled: true, workday, contactLeads: [lead("a"), { ...lead("invalid"), status: "invalid" }, { ...lead("unassigned"), ownerId: null }],
      rows: [{ ...invitation("closed"), state: "completed" }], postActivityRows: [post],
      rowOrder: ["lead:a", "lead:invalid", "lead:unassigned", "lead:closed", "post:registration"],
    });
    expect(result.dataRows).toHaveLength(5);
    expect(result.dataRows.filter((row) => row.cells[0].content.includes('role="checkbox"')).map((row) => row.key)).toEqual(["lead:a"]);
    const header = result.markup.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/)?.[1] ?? "";
    expect(header).toMatch(/role="checkbox"[^>]*aria-checked="true"/);
  });

  it("removes row selection and disables page selection when operation permissions are absent", () => {
    const result = renderWorkbench({ selectionEnabled: true, canContact: false, canManageInvitation: false,
      rows: [invitation("b")], rowOrder: ["lead:a", "lead:b"],
    });
    expect(result.dataRows.every((row) => !row.cells[0].content.includes('role="checkbox"'))).toBe(true);
    const header = result.markup.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/)?.[1] ?? "";
    expect(header).toMatch(/role="checkbox"[^>]*disabled=""/);
  });

  it("shows the selected day's latest result and occurrence time for contacts, invitations and activity follow-ups", () => {
    const oldAt = "2026-09-04T06:30:00Z";
    const day: CommunicationWorkday = { date: "2026-09-04", tasks: [], events: [
      { ...workday.events[0], id: "latest-a", occurredAt: oldAt, recordedAt: oldAt, outcome: "unreachable", note: "昨天最后一次未接通" },
      { ...workday.events[0], id: "first-a", occurredAt: "2026-09-04T01:00:00Z", recordedAt: "2026-09-04T01:00:00Z", note: "昨天上午第一次沟通" },
      { ...workday.events[0], id: "old-b", source: "invitation", key: "lead:b", occurredAt: oldAt, recordedAt: oldAt, channel: "wechat", outcome: "awaiting_parent", note: "昨天还在等家长确认" },
      { ...workday.events[0], id: "old-post", source: "post_activity", key: "post:registration", occurredAt: oldAt, recordedAt: oldAt, channel: "in_person", outcome: "connected", note: "昨天活动后当面沟通" },
    ] };
    const result = renderWorkbench({ workday: day, workMode: "records", focusLeadId: "a",
      contactLeads: [{ ...lead("a"), status: "contacted", lastContactAt: at, lastContactNote: "今天的新信息", lastContactOutcome: "connected" }],
      rows: [invitation("b")], postActivityRows: [post], rowOrder: ["lead:a", "lead:b", "post:registration"],
    });
    expect(result.dataRows.map((row) => row.key)).toEqual(["lead:a", "lead:b", "post:registration"]);
    for (const row of result.dataRows) {
      expect(row.cells).toHaveLength(4);
      expect(row.cells[3].content).toContain(`dateTime="${oldAt}"`);
      expect(row.cells[3].content).not.toContain("2026/9/5");
    }
    expect(result.dataRows[0].cells[1].content).toContain(messages.school.communicationWorkday.outcome_unreachable);
    expect(result.dataRows[0].cells[1].content).toContain("当天 2 条");
    expect(result.dataRows[0].cells[2].content).toContain("昨天最后一次未接通");
    expect(result.dataRows[0].cells[2].content).not.toContain("今天的新信息");
    expect(result.dataRows[0].cells[2].content).toContain(messages.school.communicationWorkday.newCommunication);
    expect(result.dataRows[0].cells[2].content).toContain('aria-keyshortcuts="Control+Enter Meta+Enter"');
    expect(result.dataRows[1].cells[1].content).toContain(messages.school.invitations.state_awaiting_parent);
    expect(result.dataRows[1].cells[2].content).toContain("昨天还在等家长确认");
    expect(result.dataRows[1].cells[2].content).toContain(messages.school.invitations.channel_wechat);
    expect(result.dataRows[1].cells[2].content).not.toContain("约好测评");
    expect(result.dataRows[2].cells[1].content).toContain(messages.school.communicationWorkday.outcome_connected);
    expect(result.dataRows[2].cells[2].content).toContain("昨天活动后当面沟通");
    expect(result.rows[1].content).toContain("昨天上午第一次沟通");
    expect(result.rows[1].content).toContain("今天的新信息");
    const header = result.markup.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/)?.[1] ?? "";
    expect(header).toContain(messages.school.communicationWorkday.dayResultColumn);
    expect(header).toContain(messages.school.communicationWorkday.dayCommunicationColumn);
    expect(header).toContain(messages.school.communicationWorkday.occurredAtColumn);
  });
});
