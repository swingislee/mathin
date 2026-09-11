// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SchoolRecordSourceReview } from "@/features/school/SchoolRecordSourceReview";
import { PossibleDuplicateBadge } from "@/features/school/PossibleDuplicateBadge";
import { schoolRecordContextSchema, type SchoolRecordContext } from "@/features/school/school-record-review-contract";
import { organizeBaseRecord } from "../scripts/lib/base-business-fields.mjs";

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
  it.each(["zh", "en"])("reuses the inferred badge for a personal source excerpt in %s", async locale => {
    const excerpt = { ...record, id: "source-fragment:example", association: "inferred" as const,
      cells: [{ id: "arrangement", name: "活动安排", text: "示例甲 · 1年级 · 公开课 · 周六 10:00", type: "Text" }] };
    actions.read.mockResolvedValueOnce({ ok: true, data: { ...data, candidates: [], sources: [excerpt], sourceCount: 1 } });
    await act(async () => root.render(createElement(SchoolRecordSourceReview, { subject, locale })));
    await click(locale === "zh" ? "查看原表资料与相关记录" : "View original fields and related records");
    const badge = document.querySelector('[data-slot="badge"]');
    expect(badge?.textContent).toBe(locale === "zh" ? "资料关联待核对" : "Association to check");
    expect(document.body.textContent).toContain(excerpt.cells[0].text);
    expect(actions.open).not.toHaveBeenCalled();
  });
  it("shows the original alongside a normalized value and explains unresolved source values", async () => {
    const cells = [{ fieldId: "grade", fieldName: "年级/25级", text: "一", type: "Text", kind: "context" },
      { fieldId: "mixed", fieldName: "春季年级", text: "二升三", type: "Text", kind: "context" }];
    const structured = organizeBaseRecord({ id: record.id, source_data: { format: "feishu-base" }, record_data: { tableName: record.table, cells } })!;
    actions.read.mockResolvedValueOnce({ ok: true, data: { ...data, sources: [{ ...record, businessFields: structured.fields }] } });
    await act(async () => root.render(createElement(SchoolRecordSourceReview, { subject, locale: "zh" })));
    await click("查看原表资料与相关记录");
    const text = document.querySelector("[data-base-business-fields]")?.textContent;
    expect(text).toContain("1年级");
    expect(text).toContain("原文：一");
    expect(text).toContain("3年级");
    expect(text).toContain("原文：二升三");
    expect(text).not.toContain("请核对适用学年");
  });
  it.each(["zh", "en"])("shows split fields and individual children with their source in %s", async locale => {
    const cells = [{ fieldId: "school", fieldName: "就读学校", text: "合肥师范附小四小(四川路)\n一年级", type: "Text", kind: "context" },
      { fieldId: "children", fieldName: "年级/25级", text: "一年级 中班", type: "Text", kind: "context" },
      { fieldId: "address", fieldName: "年级", text: "水晶公馆", type: "Text", kind: "context" }];
    const structured = organizeBaseRecord({ id: record.id, source_data: { format: "feishu-base" }, record_data: { tableName: record.table, cells } })!;
    actions.read.mockResolvedValueOnce({ ok: true, data: { ...data, sources: [{ ...record, businessFields: structured.fields }] } });
    await act(async () => root.render(createElement(SchoolRecordSourceReview, { subject, locale })));
    await click(locale === "zh" ? "查看原表资料与相关记录" : "View original fields and related records");
    const fields = document.querySelector("[data-base-business-fields]")!;
    expect([...fields.querySelectorAll("dt")].map(item => item.textContent)).toContain(locale === "zh" ? "年级" : "Grade");
    expect(fields.textContent).toContain(locale === "zh" ? "孩子1（姓名：资料待补）：1年级" : "Child 1（Name：Details to complete）：1年级");
    expect(fields.textContent).toContain(locale === "zh" ? "孩子2（姓名：资料待补）：中班" : "Child 2（Name：Details to complete）：中班");
    expect(fields.textContent).toContain(locale === "zh" ? "共用家庭联系方式" : "share this family's contact details");
    expect(fields.textContent).not.toContain("信息待补");
    const acquisition = [...fields.querySelectorAll("section")].find(section => section.querySelector("h4")?.textContent === (locale === "zh" ? "获客资料" : "Acquisition"));
    expect(acquisition?.textContent).toContain("水晶公馆");
    expect(acquisition?.textContent).toContain(locale === "zh" ? "原文（年级）" : "Original（年级）");
    expect(actions.open).not.toHaveBeenCalled();
  });
  it("shows organized business fields with original values available in the same source record", async () => {
    const structured = organizeBaseRecord({ id: record.id, source_data: { format: "feishu-base" },
      record_data: { tableName: record.table, cells: record.cells.map(cell => ({ fieldId: cell.id, fieldName: cell.name, text: cell.text, type: cell.type, kind: "context" })) } })!;
    actions.read.mockResolvedValueOnce({ ok: true, data: { ...data, sources: [{ ...record, businessFields: structured.fields }] } });
    await act(async () => root.render(createElement(SchoolRecordSourceReview, { subject, locale: "zh" })));
    await click("查看原表资料与相关记录");
    expect(document.querySelector("[data-base-business-fields]")?.textContent).toContain("获客资料");
    expect(document.querySelector("[data-base-business-fields]")?.textContent).toContain("2024-09-10");
    expect(document.querySelector("[data-base-business-fields]")?.textContent).toContain("第一行\n原文第二行");
    await click("查看原字段");
    expect(document.querySelector("#source-fields-source-one-original")?.textContent).toContain("2024/09/10");
    expect(actions.read).toHaveBeenCalledTimes(1);
  });
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
