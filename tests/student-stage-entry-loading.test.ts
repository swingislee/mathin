// @vitest-environment jsdom
import { act, createElement, createRef, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import zh from "../messages/zh.json";
import { StudentStageEntryLoader } from "@/features/school/StudentStageEntryLoader";
import type { StudentStageRow } from "@/features/school/student-stage-contract";

const actions = vi.hoisted(() => ({ subject: vi.fn(), options: vi.fn(), save: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, ...props }: ComponentProps<"a">) => createElement("a", props, children) }));
vi.mock("@/features/school/student-stage-actions", () => ({ getStudentStageSubjectAction: actions.subject,
  getStudentStageOptionsAction: actions.options, saveStudentStageEntryAction: actions.save }));
const id = "00000000-0000-4000-8000-000000000012";
const full: StudentStageRow = { key: `lead:${id}`, studentId: null, leadId: id, name: "示例", phone: "", grade: null, gradeText: "",
  ownerId: "actor", ownerName: "", stage: "awaiting_first_contact", detail: "not_contacted", note: "", lastContactAt: null, nextContactAt: "2026-10-01T02:00:00Z",
  score: null, assessmentBand: null, assessmentAt: null, registrationId: null, courseTitle: "", termName: "", courseId: null, termId: null,
  createdAt: "2026-09-08T00:00:00Z", canWrite: true, canContact: true,
  invitation: { id, leadId: id, updatedAt: "2026-09-08T00:00:00Z", kind: "assessment_1v1", state: "confirmed", activityId: null, assessorId: null,
    parentTimeOptions: [], assessorTimeOptions: [], scheduledAt: "2026-10-01T03:00:00Z", locationText: "", nextContactAt: null } };
const light = { ...full, nextContactAt: null, invitation: null, detailLoaded: false as const };
let root: Root, container: HTMLDivElement;
const ref = createRef<{ save: () => void }>();
const outcomeRequest = { value: "unreachable" as const };
async function render(row: StudentStageRow = light) {
  const props: ComponentProps<typeof StudentStageEntryLoader> = { row, locale: "zh", currentUserId: "actor", requestedMode: "contact", canEnroll: false,
    onSaved: vi.fn(), onBusyChange: vi.fn(), canAdvance: false, outcomeRequest, ref };
  const provider = { locale: "zh", messages: zh, timeZone: "Asia/Shanghai", children: createElement(StudentStageEntryLoader, props) };
  await act(async () => root.render(createElement(NextIntlClientProvider, provider)));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks(); sessionStorage.clear();
  actions.save.mockResolvedValue({ ok: false, code: "INVITATION_CONFLICT" });
  actions.subject.mockResolvedValue({ ok: true, data: full });
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => ({
    ok: true, json: async () => actions.subject(JSON.parse(init.body as string)),
  })));
  actions.options.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("student entry loads complete context before initializing a draft", () => {
  it("uses an independent cancellable request and retains detail across parent renders", async () => {
    await render();
    const entry = container.querySelector("[data-student-stage-entry]");
    await render({ ...light });
    expect(container.querySelector("[data-student-stage-entry]")).toBe(entry);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/zh/dashboard/students/entry-detail", expect.objectContaining({
      method: "POST", cache: "no-store", credentials: "same-origin", signal: expect.any(AbortSignal),
    }));
    const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
    await render({ ...light, key: "another", leadId: "another" });
    expect(signal.aborted).toBe(true);
  });
  it("waits for reminder and invitation versions, then saves without preloading business options", async () => {
    let resolve!: (value: { ok: true; data: StudentStageRow }) => void;
    actions.subject.mockImplementationOnce(() => new Promise(value => { resolve = value; }));
    await render();
    expect(container.querySelector("[data-student-stage-entry]")).toBeNull();
    expect(sessionStorage.getItem(`mathin:student-stage:v1:actor:${full.key}`)).toBeNull();
    await act(async () => resolve({ ok: true, data: full }));
    expect(container.querySelector("[data-student-stage-entry]")).not.toBeNull();
    expect(actions.options).not.toHaveBeenCalled();
    await act(async () => ref.current?.save());
    expect(actions.save.mock.calls[0][1]).toMatchObject({ nextContactAt: full.nextContactAt, expectedInvitationId: id,
      expectedInvitationUpdatedAt: full.invitation!.updatedAt });
    const updated = { ...full, invitation: { ...full.invitation!, updatedAt: "2026-09-08T01:00:00Z" } };
    await render(updated);
    await act(async () => ref.current?.save());
    expect(actions.save.mock.calls[1][1].expectedInvitationUpdatedAt).toBe(updated.invitation.updatedAt);
  });
  it("keeps a saved local draft when the full row arrives", async () => {
    const storageKey = `mathin:student-stage:v1:actor:${full.key}`;
    sessionStorage.setItem(storageKey, JSON.stringify({ requestId: id, note: "未提交备注", nextContactAt: "2026-10-02T02:00:00Z",
      outcome: "unreachable", wechatAdded: null, interestLevel: null, invitation: null, courseId: "", termId: "", result: "considering", paymentEvidence: "" }));
    await render(); await act(async () => ref.current?.save());
    expect(actions.save.mock.calls[0][1]).toMatchObject({ note: "未提交备注", nextContactAt: "2026-10-02T02:00:00Z", expectedInvitationId: id });
    expect(JSON.parse(sessionStorage.getItem(storageKey)!).note).toBe("未提交备注");
  });
  it("offers retry on failure and ignores a response from a previous student", async () => {
    actions.subject.mockRejectedValueOnce(new Error("NETWORK"));
    await render(); expect(container.querySelector('[role="alert"]')).not.toBeNull();
    let resolveOld!: (value: { ok: true; data: StudentStageRow }) => void;
    actions.subject.mockImplementationOnce(() => new Promise(value => { resolveOld = value; }));
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    const next = { ...full, key: "lead:next", leadId: "next", invitation: null };
    actions.subject.mockResolvedValueOnce({ ok: true, data: next });
    await render({ ...next, ...{ detailLoaded: false } });
    await act(async () => resolveOld({ ok: true, data: full }));
    expect(container.querySelector("[data-student-stage-entry]")?.getAttribute("data-student-stage-entry")).toBe(next.key);
    expect(sessionStorage.getItem(`mathin:student-stage:v1:actor:${full.key}`)).toBeNull();
  });
});
