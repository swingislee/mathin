import type { SessionLearningSetup } from "@/features/school/session-learning-contract";
import type { CoursewarePage, SessionRosterEntry } from "../types";

export function buildRehearsalLearningSetup({
  persisted,
  pages,
  roster,
  fallbackTitle,
}: {
  persisted: SessionLearningSetup | null;
  pages: readonly CoursewarePage[];
  roster: readonly SessionRosterEntry[];
  fallbackTitle: string;
}): SessionLearningSetup {
  const students = roster.map((student) => ({
    id: student.studentId,
    name: student.name,
    seatPosition: student.seatPosition,
  }));
  const checks = persisted?.checks.length
    ? persisted.checks
    : pages
      .filter((page): page is Extract<CoursewarePage, { type: "doc" }> => page.type === "doc")
      .map((page, position) => ({
          id: `rehearsal-learning:${page.docId}`,
          position,
          title: page.title || fallbackTitle,
          sourcePageId: page.docId,
        }));
  const resolvedChecks = checks.length > 0
    ? checks
    : [{
        id: "rehearsal-learning:general",
        position: 0,
        title: fallbackTitle,
        sourcePageId: null,
      }];
  const checkIds = new Set(resolvedChecks.map((check) => check.id));
  const studentIds = new Set(students.map((student) => student.id));

  return {
    configured: persisted?.configured ?? false,
    checks: resolvedChecks,
    students,
    results: (persisted?.results ?? []).filter((result) => (
      checkIds.has(result.checkId) && studentIds.has(result.studentId)
    )),
  };
}
