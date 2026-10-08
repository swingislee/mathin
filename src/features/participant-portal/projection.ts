import type * as Existing from "../../../contracts/parent-api/portal";
import type * as Participant from "../../../contracts/participant-api/portal";

/** Small-program projection only. Shared persistence, identities and other clients retain their existing contract. */
export function participantCalendar(value: Existing.ParentLearning): Participant.ParticipantCalendar {
  return {
    participantId: value.participantId, generatedAt: value.generatedAt, range: value.range,
    summary: value.summary && { stageNumber: value.summary.grade, nextSessionAt: value.summary.nextSessionAt,
      weekSessionCount: value.summary.weekSessionCount, starTotal: value.summary.starTotal },
    groups: value.courses.map(row => ({ id: row.id, name: row.name, facilitatorName: row.teacherName,
      nextSessionAt: row.nextSessionAt, sessionCount: row.sessionCount })),
    calendar: value.schedule.map(row => ({ id: row.id, participantId: row.participantId, groupId: row.classroomId,
      groupName: row.classroomName, title: row.title, startsAt: row.startsAt,
      durationMinutes: row.durationMinutes, facilitatorName: row.teacherName })),
    attendance: value.attendance.map(row => ({ sessionId: row.sessionId, participantId: row.participantId,
      groupName: row.classroomName, title: row.title, startsAt: row.startsAt, status: row.status, note: row.note })),
    notifications: value.notifications.map(row => ({ id: row.id, type: row.type, occurredAt: row.occurredAt,
      readAt: row.readAt, link: row.link, participantId: row.participantId, participantName: row.studentName,
      groupName: row.classroomName, sessionTitle: row.sessionTitle })),
    leaveRequests: value.leaveRequests.map(row => ({ id: row.id, sessionId: row.sessionId,
      participantId: row.participantId, sessionTitle: row.sessionTitle, reason: row.reason, status: row.status,
      createdAt: row.createdAt, decidedAt: row.decidedAt, makeupSessionId: row.makeupSessionId,
      makeupSessionTitle: row.makeupSessionTitle, makeupGroupName: row.makeupClassroomName,
      makeupStartsAt: row.makeupStartsAt,
      makeupStatus: row.makeupStatus === "to_schedule" ? "awaiting_time" : row.makeupStatus === "scheduled" ? "time_confirmed" : row.makeupStatus })),
    reports: value.reports, unassignedReportCount: value.unassignedReportCount,
    capabilities: { leaveRequests: value.capabilities.leaveRequests, notificationRead: value.capabilities.notificationRead,
      chat: value.capabilities.chat, rebooking: value.capabilities.rescheduling, wrongAnswers: value.capabilities.wrongAnswers,
      profileEditing: value.capabilities.profileEditing, payments: value.capabilities.payments },
  };
}

export function assessmentRequest(value: Existing.ParentAssessmentRequest): Participant.AssessmentRequest {
  return {
    id: value.id, participantId: value.participantId, facilitator: value.teacher,
    state: value.state === "awaiting_parent" ? "awaiting_participant" : value.state === "awaiting_teacher" ? "awaiting_facilitator" : value.state,
    participantTimeOptions: value.parentTimeOptions, facilitatorTimeOptions: value.teacherTimeOptions,
    sharedTimeOptions: value.sharedTimeOptions, proposedStartsAt: value.proposedStartsAt,
    confirmedStartsAt: value.scheduledAt, updatedAt: value.updatedAt, canConfirm: value.canConfirm,
    booking: value.booking && { slotId: value.booking.slotId, topics: value.booking.subjects, stageNumber: value.booking.grade,
      mode: value.booking.mode, campus: value.booking.campus, endsAt: value.booking.endsAt },
  };
}

export function assessmentOverview(value: Existing.ParentAssessmentOverview): Participant.AssessmentOverview {
  return { participantId: value.participantId, timeZone: value.timeZone,
    eligibility: { canRequest: value.eligibility.canRequest,
      reason: value.eligibility.reason === "NO_ELIGIBLE_TEACHER" ? "NO_ELIGIBLE_FACILITATOR" : value.eligibility.reason },
    facilitators: value.teachers, requests: value.requests.map(assessmentRequest) };
}

export function assessmentAvailability(value: Existing.AssessmentAvailability): Participant.AssessmentAvailability {
  return { participantId: value.participantId, timeZone: value.timeZone, from: value.from, to: value.to,
    facilitators: value.teachers, campuses: value.campuses,
    slots: value.slots.map(row => ({ id: row.id, facilitatorId: row.teacherId, campusId: row.campusId,
      startsAt: row.startsAt, endsAt: row.endsAt, available: row.available })) };
}

export function activityOffers(values: Existing.CourseOffer[]): Participant.ActivityOffer[] {
  return values.flatMap(row => row.kind !== "activity" || !row.activity ? [] : [{
    id: row.id, kind: "activity" as const, title: row.title, description: row.description, priceCents: row.priceCents,
    bookingClosesAt: row.bookingClosesAt, revision: row.revision, topic: null,
    activity: { id: row.activity.id, targetStages: row.activity.targetGrades, location: row.activity.location,
      startsAt: row.activity.startsAt, durationMinutes: row.activity.durationMinutes, remaining: row.activity.remaining },
  }]);
}

export function activityRequests(values: Existing.CourseApplication[]): Participant.ActivityRequest[] {
  return values.filter(row => row.kind === "activity").map(row => ({ id: row.id, kind: "activity", participantId: row.participantId,
    participantName: row.participantName, publicationId: row.publicationId, activityId: row.activityId, title: row.title,
    priceCents: row.priceCents, status: row.status, createdAt: row.createdAt, resolvedAt: row.resolvedAt, reply: row.reply }));
}

export function serviceContacts(values: Existing.AdvisorContact[]): Participant.ServiceContact[] {
  return values.map(row => ({ stageNumber: row.grade, facilitatorName: row.teacherName, phone: row.phone,
    qrCodeUrl: row.qrCodeUrl.replace("/api/v1/parent/advisors/qr?", "/api/v1/participant/services/qr?") }));
}
