/// <reference path="../apps/parent-wechat/node_modules/miniprogram-api-typings/index.d.ts" />
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { CatalogClass, CourseOffer } from "../contracts/parent-api/portal";
import { classTimeGrid, classTimes, courseCard, filterCourseOffers, matchingClasses } from "../apps/parent-wechat/miniprogram/lib/course-catalog";
import type { CourseApplicationCommand } from "../contracts/parent-api/portal";

const room: CatalogClass = { id: "class-a", name: "A class", familyId: "family", familyTitle: "Logic", courseId: "course", grade: 4, subject: "逻辑思维", level: "A", termId: "fall", termName: "秋季",
  campusId: "campus-a", campusName: "东校区", roomName: "101", remaining: 3, teachers: [{ id: "teacher-a", name: "Teacher A" }],
  sessions: [{ at: "2030-10-03T00:30:00Z", duration: 150 }, { at: "2030-10-10T00:30:00Z", duration: 150 }] };
const offer: CourseOffer = { id: room.id, kind: "class", activity: null, title: "真实班级", description: "", priceCents: null, bookingClosesAt: "2030-12-01T00:00:00Z", revision: 1, classes: [room] };
describe("published course selection", () => {
  it("filters actual grades, subjects and terms without an activity-kind alias", () => {
    expect(filterCourseOffers([offer], "g4", "逻辑思维", "fall", 0)).toEqual([offer]);
    expect(filterCourseOffers([offer], "g3", "", "", 0)).toEqual([]);
    expect(filterCourseOffers([offer], "g4", "math", "", 0)).toEqual([]);
    expect(filterCourseOffers([offer], "", "", "spring", 0)).toEqual([]);
    expect(filterCourseOffers([offer], "", "", "", Date.parse("2031-01-01"))).toEqual([]);
  });
  it("keeps class identity when teachers and scheduled times match", () => {
    const second = { ...room, id: "class-b", name: "B class", remaining: 0 };
    const grid = classTimeGrid([room, second], "zh");
    expect(grid.days).toEqual([{ id: 4, label: "周四" }]);
    expect(grid.rows[0].time).toBe("08:30–11:00");
    expect(grid.rows[0].cells[0].choices.map(c => [c.id, c.full])).toEqual([["class-a", false], ["class-b", true]]);
    expect(classTimes(room, "zh")).toBe("周四 08:30–11:00");
  });
  it("does not invent teachers, schedules or prices for incomplete records", () => {
    const pending = { ...room, teachers: [], campusId: null, sessions: [] };
    expect(matchingClasses([pending], { level: "A", campus: "pending", teacher: "" })).toEqual([pending]);
    expect(matchingClasses([pending], { level: "A", campus: "pending", teacher: "teacher-a" })).toEqual([]);
    expect(classTimeGrid([pending], "zh").rows).toEqual([]);
    expect(courseCard({ ...offer, classes: [pending] }, "zh")).toMatchObject({ priceLabel: "线下缴费", startLabel: "开课时间待定" });
    expect(courseCard({ ...offer, priceCents: 0 }, "zh").priceLabel).toBe("线下缴费");
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
class TestApiError extends Error { constructor(public code: string) { super(code); } }
function selectionPage(command: (input: CourseApplicationCommand) => Promise<{ id?: string }>, modal: Promise<{ confirm: boolean }>) {
  type SelectionPage = { data: Record<string, unknown>; setData: (patch: Record<string, unknown>) => void; submit: () => Promise<void>; onHide: () => void };
  let page!: SelectionPage;
  const storage = new Map<string, unknown>();
  const wx = { getAppBaseInfo: () => ({ language: "zh_CN" }), getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key),
    showModal: vi.fn(() => modal) };
  const api = { ApiError: TestApiError, courseCommand: command, requestId: vi.fn(() => "stable-request"), session: () => ({}) };
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
  load(path.join(root, "pages/course-select/index.ts"));
  page.setData({ authenticated: true, accountId: "account-a", offer, id: offer.id, classId: room.id, participants: [{ id: "child-a", name: "Child A" }], selected: 0 });
  return { page, storage, api, wx };
}
describe("course application submission", () => {
  it("locks submission while the confirmation dialog is open", async () => {
    const modal = deferred<{ confirm: boolean }>(); const result = deferred<{ id: string }>();
    const post = vi.fn(() => result.promise); const run = selectionPage(post, modal.promise);
    const first = run.page.submit(); await run.page.submit();
    expect(run.wx.showModal).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
    modal.resolve({ confirm: true });
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith({ action: "apply", kind: "class", id: "stable-request", publicationId: offer.id, revision: offer.revision, classroomId: room.id, participantId: "child-a" });
    result.resolve({ id: "stable-request" }); await first;
    expect(run.page.data.sent).toBe(true); expect(run.storage.size).toBe(0);
  });
  it("retries the same application identity after an unknown network outcome", async () => {
    const post = vi.fn().mockRejectedValueOnce(new TestApiError("NETWORK")).mockResolvedValueOnce({ id: "stable-request" });
    const run = selectionPage(post, Promise.resolve({ confirm: true }));
    await run.page.submit();
    const pending = run.page.data.pending;
    expect(pending).toMatchObject({ id: "stable-request", participantId: "child-a", classroomId: room.id });
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
