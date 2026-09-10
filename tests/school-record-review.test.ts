// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SchoolRecordSourceReview } from "@/features/school/SchoolRecordSourceReview";
import { PossibleDuplicateBadge } from "@/features/school/PossibleDuplicateBadge";
import { schoolRecordContextSchema, type SchoolRecordContext } from "@/features/school/school-record-review-contract";

const actions = vi.hoisted(() => ({ read: vi.fn(), open: vi.fn() }));
vi.mock("@/features/school/actions/school-record-review", () => ({ getSchoolRecordContextAction: actions.read }));
vi.mock("@/features/school/Student360Sheet", () => ({ Student360Trigger: ({ children, subject }: { children: ReactNode; subject: unknown }) =>
  createElement("button", { onClick: () => actions.open(subject) }, children) }));
const subject = { studentId: "11111111-1111-1111-1111-111111111111", leadId: null };
const candidate = { studentId: null, leadId: "22222222-2222-2222-2222-222222222222", name: "同名学生", phone: "13800001234", grade: null, school: "" };
const record = { id: "source-one", table: "原始获客表", source: "original.base", date: "2024-09-10", association: "linked" as const,
  cells: [{ id: "date", name: "获取日期", text: "2024/09/10", type: "DateTime" },
    { id: "future", name: "以后新增字段", text: "第一行\n原文第二行", type: "Text" }] };
const data: SchoolRecordContext = { candidates: [candidate], sources: [record, { ...record, id: "source-two", table: "另一张原表",
  cells: [{ id: "date", name: "获取日期", text: "2025/03/01", type: "DateTime" }] }], sourceCount: 2, page: 1, pageSize: 10 };
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.clearAllMocks(); actions.read.mockResolvedValue({ ok: true, data });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const click = async (text: string) => {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(element => element.textContent?.includes(text));
  expect(button, text).toBeDefined(); await act(async () => button!.click());
};

describe("source fields and duplicate hints", () => {
  it("reads on demand and retains separate original values and unknown fields", async () => {
    expect(schoolRecordContextSchema.parse(data)).toEqual(data);
    await act(async () => root.render(createElement(SchoolRecordSourceReview, { subject, locale: "zh" })));
    expect(actions.read).not.toHaveBeenCalled();
    await click("查看原表资料与相关记录");
    expect(actions.read).toHaveBeenCalledExactlyOnceWith({ subject, page: 1 });
    expect(document.body.textContent).toContain("可能重复");
    expect(document.body.textContent).toContain("以后新增字段");
    expect(document.body.textContent).toContain("第一行\n原文第二行");
    await click("另一张原表");
    expect(document.body.textContent).toContain("2024/09/10");
    expect(document.body.textContent).toContain("2025/03/01");
    expect(actions.open).not.toHaveBeenCalled();
    await click("查看记录");
    expect(actions.open).toHaveBeenCalledExactlyOnceWith(candidate);
  });
  it("keeps an explicit retry and bilingual labels when a read fails", async () => {
    actions.read.mockResolvedValueOnce({ ok: false, error: { code: "FORBIDDEN" } });
    await act(async () => root.render(createElement(SchoolRecordSourceReview, { subject, locale: "en" })));
    await click("View original fields and related records");
    expect(document.querySelector("[role=alert]")?.textContent).toContain("Could not load");
    await click("Retry");
    expect(actions.read).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("Possible duplicate");
    expect(document.body.textContent).toContain("These records stay separate");
  });
  it("only opens the existing record when a duplicate badge is selected", async () => {
    await act(async () => root.render(createElement(PossibleDuplicateBadge, { count: 0, subject, name: "学生", locale: "zh" })));
    expect(container.textContent).toBe("");
    await act(async () => root.render(createElement(PossibleDuplicateBadge, { count: 2, subject, name: "学生", locale: "zh" })));
    expect(actions.read).not.toHaveBeenCalled(); expect(actions.open).not.toHaveBeenCalled();
    await click("可能重复"); expect(actions.open).toHaveBeenCalledExactlyOnceWith(subject);
  });
});
