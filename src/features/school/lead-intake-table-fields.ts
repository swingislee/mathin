import { LEAD_STATUSES, type LeadPoolRow } from "./lead-contract";
import { INVITATION_STATES } from "./invitation-contract";
import type { DashboardFieldDefinitions, DashboardFieldOption } from "./dashboard-page/dashboard-table-field-contract";

type Translate = (key: string, values?: Record<string, string | number>) => string;
const option = (value: string | null | undefined, label = value): DashboardFieldOption[] => value ? [{ value, label: label || value }] : [];
export const LEAD_INTAKE_TABLE_COLUMNS = {
  identity: ["name", "identity", "duplicate", "suggested"], phone: ["phone"], grade: ["grade"],
  source: ["location", "promoter", "method", "content", "acquisitionGroup", "interest", "sourceCount"], acquiredAt: ["acquiredAt", "acquiredDateLabel"],
  owner: ["owner"], progress: ["status", "invitationState", "contactResult"],
} as const;

export function leadIntakeTableFields(t: Translate, tableT: Translate, invitationT: Translate): DashboardFieldDefinitions<LeadPoolRow> {
  return {
    name: { kind: "text", label: tableT("fieldName"), value: row => row.provisionalStudentName },
    phone: { kind: "text", label: tableT("fieldPhone"), value: row => row.phone },
    identity: { kind: "enum", label: tableT("fieldIdentity"), values: row => option(row.studentId ? "confirmed" : "unconfirmed", t(row.studentId ? "identityConfirmed" : "identityUnconfirmed")) },
    duplicate: { kind: "enum", label: tableT("fieldDuplicate"), values: row => row.sourceMarkedDuplicate ? option("duplicate", t("sourceDuplicateShort")) : [] },
    suggested: { kind: "text", label: tableT("fieldSuggestedStudent"), value: row => row.suggestedStudentName },
    grade: { kind: "enum", label: tableT("fieldGrade"), values: row => row.gradeHint ? option(String(row.gradeHint), t("gradeValue", { grade: row.gradeHint })) : [], sortValue: row => row.gradeHint },
    location: { kind: "enum", label: tableT("fieldLocation"), values: row => option(row.acquisitionLocation), sortValue: row => row.acquisitionLocation },
    promoter: { kind: "text", label: tableT("fieldPromoter"), value: row => row.acquisitionPromoter },
    method: { kind: "text", label: tableT("fieldMethod"), value: row => row.acquisitionMethod },
    content: { kind: "text", label: t("acquisitionContent"), value: row => (row.baseAcquisitionSources ?? []).map(source => source.content).filter(Boolean).join("\n") },
    acquisitionGroup: { kind: "enum", label: t("acquisitionGroup"), values: row => (row.baseAcquisitionSources ?? []).flatMap(source => option(source.group)), sortable: false },
    interest: { kind: "enum", label: tableT("fieldInterest"), values: row => row.interests.flatMap(value => option(value)), sortable: false },
    sourceCount: { kind: "number", label: tableT("fieldSourceCount"), value: row => row.sourceCount, step: 1 },
    acquiredAt: { kind: "date", label: t("acquiredAt"), value: row => row.acquiredAt },
    acquiredDateLabel: { kind: "text", label: t("acquiredDateLabel"), value: row => (row.baseAcquisitionSources ?? []).map(source => source.dateLabel).filter(Boolean).join("\n") },
    owner: { kind: "enum", label: tableT("fieldOwner"), values: row => option(row.ownerId, row.ownerName), sortValue: row => row.ownerId ? row.ownerName : null },
    status: { kind: "enum", label: tableT("fieldStatus"), options: LEAD_STATUSES.map(value => ({ value, label: t(`status_${value}`) })),
      values: row => option(row.status, t(`status_${row.status}`)), sortValue: row => LEAD_STATUSES.indexOf(row.status) },
    invitationState: { kind: "enum", label: invitationT("title"), options: INVITATION_STATES.map(value => ({ value, label: invitationT(`state_${value}`) })),
      values: row => row.activeInvitation ? option(row.activeInvitation.state, invitationT(`state_${row.activeInvitation.state}`)) : [],
      sortValue: row => row.activeInvitation ? INVITATION_STATES.indexOf(row.activeInvitation.state) : null },
    contactResult: { kind: "enum", label: tableT("fieldContactResult"), values: row => option(row.lastContactOutcome, row.lastContactOutcome ? t(`contactOutcome_${row.lastContactOutcome}`) : "") },
  };
}
