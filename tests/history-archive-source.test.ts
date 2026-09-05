import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { extractFeishuBase } from "../scripts/lib/history-archive-source.mjs";

const directories: string[] = [];
const textField = (name: string, isPrimary = false) => ({ name, isPrimary, type: 1, fieldUIType: "Text" });
const cell = (value: unknown) => ({ value, modifiedTime: 1000, modifiedUser: "synthetic-user" });
const rich = (text: string) => [{ type: "text", text }];
function snapshot(tableId: string, name: string, fields: Record<string, unknown>, rows: Record<string, unknown>) {
  return { schema: {
    base: { id: "synthetic-base", timezone: "Asia/Shanghai" }, tableMap: { [tableId]: { name } },
    data: { table: { meta: { id: tableId }, fieldMap: fields }, recordMap: rows,
      recordMeta: Object.fromEntries(Object.keys(rows).map((id) => [id, { recMeta: { createdTime: 1234 } }])) },
  } };
}
async function source(snapshots: unknown[], newline = "\n") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mathin-history-test-"));
  directories.push(directory);
  const file = path.join(directory, "synthetic.base");
  const json = JSON.stringify({ gzipSnapshot: gzipSync(JSON.stringify(snapshots)).toString("base64") }, null, 2);
  await writeFile(file, json.replace(/\n/g, newline), "utf8");
  return file;
}
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("Feishu 历史档案只读解析", () => {
  it("精确去重快照、保留不同版本，ID 可复现且不依赖路径和换行", async () => {
    const first = snapshot("table-a", "历史表", { name: textField("学员姓名", true) }, { row1: { name: cell(rich("合成学生甲")) } });
    const revised = structuredClone(first);
    revised.schema.data.recordMap = { row1: { name: cell(rich("合成学生乙")) } };
    const result = await extractFeishuBase(await source([first, first, revised]));
    const repeated = await extractFeishuBase(await source([first, first, revised], "\r\n"));
    expect(result.source).toEqual(repeated.source);
    expect(result.records.map((record) => record.id)).toEqual(repeated.records.map((record) => record.id));
    expect(result.records).toHaveLength(2);
    expect(new Set(result.records.map((record) => record.id)).size).toBe(2);
    expect(result.tables[0]).toMatchObject({ rowCount: 2, contentRowCount: 2 });
    expect(result.warnings).toContain("IDENTICAL_TABLE_SNAPSHOT_DEDUPLICATED:table-a");
    expect(result.warnings).toContain("MULTIPLE_TABLE_SNAPSHOTS_RETAINED:table-a:2");
  });

  it("完整保留富文本及原值，只从专用身份列提取号码和姓名", async () => {
    const narrative = `长记录\n${"历史内容".repeat(5000)}\n请联系 13900000000`;
    const row = {
      student: cell(rich("合成学生甲")), phone: cell({ fullPhoneNum: "+86 13800000000" }),
      masked: cell(rich("137****0000")), note: cell(rich(narrative)), teacher: cell(rich("合成老师乙")), group: cell({ fullPhoneNum: "13600000000" }),
      unknown: cell({ nested: { sourceValue: "完整保存" } }),
    };
    const result = await extractFeishuBase(await source([snapshot("table-a", "沟通表", {
      student: textField("学员姓名", true), phone: { name: "家长电话", type: 13, fieldUIType: "Phone" },
      masked: textField("手机号码"), note: textField("跟进信息"), teacher: textField("老师姓名"), group: { name: "团成员手机号", type: 13, fieldUIType: "Phone" },
    }, { row1: row })]));
    const record = result.records[0];
    expect(record.names).toEqual(["合成学生甲"]);
    expect(record.phones).toEqual(["13800000000"]);
    expect(record.cells.find((item) => item.fieldId === "note")).toMatchObject({ text: narrative, rawValue: row.note.value, kind: "narrative" });
    expect(record.cells.find((item) => item.fieldId === "unknown")?.rawValue).toEqual(row.unknown.value);
    expect(record.cells.find((item) => item.fieldId === "__cell_metadata")?.rawValue.note).toEqual({ modifiedTime: 1000, modifiedUser: "synthetic-user" });
    expect(record.warnings).toContain("FIELD_DEFINITION_MISSING:unknown");
  });

  it("将选择项、人员、关联和 lookup 转为可读值，并保留缺失关联", async () => {
    const option = { name: "状态", type: 3, fieldUIType: "SingleSelect", property: { options: [{ id: "opt1", name: "已沟通" }] } };
    const result = await extractFeishuBase(await source([
      snapshot("people", "学生", { name: textField("姓名", true), status: option }, { person1: { name: cell(rich("合成学生甲")), status: cell("opt1") } }),
      snapshot("history", "沟通", {
        status: option,
        user: { name: "负责人", type: 11, fieldUIType: "User" },
        person: { name: "关联学生", type: 18, fieldUIType: "SingleLink", property: { tableId: "people" } },
        missing: { name: "旧关联", type: 18, fieldUIType: "SingleLink", property: { tableId: "missing-table" } },
        lookup: { name: "查找状态", type: 19, fieldUIType: "Lookup", property: { tableId: "people", fieldId: "status" } },
      }, { h1: { status: cell("opt1"), user: cell({ users: [{ userId: "synth1", name: "合成员工甲" }] }), person: cell(["person1"]), missing: cell(["lost1"]), lookup: cell([{ value: "opt1" }]) } }),
    ]));
    const record = result.records.find((item) => item.tableId === "history")!;
    const text = Object.fromEntries(record.cells.map((item) => [item.fieldId, item.text]));
    expect(text).toMatchObject({ status: "已沟通", user: "合成员工甲", person: "合成学生甲", missing: "lost1", lookup: "已沟通" });
    expect(record.links).toContainEqual({ fieldId: "missing", targetTableId: "missing-table", targetRecordId: "lost1" });
    expect(record.warnings).toContain("LINK_TARGET_MISSING:missing:missing-table:lost1");
    expect(result.warnings).toContain("LINK_TABLE_MISSING:history:missing:missing-table");
  });

  it("按源时区和精度显示业务日期，系统日期和生日不充当历史发生日期", async () => {
    const timestamp = Date.UTC(2024, 0, 1, 16, 30);
    const date = (name: string, property: Record<string, unknown>) => ({ name, type: 5, fieldUIType: "DateTime", property });
    const result = await extractFeishuBase(await source([snapshot("dates", "日期", {
      follow: date("跟进日期", { dateFormat: "yyyy/MM/dd", timeFormat: "" }),
      month: date("报名月份", { dateFormat: "yyyy-MM", timeFormat: "" }),
      created: date("登记日期（自动生成）", { dateFormat: "yyyy/MM/dd", timeFormat: "", autoFill: true }),
      born: date("出生日期", { dateFormat: "yyyy/MM/dd", timeFormat: "" }),
      partial: textField("确认日期"),
    }, { r1: { follow: cell(timestamp), month: cell(timestamp), created: cell(timestamp), born: cell(timestamp), partial: cell(rich("去年秋季")) }, r2: { created: cell(timestamp) } })]));
    expect(result.records[0].dateLabel).toBe("跟进日期：2024/01/02；报名月份：2024-01；确认日期：去年秋季");
    expect(result.records[0].cells.find((item) => item.fieldId === "follow")?.rawValue).toBe(timestamp);
    expect(result.records[1].dateLabel).toBeNull();
    expect(result.records[1].hasContent).toBe(false);
  });

  it("保留空行但自动序号不算业务内容，缺少日期时不生成时间", async () => {
    const result = await extractFeishuBase(await source([snapshot("table", "历史", {
      sequence: { name: "序号", type: 1005, fieldUIType: "AutoNumber" }, name: textField("姓名", true),
    }, { empty: { sequence: cell([{ number: "1", sequence: "1" }]) }, child: { name: cell(rich("合成学生甲")) } })]));
    expect(result.tables[0]).toMatchObject({ rowCount: 2, contentRowCount: 1 });
    expect(result.records[0]).toMatchObject({ hasContent: false, dateLabel: null, names: [], phones: [] });
  });

  it("无时区的数字日期保留原值并给出警告，错误格式明确失败", async () => {
    const entry = snapshot("t", "历史", { date: { name: "沟通日期", type: 5, fieldUIType: "DateTime", property: { dateFormat: "yyyy-MM-dd" } } }, { r: { date: cell(1234) } });
    entry.schema.base.timezone = "";
    const result = await extractFeishuBase(await source([entry]));
    expect(result.records[0].dateLabel).toBe("沟通日期：1234");
    expect(result.records[0].warnings).toContain("DATE_TIMEZONE_MISSING: numeric date retained as source value");
    const malformed = await source([]);
    await writeFile(malformed, "{", "utf8");
    await expect(extractFeishuBase(malformed)).rejects.toThrow("FEISHU_BASE_INVALID_JSON");
  });

  it("循环 lookup 保留原值并警告，不递归丢失整份档案", async () => {
    const lookup = (tableId: string) => ({ name: "查找", type: 19, fieldUIType: "Lookup", property: { tableId, fieldId: "lookup" } });
    const result = await extractFeishuBase(await source([
      snapshot("a", "甲", { lookup: lookup("b") }, { row1: { lookup: cell("保留原值") } }),
      snapshot("b", "乙", { lookup: lookup("a") }, { row2: { lookup: cell("保留原值") } }),
    ]));
    expect(result.records[0].cells[0].text).toBe("保留原值");
    expect(result.records[0].warnings).toContain("LOOKUP_CYCLE:lookup");
  });
});
