import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  inferMofaxiaoSchoolYearStart,
  isSupportedMofaxiaoClassType,
  parseMofaxiaoClassWorksheet,
} from "@/features/school/mofaxiao-class-import";

const headers = [
  "班级ID", "班级名称", "授课方式", "课程名称", "课程类型", "进度", "学科", "年级", "学期", "班型",
  "测评难度", "班级老师", "校区", "教室", "课程费用", "在班人数", "已报", "预招人数", "班级状态",
  "开课日期", "结束日期", "讲次时间", "已购",
];

describe("魔法校班级表解析", () => {
  it("按参考导出表识别班级核心字段，并保留来源行号", () => {
    const parsed = parseMofaxiaoClassWorksheet([
      headers,
      [
        5670234, "【科学思维】一年级秋季A+|紫辰ZC周五17:00", "面授", "E系列数学一年级秋季B[全国版]",
        "长期班", "0/15", "思维", "1年级", "秋季", "A+", "", "张灿", "紫辰阁", "Z312",
        "3150.00元/人/期", 0, 0, 16, "未开课", "2026-09-11", "2026-12-25", "17:00-19:00", "15/15",
      ],
    ], "bill");

    expect(parsed).toMatchObject({ sheetName: "bill", headerRow: 1 });
    expect(parsed.recognizedHeaders).toHaveLength(23);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      sourceRow: 2,
      externalClassId: "5670234",
      name: "【科学思维】一年级秋季A+|紫辰ZC周五17:00",
      courseName: "E系列数学一年级秋季B[全国版]",
      courseType: "长期班",
      grade: 1,
      season: 2,
      teacherName: "张灿",
      campusName: "紫辰阁",
      roomName: "Z312",
      capacity: 16,
      sourceStatus: "未开课",
      startDate: "2026-09-11",
      endDate: "2026-12-25",
      sessionTime: "17:00-19:00",
      courseId: null,
      primaryTeacherId: null,
      schoolTermId: null,
    });
  });

  it("把启蒙阶段留空、识别 Excel 日期，并显式标出非法容量", () => {
    const parsed = parseMofaxiaoClassWorksheet([
      headers,
      [
        "5600001", "启蒙班", "面授", "E系列数学七大能力暑期K3", "长期班", "0/10", "思维", "启蒙阶段",
        "暑期", "", "", "专业思维老师", "利港", "待分发教室", "0.00元/人/期", 0, 0, 0, "未开课",
        45809, null, "08:20-10:20", "0/10",
      ],
    ]);

    expect(parsed.rows[0]).toMatchObject({
      grade: null,
      gradeUnmapped: false,
      season: 1,
      startDate: "2025-06-01",
      capacity: null,
      capacityInvalid: true,
    });
  });

  it("体验课不伪装成班级，显式日期按暑秋寒春学年顺序推断", () => {
    expect(isSupportedMofaxiaoClassType("体验课")).toBe(false);
    expect(isSupportedMofaxiaoClassType("长期班")).toBe(true);
    expect(inferMofaxiaoSchoolYearStart("2026-09-05", 2, 2025)).toBe(2026);
    expect(inferMofaxiaoSchoolYearStart("2027-03-01", 4, 2025)).toBe(2026);
    expect(inferMofaxiaoSchoolYearStart(null, 2, 2026)).toBe(2026);
  });

  it("服务端导入只建班级壳，不生成课次、报名、订单或费用", () => {
    const root = process.cwd();
    const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");
    const action = read("src", "features", "school", "actions", "mofaxiao-class-imports.ts");
    const routes = read("src", "features", "school", "dashboard-routes.ts");
    const migration = read("supabase", "migrations", "20260903000600_mofaxiao_class_import.sql");
    const applySection = migration.slice(
      migration.indexOf("create or replace function public.apply_mofaxiao_class_import"),
      migration.indexOf("revoke all on function public.normalize_mofaxiao_class_text"),
    );

    expect(action).toContain(".strict()");
    expect(action).toContain("p_file_hash: value.fileHash");
    expect(routes).toContain('href: "/dashboard/classes/import"');
    expect(routes).toContain('permission: "class.create"');
    expect(applySection).toContain("public.create_class_v2");
    expect(applySection).toContain("p_sessions => '[]'::jsonb");
    for (const forbiddenWrite of [
      "insert into public.class_sessions",
      "insert into public.enrollments",
      "insert into public.orders",
      "insert into public.payments",
      "insert into public.activities",
    ]) {
      expect(applySection).not.toContain(forbiddenWrite);
    }
  });
});
