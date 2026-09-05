import { describe, expect, it } from "vitest";
import {
  activityEnrollmentContextSchema, followupState, placementDestinationError, placementStudents, placementHealth, classWeeklyScheduleLabel,
  type EnrollmentPlacementBoard, type PlacementClassroom, type PlacementStudent,
} from "../src/features/school/enrollment-workflow-contract";

const enrollmentDefaults = { opportunityId: "opportunity", termName: "Term", note: "", confirmedAt: "2026-09-05T10:00:00Z", confirmedByName: "Admin", cancelledAt: null, cancelledByName: null, assignmentId: null, classroomName: null, membershipId: null, assignedAt: null, claimableClassroomIds: [], updatedAt: "2026-09-05T10:00:00Z" };

const course = { id: "course", title: "Grade 4 math", grade: 4, classType: "a", productCode: null };
const classroom: PlacementClassroom = { id: "class", courseId: course.id, termId: "term", name: "Class A", activeCount: 1, capacity: 1, operationalStatus: "active", teacherNames: "Teacher", sessions: [] };
const student: PlacementStudent = { key: "enrollment", enrollmentId: "enrollment", membershipId: null, studentId: "student", name: "Student", phone: "", grade: 4, courseId: course.id, courseTitle: course.title, termId: "term", classroomId: null, note: "", recommendation: "", seat: null, status: "active" };

describe("enrollment placement decisions", () => {
  it("uses the enrollment course grade and shows an existing roster member only once", () => {
    const enrollment = { ...enrollmentDefaults, id: "enrollment", studentId: "student", studentName: "Student", studentPhone: "", courseId: course.id, courseTitle: course.title, termId: "term", classroomId: null, status: "active" as const };
    const board = {
      options: { courses: [course], terms: [], classrooms: [classroom] },
      enrollments: [enrollment],
      members: [{ membershipId: "member", studentId: "student", name: "Student", phone: "", classroomId: "class", enrollmentId: "enrollment", note: "", recommendation: "Ready" }],
    } as EnrollmentPlacementBoard;
    expect(placementStudents(board)).toHaveLength(1);
    expect(placementStudents(board)[0]).toMatchObject({ grade: 4, classroomId: "class", membershipId: "member" });
  });
  it("keeps legacy students visible and includes course-only enrollment in pending", () => {
    const board = {
      options: { courses: [course], terms: [], classrooms: [classroom] },
      enrollments: [{ ...enrollmentDefaults, id: "new", studentId: "newStudent", studentName: "New", studentPhone: "", courseId: course.id, courseTitle: course.title, termId: "term", classroomId: null, status: "active" }],
      members: [{ membershipId: "legacy", studentId: "student", name: "Existing", phone: "", classroomId: "class", enrollmentId: null, note: "", recommendation: "" }],
    } as EnrollmentPlacementBoard;
    expect(placementStudents(board).map((row) => [row.key, row.classroomId])).toEqual([["legacy", "class"], ["new", null]]);
  });
  it("rejects full destinations while allowing a claim of an existing place", () => {
    expect(placementDestinationError(student, classroom, [])).toBe("CLASS_FULL");
    expect(placementDestinationError(student, classroom, [{ ...student, classroomId: "class" }])).toBeNull();
  });
  it("rejects different courses and terms even when there is capacity", () => {
    expect(placementDestinationError(student, { ...classroom, capacity: 10, courseId: "other" }, [])).toBe("CLASS_TARGET_MISMATCH");
    expect(placementDestinationError(student, { ...classroom, capacity: 10, termId: "next" }, [])).toBe("CLASS_TARGET_MISMATCH");
  });
  it("permits unbounded classes and return to pending", () => {
    expect(placementDestinationError(student, { ...classroom, capacity: null }, [])).toBeNull();
    expect(placementDestinationError({ ...student, classroomId: "class" }, null, [])).toBeNull();
  });
});

describe("post-activity contact queues", () => {
  const id = "f3000000-0000-4000-8000-000000000001";
  const context = activityEnrollmentContextSchema.parse({ registrationId: id, studentId: id, leadId: null, name: "Student", phone: "", grade: 4, gradeText: "", ownerId: id, leadStatus: null, activityId: id, activityTitle: "Assessment", activityAt: "2026-09-05T10:00:00Z", eligible: true, recommendation: "", assessmentBand: null, route: "continue_follow_up", routeNote: "", enrollmentId: null, courseTitle: null, termName: null, classroomName: null, termId: null, canContact: true, canEnroll: true, contacts: [] });
  it("can follow up without a selected course", () => {
    expect(followupState(context)).toBe("contact");
    expect(followupState({ ...context, route: "await_product" })).toBe("waiting");
  });
  it("removes confirmed enrollment from the open queue even if the last contact was unreachable", () => {
    expect(followupState({ ...context, enrollmentId: id })).toBe("enrolled");
    expect(followupState({ ...context, route: "closed" })).toBe("closed");
  });
});

describe("roster status and health", () => {
  it("preserves withdrawn enrollment for review and prevents dragging it into a class", () => {
    const board = { options: { courses: [course], terms: [], classrooms: [classroom] }, members: [],
      enrollments: [{ ...enrollmentDefaults, id: "cancelled", studentId: "student", studentName: "Student", studentPhone: "", courseId: course.id, courseTitle: course.title, termId: "term", classroomId: null, status: "cancelled" as const }] };
    const [withdrawn] = placementStudents(board);
    expect(withdrawn.status).toBe("withdrawn");
    expect(placementDestinationError(withdrawn, classroom, [])).toBe("ENROLLMENT_CANCELLED");
  });
  it("keeps missing and single-observation evidence neutral", () => {
    expect(placementHealth().tone).toBe("neutral");
    expect(placementHealth([{ key: "attendance", level: "observed" }, { key: "homework", level: "unknown" }]).tone).toBe("neutral");
  });
  it("maps comparable observed evidence towards blue and attention towards red", () => {
    expect(placementHealth([{ key: "attendance", level: "observed" }, { key: "communication", level: "observed" }]).tone).toBe("high");
    expect(placementHealth([{ key: "attendance", level: "attention" }, { key: "communication", level: "attention" }]).tone).toBe("low");
    expect(placementHealth([{ key: "attendance", level: "observed" }, { key: "communication", level: "attention" }]).tone).toBe("neutral");
  });
  it("collapses weekly repetitions while retaining duration and distinct time slots", () => {
    const label = classWeeklyScheduleLabel({ ...classroom, sessions: [{ at: "2026-09-05T01:00:00Z", duration: 90 }, { at: "2026-09-12T01:00:00Z", duration: 90 }] }, "zh");
    expect(label).toContain("09:00"); expect(label).toContain("10:30"); expect(label).not.toContain(" / ");
  });
});
