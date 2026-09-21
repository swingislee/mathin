// @vitest-environment jsdom
import { act, createElement as h, Suspense, type ComponentProps, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import zh from "../messages/zh.json";
import en from "../messages/en.json";
import { StudentStageWorkspace } from "@/features/school/StudentStageWorkspace";
import type { StudentStage, StudentStageOptions, StudentStageRow } from "@/features/school/student-stage-contract";
import { communicationEntryMode } from "@/features/school/work-entry-contract";

const deps = vi.hoisted(() => ({
  subject: vi.fn(), options: vi.fn(), save: vi.fn(), refresh: vi.fn(), replace: vi.fn(),
  resetChunks: [] as Array<() => void>, releaseChunks: [] as Array<() => void>,
}));
vi.mock("server-only", () => ({}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/school/student-stage-actions", () => ({ saveStudentStageEntryAction: deps.save, assignStudentStageAction: vi.fn() }));
vi.mock("@/features/school/Student360Sheet", () => ({ Student360Trigger: ({ children }: { children: ReactNode }) => h("button", { type: "button" }, children) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, ...props }: ComponentProps<"a">) => h("a", props, children),
  useRouter: () => ({ replace: deps.replace, refresh: deps.refresh }), usePathname: () => "/dashboard/communication" }));
// 只延迟模块到达；保留 Next 真正的 lazy/Suspense 行为和实际详情组件。
vi.mock("next/dynamic", async () => {
  const dynamic = (await import("next/dist/shared/lib/app-dynamic")).default;
  return { default: (loader: () => Promise<ComponentType<Record<string, unknown>>>) => {
    let Component: ComponentType<Record<string, unknown>>;
    deps.resetChunks.push(() => {
      const chunk = Promise.withResolvers<void>();
      deps.releaseChunks.push(() => chunk.resolve());
      Component = dynamic(async () => { await chunk.promise; return loader(); });
    });
    return (props: Record<string, unknown>) => h(Component, props);
  } };
});

const ids = ["00000000-0000-4000-8000-000000000011", "00000000-0000-4000-8000-000000000012"];
const rowsFor = (stage: StudentStage): StudentStageRow[] => ids.map((id, i) => ({
  key: `student:${id}`, studentId: id, leadId: null, name: `Student ${i + 1}`, phone: "", grade: 3, gradeText: "",
  ownerId: "actor", ownerName: "Owner", stage, detail: "not_booked", note: "", lastContactAt: null, nextContactAt: null,
  score: null, assessmentBand: null, assessmentAt: null, registrationId: null, courseTitle: "", termName: "", courseId: null, termId: null,
  createdAt: "2026-09-21T00:00:00Z", canWrite: true, canContact: true, invitation: null,
}));
const optionsFor = (row: StudentStageRow): StudentStageOptions => ({ row, invitations: { activities: [], assessors: [] },
  enrollment: { courses: [], terms: [], classrooms: [] }, opportunities: [] });
let root: Root, container: HTMLDivElement;
const click = async (node: HTMLElement) => { await act(async () => node.click()); };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks(); deps.subject.mockReset(); deps.options.mockReset(); sessionStorage.clear();
  vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto), randomUUID: undefined });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  deps.releaseChunks = []; deps.resetChunks.forEach(reset => reset());
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => ({ ok: true, json: async () =>
    (url.endsWith("entry-options") ? deps.options : deps.subject)(JSON.parse(String(init.body))) })));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe.each(["zh", "en"])("communication inline loading in %s", locale => {
  it.each<StudentStage>(["awaiting_assessment", "awaiting_enrollment", "awaiting_renewal", "former_student"])(
    "keeps the table, focus and drafts through first module/data load, retry and row switching: %s", async stage => {
      const rows = rowsFor(stage), subject = Promise.withResolvers<{ ok: true; data: StudentStageRow }>();
      const options = Promise.withResolvers<{ ok: false; code: string }>();
      deps.subject.mockImplementation(({ studentId }: { studentId: string }) => ({ ok: true, data: rows.find(row => row.studentId === studentId)! }));
      deps.subject.mockImplementationOnce(() => subject.promise);
      deps.options.mockResolvedValue({ ok: true, data: optionsFor(rows[0]) });
      deps.options.mockImplementationOnce(() => options.promise);
      const props: ComponentProps<typeof StudentStageWorkspace> = { presentation: "communication",
        data: { rows: rows.map(row => ({ ...row, detailLoaded: false })), count: 2, page: 1, totalPages: 1, pageSize: 50, counts: { [stage]: 2 } },
        filters: { stage, scope: "all", detail: "", q: "", page: 1, pageSize: 50 }, locale, currentUserId: "actor", canEnroll: false,
        canAssign: false, assignees: [], actions: null, timeZone: "Asia/Shanghai" };
      await act(async () => root.render(h(NextIntlClientProvider, { locale, messages: locale === "en" ? en : zh, timeZone: "Asia/Shanghai",
        children: h(Suspense, { fallback: h("p", { "data-page-loading": true }, "Page loading") }, h(StudentStageWorkspace, props)) })));
      const table = container.querySelector("table")!, header = container.querySelector("h1")!;
      const summaries = [...container.querySelectorAll<HTMLElement>("[data-student-stage-row]")];
      const scroll = table.closest<HTMLElement>('[data-slot="table-container"]')!; scroll.scrollTop = 120;
      const stable = () => {
        expect(container.querySelector("[data-page-loading]")).toBeNull();
        expect(container.querySelector("table")).toBe(table); expect(container.querySelector("h1")).toBe(header);
        expect([...container.querySelectorAll("[data-student-stage-row]")]).toEqual(summaries);
        expect(scroll.scrollTop).toBe(120);
        expect(deps.replace).not.toHaveBeenCalled(); expect(deps.refresh).not.toHaveBeenCalled(); expect(deps.save).not.toHaveBeenCalled();
      };
      expect(fetch).not.toHaveBeenCalled();
      await act(async () => summaries[0].focus()); await click(summaries[0]); stable();
      expect(document.activeElement).toBe(summaries[0]);
      expect(container.querySelector('[data-followup-inline-details] [role="status"]')?.textContent).toBe(locale === "en" ? "Loading…" : "正在读取…");
      expect(fetch).not.toHaveBeenCalled();
      await act(async () => { deps.releaseChunks.forEach(release => release()); });
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      stable(); expect(container.querySelector("[data-student-stage-entry]")).toBeNull();
      await act(async () => subject.resolve({ ok: true, data: rows[0] })); stable();
      const firstDetail = summaries[0].nextElementSibling as HTMLElement;
      const note = firstDetail.querySelector("textarea")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(note, "Unsaved draft");
        note.dispatchEvent(new Event("input", { bubbles: true }));
      });
      if (["invitation", "enrollment"].includes(communicationEntryMode(rows[0]))) {
        expect(firstDetail.querySelector('[role="status"]')).not.toBeNull();
        await act(async () => options.resolve({ ok: false, code: "UNAVAILABLE" })); stable();
        const retry = [...firstDetail.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === (locale === "en" ? "Retry" : "重试"))!;
        await click(retry); stable(); expect(deps.options).toHaveBeenCalledTimes(2);
      } else expect(deps.options).not.toHaveBeenCalled();
      await act(async () => firstDetail.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
      expect(document.activeElement).toBe(summaries[1]);
      await click(summaries[1]); stable();
      expect(firstDetail.hidden).toBe(true); expect(note.value).toBe("Unsaved draft");
      await click(summaries[0]); stable();
      expect(firstDetail.hidden).toBe(false); expect(firstDetail.querySelector("textarea")).toBe(note); expect(note.value).toBe("Unsaved draft");
      expect(deps.subject).toHaveBeenCalledTimes(2);
      for (const [url, init] of vi.mocked(fetch).mock.calls) {
        expect(String(url)).toMatch(new RegExp(`^/${locale}/dashboard/students/entry-(detail|options)$`));
        expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", signal: expect.any(AbortSignal) });
      }
    },
  );
});
