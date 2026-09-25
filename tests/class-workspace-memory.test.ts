// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardPreferenceScope } from "@/features/school/dashboard-page/DashboardPreferenceScope";
import { ClassWorkspaceEntry, ClassWorkspaceMemory } from "@/features/school/ClassWorkspaceMemory";
import { classWorkspacePreference, rememberedClassWorkspaceHref } from "@/features/school/class-workspace-preferences";
import type { WorkEntryQuery } from "@/features/school/work-entry-contract";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => router }));
vi.mock("next-intl", () => ({ useLocale: () => "zh", useTranslations: () => (key: string) => key }));
vi.mock("@/features/school/dashboard-page/DashboardPage", () => ({ DashboardPage: ({ children }: { children: ReactNode }) => children }));

let root: Root, container: HTMLDivElement;
const key = (user: string) => `mathin:dashboard:v1:${user}:workspace-entry:classes`;
const render = async (children: ReactNode, userId = "teacher-a") => {
  const props = { userId, children };
  await act(async () => root.render(createElement(DashboardPreferenceScope, props)));
};
const remember = (query: WorkEntryQuery) => createElement(ClassWorkspaceMemory, { query });

describe("class workspace selection memory", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear(); vi.clearAllMocks();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

  it("uses the roster default on first entry without overwriting a stored choice", async () => {
    await render(createElement(ClassWorkspaceEntry));
    expect(router.replace).toHaveBeenLastCalledWith("/dashboard/classes?view=arrange");
    expect(localStorage.getItem(key("teacher-a"))).toBeNull();
  });

  it("restores scope, grouping, term and column choices separately for teachers and other staff", async () => {
    const fields = JSON.stringify({ version: 2, filters: { grade: { kind: "enum", values: ["4"] } }, sort: { field: "classroom", direction: "desc" } });
    await render(remember({ view: "arrange", scope: "all", group: "teacher", term: "spring", q: "test", fields }));
    expect(router.replace).not.toHaveBeenCalled();
    await render(createElement(ClassWorkspaceEntry));
    let saved = new URL(router.replace.mock.lastCall![0], "http://local.test").searchParams;
    expect(Object.fromEntries(saved)).toEqual({ view: "arrange", scope: "all", group: "teacher", term: "spring", q: "test", fields });
    await render(createElement(ClassWorkspaceEntry), "manager-b");
    expect(router.replace).toHaveBeenLastCalledWith("/dashboard/classes?view=arrange");
    await render(remember({ view: "directory", scope: "support", grade: "5" }), "manager-b");
    await render(createElement(ClassWorkspaceEntry), "manager-b");
    saved = new URL(router.replace.mock.lastCall![0], "http://local.test").searchParams;
    expect(Object.fromEntries(saved)).toEqual({ view: "directory", scope: "support", grade: "5" });
    expect(JSON.parse(localStorage.getItem(key("teacher-a"))!)).toContain("scope=all");
  });

  it("remembers cleared filters and the last auxiliary view", async () => {
    await render(remember({ view: "arrange", scope: "mine", q: "previous", term: "autumn" }));
    await render(remember({ view: "arrange", scope: "all", term: "all" }));
    await render(createElement(ClassWorkspaceEntry));
    expect(router.replace).toHaveBeenLastCalledWith("/dashboard/classes?view=arrange&scope=all&term=all");
    await render(remember({ view: "progress", period: "week", date: "2026-09-21", teacher: "teacher-a" }));
    await render(createElement(ClassWorkspaceEntry));
    expect(router.replace).toHaveBeenLastCalledWith("/dashboard/classes?view=progress&period=week&date=2026-09-21&teacher=teacher-a");
  });

  it("lets explicit lesson and student links keep their destination without replacing the previous choice", async () => {
    await render(remember({ view: "arrange", scope: "mine", group: "teacher" }));
    const previous = localStorage.getItem(key("teacher-a"));
    for (const focus of [{ session: "lesson-a" }, { student: "student-a" }, { replay: "record-a" }]) {
      await render(remember({ view: "arrange", scope: "all", term: "spring", ...focus }));
      expect(localStorage.getItem(key("teacher-a"))).toBe(previous);
    }
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("handles unavailable or malformed storage and restores only class workspace choices", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    await render(createElement(ClassWorkspaceEntry));
    expect(router.replace).toHaveBeenLastCalledWith("/dashboard/classes?view=arrange");
    for (const raw of ["bad json", JSON.stringify({ view: "progress" }), JSON.stringify("https://example.com"), JSON.stringify("//example.com")]) {
      expect(rememberedClassWorkspaceHref(raw)).toBe("/dashboard/classes?view=arrange");
    }
    const saved = classWorkspacePreference({ view: "records", scope: "all", group: "grade", state: "historical", page: "4", next: "https://example.com" });
    expect(rememberedClassWorkspaceHref(JSON.stringify(saved))).toBe("/dashboard/classes?view=arrange&scope=all&group=grade");
  });
});
