// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import zh from "../messages/zh.json";
import en from "../messages/en.json";
import { StudentDirectoryWorkspace } from "@/features/school/StudentDirectoryWorkspace";
import { parseStudentDirectoryFilters, type StudentDirectoryCard, type StudentDirectoryData } from "@/features/school/student-directory-contract";

const navigation = vi.hoisted(() => ({ replace: vi.fn(), profile: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, ...props }: ComponentProps<"a">) => createElement("a", props, children), useRouter: () => ({ replace: navigation.replace }) }));
vi.mock("@/features/school/Student360Sheet", () => ({ Student360Trigger: ({ children, subject, ...props }: { children: ReactNode; subject: { studentId: string }; fallback: unknown; className: string }) => {
  return createElement("button", { className: props.className, type: "button", onClick: () => navigation.profile(subject.studentId) }, children);
} }));

const id = "00000000-0000-4000-8000-000000000011", nextId = "00000000-0000-4000-8000-000000000012";
const card: StudentDirectoryCard = { id, name: "样例甲", grade: 3, gradeText: "", phoneTail: "1234", stage: "awaiting_enrollment", detail: "assessed", canContact: true,
  assessment: { score: 80, band: "b_plus", at: "2026-09-18" }, groups: [{ id: "class-a", name: "第一班" }, { id: "class-b", name: "第二班" }] };
const data: StudentDirectoryData = { students: [card], count: 2, page: 1, totalPages: 2, pageSize: 20, groups: [], counts: {} };
let container: HTMLDivElement, root: Root;
const render = async (overrides: Partial<ComponentProps<typeof StudentDirectoryWorkspace>> = {}) => {
  const props = { data, filters: parseStudentDirectoryFilters({ scope: "mine", pageSize: "20" }), locale: "zh", canContact: true, actions: null, ...overrides };
  const provider = { locale: props.locale, messages: props.locale === "en" ? en : zh, timeZone: "Asia/Shanghai", children: createElement(StudentDirectoryWorkspace, props) };
  await act(async () => root.render(createElement(NextIntlClientProvider, provider)));
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("crypto", { randomUUID: undefined, getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("student directory interaction", () => {
  it("opens the shared profile and selects a multi-group student only once", async () => {
    await render();
    expect(container.querySelectorAll("[data-student-card]")).toHaveLength(2);
    expect(container.querySelector("table")).toBeNull();
    const first = container.querySelector<HTMLElement>("[data-student-card]")!;
    expect(first.textContent).toContain("1234"); expect(first.textContent).toContain("B+ · 80");
    await act(async () => first.querySelector<HTMLButtonElement>("button")!.click());
    expect(navigation.profile).toHaveBeenCalledWith(id);
    await act(async () => first.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
    expect(container.querySelectorAll('[data-student-card] [role="checkbox"][aria-checked="true"]')).toHaveLength(2);
    const href = container.querySelector<HTMLAnchorElement>('a[href^="/dashboard/communication?"]')!.href;
    expect(new URL(href).searchParams.get("students")).toBe(id);
    expect(container.textContent).toContain("已选 1");
    expect(navigation.replace).not.toHaveBeenCalled();
  });
  it("keeps selection across pages and sends the chosen order to communication", async () => {
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-student-card] [role="checkbox"]')!.click());
    await render({ data: { ...data, page: 2, students: [{ ...card, id: nextId, name: "样例乙", groups: [card.groups[0]] }] }, filters: parseStudentDirectoryFilters({ page: "2", pageSize: "20" }) });
    expect(container.textContent).toContain("其中不在本页 1");
    await act(async () => container.querySelector<HTMLButtonElement>('[data-student-card] [role="checkbox"]')!.click());
    const url = new URL(container.querySelector<HTMLAnchorElement>('a[href^="/dashboard/communication?"]')!.href);
    expect(url.searchParams.get("students")).toBe(`${id},${nextId}`);
    expect(url.searchParams.get("returnTo")).toContain("page=2");
  });
  it("supports English and keeps read-only profiles available without batch entry", async () => {
    await render({ locale: "en", canContact: false });
    expect(container.querySelector("h1")?.textContent).toBe("Students");
    expect(container.querySelector('[role="checkbox"]')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>("[data-student-card] button")!.click());
    expect(navigation.profile).toHaveBeenCalledWith(id);
  });
});
