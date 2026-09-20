import { describe, expect, it } from "vitest";
import { classSessionStudentWork, orderedClassSessions, type ClassRosterSession } from "@/features/school/class-roster-session-contract";
import type { TeachingRecords } from "@/features/school/teaching-workbench/teaching-records-contract";

const lesson = (id: string, scheduledAt: string | null, overrides: Partial<ClassRosterSession> = {}): ClassRosterSession => ({
  id, classroomId: "class", title: id, scheduledAt, startedAt: null, endedAt: null, attendanceCount: 0, reviewCount: 0, ...overrides,
});
describe("班级内课次范围与实际名单", () => {
  const sessions = orderedClassSessions([lesson("future", "2026-09-25T10:00:00Z"), lesson("previous", "2026-09-10T10:00:00Z"),
    lesson("today", "2026-09-20T10:00:00Z"), lesson("other-class", "2026-09-20T09:00:00Z", { classroomId: "other" })], "class");
  it("课次按时间排列，只包含当前班级", () => {
    expect(sessions.map(row => row.id)).toEqual(["previous", "today", "future"]);
  });
  it("旧课以冻结名单投影，新增当前成员不会混入；临时学生也有登记位置", () => {
    const data = { students: [{ id: "transferred", name: "Transferred student" }, { id: "temporary", name: "Temporary student" }],
      attendance: [{ studentId: "transferred", status: "late" }], checks: [{ id: "question", title: "Question" }],
      results: [{ checkId: "question", studentId: "temporary", status: "prompted" }],
      reviews: [{ studentId: "transferred", comment: "Saved", focus: 3 }, { studentId: "current-only", comment: "Not this lesson" }],
    } as TeachingRecords;
    const work = classSessionStudentWork(data);
    expect(work.rows.map(row => row.studentId)).toEqual(["transferred", "temporary"]);
    expect(work.rows[0]).toMatchObject({ attendanceStatus: "late", stars: null, checks: [{ status: "unchecked" }] });
    expect(work.rows[1].checks[0].status).toBe("prompted");
    expect(work.reviews).toMatchObject([{ studentId: "transferred", comment: "Saved", focus: 3 }, { studentId: "temporary", comment: "", focus: null }]);
  });
});
