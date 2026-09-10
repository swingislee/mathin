import { describe, expect, it } from "vitest";
import { normalizeGradeLabel, normalizeGradeText, parseSchoolGrade } from "@/lib/grade-format.mjs";
import { normalizeClassImportText, preferredMofaxiaoClassCourseCandidate } from "@/features/school/mofaxiao-class-import";
import { parseXiaodituiWorksheet } from "@/features/school/xiaoditui-import";
import type { ClassImportCourseOption } from "@/features/school/actions/types";

describe("年级数字规范", () => {
  it.each(["一", "二", "三", "四", "五", "六", "七"])("兼容来源年级 %s，并输出数字标签", (word) => {
    const grade = "一二三四五六七".indexOf(word) + 1;
    expect(parseSchoolGrade(`${word}年级`)).toBe(grade);
    expect(parseSchoolGrade(`${grade}年级`)).toBe(grade);
    expect(parseSchoolGrade(word)).toBe(grade);
    expect(normalizeGradeLabel(`${word}年级`)).toBe(`${grade}年级`);
    expect(normalizeGradeText(`数学${word}年级秋季 A+`)).toBe(`数学${grade}年级秋季 A+`);
  });

  it("统一年级范围，保留一般数字语义与范围外年级", () => {
    const value = "同一年级，一年级和七年级；三至六年级；一、三、四年级；十一年级；十二年级；周六；一对一";
    const normalized = "同一年级，1年级和7年级；3至6年级；1、3、4年级；十一年级；十二年级；周六；一对一";
    expect(normalizeGradeText(value)).toBe(normalized);
    expect(normalizeGradeText(normalized)).toBe(normalized);
    expect(normalizeGradeLabel("初一")).toBe("7年级");
    expect(normalizeGradeLabel("第 ６ 年级")).toBe("6年级");
    expect(normalizeGradeLabel("小学一")).toBe("1年级");
    expect(normalizeGradeLabel("第一年级")).toBe("1年级");
    expect(parseSchoolGrade("小学七年级")).toBeNull();
    expect(parseSchoolGrade("初中二年级")).toBe(8);
    expect(normalizeGradeLabel("大班")).toBe("大班");
    expect(parseSchoolGrade("13年级")).toBeNull();
    expect(parseSchoolGrade("同一年级")).toBeNull();
    expect(parseSchoolGrade("初二")).toBe(8);
    expect(parseSchoolGrade("十二年级")).toBe(12);
  });

  it("数字课程标题仍匹配旧导入标题", () => {
    const oldTitle = "E系列数学一年级秋季B[全国版]";
    const title = "E系列数学1年级秋季B[全国版]";
    const course = { id: "existing-course", title, grade: 1, season: 2, catalogVersionCurrent: true } as ClassImportCourseOption;
    expect(normalizeClassImportText(oldTitle)).toBe(normalizeClassImportText(title));
    expect(preferredMofaxiaoClassCourseCandidate({ courseName: oldTitle, grade: 1, season: 2 }, [course])?.id).toBe(course.id);
  });

  it.each(["6年级", "六年级"])("小地推读取 %s，保留来源原文供追溯", (label) => {
    const parsed = parseXiaodituiWorksheet([
      ["孩子姓名", "手机号码", "孩子年级", "预约", "提交时间", "定位"],
      ["样本", "13800000000", label, "测评", "2026-09-07 10:00:00", "校区"],
    ]);
    expect(parsed.rows[0]).toMatchObject({ grade: 6, gradeText: label });
  });
});
