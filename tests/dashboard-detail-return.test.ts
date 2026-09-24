// @vitest-environment jsdom
import { act, createElement as h, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FollowupRecordRow } from "@/features/school/dashboard-page/FollowupRecordRow";
import { FollowupInlineDetails } from "@/features/school/dashboard-page/FollowupInlineDetails";
import { restoreCollapsedRow } from "@/features/school/dashboard-page/restore-collapsed-row";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

let root: Root, container: HTMLDivElement, frames: FrameRequestCallback[];
const scroll = vi.fn();
const table = (children: ReactNode) => h("table", null, h("tbody", null, children));
function Record({ name, children, pending = false, keepMounted = false }: {
  name: string; children?: ReactNode; pending?: boolean; keepMounted?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return h(FollowupRecordRow, { rowKey: name, active: true, expanded: open, onExpandedChange: setOpen,
    detailsId: `${name}-detail`, title: name, colSpan: 1, pending, keepMounted,
    summary: h("td", null, h("button", { "aria-expanded": open, "aria-controls": `${name}-detail`, onClick: () => setOpen(!open) }, name)),
  }, children ?? h("textarea", { defaultValue: "unsaved draft" }));
}
function CustomRow({ trigger = true }: { trigger?: boolean }) {
  const [open, setOpen] = useState(true);
  return table([
    h("tr", { key: "summary", "aria-expanded": open }, h("td", null, trigger
      ? h("button", { "aria-expanded": open, "aria-controls": "custom-detail" }, "Custom summary") : "Custom summary")),
    h(FollowupInlineDetails, { key: "detail", open, onOpenChange: setOpen, id: "custom-detail", title: "Custom", colSpan: 1 }, h("textarea")),
  ]);
}
async function keydown(target: Element, extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...extra });
  await act(async () => { target.dispatchEvent(event); });
  return event;
}
async function paint() {
  await act(async () => { const next = frames.splice(0); next.forEach(frame => frame(0)); });
}
const summary = (name: string) => container.querySelector<HTMLTableRowElement>(`[data-followup-row-key="${name}"]`)!;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => frames.push(callback));
  HTMLElement.prototype.scrollIntoView = scroll;
  scroll.mockReset();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe("returning from dashboard row details", () => {
  it.each(["input", "summary", "close button"])("returns from %s after the detail has collapsed", async origin => {
    await act(async () => root.render(table(h(Record, { name: "record" }))));
    const row = summary("record"), trigger = row.querySelector("button")!;
    scroll.mockImplementation(function (this: HTMLElement) {
      expect(this).toBe(row);
      expect(document.getElementById("record-detail")).toBeNull();
      expect(row.getAttribute("aria-expanded")).toBe("false");
    });
    if (origin === "close button") await act(async () => container.querySelector<HTMLButtonElement>("[data-dashboard-inline-entry] button")!.click());
    else await keydown(origin === "input" ? container.querySelector("textarea")! : row);
    expect(document.activeElement).toBe(trigger);
    expect(scroll).not.toHaveBeenCalled();
    await paint();
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: "nearest", inline: "nearest", behavior: "instant" });
  });

  it("closes one nested level at a time and returns to that level's disclosure", async () => {
    await act(async () => root.render(table(h(Record, { name: "parent" }, table(h(Record, { name: "child" }))))));
    const parent = summary("parent"), child = summary("child");
    await keydown(container.querySelector("textarea")!); await paint();
    expect(parent.getAttribute("aria-expanded")).toBe("true");
    expect(child.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(child.querySelector("button"));
    expect(scroll.mock.instances).toEqual([child]);
    await keydown(document.activeElement!); await paint();
    expect(parent.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(parent.querySelector("button"));
    expect(scroll.mock.instances).toEqual([child, parent]);
  });

  it.each([true, false])("also returns from a custom table with disclosure=%s", async trigger => {
    await act(async () => root.render(h(CustomRow, { trigger })));
    const row = container.querySelector("tr")!;
    await keydown(container.querySelector("textarea")!); await paint();
    expect(document.activeElement).toBe(trigger ? row.querySelector("button") : row);
    expect(scroll.mock.instances).toEqual([row]);
  });

  it("keeps retained drafts mounted when closing and reopening", async () => {
    await act(async () => root.render(table(h(Record, { name: "draft", keepMounted: true }))));
    const input = container.querySelector("textarea")!;
    input.value = "Edited, not submitted";
    await keydown(input); await paint();
    expect(document.getElementById("draft-detail")?.hidden).toBe(true);
    await act(async () => summary("draft").querySelector<HTMLButtonElement>("button")!.click());
    expect(container.querySelector("textarea")).toBe(input);
    expect(input.value).toBe("Edited, not submitted");
  });

  it.each([{ isComposing: true }, { repeat: true }, { altKey: true }, { ctrlKey: true }, { shiftKey: true }])("leaves modified or composing Escape alone: %j", async extra => {
    await act(async () => root.render(table(h(Record, { name: "record" }))));
    await keydown(container.querySelector("textarea")!, extra); await paint();
    expect(summary("record").getAttribute("aria-expanded")).toBe("true");
    expect(scroll).not.toHaveBeenCalled();
  });

  it("keeps a pending detail open and lets overlays handle Escape", async () => {
    await act(async () => root.render(table(h(Record, { name: "record", pending: true }))));
    await keydown(container.querySelector("textarea")!); await paint();
    expect(summary("record").getAttribute("aria-expanded")).toBe("true");
    await act(async () => root.render(table(h(Record, { name: "record" }, h("div", { role: "listbox" }, "Options")))));
    expect((await keydown(container.querySelector("[role='listbox']")!)).defaultPrevented).toBe(false);
    await paint();
    expect(summary("record").getAttribute("aria-expanded")).toBe("true");
    expect(scroll).not.toHaveBeenCalled();
  });

  it("allows for sticky headers while preserving the horizontal position and existing margin", async () => {
    await act(async () => root.render(h(CustomRow)));
    const row = container.querySelector("tr")!, header = container.querySelector("table")!.createTHead();
    header.style.position = "sticky";
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue({ height: 40 } as DOMRect);
    container.scrollLeft = 120; row.style.scrollMarginTop = "4px";
    scroll.mockImplementation(function (this: HTMLElement) {
      expect(this.style.scrollMarginTop).toBe("48px");
      container.scrollLeft = 0;
    });
    await keydown(container.querySelector("textarea")!); await paint();
    expect(scroll).toHaveBeenCalledOnce();
    expect(container.scrollLeft).toBe(120);
    expect(row.style.scrollMarginTop).toBe("4px");
  });

  it.each(["removed", "hidden", "reopened", "focus moved"])("does not scroll a stale return target after it is %s", async change => {
    await act(async () => root.render(h(CustomRow)));
    const row = container.querySelector("tr")!;
    await keydown(container.querySelector("textarea")!);
    if (change === "removed") await act(async () => root.render(null));
    else if (change === "hidden") row.hidden = true;
    else if (change === "reopened") row.setAttribute("aria-expanded", "true");
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await paint();
    expect(scroll).not.toHaveBeenCalled();
  });

  it("safely ignores a missing summary", () => {
    restoreCollapsedRow(null);
    expect(frames).toHaveLength(0);
  });
});
