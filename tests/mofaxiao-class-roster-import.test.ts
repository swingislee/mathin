import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMofaxiaoRosterDefaultClass,
  defaultMofaxiaoRosterStudentDecision,
  listMofaxiaoRosterClassCandidates,
  matchMofaxiaoRosterStudent,
  parseMofaxiaoClassRosterWorkbook,
  preferredMofaxiaoRosterClassCandidate,
} from "@/features/school/mofaxiao-class-roster-import";
import type { ClassRosterStudentOption, ClassRosterTargetOption } from "@/features/school/actions/types";

function row(values: Record<number, unknown>): unknown[] {
  const result: unknown[] = [];
  for (const [index, value] of Object.entries(values)) result[Number(index)] = value;
  return result;
}

describe("魔法校班级学员花名册导入", () => {
  it("只读取 2026 秋季横向花名册，并用报名主表补充唯一手机号", () => {
    const parsed = parseMofaxiaoClassRosterWorkbook([
      {
        sheet: "学员报名信息",
        data: [[], [], row({ 1: "陈天欣", 2: "18255178761" }), row({ 1: "陈天佑", 2: "18255178761" })],
      },
      {
        sheet: "26年暑秋在读学员",
        data: [
          row({ 29: "紫辰" }),
          row({ 29: "思维体系" }),
          row({
            29: "一年级", 30: "秋季", 31: "A+", 32: "Z312", 33: "张灿", 34: "周六", 35: "10:00-12:00",
            40: "陈天欣", 41: "周张绾宜（王）", 42: "王博煊待定", 43: "李梓涵（暑期备注）",
          }),
        ],
      },
    ]);

    expect(parsed).toMatchObject({ sheetName: "26年暑秋在读学员", schoolYear: 2026, season: 2, memberships: 4 });
    expect(parsed.classes[0]).toMatchObject({ campus: "紫辰", system: "思维体系", grade: 1, teacher: "张灿" });
    expect(parsed.classes[0].students).toEqual([
      expect.objectContaining({ sourceCell: "AO3", rawName: "陈天欣", name: "陈天欣", phone: "18255178761", needsReview: false }),
      expect.objectContaining({ sourceCell: "AP3", rawName: "周张绾宜（王）", name: "周张绾宜", sourceNote: "王", needsReview: true }),
      expect.objectContaining({ sourceCell: "AQ3", rawName: "王博煊待定", name: "王博煊", sourceNote: "待定", needsReview: true }),
      expect.objectContaining({ sourceCell: "AR3", rawName: "李梓涵（暑期备注）", name: "李梓涵", sourceNote: "暑期备注", needsReview: true }),
    ]);
  });

  it("手机号只在姓名相同后参与匹配，不会把共用号码的兄弟姐妹并成一人", () => {
    const options: ClassRosterStudentOption[] = [
      { id: "a", name: "陈天欣", phone: "18255178761", parentPhone: "", grade: 1, status: "enrolled" },
      { id: "b", name: "陈天佑", phone: "18255178761", parentPhone: "", grade: 2, status: "enrolled" },
    ];
    expect(matchMofaxiaoRosterStudent({
      sourceRow: 3, sourceCell: "AO3", rawName: "陈天佑", name: "陈天佑", phone: "18255178761", sourceNote: "", needsReview: false,
    }, options)).toMatchObject({ kind: "exact_phone", suggestedStudentId: "b" });
  });

  it("为唯一同名、未找到档案和带备注姓名预填安全默认值，只保留真实歧义", () => {
    const uniqueOptions: ClassRosterStudentOption[] = [
      { id: "existing", name: "周张绾宜", phone: "", parentPhone: "", grade: 1, status: "enrolled" },
    ];
    const reviewedStudent = {
      sourceRow: 3,
      sourceCell: "AP3",
      rawName: "周张绾宜（王）",
      name: "周张绾宜",
      phone: "",
      sourceNote: "王",
      needsReview: true,
    };
    const reviewedMatch = matchMofaxiaoRosterStudent(reviewedStudent, uniqueOptions);
    expect(reviewedMatch).toMatchObject({ kind: "review", suggestedStudentId: "existing" });
    expect(defaultMofaxiaoRosterStudentDecision(reviewedMatch, true)).toEqual({
      decision: "link_existing",
      studentId: "existing",
    });

    const unmatched = matchMofaxiaoRosterStudent({
      ...reviewedStudent,
      rawName: "新学员",
      name: "新学员",
      sourceNote: "",
      needsReview: false,
    }, uniqueOptions);
    expect(defaultMofaxiaoRosterStudentDecision(unmatched, true)).toEqual({
      decision: "create_student",
      studentId: null,
    });
    expect(defaultMofaxiaoRosterStudentDecision(unmatched, false)).toEqual({
      decision: "pending",
      studentId: null,
    });

    const reviewedUnmatched = matchMofaxiaoRosterStudent({
      ...reviewedStudent,
      rawName: "新学员（待确认）",
      name: "新学员",
      sourceNote: "待确认",
    }, uniqueOptions);
    expect(defaultMofaxiaoRosterStudentDecision(reviewedUnmatched, true)).toEqual({
      decision: "create_student",
      studentId: null,
    });

    const reviewedAmbiguous = matchMofaxiaoRosterStudent(reviewedStudent, [
      ...uniqueOptions,
      { ...uniqueOptions[0], id: "another" },
    ]);
    expect(defaultMofaxiaoRosterStudentDecision(reviewedAmbiguous, true)).toEqual({
      decision: "pending",
      studentId: null,
    });
  });

  it("只有学期、年级、主讲、校区与班型共同形成唯一高置信结果时才自动映射班级", () => {
    const target = (overrides: Partial<ClassRosterTargetOption>): ClassRosterTargetOption => ({
      id: "target", name: "一年级秋季A+ 周六 10:00-12:00", grade: 1, termId: "term", schoolYear: 2026,
      season: 2, courseTitle: "爱学习 A+ 一年级秋季", courseFamilySlug: "aixuexi-primary-math", classType: "A+", campusName: "紫辰", roomName: "Z312",
      primaryTeacherNames: ["张灿"], capacity: 16, activeEnrollmentCount: 0, ...overrides,
    });
    const source = parseMofaxiaoClassRosterWorkbook([{
      sheet: "26年暑秋在读学员",
      data: [row({ 29: "紫辰" }), row({ 29: "一年级", 30: "秋季", 31: "A+", 32: "Z312", 33: "张灿", 34: "周六", 35: "10:00-12:00", 40: "陈天欣" })],
    }]).classes[0];
    expect(preferredMofaxiaoRosterClassCandidate(source, [target({})])?.id).toBe("target");
    expect(preferredMofaxiaoRosterClassCandidate(source, [target({ id: "a" }), target({ id: "b" })])).toBeNull();
    expect(preferredMofaxiaoRosterClassCandidate(source, [target({ campusName: "" })])).toBeNull();
    expect(preferredMofaxiaoRosterClassCandidate(source, [target({ classType: "S", courseTitle: "二年级 S 班" })])).toBeNull();
  });

  it("贯通体系的花名册班级只推荐爱学习 G+ 与 A+ 班级", () => {
    const source = parseMofaxiaoClassRosterWorkbook([{
      sheet: "26年暑秋在读学员",
      data: [row({ 29: "紫辰" }), row({ 29: "贯通体系" }), row({ 29: "三年级", 30: "秋季", 31: "G+", 33: "王成国", 40: "陈天欣" })],
    }]).classes[0];
    const base: ClassRosterTargetOption = {
      id: "g", name: "三年级秋季 G+", grade: 3, termId: "term", schoolYear: 2026, season: 2,
      courseTitle: "爱学习 G+ 苏教版数学 · 三年级秋季", courseFamilySlug: "aixuexi-primary-math", classType: "G+",
      campusName: "紫辰", roomName: "", primaryTeacherNames: ["王成国"], capacity: 16, activeEnrollmentCount: 0,
    };
    const candidates = listMofaxiaoRosterClassCandidates(source, [
      base,
      { ...base, id: "a", classType: "A+", courseTitle: "爱学习 A+ 全国版数学 · 三年级秋季" },
      { ...base, id: "x", classType: "X+", courseTitle: "爱学习 X+ 苏教版数学 · 三年级秋季" },
      { ...base, id: "e", courseFamilySlug: "xueersi-e-primary-math-cn", classType: "A+", courseTitle: "E 系列数学三年级秋季 A+" },
    ]);
    expect(candidates.map((candidate) => candidate.id).sort()).toEqual(["a", "g"]);
  });

  it("培优体系映射 E 系列，并把魔法校 A+ 转成课程 B 版", () => {
    const source = parseMofaxiaoClassRosterWorkbook([{
      sheet: "26年暑秋在读学员",
      data: [
        row({ 29: "培优体系" }),
        row({ 29: "紫辰" }),
        row({ 29: "三年级", 30: "秋季", 31: "A+", 33: "薛立志", 34: "周三", 35: "17:00-19:30", 40: "张若雨" }),
      ],
    }]).classes[0];
    const base: ClassRosterTargetOption = {
      id: "e-b", name: "【科学思维】三年级秋季A+|紫辰XLZ周三17:00", grade: 3, termId: "term",
      schoolYear: 2026, season: 2, courseTitle: "E系列数学三年级秋季B[全国版]",
      courseFamilySlug: "xueersi-e-primary-math-cn", classType: "B", campusName: "", roomName: "",
      primaryTeacherNames: ["薛立志"], capacity: 20, activeEnrollmentCount: 0,
    };

    expect(listMofaxiaoRosterClassCandidates(source, [
      base,
      { ...base, id: "e-a", courseTitle: "E系列数学三年级秋季A[全国版]", classType: "A" },
      { ...base, id: "aix-a", courseTitle: "爱学习 A+ 全国版数学 · 三年级秋季", courseFamilySlug: "aixuexi-primary-math", classType: "A+" },
    ]).map((candidate) => candidate.id)).toEqual(["e-b"]);
    expect(preferredMofaxiaoRosterClassCandidate(source, [base])?.id).toBe("e-b");
    expect(preferredMofaxiaoRosterClassCandidate(source, [{ ...base, name: "【培优思维】三年级秋季A+|紫辰XLZ周三17:00" }])?.id).toBe("e-b");
    expect(preferredMofaxiaoRosterClassCandidate(source, [{ ...base, name: "三年级秋季A+周三17:00", campusName: "紫辰阁" }])?.id).toBe("e-b");
    expect(preferredMofaxiaoRosterClassCandidate(source, [{ ...base, name: "三年级秋季A+周三17:00", campusName: "利港" }])).toBeNull();
    expect(preferredMofaxiaoRosterClassCandidate({ ...source, weekday: "周六", time: "9.12开课10:00-12:00" }, [base])).toBeNull();

    expect(buildMofaxiaoRosterDefaultClass(source)).toEqual(expect.objectContaining({
      name: "【培优思维】三年级秋季B｜紫辰阁薛立志周三17:00-19:30",
      system: "培优思维",
      classType: "B",
      campusName: "紫辰阁",
      schoolYear: 2026,
      season: 2,
    }));
  });

  it("仍只使用现有 xlsx 读取器，不引入 SheetJS", () => {
    const root = process.cwd();
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    expect(packageJson.dependencies).not.toHaveProperty("xlsx");
  });

  it("未匹配班级只在正式应用时建立 planning 壳，并保留显式待完善清单", () => {
    const root = process.cwd();
    const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");
    const action = read("src", "features", "school", "actions", "mofaxiao-class-roster-imports.ts");
    const panel = read("src", "features", "school", "MofaxiaoClassRosterImportPanel.tsx");
    const optionReader = read("src", "features", "school", "class-roster-imports.ts");
    const routes = read("src", "features", "school", "dashboard-routes.ts");
    const migration = read("supabase", "migrations", "20260903000800_mofaxiao_class_roster_import.sql");
    const optionMigration = read("supabase", "migrations", "20260903000900_mofaxiao_class_roster_option_readers.sql");
    const defaultClassMigration = read("supabase", "migrations", "20260903001200_mofaxiao_roster_default_class_creation.sql");
    const applySection = migration.slice(
      migration.indexOf("create or replace function public.apply_mofaxiao_class_roster_import"),
      migration.indexOf("revoke all on function public.get_mofaxiao_class_roster_import_batch"),
    );

    expect(action).toContain(".strict()");
    expect(action).toContain("defaultClassSchema");
    expect(action).toContain("!row.classroomId && !row.defaultClass");
    expect(panel).toContain("defaultMofaxiaoRosterStudentDecision(view.match, canCreateStudents)");
    expect(panel).toContain("preferred?.id ?? (canCreateClasses ? CREATE_DEFAULT_CLASS : \"\")");
    expect(panel).toContain('"bg-rose/5 hover:bg-rose/10"');
    expect(action).toContain('p_source_system: "mofaxiao"');
    expect(optionReader).toContain('.rpc("list_mofaxiao_class_roster_target_options")');
    expect(optionReader).not.toContain('.from("classrooms")');
    expect(optionMigration).toContain("security definer stable");
    expect(optionMigration).toContain("public.has_perm(v_uid, 'enrollment.manage')");
    expect(optionMigration).toContain("public.can_manage_classroom(classroom_row.id, v_uid)");
    expect(routes).toContain('href: "/dashboard/classes/import/roster"');
    expect(routes).toContain('permission: "enrollment.manage"');
    expect(applySection).toContain("insert into public.students");
    expect(applySection).toContain("insert into public.enrollments");
    expect(applySection).toContain("'active', now(), v_classroom.term_id");
    expect(applySection).toContain("where item.batch_id = v_batch.id");
    const defaultPreviewSection = defaultClassMigration.slice(
      defaultClassMigration.indexOf("create or replace function public.preview_mofaxiao_class_roster_import"),
      defaultClassMigration.indexOf("create or replace function public.apply_mofaxiao_class_roster_import"),
    );
    const defaultApplySection = defaultClassMigration.slice(
      defaultClassMigration.indexOf("create or replace function public.apply_mofaxiao_class_roster_import"),
      defaultClassMigration.indexOf("revoke all on function public.get_mofaxiao_class_roster_import_batch"),
    );
    expect(defaultPreviewSection).not.toContain("public.create_class_v2(");
    expect(defaultPreviewSection).toContain("jsonb_typeof(v_default_class) = 'object'");
    expect(defaultApplySection).toContain("public.create_class_v2(");
    expect(defaultApplySection).toContain("p_activate => false");
    expect(defaultApplySection).toContain("'CREATED_DEFAULT_CLASS'");
    expect(defaultClassMigration).toContain("'reviewIssues', to_jsonb(created.review_issues)");
    for (const forbiddenWrite of [
      "insert into public.classrooms",
      "insert into public.class_sessions",
      "insert into public.orders",
      "insert into public.payments",
      "insert into public.attendance",
      "insert into public.activities",
    ]) {
      expect(applySection).not.toContain(forbiddenWrite);
    }
  });
});
