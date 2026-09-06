import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../messages/zh.json";
import { ActivityWeekPicker } from "@/features/school/ActivityWeekPicker";
import { FollowupContactFacts } from "@/features/school/FollowupContactFacts";
import { InvitationDraftFields } from "@/features/school/InvitationDraftFields";
import { activityGradeFit, activityWeekCell } from "@/features/school/activity-grade-contract";
import { emptyInvitationDraft, invitationForAdvance, invitationTabSelection } from "@/features/school/followup-entry-contract";
import type { InvitationActivityOption } from "@/features/school/invitation-contract";

vi.mock("@/i18n/navigation", () => ({ Link: ({ children, ...props }: ComponentProps<"a">) => createElement("a", props, children) }));
const render = (child: ReturnType<typeof createElement>) => {
  const props: ComponentProps<typeof NextIntlClientProvider> = { locale: "zh", messages, children: child };
  return renderToStaticMarkup(createElement(NextIntlClientProvider, props));
};
const activities: InvitationActivityOption[] = [
  { id: "fit", kind: "public_class", title: "适配场次", scheduledAt: "2026-09-08T06:00:00Z", location: "A教室", targetGrades: [3], durationMin: 60 },
  { id: "wrong", kind: "public_class", title: "其他年级场次", scheduledAt: "2026-09-08T06:00:00Z", location: "", targetGrades: [6] },
  { id: "unknown", kind: "public_class", title: "待核对场次", scheduledAt: "2026-09-08T06:00:00Z", location: "", targetGrades: null },
];

describe("follow-up arrangement upgrade", () => {
  it("only replaces a registered arrangement with a real selection, not a blank tab", () => {
    const assessment = { ...emptyInvitationDraft("assessment_1v1"), assessorId: "teacher" };
    const activity = { ...emptyInvitationDraft("activity"), activityId: "session" };
    const browsing = invitationTabSelection(assessment, "activity");
    expect(browsing.register).toBe(false);
    expect(browsing.preview.kind).toBe("activity");
    expect(invitationForAdvance(browsing.value)).toBe(assessment);
    expect(invitationTabSelection(assessment, "activity", activity).value).toBe(activity);
    expect(invitationTabSelection(activity, "assessment_1v1").value).toBe(activity);
    expect(invitationTabSelection(activity, "waiting_activity").value?.kind).toBe("waiting_activity");
    expect(invitationForAdvance(invitationTabSelection(null, "assessment_1v1").value).kind).toBe("waiting_activity");
  });
  it("uses grade metadata, never titles, and keeps unspecified distinct from all grades", () => {
    expect(activityGradeFit([3, 4], 3)).toBe("match");
    expect(activityGradeFit([3, 4], 6)).toBe("mismatch");
    expect(activityGradeFit(null, 3)).toBe("unknown");
    expect(activityGradeFit(undefined, 3)).toBe("unknown");
    expect(activityGradeFit([], 3)).toBe("match");
    expect(activityGradeFit([3], null)).toBe("unknown");
    expect(activityWeekCell({ scheduledAt: "2026-09-07T23:00:00Z" })).toEqual({ day: "2026-09-08", period: "morning" });
    expect(activityWeekCell(activities[0])).toEqual({ day: "2026-09-08", period: "afternoon" });
  });
  it("renders a one-click weekly schedule with matched sessions and explicit unknown-grade discovery", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T02:00:00Z"));
    try {
      const markup = render(createElement(ActivityWeekPicker, { activities, gradeHint: 3, selectedId: null, locale: "zh", onSelect: vi.fn() }));
      expect(markup).toContain('role="table"');
      expect(markup).toContain("适配场次");
      expect(markup).not.toContain("其他年级场次");
      expect(markup).not.toContain("待核对场次");
      expect(markup).toContain(messages.school.activityWeek.showUnknown);
      expect(markup).toContain("14:00");
      expect(markup).toContain("60分钟");
      expect(markup).toContain('aria-pressed="false"');
    } finally { vi.useRealTimers(); }
  });
  it("starts with activity tabs without emitting an arrangement and renders solid/dashed progress links", () => {
    const change = vi.fn();
    const props = { value: null, activities: [], assessors: [], locale: "zh", onChange: change };
    const blank = render(createElement(InvitationDraftFields, props));
    expect(blank).toMatch(/data-state="active"[^>]*>活动<\/button>/);
    expect(blank.match(/role="tab"/g)).toHaveLength(3);
    expect(change).not.toHaveBeenCalled();
    const progress = render(createElement(InvitationDraftFields, { ...props, value: { ...emptyInvitationDraft("assessment_1v1"), state: "awaiting_teacher" } }));
    expect(progress).toContain('data-followup-progress-link="complete"');
    expect(progress.match(/data-followup-progress-link="pending"/g)).toHaveLength(2);
  });
  it("uses an accessible switch and three default-unselected colored interest choices", () => {
    const props = { wechat: null, onWechatChange: vi.fn(), interest: "" as const, onInterestChange: vi.fn() };
    const blank = render(createElement(FollowupContactFacts, props));
    expect(blank).toContain('role="switch"');
    expect(blank).toContain(messages.school.followupEntry.wechatUnknown);
    expect(blank).toContain(messages.school.followupEntry.wechatConfirmNo);
    expect(blank).not.toContain('data-state="on"');
    for (const level of ["A", "B", "C"] as const) expect(blank).toContain(`aria-label="${messages.school.leads[`interest_${level}`]}"`);
    expect(render(createElement(FollowupContactFacts, { ...props, wechat: true }))).toContain('aria-checked="true"');
    expect(render(createElement(FollowupContactFacts, { ...props, wechat: false }))).toContain("data-[state=unchecked]:bg-rose");
  });
});
