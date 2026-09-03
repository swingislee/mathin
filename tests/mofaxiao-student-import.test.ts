import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseMofaxiaoWorksheet } from "@/features/school/mofaxiao-student-import";

describe("魔法校学生表解析", () => {
  it("导入历史学生行但完全不读取来源学生状态和身份证号", () => {
    const parsed = parseMofaxiaoWorksheet([
      ["学生ID", "学生姓名", "联系电话", "学生状态", "性别", "身份证号码", "学生年级", "所属公立校", "公立校班级", "家长姓名", "关系", "家长电话", "来源渠道", "市场活动", "标签1", "标签2", "标签3", "跟进状态", "学管师"],
      ["12532029", "A Kelly家族", "137****1046", "历史", "男", "110101200001010011", "无年级", "实验学校", "六(2)班", "王女士", "母亲", "138****0000", "机构微官网", "秋季开放日", "重点", "英语", "重点", "待跟进", "张老师"],
    ]);

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      externalStudentId: "12532029",
      name: "A Kelly家族",
      phone: "",
      phoneMasked: true,
      grade: null,
      gradeUnmapped: false,
      publicSchoolClass: "六(2)班",
      marketActivity: "秋季开放日",
      tags: ["重点", "英语"],
    });
    expect(parsed.rows[0]).not.toHaveProperty("studentStatus");
    expect(parsed.rows[0]).not.toHaveProperty("idCard");
    expect(JSON.stringify(parsed.rows[0])).not.toContain("110101200001010011");
    expect(JSON.stringify(parsed.rows[0])).not.toContain("历史");
    expect(JSON.stringify(parsed.rows[0])).not.toContain("张老师");
  });

  it("识别中文年级、Excel 日期和完整号码", () => {
    const parsed = parseMofaxiaoWorksheet([
      ["学生姓名", "联系电话", "学生年级", "学生生日", "家长电话"],
      ["小明", "138 0013 8000", "初二", 45292, "010-88886666"],
    ]);
    expect(parsed.rows[0]).toMatchObject({
      phone: "13800138000",
      grade: 8,
      birthday: "2024-01-01",
      parentPhone: "01088886666",
    });
  });

  it("不在浏览器静默截断超长业务字段，让服务端按行报错", () => {
    const longName = "长".repeat(101);
    const parsed = parseMofaxiaoWorksheet([
      ["学生姓名", "联系电话", "学生年级"],
      [longName, "13800138000", "六年级"],
    ]);
    expect(parsed.rows[0].name).toBe(longName);
  });

  it("服务端只接收脱敏行，并且不创建账号、班级或报名", () => {
    const root = process.cwd();
    const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");
    const migration = read("supabase", "migrations", "20260903000100_mofaxiao_student_import.sql");
    const action = read("src", "features", "school", "actions", "mofaxiao-student-imports.ts");
    const panel = read("src", "features", "school", "MofaxiaoStudentImportPanel.tsx");
    const applySection = migration.slice(
      migration.indexOf("create or replace function public.apply_mofaxiao_student_import"),
      migration.indexOf("revoke all on function public.normalize_mofaxiao_phone"),
    );

    expect(action).toContain(".strict()");
    expect(action).toContain("p_file_hash: value.fileHash");
    expect(action).not.toContain("fileBase64");
    expect(panel).toContain("sha256Hex(buffer)");
    expect(panel).not.toContain("arrayBufferToBase64");
    expect(migration).toContain("FORBIDDEN_SOURCE_FIELD");
    expect(migration).toContain("length(v_external_id) > 100");
    expect(migration).toContain("public_school_class");
    expect(migration).toContain("market_activity");
    expect(applySection).toContain("insert into public.students");
    expect(applySection).toContain("'lead', null, v_batch.created_by");
    expect(applySection).toContain("mofaxiao-student:phone:");
    expect(applySection).toContain("mofaxiao-student:parent:");
    for (const forbiddenWrite of [
      "insert into auth.users",
      "insert into public.profiles",
      "insert into public.classrooms",
      "insert into public.enrollments",
      "insert into public.assessments",
      "insert into public.student_guardians",
    ]) {
      expect(applySection).not.toContain(forbiddenWrite);
    }
  });
});
