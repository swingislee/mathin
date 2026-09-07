import type { RenewalPoolRow } from "./RenewalRecordDetails";
import { isCurrentBusinessRecord } from "./business-record-state-contract";
import { followupTableMessages } from "./followup-table-messages";
import { RENEWAL_SEASONS, RENEWAL_CONTACT_METHODS, RENEWAL_PAYMENT_METHODS } from "./renewal-workbench-contract";
import type { DashboardFieldDefinitions, DashboardFieldOption } from "./dashboard-page/dashboard-table-field-contract";

type Translate = (key: string, values?: Record<string, string | number>) => string;
const option = (value: string | null | undefined, label = value): DashboardFieldOption[] => value ? [{ value, label: label || value }] : [];
export const RENEWAL_TABLE_COLUMNS = {
  name: ["name", "phone", "grade", "owner"], classroom: ["classroom", "teacher", "sourceText"],
  seasons: ["seasons", "targetTerm", "course", "contactMethod"], health: ["health", "observation"], stage: ["stage"],
  payment: ["paymentMethod", "amount", "paidOn", "periods"], next: ["nextAt", "due", "note"],
} as const;
export function renewalTableFields({ locale, now, t, pool, resultFor, labelFor, healthFor, observationFor }: {
  locale: string; now: number; t: Translate; pool: Translate;
  resultFor: (row: RenewalPoolRow) => string; labelFor: (row: RenewalPoolRow) => string;
  healthFor: (row: RenewalPoolRow) => string | null; observationFor: (row: RenewalPoolRow) => string;
}): DashboardFieldDefinitions<RenewalPoolRow> {
  const m = followupTableMessages(locale);
  return {
    name: { kind: "text", label: m.student, value: row => row.name },
    phone: { kind: "text", label: m.phone, value: row => row.phone },
    grade: { kind: "enum", label: m.grade, values: row => row.grade ? option(String(row.grade), String(row.grade)) : [], sortValue: row => row.grade },
    owner: { kind: "enum", label: m.owner, values: row => option(row.ownerId, row.owner), sortValue: row => row.ownerId ? row.owner : null },
    classroom: { kind: "enum", label: pool("classroom"), values: row => option(row.classroomId, row.classroom), sortValue: row => row.classroomId ? row.classroom : null },
    teacher: { kind: "enum", label: m.teacher, values: row => (row.teachers ?? []).flatMap(item => option(item.id, item.name)), sortValue: row => row.teachers?.length ? row.teacher : null },
    sourceText: { kind: "text", label: m.sourceText, value: row => isCurrentBusinessRecord(row.recordState) ? "" : [row.classroom, row.teacher, row.note].join(" "), sortable: false },
    seasons: { kind: "enum", label: t("seasons"), options: RENEWAL_SEASONS.map(value => ({ value, label: t(`season_${value}`) })),
      values: row => row.record?.seasons.flatMap(value => option(value, t(`season_${value}`))) ?? [],
      hint: locale.startsWith("zh") ? "按最早所选季节排序：寒、春、暑、秋。" : "Sort by earliest selected season: winter, spring, summer, autumn.",
      sortValue: row => row.record?.seasons.length ? Math.min(...row.record.seasons.map(value => RENEWAL_SEASONS.indexOf(value))) : null },
    targetTerm: { kind: "enum", label: m.targetTerm, values: row => option(row.targetTermId, row.targetTermName), sortValue: row => row.targetTermName },
    course: { kind: "enum", label: m.course, values: row => option(row.targetCourseId, row.targetCourse), sortValue: row => row.targetCourseId ? row.targetCourse : null },
    contactMethod: { kind: "enum", label: m.contactMethod, options: RENEWAL_CONTACT_METHODS.map(value => ({ value, label: t(`contact_${value}`) })), values: row => option(row.record?.contactMethod, row.record?.contactMethod ? t(`contact_${row.record.contactMethod}`) : "") },
    health: { kind: "enum", label: t("learning"), values: row => option(healthFor(row), healthFor(row) ? pool(healthFor(row)!) : ""), sortable: false },
    observation: { kind: "text", label: t("learning"), value: observationFor, sortable: false },
    stage: { kind: "enum", label: t("result"), values: row => option(resultFor(row), labelFor(row)) },
    paymentMethod: { kind: "enum", label: t("paymentMethod"), options: RENEWAL_PAYMENT_METHODS.map(value => ({ value, label: t(`payment_${value}`) })), values: row => option(row.record?.paymentMethod, row.record?.paymentMethod ? t(`payment_${row.record.paymentMethod}`) : "") },
    amount: { kind: "number", label: m.amount, value: row => row.payment?.paid_amount, step: 0.01 },
    paidOn: { kind: "date", label: m.paidOn, value: row => row.record?.paidOn },
    periods: { kind: "number", label: m.periods, value: row => row.payment?.period_count, step: 1 },
    nextAt: { kind: "date", label: m.nextContact, value: row => row.nextContactAt },
    due: { kind: "enum", label: m.state, values: row => row.nextContactAt ? option(Date.parse(row.nextContactAt) <= now ? "due" : "scheduled", t(Date.parse(row.nextContactAt) <= now ? "contactDue" : "contactScheduled")) : [] },
    note: { kind: "text", label: m.note, value: row => [row.note, row.payment?.note].filter(Boolean).join(" "), sortable: false },
  };
}
