import type { SessionLearningSetup } from "@/features/school/session-learning-contract";
import type { SessionRosterEntry } from "../types";

export function buildRehearsalLearningSetup({
  persisted,
  roster,
  fallbackTitle,
}: {
  persisted: SessionLearningSetup | null;
  roster: readonly SessionRosterEntry[];
  fallbackTitle: string;
}): SessionLearningSetup {
  const students = roster.map((student) => ({
    id: student.studentId,
    name: student.name,
    seatPosition: student.seatPosition,
  }));
  const checks = persisted?.checks ?? [];
  // 无配置时保留通用观察与点名入口；页级提醒只绑定已保存的检查页。
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
