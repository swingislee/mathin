export const CALENDAR_EVENT_KINDS = ["meeting", "task", "preparation"] as const;
export type CalendarEventKind = typeof CALENDAR_EVENT_KINDS[number];
export type CalendarEventStatus = "scheduled" | "completed" | "cancelled";
export type CalendarInvitationResponse = "pending" | "accepted" | "declined";

export interface CalendarEvent {
  id: string;
  kind: CalendarEventKind;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  location: string;
  campusId: string | null;
  status: CalendarEventStatus;
  organizerId: string;
  organizerName: string;
  attendees: {
    userId: string;
    displayName: string;
    response: CalendarInvitationResponse;
    /** Tasks retain each assignee's completion independently. */
    completedAt: string | null;
  }[];
  updatedAt: string;
  canEdit: boolean;
  /** A task assignee completes only their own assignment; the event completes once all active assignees finish. */
  canComplete: boolean;
  myCompletedAt: string | null;
}

export interface CalendarWorkspace {
  currentUserId: string;
  people: { id: string; displayName: string }[];
  events: CalendarEvent[];
  canCreate: boolean;
}

export interface SaveCalendarEventInput {
  id: string;
  kind: CalendarEventKind;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  location: string;
  campusId: string | null;
  attendeeIds: string[];
  expectedUpdatedAt: string | null;
}
