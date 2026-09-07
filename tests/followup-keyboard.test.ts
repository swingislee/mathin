import { readFileSync } from "node:fs";
import type { KeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { adjacentFollowupKey, followupKeyboardCommand, followupKeyContext, navigateFollowupTable } from "@/features/school/followup-keyboard";

const key = (value: string, extra = {}) => ({ key: value, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
  repeat: false, defaultPrevented: false, ...extra });

function tableEvent(value: string, { detail = false, editing = false, portal = false, busy = false, index = 1, ...extra } = {}) {
  const rows = ["lead:a", "lead:b", "post:c"].map((id) => ({
    dataset: { followupRowKey: id }, focus: vi.fn(), scrollIntoView: vi.fn(),
    hasAttribute: () => false, getAttribute: (name: string) => name === "data-followup-row-key" ? id : name === "aria-busy" && busy ? "true" : null,
  }));
  const origin = detail ? { hasAttribute: () => true, previousElementSibling: rows[index] } : rows[index];
  const event = { ...key(value, extra), nativeEvent: { isComposing: false },
    target: { closest: (selector: string) => selector === "tr" ? origin : editing && selector.startsWith("input,") ? {} : null },
    currentTarget: { contains: () => !portal, querySelectorAll: () => rows }, preventDefault: vi.fn(), stopPropagation: vi.fn(),
  };
  return { rows, event, dispatch: (navigate = vi.fn(() => true)) => { navigateFollowupTable(event as unknown as KeyboardEvent<HTMLElement>, navigate); return navigate; } };
}

describe("follow-up keyboard scope", () => {
  it.each([["1", "unreachable"], ["2", "connected"], ["3", "declined"], ["4", "invalid_number"]])("maps %s to the original contact outcome", (value, outcome) => {
    expect(followupKeyboardCommand(key(value))).toEqual({ type: "outcome", outcome });
  });
  it("clears the outcome with zero", () => {
    expect(followupKeyboardCommand(key("0"))).toEqual({ type: "outcome", outcome: "" });
  });
  it("keeps number and arrow keys available for normal text entry, and saves only explicitly", () => {
    for (const value of ["0", "1", "2", "3", "4", "ArrowUp", "ArrowDown"]) expect(followupKeyboardCommand(key(value), { editing: true })).toBeNull();
    expect(followupKeyboardCommand(key("Enter", { ctrlKey: true }), { editing: true })).toEqual({ type: "save" });
    expect(followupKeyboardCommand(key("Enter", { metaKey: true }))).toEqual({ type: "save" });
    expect(followupKeyboardCommand(key("Escape"))).toEqual({ type: "close" });
    expect(followupKeyboardCommand(key("Enter"))).toBeNull();
  });
  it("ignores IME, repeats, modifiers, consumed control events, and overlays", () => {
    for (const extra of [{ isComposing: true }, { repeat: true }, { defaultPrevented: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      expect(followupKeyboardCommand(key("2", extra))).toBeNull();
      expect(followupKeyboardCommand(key("0", extra))).toBeNull();
    }
    expect(followupKeyboardCommand(key("0"), { overlay: true })).toBeNull();
    expect(followupKeyboardCommand(key("Enter", { ctrlKey: true }), { overlay: true })).toBeNull();
    expect(followupKeyContext(tableEvent("2", { editing: true }).event as unknown as KeyboardEvent<HTMLElement>)).toEqual({ editing: true, overlay: false });
    expect(followupKeyContext(tableEvent("2", { portal: true }).event as unknown as KeyboardEvent<HTMLElement>).overlay).toBe(true);
  });
  it.each([false, true])("moves from summary/detail=%s to the adjacent visible record without submitting", (detail) => {
    const next = tableEvent("ArrowDown", { detail });
    expect(next.dispatch()).toHaveBeenCalledExactlyOnceWith("post:c");
    expect(next.rows[2].focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(next.rows[2].scrollIntoView).toHaveBeenCalledOnce();
    expect(next.event.preventDefault).toHaveBeenCalledOnce();
    const previous = tableEvent("ArrowUp", { detail });
    expect(previous.dispatch()).toHaveBeenCalledExactlyOnceWith("lead:a");
  });
  it("holds the first/last boundary, respects pending saves, and leaves controls alone", () => {
    expect(adjacentFollowupKey(["a", "b"], "a", -1)).toBeNull();
    expect(adjacentFollowupKey(["a", "b"], "b", 1)).toBeNull();
    expect(adjacentFollowupKey(["a", "b"], "missing", 1)).toBeNull();
    expect(tableEvent("ArrowUp", { index: 0 }).dispatch()).not.toHaveBeenCalled();
    expect(tableEvent("ArrowDown", { index: 2 }).dispatch()).not.toHaveBeenCalled();
    for (const options of [{ busy: true }, { editing: true }, { portal: true }, { defaultPrevented: true }]) {
      const input = tableEvent("ArrowDown", options);
      expect(input.dispatch()).not.toHaveBeenCalled();
      expect(input.rows[2].focus).not.toHaveBeenCalled();
    }
    const locked = tableEvent("ArrowDown");
    locked.dispatch(vi.fn(() => false));
    expect(locked.rows[2].focus).not.toHaveBeenCalled();
  });
  it("wires the same contact handler into both rows and keeps the nested assessment shortcut disabled", () => {
    const source = readFileSync(new URL("../src/features/school/LeadFirstContactWorkbench.tsx", import.meta.url), "utf8");
    const details = readFileSync(new URL("../src/features/school/dashboard-page/FollowupInlineDetails.tsx", import.meta.url), "utf8");
    const recordRow = readFileSync(new URL("../src/features/school/FirstContactRecordRow.tsx", import.meta.url), "utf8");
    expect(source).toContain("<FirstContactRecordRow");
    expect(source.match(/onKeyDown=\{handleRowKeyDown\}/g)).toHaveLength(1);
    expect(recordRow.match(/onKeyDown=\{handleKeyDown\}/g)).toHaveLength(2);
    expect(source).toContain("enableProgressShortcuts={false}");
    expect(details).toContain("onKeyDown={onKeyDown}");
    expect(details).toContain("onActivate?.()");
    expect(details).toContain("event.currentTarget.focus({ preventScroll: true })");
  });
});
