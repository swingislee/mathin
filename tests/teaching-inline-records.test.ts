// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ComponentType, type PropsWithChildren } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../messages/zh.json";
import { TeachingClassOverviewTable } from "@/features/school/teaching-workbench/TeachingClassOverviewTable";
import { TeachingInlineRecords } from "@/features/school/teaching-workbench/TeachingInlineRecords";
import { ATTENDANCE_STATUS_TONE } from "@/features/school/attendance-visual";
import { LEARNING_CHECK_STATUS_STYLE } from "@/features/school/session-learning-visual";
import { readTeachingInlineRecords, type TeachingRecordCache } from "@/features/school/teaching-workbench/teaching-records-client";
import type { TeachingRecords } from "@/features/school/teaching-workbench/teaching-records-contract";
import type { TeachingClassOverview } from "@/features/school/teaching-workbench/teaching-class-overview-contract";

vi.mock("next/dynamic", async () => ({ default: (await import("next/dist/shared/lib/app-dynamic")).default }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, prefetch, ...props }: ComponentProps<"a"> & { prefetch?: boolean }) => { void prefetch; return createElement("a", props, children); },
  useRouter: () => ({ replace: vi.fn() }),
}));
const at = "2026-09-15T01:00:00Z";
const records: TeachingRecords = {
  session: { id: "session", classroomId: "class", classroomName: "示例班", title: "第一讲", scheduledAt: at, startedAt: null, endedAt: null },
  students: [{ id: "student", name: "学生甲" }], attendance: [{ studentId: "student", status: "late", note: "考勤备注" }],
  checks: [{ id: "check", title: "思路说明" }], results: [{ checkId: "check", studentId: "student", status: "prompted", markedAt: at, author: "任课老师" }],
  reviews: [], canReadContacts: true, contactPage: 1, contactTotal: 21,
  contacts: [{ id: "contact", studentId: "student", content: "保存的沟通正文", kind: "class", createdAt: at, occurredOn: null, author: "老师" }], supportNotes: [],
};
const overview: TeachingClassOverview = {
  workbench: { truncated: false, sessions: [{ ...records.session, scheduledAt: at, teachers: [{ id: "teacher", name: "任课老师" }] }] },
  metrics: [{ sessionId: "session", studentIds: ["student"], attendance: { marked: 1, present: 1, late: 1, absent: 0, leave: 0 }, checkCount: 1, ratedCount: 1,
    attentionStudents: [{ id: "student", name: "学生甲" }], reviewCount: 0, latestReview: null }],
  canReadContacts: true, classContacts: [],
};
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const Provider = NextIntlClientProvider as ComponentType<PropsWithChildren<Omit<ComponentProps<typeof NextIntlClientProvider>, "children">>>;

describe("inline teaching record loading", () => {
  it("uses the workbench field menu and recalculates a class when the teacher scope changes or clears", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const data: TeachingClassOverview = { ...overview,
      workbench: { ...overview.workbench, sessions: [...overview.workbench.sessions, { ...overview.workbench.sessions[0], id: "second", teachers: [{ id: "substitute", name: "代课老师" }] }] },
      metrics: [...overview.metrics, { ...overview.metrics[0], sessionId: "second" }],
    };
    const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
    const click = async (element: Element | null | undefined) => { expect(element).toBeTruthy(); await act(async () => (element as HTMLElement).click()); };
    try {
      await act(async () => root.render(createElement(Provider, { locale: "zh", messages, timeZone: "Asia/Shanghai" }, createElement(TeachingClassOverviewTable, {
        data, locale: "zh", timeZone: "Asia/Shanghai", returnTo: "/dashboard/teaching?view=records",
      }))));
      const row = () => container.querySelector('[data-teaching-level="class"]')!;
      expect(row().textContent).toContain("已记 2/2");
      await click(container.querySelectorAll("[data-dashboard-table-menu]")[1]);
      const menu = document.querySelector("[data-dashboard-field-menu]");
      expect(menu).toBeTruthy();
      expect(container.contains(menu)).toBe(false); // 弹层离开表格滚动与固定列的堆叠范围。
      await click(document.querySelector('[data-field-option="substitute"]'));
      expect(row().textContent).toContain("已记 1/1");
      expect(row().textContent).not.toContain("任课老师");
      expect(document.querySelector('[data-field-option="teacher"]')).toBeTruthy();
      await click([...document.querySelectorAll("[data-dashboard-field-menu] button")].find(button => button.textContent === "清除全部条件"));
      expect(row().textContent).toContain("已记 2/2");
      expect(row().textContent).toContain("任课老师");
      expect(fetcher).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); container.remove(); }
  });

  it("loads on expansion, uses the shared detail surface and colors, and pages without navigation", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const query = JSON.parse(String(init.body));
      return Response.json({ ...records, contactPage: query.contactPage, contacts: [{ ...records.contacts[0], content: query.contactPage === 1 ? "保存的沟通正文" : "下一页沟通正文" }] });
    });
    vi.stubGlobal("fetch", fetcher);
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    const click = async (label: string) => {
      const button = [...container.querySelectorAll("button")].find(node => node.textContent === label || node.getAttribute("aria-label") === label);
      expect(button, label).toBeTruthy();
      await act(async () => button!.click());
    };
    try {
      await act(async () => root.render(createElement(Provider, { locale: "zh", messages, timeZone: "Asia/Shanghai" },
        createElement(TeachingClassOverviewTable, { data: overview, locale: "zh", timeZone: "Asia/Shanghai", returnTo: "/dashboard/teaching?view=records" }),
      )));
      expect(fetcher).not.toHaveBeenCalled();
      await click("展开示例班的课次");
      expect(fetcher).not.toHaveBeenCalled();
      const classRow = container.querySelector('[data-teaching-level="class"]')!;
      const sessionRow = container.querySelector('[data-teaching-level="session"]')!;
      const classDetail = container.querySelector("#teaching-class-details-class")!;
      expect(classRow.nextElementSibling).toBe(classDetail);
      expect(classDetail.contains(sessionRow)).toBe(true);
      expect(classDetail.querySelector(":scope > td")?.getAttribute("colspan")).toBe("8");
      expect(classRow.hasAttribute("data-followup-group")).toBe(false);
      expect(classDetail.querySelector("[data-dashboard-inline-entry]")?.className).toContain("pr-8");
      expect(classDetail.querySelector("[data-dashboard-inline-entry] > div")?.className).toContain("absolute right-0 top-0");
      expect(classRow.closest("[data-followup-workbench]")).toBeTruthy();
      expect(classRow.querySelector("td:first-child .lucide-chevron-down")).toBeTruthy();
      expect(sessionRow.querySelector("td:first-child .lucide-chevron-right")).toBeTruthy();
      expect(container.querySelectorAll("thead:not(.sr-only)")).toHaveLength(1);
      expect(container.querySelectorAll("thead [data-dashboard-table-menu]")).toHaveLength(8);
      await act(async () => { await import("@/features/school/teaching-workbench/TeachingInlineRecords"); });
      await click("查看实际记录");
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][0]).toBe("/zh/dashboard/teaching/records-detail");
      expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-store", credentials: "same-origin" });
      const detail = container.querySelector("#session-records-session")!;
      expect(sessionRow.querySelector("td:first-child .lucide-chevron-down")).toBeTruthy();
      expect([...detail.querySelectorAll("thead,th")].some(node => node.className.includes("sticky"))).toBe(false);
      expect([...container.querySelectorAll('[data-slot="table-container"]')].filter(node => node.className.includes("max-h"))).toHaveLength(0);
      expect(container.querySelector('[data-followup-scroll] > [data-slot="table-container"]')?.className).toContain("[scrollbar-gutter:stable]");
      expect(classRow.querySelector("td:first-child")?.className).toContain("sticky left-0 z-10");
      expect(sessionRow.querySelector("td:first-child")?.className).not.toContain("sticky");
      expect(sessionRow.querySelector("td:first-child")?.className).not.toContain("border-r");
      expect(classRow.querySelector("button[aria-expanded]")?.className).toBe(sessionRow.querySelector("button[aria-expanded]")?.className);
      expect(container.querySelector("th:first-child")?.className).toContain("left-0 z-30");
      const footers = [...container.querySelectorAll("[data-followup-pagination]")];
      expect(footers).toHaveLength(2);
      expect(footers[0].className).toBe(footers[1].className);
      expect(detail.textContent).toContain("保存的沟通正文");
      expect(detail.textContent).not.toContain("返回教学记录列表");
      expect(detail.querySelector("[data-dashboard-inline-entry]")).toBeTruthy();
      expect([...detail.querySelectorAll("span")].find(node => node.textContent === "迟到")?.className).toContain(ATTENDANCE_STATUS_TONE.late);
      const learningMark = detail.querySelector('tbody [data-learning-status="prompted"]')!;
      expect(learningMark.className).toContain(LEARNING_CHECK_STATUS_STYLE.prompted.active);
      expect(learningMark.getAttribute("aria-label")).toContain(messages.school.session.learningStatus_prompted);
      expect(learningMark.querySelector("svg")).toBeTruthy();
      await click("下一页");
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain("下一页沟通正文");
      expect(JSON.parse(String(fetcher.mock.calls[1][1].body))).toMatchObject({ sessionId: "session", contactPage: 2, pageSize: 20 });
      await click("收起实际记录");
      expect(container.querySelector("#session-records-session")).toBeNull();
      expect(classDetail.isConnected).toBe(true);
      await click("查看实际记录");
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain("保存的沟通正文");
      const expandedButton = container.querySelector('[aria-label="收起实际记录"]')!;
      await act(async () => container.querySelector("#session-records-session [data-dashboard-inline-entry]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(container.querySelector("#session-records-session")).toBeNull();
      expect(classDetail.isConnected).toBe(true);
      // 关闭后焦点回到该课次的展开控件。
      expect(document.activeElement?.getAttribute("aria-controls")).toBe(expandedButton.getAttribute("aria-controls"));
      await act(async () => (classDetail.querySelector("[data-dashboard-inline-entry] > div > button") as HTMLButtonElement).click());
      expect(container.querySelector("[data-followup-inline-details]")).toBeNull();
      expect(document.activeElement?.getAttribute("aria-controls")).toBe("teaching-class-details-class");
    } finally { await act(async () => root.unmount()); container.remove(); }
  });

  it.each([undefined, "grade", "teacher"] as const)("shares Enter, Esc and row navigation with %s grouping", async groupBy => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(records)));
    const data: TeachingClassOverview = { ...overview,
      workbench: { ...overview.workbench, sessions: [...overview.workbench.sessions, { ...overview.workbench.sessions[0], id: "second", title: "第二讲" }] },
      metrics: [...overview.metrics, { ...overview.metrics[0], sessionId: "second" }],
    };
    const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
    const keydown = async (target: Element, key: string, extra = {}) => {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra });
      await act(async () => target.dispatchEvent(event)); return event;
    };
    try {
      await act(async () => root.render(createElement(Provider, { locale: "zh", messages, timeZone: "Asia/Shanghai" }, createElement(TeachingClassOverviewTable, {
        data, locale: "zh", timeZone: "Asia/Shanghai", returnTo: "/dashboard/teaching?view=records", groupBy,
      }))));
      const parent = container.querySelector('[data-teaching-level="class"]')!;
      await keydown(parent, "Enter");
      const sessions = [...container.querySelectorAll('[data-teaching-level="session"]')];
      await keydown(parent, "ArrowDown"); expect(document.activeElement).toBe(sessions[0]);
      await keydown(sessions[0], "Enter");
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
      const detailId = sessions[0].getAttribute("aria-controls")!;
      const detail = document.getElementById(detailId)!;
      expect(detail).toBeTruthy();
      const cell = detail.querySelector("tbody td")!;
      await act(async () => cell.dispatchEvent(new Event("pointerdown", { bubbles: true })));
      expect(sessions[0].getAttribute("data-followup-active")).toBe("true");
      expect(parent.getAttribute("data-followup-active")).toBe("true");
      await keydown(cell, "ArrowDown"); expect(document.activeElement).toBe(sessions[1]);
      await keydown(sessions[1], "ArrowUp"); expect(document.activeElement).toBe(sessions[0]);
      await keydown(sessions[0], "Escape");
      expect(document.getElementById(detailId)).toBeNull();
      expect(parent.getAttribute("aria-expanded")).toBe("true");
      await keydown(sessions[0], "ArrowUp"); expect(document.activeElement).toBe(parent);
      const input = document.createElement("input"); parent.querySelector("td")!.append(input);
      expect((await keydown(input, "ArrowDown")).defaultPrevented).toBe(false);
      const overlay = document.createElement("div"); overlay.setAttribute("role", "listbox"); parent.querySelector("td")!.append(overlay);
      expect((await keydown(overlay, "Escape")).defaultPrevented).toBe(false);
      expect((await keydown(parent, "Enter", { isComposing: true })).defaultPrevented).toBe(false);
      await keydown(parent, "Escape");
      expect(container.querySelectorAll('[data-teaching-level="session"]')).toHaveLength(0);
      expect(parent.getAttribute("aria-selected")).toBe("false");
    } finally { await act(async () => root.unmount()); container.remove(); }
  });

  it("cancels on lesson changes and closing, ignores late responses, and retries in place", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const requests: { signal: AbortSignal; resolve: (response: Response) => void }[] = [];
    const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>(resolve => requests.push({ signal: init.signal as AbortSignal, resolve })));
    vi.stubGlobal("fetch", fetcher);
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    const cache: TeachingRecordCache = new Map();
    const show = (sessionId: string) => act(async () => root.render(createElement(Provider, { locale: "zh", messages, timeZone: "Asia/Shanghai" },
      createElement(TeachingInlineRecords, { sessionId, locale: "zh", timeZone: "Asia/Shanghai", cache }))));
    try {
      await show("first");
      await show("second");
      expect(requests[0].signal.aborted).toBe(true);
      await act(async () => requests[1].resolve(Response.json({ ...records, contacts: [{ ...records.contacts[0], content: "第二课次正文" }] })));
      await act(async () => requests[0].resolve(Response.json(records)));
      expect(container.textContent).toContain("第二课次正文");
      expect(container.textContent).not.toContain("保存的沟通正文");
      await show("third");
      await act(async () => requests[2].resolve(Response.json({}, { status: 503 })));
      expect(container.querySelector('[role="alert"]')).toBeTruthy();
      await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "重新读取")!.click());
      expect(requests).toHaveLength(4);
      expect(container.querySelector('[role="status"]')).toBeTruthy();
      await act(async () => root.render(null));
      expect(requests[3].signal.aborted).toBe(true);
      await act(async () => requests[3].resolve(Response.json(records)));
      expect(cache.size).toBe(1);
    } finally { await act(async () => root.unmount()); container.remove(); }
  });

  it("expires page-scoped cache and keeps failed or cancelled requests out of it", async () => {
    const cache: TeachingRecordCache = new Map();
    const query = { sessionId: "session", contactPage: 1, pageSize: 20 as const };
    let now = 1000; vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetcher = vi.fn().mockResolvedValue(Response.json(records)); vi.stubGlobal("fetch", fetcher);
    await readTeachingInlineRecords(cache, "zh", query, new AbortController().signal);
    await readTeachingInlineRecords(cache, "zh", query, new AbortController().signal);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 30001;
    fetcher.mockResolvedValueOnce(Response.json(records));
    await readTeachingInlineRecords(cache, "zh", query, new AbortController().signal);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const controller = new AbortController();
    fetcher.mockImplementationOnce(async () => { controller.abort(); return Response.json(records); });
    await expect(readTeachingInlineRecords(cache, "zh", { ...query, contactPage: 2 }, controller.signal)).rejects.toThrow();
    expect(cache.size).toBe(1);
    fetcher.mockResolvedValueOnce(Response.json({ code: "UNAVAILABLE" }, { status: 503 }));
    await expect(readTeachingInlineRecords(cache, "zh", { ...query, contactPage: 2 }, new AbortController().signal)).rejects.toThrow();
    expect(cache.size).toBe(1);
    for (let page = 2; page <= 12; page++) {
      fetcher.mockResolvedValueOnce(Response.json(records));
      await readTeachingInlineRecords(cache, "zh", { ...query, contactPage: page }, new AbortController().signal);
    }
    expect(cache.size).toBe(8);
  });
});
