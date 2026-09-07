import { followupState, type ActivityEnrollmentContext } from "./enrollment-workflow-contract";
import type { InvitationCoordinationRow } from "./invitation-contract";
import type { LeadPoolRow } from "./lead-contract";
import type { HistoricalFirstContactRow } from "./historical-first-contact-contract";
import { communicationDayBounds, type CommunicationDayEvent, type CommunicationWorkday } from "./communication-workday-contract";
import { followupTableMessages } from "./followup-table-messages";
import type { DashboardFieldDefinitions, DashboardFieldOption } from "./dashboard-page/dashboard-table-field-contract";

interface FieldEvent { source: string; channel: string; outcome: string; occurredAt: string; note: string }
export type CommunicationTableRow = (
  | { id: string; source: "profile"; value: HistoricalFirstContactRow }
  | { id: string; source: "invitation"; value: InvitationCoordinationRow }
  | { id: string; source: "contact"; value: LeadPoolRow; previousInvitation?: InvitationCoordinationRow }
  | { id: string; source: "post_activity"; value: ActivityEnrollmentContext }
) & { fieldEvents?: readonly FieldEvent[] };
export const communicationTableRowKey = (row: CommunicationTableRow) => row.source === "profile" ? `student:${row.value.studentId}` : row.source === "post_activity"
  ? `post:${row.value.registrationId}` : `lead:${row.source === "contact" ? row.value.id : row.value.leadId}`;
export const COMMUNICATION_TABLE_COLUMNS = {
  name: ["name"], phone: ["phone"], grade: ["grade"], owner: ["owner"],
  state: ["status", "contactOutcome", "invitationState", "kind", "activity", "scheduledAt", "location", "assessor"],
  note: ["note", "channel"],
  updated: ["recordedAt", "lastContact", "nextContact"],
} as const;
type Translate = (key: string, values?: Record<string, string | number>) => string;
const option = (value: string | null | undefined, label = value): DashboardFieldOption[] => value ? [{ value, label: label || value }] : [];

export function communicationFieldDayEvents(workday?: CommunicationWorkday) {
  const result = new Map<string, CommunicationDayEvent[]>();
  if (!workday) return result;
  const bounds = communicationDayBounds(workday.date);
  for (const event of workday.events) {
    if (Date.parse(event.occurredAt) < Date.parse(bounds.start) || Date.parse(event.occurredAt) >= Date.parse(bounds.end)) continue;
    result.set(event.key, [...(result.get(event.key) ?? []), event]);
  }
  for (const events of result.values()) events.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || Date.parse(b.recordedAt) - Date.parse(a.recordedAt) || a.id.localeCompare(b.id));
  return result;
}

export function communicationTableFields({ locale, t, leadT, enrollmentT, tableT, workT, leads, workday, recordsMode }: {
  locale: string; t: Translate; leadT: Translate; enrollmentT: Translate; tableT: Translate; workT: Translate;
  leads: ReadonlyMap<string, LeadPoolRow>; workday?: CommunicationWorkday; recordsMode: boolean;
}): DashboardFieldDefinitions<CommunicationTableRow> {
  const m = followupTableMessages(locale), dayEvents = communicationFieldDayEvents(workday);
  const leadFor = (row: CommunicationTableRow) => row.source === "contact" ? row.value
    : row.source === "invitation" ? leads.get(row.value.leadId) : row.source === "post_activity" && row.value.leadId ? leads.get(row.value.leadId) : undefined;
  const invitation = (row: CommunicationTableRow) => row.source === "invitation" ? row.value : row.source === "contact" ? row.previousInvitation ?? row.value.activeInvitation : null;
  const laterContact = (row: CommunicationTableRow) => {
    const lead = leadFor(row), thread = invitation(row);
    return thread && ["completed", "cancelled"].includes(thread.state) && lead?.lastContactAt
      && Date.parse(lead.lastContactAt) > Date.parse(thread.updatedAt) ? lead : null;
  };
  const eventsFor = (row: CommunicationTableRow): readonly FieldEvent[] => {
    if (row.fieldEvents) return row.fieldEvents;
    if (recordsMode) return dayEvents.get(communicationTableRowKey(row)) ?? [];
    if (row.source === "post_activity") return row.value.contacts.slice(0, 1).map(event => ({ ...event, source: "post_activity" }));
    if (row.source === "invitation") {
      const contact = laterContact(row);
      if (contact) return [{ source: "contact", occurredAt: contact.lastContactAt!, outcome: contact.lastContactOutcome ?? "", channel: contact.lastContactChannel ?? "", note: contact.lastContactNote }];
      const latest = row.value.events.reduce<InvitationCoordinationRow["events"][number] | null>((a, b) => !a || b.occurredAt > a.occurredAt ? b : a, null);
      return latest ? [{ ...latest, source: "invitation", outcome: latest.toState }] : [];
    }
    const lead = leadFor(row);
    return lead?.lastContactAt ? [{ source: "contact", occurredAt: lead.lastContactAt, outcome: lead.lastContactOutcome ?? "", channel: lead.lastContactChannel ?? "", note: lead.lastContactNote }] : [];
  };
  const related = { group: "communication-event", rows: (row: CommunicationTableRow): CommunicationTableRow[] => eventsFor(row).length ? eventsFor(row).map(event => ({ ...row, fieldEvents: [event] })) : [{ ...row, fieldEvents: [] }] };
  const eventLabel = (event: FieldEvent) => event.source === "invitation" ? t(`state_${event.outcome}`) : workT(`outcome_${event.outcome}`);
  const statusValue = (row: CommunicationTableRow) => row.source === "profile" ? "profile" : row.source === "contact" ? `contact:${row.value.status}`
    : row.source === "invitation" ? `invitation:${row.value.state}` : `post:${followupState(row.value)}`;
  const statusLabel = (row: CommunicationTableRow) => row.source === "profile" ? leadT("firstContactEntry") : row.source === "contact" ? leadT(`status_${row.value.status}`)
    : row.source === "invitation" ? t(`state_${row.value.state}`) : enrollmentT(`state_${followupState(row.value)}`);
  const activity = (row: CommunicationTableRow) => row.source === "post_activity" ? { id: row.value.activityId, name: row.value.activityTitle }
    : invitation(row) ? { id: invitation(row)!.activityId, name: invitation(row)!.activityTitle } : null;
  const grade = (row: CommunicationTableRow) => row.source === "profile" || row.source === "post_activity" ? row.value.grade : row.source === "contact" ? row.value.gradeHint : row.value.gradeHint ?? leadFor(row)?.gradeHint;
  const recordedAt = (row: CommunicationTableRow) => recordsMode ? eventsFor(row)[0]?.occurredAt
    : row.source === "invitation" ? laterContact(row)?.lastContactAt ?? row.value.updatedAt : row.source === "post_activity" ? row.value.contacts[0]?.occurredAt ?? row.value.activityAt
      : row.source === "profile" ? null : leadFor(row)?.lastContactAt ?? leadFor(row)?.createdAt;
  return {
    name: { kind: "text", label: m.student, value: row => row.source === "invitation" ? row.value.leadName : row.source === "contact" ? row.value.provisionalStudentName : row.value.name },
    phone: { kind: "text", label: m.phone, value: row => row.value.phone },
    grade: { kind: "enum", label: m.grade, values: row => grade(row) ? option(String(grade(row)), leadT("gradeValue", { grade: grade(row)! })) : [], sortValue: grade },
    owner: { kind: "enum", label: m.owner, values: row => option(row.source === "post_activity" ? row.value.ownerId : leadFor(row)?.ownerId, leadFor(row)?.ownerName), sortValue: row => leadFor(row)?.ownerName },
    status: { kind: "enum", label: m.state, ...(recordsMode ? { related } : {}), values: row => recordsMode ? eventsFor(row).flatMap(event => option(`${event.source}:${event.outcome}`, eventLabel(event))) : option(statusValue(row), statusLabel(row)) },
    contactOutcome: { kind: "enum", label: m.contactOutcome, related, values: row => eventsFor(row).filter(event => event.source !== "invitation" && event.outcome).flatMap(event => option(event.outcome, workT(`outcome_${event.outcome}`))) },
    invitationState: { kind: "enum", label: m.invitationState, ...(recordsMode ? { related } : {}), values: row => recordsMode ? eventsFor(row).filter(event => event.source === "invitation").flatMap(event => option(event.outcome, t(`state_${event.outcome}`)))
      : invitation(row) ? option(invitation(row)!.state, t(`state_${invitation(row)!.state}`)) : [] },
    kind: { kind: "enum", label: m.arrangement, values: row => invitation(row) ? option(invitation(row)!.kind, t(`kind_${invitation(row)!.kind}`)) : row.source === "post_activity" ? option("post_activity", t("queue_post_activity")) : option("first_contact", leadT("firstContactEntry")) },
    activity: { kind: "enum", label: tableT("fieldActivity"), values: row => option(activity(row)?.id, activity(row)?.name), sortValue: row => activity(row)?.name },
    scheduledAt: { kind: "date", label: m.arrangementDate, value: row => row.source === "post_activity" ? row.value.activityAt : invitation(row)?.scheduledAt ?? invitation(row)?.activityScheduledAt },
    location: { kind: "enum", label: tableT("fieldLocation"), values: row => option(invitation(row)?.locationText), sortValue: row => invitation(row)?.locationText },
    assessor: { kind: "enum", label: tableT("fieldAssessor"), values: row => option(invitation(row)?.assessorId, invitation(row)?.assessorName), sortValue: row => invitation(row)?.assessorName },
    channel: { kind: "enum", label: m.contactMethod, related, values: row => eventsFor(row).filter(event => ["phone", "wechat", "in_person", "other"].includes(event.channel)).flatMap(event => option(event.channel, t(`channel_${event.channel}`))) },
    recordedAt: { kind: "date", label: m.recordedAt, ...(recordsMode ? { related } : {}), value: recordedAt },
    lastContact: { kind: "date", label: m.lastContact, value: row => leadFor(row)?.lastContactAt ?? (row.source === "post_activity" ? row.value.contacts[0]?.occurredAt : null) },
    nextContact: { kind: "date", label: m.nextContact, value: row => invitation(row)?.nextContactAt ?? leadFor(row)?.nextContactAt ?? (row.source === "post_activity" ? row.value.contacts[0]?.nextContactAt : null) },
    note: { kind: "text", label: m.note, ...(recordsMode ? { related } : {}), value: row => recordsMode ? eventsFor(row).map(event => event.note).join(" ")
      : [leadFor(row)?.lastContactNote, row.source === "invitation" ? row.value.summary : row.source === "post_activity" ? row.value.routeNote : row.source === "profile" ? row.value.context : ""].filter(Boolean).join(" "), sortable: false },
  };
}
