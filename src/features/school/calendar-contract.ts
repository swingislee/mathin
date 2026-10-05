import type { TeachingCalendarEntryV2 } from "./teaching-calendar";

export const CALENDAR_EVENT_KINDS = ["meeting", "task", "preparation", "strategy", "milestone"] as const;
export type CalendarEventKind = typeof CALENDAR_EVENT_KINDS[number];
export type CalendarEventStatus = "scheduled" | "completed" | "cancelled";
export type CalendarInvitationResponse = "pending" | "accepted" | "declined";

export interface CalendarRecurrence {
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  /** Inclusive last occurrence date in timeZone. */
  until: string;
  timeZone: string;
}

export interface CalendarSchoolWindow {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface CalendarSchoolWindowsSettings {
  schoolWindows: CalendarSchoolWindow[];
  availableWindows: CalendarSchoolWindow[];
  updatedAt: string;
}

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
  seriesId: string | null;
  recurrence: CalendarRecurrence | null;
}

export interface CalendarWorkspace {
  currentUserId: string;
  people: { id: string; displayName: string }[];
  events: CalendarEvent[];
  canCreate: boolean;
  schoolWindows: CalendarSchoolWindow[];
  availableWindows: CalendarSchoolWindow[];
  settingsUpdatedAt: string | null;
  canManageSettings: boolean;
  teachingCalendar: TeachingCalendarEntryV2[];
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
  /** Creates a bounded series for a new id; editing an existing id changes only that occurrence. */
  recurrence?: CalendarRecurrence | null;
}
