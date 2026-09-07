import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FollowupEntryFields } from "@/features/school/FollowupEntryFields";
import { emptyInvitationDraft, invitationForAdvance, invitationHasStageInformation, leadContactInput, leadWechatValue, type LeadContactDraft } from "@/features/school/followup-entry-contract";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/features/school/NextContactReminderField", () => ({
  NextContactReminderField: ({ id, className, compact }: { id: string; className?: string; compact?: boolean }) =>
    createElement("button", { id, className, "data-compact": compact }, "reminder"),
}));

const props: ComponentProps<typeof FollowupEntryFields> = {
  id: "entry", note: "同一份备注", onNoteChange: () => {}, onSave: () => {}, canAdvance: true,
  reminder: { value: null, onChange: () => {} },
};

describe("shared follow-up entry layout and submission contract", () => {
  it("keeps the first-contact note limit while allowing a public-class assessment field to retain its own limit", () => {
    expect(renderToStaticMarkup(createElement(FollowupEntryFields, props))).toMatch(/maxLength="2000"/i);
    expect(renderToStaticMarkup(createElement(FollowupEntryFields, { ...props, noteMaxLength: 3000 }))).toMatch(/maxLength="3000"/i);
  });
  it("uses the same note section for immutable facts and blocks keyboard submission", () => {
    const save = vi.fn();
    const readonlyProps = { ...props, readOnly: true, onSave: save, noteLabel: '原有业务事实' };
    const markup = renderToStaticMarkup(createElement(FollowupEntryFields, readonlyProps));
    expect(markup).toContain('data-followup-notes');
    expect(markup).toContain('原有业务事实');
    expect(markup).toContain(props.note);
    expect(markup).not.toMatch(/<textarea|id="entry-reminder"|aria-keyshortcuts/);
    FollowupEntryFields(readonlyProps).props.onKeyDown({
      defaultPrevented: false, nativeEvent: { isComposing: false }, repeat: false, ctrlKey: true, metaKey: false,
      key: 'Enter', preventDefault: vi.fn(), stopPropagation: vi.fn(),
    });
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    { name: "empty", children: null }, { name: "hidden", children: false },
    { name: "assessment", children: createElement("div", null, "assessment") },
    { name: "activity", children: createElement("div", null, "activity") },
  ])(
    "keeps one note, a compact reminder immediately below, and a single action footer ($name)", ({ children }) => {
      const markup = renderToStaticMarkup(createElement(FollowupEntryFields, props, children));
      expect(markup.match(/<textarea\b/g)).toHaveLength(1);
      expect(markup.indexOf('id="entry-note"')).toBeLessThan(markup.indexOf('id="entry-reminder"'));
      expect(markup.indexOf('id="entry-reminder"')).toBeLessThan(markup.indexOf("data-followup-entry-actions"));
      expect(markup).toContain('data-compact="true"');
      expect(markup).toContain("max-w-72");
      expect(markup).toContain("@[50rem]/followup-entry:grid-cols-[minmax(0,1fr)_19rem]");
      expect(markup).toContain("data-followup-notes");
      expect(markup).not.toContain("followup-entry:border-l");
      expect(markup).not.toContain("border-t");
      expect(markup).toContain("data-followup-business");
      expect(markup.indexOf("data-followup-business")).toBeLessThan(markup.indexOf("data-followup-notes"));
      expect(markup).not.toContain("max-w-3xl");
    },
  );

  it("offers ordinary save and save-next separately, with the keyboard shortcut on ordinary save", () => {
    const markup = renderToStaticMarkup(createElement(FollowupEntryFields, props));
    expect(markup).toMatch(/aria-keyshortcuts="Control\+Enter Meta\+Enter"[^>]*>.*?save<kbd/);
    expect(markup).toContain(">saveAndNext</button>");
    const noQueue = renderToStaticMarkup(createElement(FollowupEntryFields, { ...props, canAdvance: false }));
    expect(noQueue).not.toContain("saveAndNext");
  });
  it("retains the reminder slot when a confirmed arrangement no longer allows reminders", () => {
    for (const children of [null, createElement("div", null, "assessment")]) for (const reminder of [props.reminder, undefined]) {
      const markup = renderToStaticMarkup(createElement(FollowupEntryFields, { ...props, reminder }, children));
      expect(markup).toContain('data-followup-reminder-slot="true" class="min-h-18"');
      expect(markup.indexOf("data-followup-reminder-slot")).toBeLessThan(markup.indexOf("data-followup-entry-actions"));
    }
  });

  it("places persistent stage tags above the business panel while notes occupy the right column from the top", () => {
    const markup = renderToStaticMarkup(createElement(FollowupEntryFields, {
      ...props, layout: "stage", stageHeader: createElement("div", { "data-stage-header": true }, "tags and navigation"),
    }, createElement("div", null, "stage details")));
    expect(markup.indexOf("data-stage-header")).toBeLessThan(markup.indexOf("data-followup-business"));
    expect(markup).toContain("col-start-1 row-start-2");
    expect(markup).toContain("@[50rem]/followup-entry:col-start-2");
    expect(markup).toContain("@[50rem]/followup-entry:row-start-1");
  });

  it("uses Ctrl+Enter for explicit save, ignores IME and repeat, and blocks disabled or pending submissions", () => {
    const save = vi.fn();
    const event = (extra = {}) => ({
      defaultPrevented: false, nativeEvent: { isComposing: false }, repeat: false, ctrlKey: true,
      metaKey: false, key: "Enter", preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra,
    });
    const handler = (extra = {}) => FollowupEntryFields({ ...props, onSave: save, ...extra }).props.onKeyDown;
    handler()(event());
    expect(save).toHaveBeenCalledExactlyOnceWith(false);
    handler()(event({ nativeEvent: { isComposing: true } }));
    handler()(event({ repeat: true }));
    handler({ pending: true })(event());
    handler({ saveDisabled: true })(event());
    handler({ disabled: true })(event());
    expect(save).toHaveBeenCalledTimes(1);
  });
});

const draft: LeadContactDraft = {
  note: "已经填写的备注", wechatState: "yes", interestLevel: "A", nextContactAt: "2026-10-01T02:00:00Z",
  invitation: { kind: "assessment_1v1", state: "coordinating_time", activityId: null, assessorId: null,
    parentTimeOptions: [], assessorTimeOptions: [], scheduledAt: null, locationText: "教室", nextContactAt: "2026-10-02T02:00:00Z" },
};

describe("contact result draft projection", () => {
  it("marks only blank browsing undecided on advance, retaining reminders", () => {
    for (const invitation of [null, emptyInvitationDraft("activity"), emptyInvitationDraft("assessment_1v1")]) {
      expect(invitationHasStageInformation(invitation)).toBe(false);
      expect(invitationForAdvance(invitation, draft.nextContactAt)).toMatchObject({ kind: "waiting_activity", state: "waiting_activity", nextContactAt: draft.nextContactAt });
    }
  });
  it("retains every kind of partial coordination, not just final parent confirmation", () => {
    const blank = emptyInvitationDraft("assessment_1v1");
    for (const invitation of [
      { ...blank, assessorId: "teacher" }, { ...blank, parentTimeOptions: ["2026-09-07@14:00"] },
      { ...blank, assessorTimeOptions: ["2026-09-07@14:00"] }, { ...blank, locationText: "教室" },
      { ...blank, scheduledAt: "2026-09-07T06:00:00Z" }, { ...blank, state: "awaiting_teacher" as const },
      { ...emptyInvitationDraft("activity"), activityId: "session" },
    ]) {
      const before = structuredClone(invitation);
      expect(invitationHasStageInformation(invitation)).toBe(true);
      expect(invitationForAdvance(invitation)).toBe(invitation);
      expect(invitation).toEqual(before);
    }
  });
  it("keeps unreachable notes and reminders without submitting hidden WeChat or invitation fields", () => {
    expect(leadContactInput("unreachable", draft)).toEqual({
      outcome: "unreachable", note: draft.note, wechatAdded: null, interestLevel: null, invitation: null, nextContactAt: draft.nextContactAt,
    });
  });
  it("keeps invalid-number notes but does not schedule another phone reminder", () => {
    expect(leadContactInput("invalid_number", draft)).toMatchObject({
      note: draft.note, wechatAdded: null, interestLevel: null, invitation: null, nextContactAt: null,
    });
  });
  it("defers an invitation on a declined contact, retaining the source draft when switching back", () => {
    const before = structuredClone(draft);
    expect(leadContactInput("declined", draft)).toMatchObject({ wechatAdded: true, interestLevel: "A", invitation: null, nextContactAt: draft.nextContactAt });
    expect(draft).toEqual(before);
    expect(leadContactInput("connected", draft).invitation).toEqual(before.invitation);
  });
  it("submits the same reminder in both the connected contact and invitation contracts", () => {
    const input = leadContactInput("connected", draft);
    expect(input.nextContactAt).toBe(input.invitation?.nextContactAt);
    expect(input.nextContactAt).toBe(draft.invitation?.nextContactAt);
  });
  it("normalizes a confirmed invitation's reminder without deleting the draft", () => {
    const confirmed = { ...draft, invitation: { ...draft.invitation!, state: "confirmed" as const } };
    const input = leadContactInput("connected", confirmed);
    expect(input.nextContactAt).toBeNull();
    expect(input.invitation?.nextContactAt).toBeNull();
    expect(confirmed.invitation.nextContactAt).toBe(draft.invitation?.nextContactAt);
  });
  it("keeps unknown facts unknown instead of manufacturing a no", () => {
    expect(leadContactInput("connected", { ...draft, wechatState: "", interestLevel: "", invitation: null }))
      .toMatchObject({ wechatAdded: null, interestLevel: null, invitation: null, nextContactAt: null });
  });
  it.each([true, false, null])("distinguishes untouched WeChat from explicitly returning to the center when the saved fact is %s", (savedWechatAdded) => {
    const untouched = { ...draft, wechatState: "" as const, savedWechatAdded };
    const centered = { ...untouched, wechatState: "unknown" as const };
    const before = structuredClone(centered);
    expect(leadWechatValue("", savedWechatAdded)).toBe(savedWechatAdded);
    expect(leadWechatValue("unknown", savedWechatAdded)).toBeNull();
    for (const outcome of ["connected", "declined"] as const) {
      expect(leadContactInput(outcome, untouched).wechatAdded).toBe(savedWechatAdded);
      expect(leadContactInput(outcome, centered).wechatAdded).toBeNull();
    }
    expect(leadContactInput("unreachable", untouched).wechatAdded).toBeNull();
    expect(centered).toEqual(before);
  });
});
