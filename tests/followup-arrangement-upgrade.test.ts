import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../messages/zh.json";
import { ActivityWeekPicker } from "@/features/school/ActivityWeekPicker";
import { FollowupContactFacts } from "@/features/school/FollowupContactFacts";
import { InvitationDraftFields } from "@/features/school/InvitationDraftFields";
import { NextContactReminderField } from "@/features/school/NextContactReminderField";
import { activityGradeFit, activityInitialWeek, activityWeekCell } from "@/features/school/activity-grade-contract";
import { emptyInvitationDraft, invitationDraftIssue, invitationForAdvance, invitationTabSelection } from "@/features/school/followup-entry-contract";
import type { InvitationActivityOption } from "@/features/school/invitation-contract";
import { calendarDayKey } from "@/features/school/schedule";

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
  it("opens the earliest suitable upcoming week without changing or sorting the source options", () => {
    const now = new Date("2026-09-06T02:00:00Z");
    const options = [
      { ...activities[0], id: "later", scheduledAt: "2026-09-15T06:00:00Z" },
      { ...activities[0], id: "past", scheduledAt: "2026-09-01T06:00:00Z" },
      ...activities,
    ];
    const before = structuredClone(options);
    const dayOf = (week: Date) => calendarDayKey(week, "Asia/Shanghai");
    expect(dayOf(activityInitialWeek(options, 3, null, now))).toBe("2026-09-07");
    expect(dayOf(activityInitialWeek(options, 3, "later", now))).toBe("2026-09-14");
    expect(dayOf(activityInitialWeek(options, 6, "past", now))).toBe("2026-08-31");
    expect(dayOf(activityInitialWeek(options, 12, null, now))).toBe("2026-08-31");
    expect(dayOf(activityInitialWeek(options, null, null, now))).toBe("2026-08-31");
    expect(dayOf(activityInitialWeek([{ ...activities[0], targetGrades: [] }], null, null, now))).toBe("2026-09-07");
    expect(options).toEqual(before);
  });
  it("shows next-week samples on Sunday, keeps same-day titles intact, and omits empty period rows", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T02:00:00Z"));
    try {
      const change = vi.fn();
      const sameDay = { ...activities[0], id: "second", title: "验收课 · 很长的活动标题完整显示与同日多场检查", scheduledAt: "2026-09-08T07:30:00Z" };
      const markup = render(createElement(ActivityWeekPicker, { activities: [sameDay, ...activities], gradeHint: 3, selectedId: null, locale: "zh", onSelect: change }));
      expect(markup).toContain("9/7 – 9/13");
      expect(markup).toContain(sameDay.title);
      expect(markup.indexOf(activities[0].title)).toBeLessThan(markup.indexOf(sameDay.title));
      expect(markup.match(/role="rowheader"/g)).toHaveLength(1);
      expect(markup).toContain(">下午</div>");
      expect(markup).toContain("overflow-x-auto");
      expect(markup).not.toContain("line-clamp");
      expect(markup).not.toContain(messages.school.activityWeek.browseHint);
      expect(change).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("provides a compact assessment action when no suitable sessions exist", () => {
    const change = vi.fn();
    const assessment = vi.fn();
    const markup = render(createElement(ActivityWeekPicker, { activities: [], gradeHint: 3, selectedId: null, locale: "zh", onSelect: change, onChooseAssessment: assessment }));
    expect(markup).toContain("data-activity-empty");
    expect(markup).toContain(messages.school.activityWeek.emptyWeek);
    expect(markup).toContain(messages.school.activityWeek.switchAssessment);
    expect(markup).not.toContain("min-h-28");
    expect(markup).not.toContain("border-dashed");
    expect(change).not.toHaveBeenCalled();
    expect(assessment).not.toHaveBeenCalled();
  });
  it("retains an out-of-grade selected activity in its own week", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T02:00:00Z"));
    try {
      const markup = render(createElement(ActivityWeekPicker, { activities, gradeHint: 3, selectedId: "wrong", locale: "zh", onSelect: vi.fn() }));
      expect(markup).toContain("其他年级场次");
      expect(markup).toContain('aria-pressed="true"');
      expect(markup).toContain(messages.school.activityWeek.gradeMismatch);
    } finally { vi.useRealTimers(); }
  });
  it("starts with activity tabs without emitting an arrangement and renders solid/dashed progress links", () => {
    const change = vi.fn();
    const props = { value: null, activities: [], assessors: [], locale: "zh", onChange: change };
    const blank = render(createElement(InvitationDraftFields, props));
    expect(blank).toMatch(/<button[^>]*data-state="active"[^>]*>.*?<span class="relative">活动<\/span><\/button>/);
    expect(blank.match(/role="tab"/g)).toHaveLength(3);
    expect(blank).toContain('role="tablist"');
    expect(blank).toContain("data-followup-handoff-mark");
    expect(blank).toContain("grid-cols-3");
    expect(blank).not.toContain("border-b-2");
    expect(blank).not.toContain("data-[state=active]:ring-1");
    expect(change).not.toHaveBeenCalled();
    const progress = render(createElement(InvitationDraftFields, { ...props, value: { ...emptyInvitationDraft("assessment_1v1"), state: "awaiting_teacher" } }));
    expect(progress).toContain('data-followup-progress-link="complete"');
    expect(progress.match(/data-followup-progress-link="pending"/g)).toHaveLength(2);
  });
  it("preserves unknown WeChat with both choices unselected and keeps colored interest choices without checkmarks", () => {
    const props = { wechat: null, onWechatChange: vi.fn(), interest: "" as const, onInterestChange: vi.fn() };
    const blank = render(createElement(FollowupContactFacts, props));
    expect(blank).toContain('data-wechat-status="unknown"');
    expect(blank).not.toContain('role="combobox"');
    expect(blank).not.toContain('role="switch"');
    expect(blank).toContain(messages.school.followupEntry.wechatUnknown);
    expect(blank).not.toContain(messages.school.followupEntry.wechatConfirmNo);
    expect(blank).not.toContain(messages.school.followupEntry.wechatUnknownHint);
    expect(blank.match(/data-state="on"/g) ?? []).toHaveLength(0);
    expect(blank).not.toContain("data-[state=on]:ring-1");
    for (const level of ["A", "B", "C"] as const) expect(blank).toContain(`aria-label="${messages.school.leads[`interest_${level}`]}"`);
    expect(render(createElement(FollowupContactFacts, { ...props, wechat: true }))).toContain(messages.school.followupEntry.wechatYes);
    expect(render(createElement(FollowupContactFacts, { ...props, wechat: false }))).toContain(messages.school.followupEntry.wechatNo);
    for (const level of ["A", "B", "C"] as const) {
      const selected = render(createElement(FollowupContactFacts, { ...props, interest: level }));
      const selectedChoice = selected.match(/<button\b[^>]*>.*?<\/button>/g)?.find((button) => button.includes(`aria-label="${messages.school.leads[`interest_${level}`]}"`));
      expect(selectedChoice).toContain('data-state="on"');
      expect(selectedChoice).toContain('aria-checked="true"');
      expect(selectedChoice).not.toContain("lucide-check");
      expect(selected).toContain("size-8 min-w-8");
      expect(selected).toContain("text-muted");
      expect(selected).toContain("data-[state=on]:bg-leaf");
      expect(selected).toContain("data-[state=on]:bg-moon");
      expect(selected).toContain("data-[state=on]:bg-rose/85");
      expect(selected).toContain("bg-muted/6");
    }
    expect(props.onWechatChange).not.toHaveBeenCalled();
  });
  it.each([[true, "A", "wechatYes"], [false, "C", "wechatNo"]] as const)("matches WeChat %s to interest %s button geometry and color", (wechat, interest, statusLabel) => {
    const markup = render(createElement(FollowupContactFacts, { wechat, interest, onWechatChange: vi.fn(), onInterestChange: vi.fn() }));
    const buttons = markup.match(/<button\b[^>]*>/g)!;
    const classes = (label: string) => buttons.find((button) => button.includes(`aria-label="${label}"`))?.match(/class="([^"]+)"/)?.[1];
    const wechatClasses = classes(`${messages.school.followupEntry.wechatLabel} · ${messages.school.followupEntry[statusLabel]}`);
    expect(wechatClasses).toBeDefined();
    expect(wechatClasses).toBe(classes(messages.school.leads[`interest_${interest}`]));
  });
  it.each(["activity", "assessment_1v1", "waiting_activity"] as const)("keeps equal-height handoff choices and draws the selected option's contour for %s", (kind) => {
    const change = vi.fn();
    const markup = render(createElement(InvitationDraftFields, {
      value: emptyInvitationDraft(kind), activities: [], assessors: [], locale: "zh", onChange: change,
    }));
    const tabs = markup.match(/<button\b[^>]*role="tab"[^>]*>.*?<\/button>/g)!;
    expect(tabs).toHaveLength(3);
    for (const tab of tabs) {
      expect(tab).toContain("h-8 min-w-11");
      expect(tab).toContain("px-2 py-0");
      expect(tab.match(/class="([^"]+)"/)?.[1].split(" ")).toContain("text-ink");
    }
    expect(markup).toContain(`role="img" aria-label="${messages.school.invitations.kindLabel}"`);
    expect(markup).toContain("lucide-signpost");
    expect(markup).toContain("grid-cols-3 gap-0.5");
    const selected = tabs.filter((tab) => tab.includes('aria-selected="true"'));
    expect(selected).toHaveLength(1);
    expect(selected[0]).toContain(`data-followup-handoff-mark="${kind}"`);
    expect(selected[0]).toContain('pathLength="1"');
    expect(markup.match(/data-followup-handoff-mark=/g)).toHaveLength(3);
    expect(markup).not.toContain("data-followup-handoff-indicator");
    expect(markup).not.toContain("border-b-2");
    expect(change).not.toHaveBeenCalled();
  });
  it("groups contact facts and handoff tabs in one wrapping toolbar", () => {
    const props = { value: null, activities: [], assessors: [], locale: "zh", onChange: vi.fn(),
      contactFacts: createElement(FollowupContactFacts, { wechat: null, onWechatChange: vi.fn(), interest: "" as const, onInterestChange: vi.fn() }) };
    const markup = render(createElement(InvitationDraftFields, props));
    const toolbar = markup.indexOf("data-followup-facts-toolbar");
    const facts = markup.indexOf("data-followup-contact-facts");
    const tabs = markup.indexOf('role="tablist"');
    expect(toolbar).toBeLessThan(facts);
    expect(facts).toBeLessThan(tabs);
    expect(markup.match(/data-followup-contact-facts/g)).toHaveLength(1);
    expect(markup).toContain('aria-label="承接"');
    expect(markup).toContain(`role="img" aria-label="${messages.school.leads.interestLevel}"`);
    expect(markup).toContain("lucide-heart-pulse");
    expect(markup.match(/data-followup-field-icon=/g)).toHaveLength(2);
    const fieldIcons = markup.match(/<svg\b[^>]*class="[^"]*lucide-(?:heart-pulse|signpost)[^"]*"[^>]*>/g) ?? [];
    expect(fieldIcons).toHaveLength(2);
    for (const icon of fieldIcons) expect(icon).toContain('stroke-width="2"');
    const heartIcon = fieldIcons.find((icon) => icon.includes("lucide-heart-pulse"));
    expect(heartIcon).toContain('fill="none"');
    expect(heartIcon).toContain("fill-cheek");
    expect(heartIcon).toContain("var(--rose)_35%,var(--cheek)");
    const handoffIcon = fieldIcons.find((icon) => icon.includes("lucide-signpost"));
    expect(handoffIcon).toContain("fill-moon text-crater");
  });
  it("leaves number keys to contact outcomes when assessment is nested in first contact", () => {
    const props = { value: emptyInvitationDraft("assessment_1v1"), activities: [], assessors: [], locale: "zh", onChange: vi.fn() };
    expect(render(createElement(InvitationDraftFields, props))).toContain('aria-keyshortcuts="1 2 3 4"');
    const nested = render(createElement(InvitationDraftFields, { ...props, enableProgressShortcuts: false }));
    expect(nested).not.toMatch(/aria-keyshortcuts="[1-4](?: [1-4])*"/);
  });
  it("keeps assessor, time and location in stable compact geometry at every assessment step", () => {
    const renders = (["coordinating_time", "awaiting_teacher", "awaiting_parent", "confirmed"] as const).map((state) => {
      const value = { ...emptyInvitationDraft("assessment_1v1"), state, assessorId: "teacher", parentTimeOptions: ["2026-09-07@14:00"] };
      const markup = render(createElement(InvitationDraftFields, { value, activities: [], assessors: [{ userId: "teacher", displayName: "测评老师甲" }], locale: "zh", showReminder: false, onChange: vi.fn() }));
      const labels = messages.school.invitations;
      expect(markup.indexOf(labels.assessorLabel)).toBeLessThan(markup.indexOf(labels.timeLabel));
      expect(markup.indexOf(labels.timeLabel)).toBeLessThan(markup.indexOf(labels.locationLabel));
      expect(markup).not.toContain(labels.stateManualHint);
      expect(markup).not.toContain(labels[`task_${state}`]);
      expect(markup).not.toContain(labels.draftIncomplete);
      expect(markup).not.toContain(labels.availabilityOpen);
      expect(markup).not.toContain(labels.availabilityChooseScheduled);
      expect(markup).toContain('data-invitation-validation="true" class="min-h-5');
      expect(markup).not.toContain("/invitation-fields:flex-1");
      return {
        fields: markup.match(/data-assessment-fields="true" class="([^"]+)"/)?.[1],
        progress: markup.match(/data-invitation-progress="true" class="([^"]+)"/)?.[1],
        timeTrigger: markup.match(/<button class="([^"]+)"[^>]*data-assessment-time-trigger="true"/)?.[1],
      };
    });
    expect(renders[0].fields).toContain("max-w-[58rem]");
    expect(renders[0].progress).toBeDefined();
    expect(renders[0].timeTrigger).toContain("min-h-9");
    for (const result of renders) expect(result).toEqual(renders[0]);
  });
  it("reports only the actual missing requirement and keeps the original draft", () => {
    const draft = { ...emptyInvitationDraft("assessment_1v1"), state: "awaiting_parent" as const };
    expect(invitationDraftIssue(emptyInvitationDraft("assessment_1v1"))).toBeNull();
    expect(invitationDraftIssue(draft)).toBe("missingAssessor");
    const teacher = { ...draft, assessorId: "teacher" };
    expect(invitationDraftIssue(teacher)).toBe("missingParentAvailability");
    const parent = { ...teacher, parentTimeOptions: ["2026-09-07@14:00"] };
    expect(invitationDraftIssue(parent)).toBe("missingAssessorAvailability");
    expect(invitationDraftIssue({ ...parent, state: "awaiting_teacher" })).toBeNull();
    expect(invitationDraftIssue({ ...parent, assessorTimeOptions: ["2026-09-07@15:00"] })).toBe("noSharedAvailability");
    const shared = { ...parent, assessorTimeOptions: parent.parentTimeOptions };
    expect(invitationDraftIssue(shared)).toBeNull();
    expect(invitationDraftIssue({ ...shared, state: "confirmed" })).toBe("missingScheduledTime");
    expect(invitationDraftIssue({ ...shared, state: "confirmed", scheduledAt: "2026-09-07T06:00:00Z" })).toBeNull();
    expect(draft).toEqual({ ...emptyInvitationDraft("assessment_1v1"), state: "awaiting_parent" });
  });
  it("keeps reminder help available without an extra disclosure row, and leaves invalid-time errors visible", () => {
    const props = { id: "reminder", value: null, compact: true, onChange: vi.fn() };
    const blank = render(createElement(NextContactReminderField, props));
    expect(blank).not.toContain("<details");
    expect(blank).toContain(`aria-label="${messages.school.invitations.nextContactReminderHelp}"`);
    expect(blank).toMatch(/<p id="reminder-hint" class="[^"]*sr-only/);
    expect(blank).toContain('aria-describedby="reminder-hint"');
    const invalid = render(createElement(NextContactReminderField, { ...props, value: "2020-01-01T00:00:00Z" }));
    expect(invalid).toContain('data-invalid="true"');
    expect(invalid).toContain(messages.school.invitations.nextContactReminderPast);
    expect(invalid).not.toMatch(/<p id="reminder-hint" class="[^"]*sr-only/);
  });
});
