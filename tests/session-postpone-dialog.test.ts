// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import zh from "../messages/zh.json";
import en from "../messages/en.json";
import { SessionPostponeDialog } from "@/features/school/SessionPostponeDialog";
import type { SessionPostponePreview } from "@/features/school/session-postpone-contract";

const mocks = vi.hoisted(() => ({ preview: vi.fn(), apply: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/features/school/actions/session-postpone", () => ({ previewSessionPostponeAction: mocks.preview, applySessionPostponeAction: mocks.apply }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));

const id = "00000000-0000-0000-0000-000000000001";
const preview: SessionPostponePreview = {
  token: "a".repeat(32), classroomId: id, sessionId: id, days: 7, timeZone: "Asia/Shanghai", skippedCount: 1,
  sessions: [{ id, title: "Lesson 1", no: 1, previousScheduledAt: "2026-10-03T01:00:00Z", scheduledAt: "2026-10-10T01:00:00Z", durationMin: 90, roomId: null, closedDayId: null, closedDayName: null }],
};
let root: Root;
let container: HTMLDivElement;
let saved = vi.fn<() => void>();

async function render(locale = "zh") {
  await act(async () => root.render(h(NextIntlClientProvider, {
    locale, messages: locale === "zh" ? zh : en, children: h(SessionPostponeDialog, { sessionId: id, onSaved: saved }),
  })));
}
function button(label: string) {
  const element = Array.from(document.querySelectorAll("button")).find(row => row.textContent === label);
  expect(element, `button: ${label}`).toBeDefined();
  return element!;
}
async function click(element: HTMLElement) { await act(async () => element.click()); }
async function fill(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  vi.stubGlobal("crypto", { randomUUID: undefined });
  mocks.preview.mockResolvedValue({ ok: true, data: preview });
  mocks.apply.mockResolvedValue({ ok: true, data: { updatedCount: 1 } });
  saved = vi.fn<() => void>(); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("postponement preview and confirmation", () => {
  it("defaults to one week and previews both dates without writing, with randomUUID unavailable", async () => {
    await click(button(zh.school.classes.postpone.entry));
    expect(mocks.preview).toHaveBeenCalledExactlyOnceWith({ sessionId: id, days: 7 });
    expect(document.querySelector('input[type="number"]')?.getAttribute("value")).toBe("7");
    expect(document.body.textContent).toContain("2026/10/3");
    expect(document.body.textContent).toContain("2026/10/10");
    expect(document.body.textContent).toContain("已跳过 1 节");
    expect(mocks.apply).not.toHaveBeenCalled();
    await click(button("确认顺延"));
    expect(mocks.apply).toHaveBeenCalledExactlyOnceWith({ sessionId: id, days: 7, expectedToken: preview.token, confirmClosedDays: false, closedDayReason: "" });
    expect(saved).toHaveBeenCalledOnce();
  });
  it("requires a fresh preview after changing the day count and keeps the old date out of the confirmation", async () => {
    await click(button(zh.school.classes.postpone.entry));
    await fill(document.querySelector('input[type="number"]')!, "14");
    expect(button("确认顺延").disabled).toBe(true);
    expect(document.body.textContent).not.toContain("2026/10/10");
    mocks.preview.mockResolvedValueOnce({ ok: true, data: { ...preview, days: 14, token: "b".repeat(32) } });
    await click(button("预览调整"));
    await click(button("确认顺延"));
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ days: 14, expectedToken: "b".repeat(32) }));
  });
  it("requires both a closed-day confirmation and a reason", async () => {
    mocks.preview.mockResolvedValueOnce({ ok: true, data: { ...preview, sessions: [{ ...preview.sessions[0], closedDayId: id, closedDayName: "Holiday" }] } });
    await click(button(zh.school.classes.postpone.entry));
    expect(document.body.textContent).toContain("停课日：Holiday");
    expect(button("确认顺延").disabled).toBe(true);
    await click(document.querySelector('[role="checkbox"]')!);
    expect(button("确认顺延").disabled).toBe(true);
    await fill(document.querySelector("textarea")!, "补课安排");
    await click(button("确认顺延"));
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ confirmClosedDays: true, closedDayReason: "补课安排" }));
  });
  it("shows stale state and requires another preview instead of retrying a changed schedule", async () => {
    mocks.apply.mockResolvedValueOnce({ ok: false, code: "SCHEDULE_PREVIEW_STALE" });
    await click(button(zh.school.classes.postpone.entry));
    await click(button("确认顺延"));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(zh.school.classes.postpone.stale);
    expect(button("确认顺延").disabled).toBe(true);
    expect(saved).not.toHaveBeenCalled();
  });
  it("keeps the confirmation unavailable while the preview is loading and discards a closed dialog’s response", async () => {
    let resolve!: (value: unknown) => void;
    mocks.preview.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await click(button(zh.school.classes.postpone.entry));
    expect(button("确认顺延").disabled).toBe(true);
    await click(button("取消"));
    await act(async () => resolve({ ok: true, data: preview }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("renders the same workflow in English", async () => {
    await render("en");
    await click(button(en.school.classes.postpone.entry));
    expect(document.body.textContent).toContain(en.school.classes.postpone.before);
    expect(document.body.textContent).toContain("Move 1 session forward by 7 days each.");
    expect(button("Confirm postponement").disabled).toBe(false);
  });
});
