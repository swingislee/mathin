export type ClassroomWorkSession = {
  id: string; classroomId: string; title: string; scheduledAt: string | null;
  startedAt: string | null; endedAt: string | null;
};
export type ClassroomSessionBucket = "upcoming" | "ended";

export function classroomWorkSessions(sessions: readonly ClassroomWorkSession[], classroomId: string, bucket: ClassroomSessionBucket) {
  return sessions.filter(session => session.classroomId === classroomId && Boolean(session.endedAt) === (bucket === "ended"))
    .sort((a, b) => (a.scheduledAt ?? "9999").localeCompare(b.scheduledAt ?? "9999") * (bucket === "ended" ? -1 : 1));
}

export function classroomWorkSessionHref(session: ClassroomWorkSession) {
  return `/dashboard/sessions/${session.id}?stage=${session.endedAt ? "post" : session.startedAt ? "live" : "pre"}`;
}
