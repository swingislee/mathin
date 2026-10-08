// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- WeChat supplies ambient types, not an importable runtime module.
/// <reference path="../apps/parent-wechat/node_modules/miniprogram-api-typings/index.d.ts" />
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { CatalogClass, CourseOffer } from "../contracts/parent-api/portal";
import { activityCard, filterActivityOffers } from "../apps/parent-wechat/miniprogram/lib/activity-catalog";
import type { ActivityOffer } from "../contracts/participant-api/portal";
import type { ActivityRequestCommand } from "../contracts/participant-api/portal";

const room: CatalogClass = { id: "class-a", name: "A class", familyId: "family", familyTitle: "Logic", courseId: "course", grade: 4, subject: "逻辑思维", level: "A", termId: "fall", termName: "秋季",
  campusId: "campus-a", campusName: "东校区", roomName: "101", remaining: 3, teachers: [{ id: "teacher-a", name: "Teacher A" }],
  sessions: [{ at: "2030-10-03T00:30:00Z", duration: 150 }, { at: "2030-10-10T00:30:00Z", duration: 150 }] };
const classOffer: CourseOffer = { id: room.id, kind: "class", activity: null, title: "真实班级", description: "", priceCents: null, bookingClosesAt: "2030-12-01T00:00:00Z", revision: 1, classes: [room] };
const offer: ActivityOffer = { ...classOffer, id: "activity-a", kind: "activity", title: "公益讲座", topic: null,
  activity: { id: "activity-a", targetStages: [4], location: "活动室", startsAt: "2030-10-03T00:30:00Z", durationMinutes: 60, remaining: null } };
describe("published Mini Program activities", () => {
  it("shows only activities for the selected grade and registration period", () => {
    expect(filterActivityOffers([classOffer as unknown as ActivityOffer, offer], "g4", "", 0)).toEqual([offer]);
    expect(filterActivityOffers([offer], "g3", "", 0)).toEqual([]);
    expect(filterActivityOffers([offer], "", "", Date.parse("2031-01-01"))).toEqual([]);
  });
  it("keeps an unknown target grade distinct from an unrestricted activity", () => {
    const unknown = { ...offer, activity: { ...offer.activity!, targetStages: null } };
    const unrestricted = { ...offer, activity: { ...offer.activity!, targetStages: [] } };
    expect(filterActivityOffers([unknown], "g4", "", 0)).toEqual([]);
    expect(filterActivityOffers([unrestricted], "g4", "", 0)).toEqual([unrestricted]);
    expect(activityCard(offer, "zh")).toMatchObject({ priceLabel: "公益活动", startLabel: "2030.10.03", meta: "活动室" });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
class TestApiError extends Error { constructor(public code: string) { super(code); } }
function selectionPage(command: (input: ActivityRequestCommand) => Promise<{ id?: string }>, modal: Promise<{ confirm: boolean }>) {
  type SelectionPage = { data: Record<string, unknown>; setData: (patch: Record<string, unknown>) => void; submit: () => Promise<void>; onHide: () => void };
  let page!: SelectionPage;
  const storage = new Map<string, unknown>();
  const wx = { getAppBaseInfo: () => ({ language: "zh_CN" }), getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key),
    showModal: vi.fn(() => modal) };
  const api = { ApiError: TestApiError, activityCommand: command, requestId: vi.fn(() => "stable-request"), session: () => ({}) };
  const root = path.resolve("apps/parent-wechat/miniprogram");
  const cache = new Map<string, Record<string, unknown>>();
  function load(file: string): Record<string, unknown> {
    if (file === path.join(root, "lib/api.ts")) return api;
    const existing = cache.get(file); if (existing) return existing;
    const exports: Record<string, unknown> = {}; cache.set(file, exports);
    const compiled = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS } });
    vm.runInNewContext(compiled.outputText, { exports, wx, console, Date,
      require: (relative: string) => load(path.resolve(path.dirname(file), relative + ".ts")),
      Page: (value: SelectionPage) => { page = value; page.setData = patch => Object.assign(page.data, patch); } });
    return exports;
  }
  load(path.join(root, "pages/activity-signup/index.ts"));
  page.setData({ authenticated: true, accountId: "account-a", offer, id: offer.id, participants: [{ id: "child-a", name: "Child A" }], selected: 0 });
  return { page, storage, api, wx };
}
describe("activity application submission", () => {
  it("locks submission while the confirmation dialog is open", async () => {
    const modal = deferred<{ confirm: boolean }>(); const result = deferred<{ id: string }>();
    const post = vi.fn(() => result.promise); const run = selectionPage(post, modal.promise);
    const first = run.page.submit(); await run.page.submit();
    expect(run.wx.showModal).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
    modal.resolve({ confirm: true });
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith({ action: "apply", kind: "activity", id: "stable-request", publicationId: offer.id, revision: offer.revision, participantId: "child-a" });
    result.resolve({ id: "stable-request" }); await first;
    expect(run.page.data.sent).toBe(true); expect(run.storage.size).toBe(0);
  });
  it("retries the same application identity after an unknown network outcome", async () => {
    const post = vi.fn().mockRejectedValueOnce(new TestApiError("NETWORK")).mockResolvedValueOnce({ id: "stable-request" });
    const run = selectionPage(post, Promise.resolve({ confirm: true }));
    await run.page.submit();
    const pending = run.page.data.pending;
    expect(pending).toMatchObject({ id: "stable-request", participantId: "child-a" });
    expect(run.storage.size).toBe(1);
    await run.page.submit();
    expect(post.mock.calls[0][0]).toEqual(post.mock.calls[1][0]);
    expect(run.api.requestId).toHaveBeenCalledTimes(1); expect(run.wx.showModal).toHaveBeenCalledTimes(1);
    expect(run.storage.size).toBe(0); expect(run.page.data.sent).toBe(true);
  });
  it("does not submit if the page changes before dialog confirmation", async () => {
    const modal = deferred<{ confirm: boolean }>(); const post = vi.fn(); const run = selectionPage(post, modal.promise);
    const pending = run.page.submit(); run.page.onHide(); modal.resolve({ confirm: true }); await pending;
    expect(post).not.toHaveBeenCalled(); expect(run.storage.size).toBe(0); expect(run.page.data.busy).toBe(false);
  });
});
