// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RosterPanel } from "@/features/school/RosterPanel";
import zh from "../messages/zh.json";
import en from "../messages/en.json";

const actions = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn(), error: vi.fn() }));
vi.mock("@/features/school/actions/followups", () => ({ addStudentFollowUp: actions.save }));
vi.mock("@/features/school/actions/classes", () => ({ enrollStudentAction: vi.fn(), listClassroomOptions: vi.fn(), searchStudentsForEnroll: vi.fn(), transferStudentAction: vi.fn(), withdrawStudentAction: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, ...props }: ComponentProps<"a">) => createElement("a", props, children), useRouter: () => ({ refresh: actions.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: actions.error } }));

let root: Root, container: HTMLDivElement;
const roster = ["student-a", "student-b", "student-c"].map(studentId => ({ studentId, studentName: studentId, enrollmentId: `membership-${studentId}`, status: "active", hasAccount: false, isMember: false }));
const mount = async (locale: "zh" | "en" = "zh", canWriteFollowup = true) => {
  const children = createElement(RosterPanel, { classroomId: "class-a", roster, canManage: false, viewerRole: "teacher", signals: {}, returnTo: "/dashboard/classes/class-a?tab=students", canWriteFollowup,
    latestFollowUps: { "student-a": { content: "Previously saved note", createdAt: "2026-09-01T00:00:00Z" } } });
  const props: ComponentProps<typeof NextIntlClientProvider> = { locale, messages: locale === "zh" ? zh : en, timeZone: "Asia/Shanghai", children };
  await act(async () => root.render(createElement(NextIntlClientProvider, props)));
};
const detail = (student: string) => container.querySelector<HTMLDivElement>(`#roster-followup-class-a-${student}`)!;
const trigger = (student: string) => container.querySelector<HTMLButtonElement>(`#roster-followup-class-a-${student}-trigger`)!;
const click = async (element: HTMLElement) => { await act(async () => element.click()); };
const fill = async (student: string, value: string) => {
  const textarea = detail(student).querySelector("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
};
const saveNext = (student: string, locale: "zh" | "en" = "zh") => [...detail(student).querySelectorAll<HTMLButtonElement>("button")]
  .find(button => button.textContent === (locale === "zh" ? zh : en).school.quickFollowUp.saveAndNext)!;

describe("class roster reuses quick follow-up entry", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal("crypto", { randomUUID: undefined });
    vi.clearAllMocks(); actions.save.mockResolvedValue({ ok: true });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

  it.each(["zh", "en"] as const)("saves to the selected student and advances after success in %s", async locale => {
    await mount(locale); expect(container.textContent).toContain("Previously saved note");
    await click(trigger("student-a")); await fill("student-a", "Classroom observation and parent feedback");
    await click(saveNext("student-a", locale));
    expect(actions.save).toHaveBeenCalledExactlyOnceWith("student-a", { content: "Classroom observation and parent feedback", kind: "note", nextFollowUpAt: null, statusAfter: null });
    expect(detail("student-a").hidden).toBe(true); expect(detail("student-b").hidden).toBe(false);
    expect(detail("student-b").querySelector("textarea")!.value).toBe("");
    expect(container.textContent).toContain("Classroom observation and parent feedback");
  });

  it("keeps unsaved drafts when switching students or closing the entry", async () => {
    await mount(); await click(trigger("student-a")); await fill("student-a", "Draft A");
    await click(trigger("student-b")); await fill("student-b", "Draft B");
    await click(trigger("student-b")); await click(trigger("student-a"));
    expect(detail("student-a").querySelector("textarea")!.value).toBe("Draft A");
    expect(detail("student-b").querySelector("textarea")!.value).toBe("Draft B");
    expect(actions.save).not.toHaveBeenCalled();
  });

  it("keeps the current student and draft after a failed save", async () => {
    actions.save.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    await mount(); await click(trigger("student-a")); await fill("student-a", "Keep for retry");
    await click(saveNext("student-a"));
    expect(detail("student-a").hidden).toBe(false); expect(detail("student-a").querySelector("textarea")!.value).toBe("Keep for retry");
    expect(trigger("student-b").getAttribute("aria-expanded")).toBe("false");
    expect(actions.error).toHaveBeenCalled();
  });

  it("keeps a manually selected student when an earlier save finishes", async () => {
    let finish!: (result: { ok: true }) => void;
    actions.save.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await mount(); await click(trigger("student-a")); await fill("student-a", "For A only");
    await click(saveNext("student-a")); await click(trigger("student-c"));
    await act(async () => finish({ ok: true }));
    expect(trigger("student-c").getAttribute("aria-expanded")).toBe("true");
    expect(actions.save.mock.calls[0][0]).toBe("student-a");
  });

  it("shows the saved summary without a write control for a read-only viewer", async () => {
    await mount("zh", false);
    expect(container.textContent).toContain("Previously saved note");
    expect(container.querySelector("button[aria-expanded],textarea")).toBeNull();
  });
});
