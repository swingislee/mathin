// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FollowupRecordRow, FollowupTableBody } from "@/features/school/dashboard-page/FollowupRecordRow";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
let root: Root, container: HTMLDivElement;
const save = vi.fn(), outcome = vi.fn();
function Harness({ pending = false }: { pending?: boolean }) {
  const [active, setActive] = useState("a");
  const [expanded, setExpanded] = useState<string | null>(null);
  return createElement("table", null, createElement(FollowupTableBody, { onNavigate: key => { if (pending) return false; setActive(key); return true; } },
    ["a", "b"].map(key => createElement(FollowupRecordRow, { key, rowKey: key, active: active === key, expanded: expanded === key, pending,
      onExpandedChange: value => setExpanded(value ? key : null), onActivate: () => setActive(key), onSave: save, onOutcomeChange: outcome,
      detailsId: `detail-${key}`, title: key, colSpan: 1, keepMounted: true,
      summary: createElement("td", null, key, createElement("button", { type: "button" }, "Profile")),
    }, createElement("textarea", { defaultValue: "unsaved draft" }))),
  ));
}
const row = (key: string) => container.querySelector<HTMLElement>(`tr[data-followup-row-key="${key}"]`)!;
const detail = (key: string) => container.querySelector<HTMLElement>(`#detail-${key}`)!;
async function keydown(target: HTMLElement, key: string, extra = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra });
  await act(async () => { target.dispatchEvent(event); });
  return event;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  vi.clearAllMocks();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("shared student and follow-up record interaction", () => {
  it("opens with Enter, navigates from details and retains a draft without saving", async () => {
    await act(async () => root.render(createElement(Harness)));
    await keydown(row("a"), "Enter");
    expect(detail("a").hidden).toBe(false);
    const input = detail("a").querySelector("textarea")!;
    input.value = "keep my edited draft";
    await keydown(detail("a"), "ArrowDown");
    expect(document.activeElement).toBe(row("b"));
    await keydown(row("b"), "Enter");
    expect(detail("a").hidden).toBe(true);
    expect(input.value).toBe("keep my edited draft");
    await keydown(detail("b"), "Escape");
    expect(detail("b").hidden).toBe(true);
    expect(document.activeElement).toBe(row("b"));
    expect(save).not.toHaveBeenCalled();
  });
  it("uses 0–4 and explicit save in both rows, leaving inputs, overlays and IME alone", async () => {
    await act(async () => root.render(createElement(Harness)));
    for (const target of [row("a"), detail("a")]) {
      for (const key of ["0", "1", "2", "3", "4"]) await keydown(target, key);
      await keydown(target, "Enter", { ctrlKey: true });
    }
    expect(outcome.mock.calls.map(call => call[0])).toEqual(["", "unreachable", "connected", "declined", "invalid_number", "", "unreachable", "connected", "declined", "invalid_number"]);
    expect(save).toHaveBeenCalledTimes(2);
    outcome.mockClear(); save.mockClear();
    const input = detail("a").querySelector("textarea")!;
    expect((await keydown(input, "ArrowDown")).defaultPrevented).toBe(false);
    await keydown(input, "2");
    await keydown(row("a"), "2", { isComposing: true });
    await keydown(row("a"), "2", { repeat: true });
    const overlay = document.createElement("div"); overlay.setAttribute("role", "dialog"); detail("a").append(overlay);
    await keydown(overlay, "2"); await keydown(overlay, "Enter", { ctrlKey: true });
    expect(outcome).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  });
  it("keeps selection/profile clicks separate and blocks switching or repeat saves while pending", async () => {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => row("a").querySelector<HTMLButtonElement>("button")!.click());
    expect(detail("a").hidden).toBe(true);
    await act(async () => root.render(createElement(Harness, { pending: true })));
    await act(async () => row("a").focus());
    for (const key of ["Enter", "2", "ArrowDown"]) await keydown(row("a"), key);
    await keydown(row("a"), "Enter", { ctrlKey: true });
    expect(document.activeElement).toBe(row("a"));
    expect(detail("a").hidden).toBe(true);
    expect(outcome).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  });
});
