import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importedClassScheduleDefaults } from "@/features/school/classroom-setup-contract";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("班级开课设置工作面", () => {
  it("从新旧两代导入上下文恢复开课日期、星期、时间和时长", () => {
    expect(importedClassScheduleDefaults({
      sourceSystem: "mofaxiao",
      sourceClassKey: "2026::autumn::紫辰::培优体系::七年级::秋季::A+::WG::吴老师::周六::9.12开课14:00-16:30",
      sourceLabel: "",
      sourceContext: {},
      reviewIssues: ["schedule"],
      completedAt: null,
    })).toEqual({ startDate: "2026-09-12", startTime: "14:00", durationMin: 150, weekday: 6 });

    expect(importedClassScheduleDefaults({
      sourceSystem: "mofaxiao",
      sourceClassKey: "fallback",
      sourceLabel: "",
      sourceContext: {
        schoolYear: 2026,
        startDate: "2026-09-13",
        startTime: "09:30",
        durationMin: 120,
        weekday: "周日",
      },
      reviewIssues: ["schedule"],
      completedAt: null,
    })).toEqual({ startDate: "2026-09-13", startTime: "09:30", durationMin: 120, weekday: 0 });
  });

  it("把课程、主讲、教室和完整课表作为一次原子提交", () => {
    const workspace = read("src", "features", "school", "ClassroomSetupWorkspace.tsx");
    const action = read("src", "features", "school", "actions", "classes.ts");
    const migration = read("supabase", "migrations", "20260904000100_classroom_import_setup_workspace.sql");
    const classPage = read("src", "app", "[locale]", "dashboard", "classes", "[classId]", "page.tsx");
    const settings = read("src", "features", "school", "ClassroomSettingsSheet.tsx");

    expect(workspace).toContain("data-classroom-setup-workspace");
    expect(workspace).toContain("<CoursePicker");
    expect(workspace).toContain("<RoomPicker");
    expect(workspace).toContain("generateSchedulePreview");
    expect(workspace).toContain("getClassBuildConflictsAction");
    expect(workspace).toContain("completeClassroomSetupAction");
    expect(workspace).toContain("dateTimeInputToInstant");
    expect(workspace).toContain('mode="datetime"');
    expect(workspace).toContain("scheduleOverrides[session.lectureId]");
    expect(workspace).toContain('classBuildT("restoreBatchSchedule")');
    expect(action).toContain('"complete_classroom_setup_v2"');
    expect(migration).toContain("create or replace function public.complete_classroom_setup_v2");
    expect(migration).toContain("for update");
    expect(migration).toContain("CLASSROOM_SETUP_STALE");
    expect(migration).toContain("v_distinct_lecture_count <> v_active_lecture_count");
    expect(migration).toContain("insert into public.class_sessions");
    expect(migration).toContain("setup_completed_at = now()");
    expect(classPage).toContain('const TABS = ["setup", "sessions"');
    expect(settings).toContain("setupHref");
  });

  it("保留导入排课来源，并让完成后的批次清除过期待完善提示", () => {
    const migration = read("supabase", "migrations", "20260904000100_classroom_import_setup_workspace.sql");
    expect(migration).toContain("source_context jsonb");
    expect(migration).toContain("get_classroom_import_setup_context_v2");
    expect(migration).toContain("v_contexts -> created.source_class_key");
    expect(migration).toContain("mapping.setup_completed_at is not null then '{}'::text[]");
  });
});
