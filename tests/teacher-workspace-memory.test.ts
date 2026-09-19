// @vitest-environment jsdom
import { act, createElement, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardPreferenceScope } from "@/features/school/dashboard-page/DashboardPreferenceScope";
import { TeacherWorkspaceEntry, TeacherWorkspaceMemory } from "@/features/school/TeacherWorkspaceMemory";
import { rememberedTeacherWorkspaceHref, teacherWorkspaceLocation, TEACHER_WORKSPACE_DEFAULTS } from "@/features/school/teacher-workspace-contract";

const navigation = vi.hoisted(() => ({ pathname: "/dashboard", query: "", router: { replace: vi.fn() } }));
vi.mock("@/i18n/navigation", () => ({ usePathname: () => navigation.pathname, useRouter: () => navigation.router }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(navigation.query) }));

let root: Root, container: HTMLDivElement;
const key = (user: string, workspace: string) => `mathin:dashboard:v1:${user}:workspace-entry:${workspace}`;
const render = async (children: ReactNode, userId = "teacher-a") => {
  const props: Parameters<typeof DashboardPreferenceScope>[0] = { userId, children };
  await act(async () => root.render(createElement(DashboardPreferenceScope, props)));
};
const enter = (workspace: "students" | "followups") => createElement(TeacherWorkspaceEntry, { workspace });
const remember = () => createElement(TeacherWorkspaceMemory);

describe("teacher workspace entry memory", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear(); vi.clearAllMocks(); navigation.pathname = "/dashboard"; navigation.query = "";
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

  it("opens renewal-stage students and class placement on the two first visits", async () => {
    await render(enter("students"));
    expect(navigation.router.replace).toHaveBeenLastCalledWith("/dashboard/students?stage=awaiting_renewal&scope=mine");
    await render(enter("followups"));
    expect(navigation.router.replace).toHaveBeenLastCalledWith("/dashboard/classes");
  });

  it("keeps the last student stage, page and field filters separate from the support worksheet", async () => {
    navigation.pathname = "/dashboard/students";
    navigation.query = new URLSearchParams({ stage: "awaiting_assessment", scope: "mine", page: "3", fields: '{"sort":null}' }).toString();
    const studentsHref = `${navigation.pathname}?${navigation.query}`;
    await render(remember());
    navigation.pathname = "/dashboard/renewals"; navigation.query = "cycle=cycle-a&state=current";
    const followupsHref = `${navigation.pathname}?${navigation.query}`;
    await render(remember());
    expect(navigation.router.replace).not.toHaveBeenCalled();
    await render(enter("students"));
    expect(navigation.router.replace).toHaveBeenLastCalledWith(studentsHref);
    await render(enter("followups"));
    expect(navigation.router.replace).toHaveBeenLastCalledWith(followupsHref);
  });

  it("preserves memory while a bare entry restores it and isolates each teacher account", async () => {
    localStorage.setItem(key("teacher-a", "students"), JSON.stringify("/dashboard/students?stage=awaiting_enrollment&page=2"));
    navigation.pathname = "/dashboard/students";
    const children = createElement(Fragment, null, remember(), enter("students"));
    await render(children);
    expect(navigation.router.replace).toHaveBeenLastCalledWith("/dashboard/students?stage=awaiting_enrollment&page=2");
    await render(children, "teacher-b");
    expect(navigation.router.replace).toHaveBeenLastCalledWith(TEACHER_WORKSPACE_DEFAULTS.students);
    expect(localStorage.getItem(key("teacher-a", "students"))).toContain("awaiting_enrollment");
    expect(localStorage.getItem(key("teacher-b", "students"))).toBeNull();
  });

  it("records an explicit worksheet without overriding its requested destination", async () => {
    localStorage.setItem(key("teacher-a", "followups"), JSON.stringify("/dashboard/classes"));
    navigation.pathname = "/dashboard/assessments"; navigation.query = "scope=mine&lead=temporary-focus";
    await render(remember());
    expect(navigation.router.replace).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(key("teacher-a", "followups"))!)).toBe("/dashboard/assessments?scope=mine");
  });

  it("keeps safe defaults when storage is unavailable or contains another workspace", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    await render(enter("students"));
    expect(navigation.router.replace).toHaveBeenLastCalledWith(TEACHER_WORKSPACE_DEFAULTS.students);
    for (const value of ["not json", JSON.stringify("https://example.com"), JSON.stringify("//example.com"), JSON.stringify("/dashboard/students?stage=awaiting_renewal")]) {
      expect(rememberedTeacherWorkspaceHref("followups", value)).toBe(TEACHER_WORKSPACE_DEFAULTS.followups);
    }
    expect(teacherWorkspaceLocation("/dashboard/students/student-a", "tab=history")).toBeNull();
    expect(teacherWorkspaceLocation("/dashboard/followups", "")).toBeNull();
  });
});
