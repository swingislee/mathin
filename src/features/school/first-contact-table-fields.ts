import { communicationTableRowKey, type CommunicationTableRow } from "./communication-table-fields";
import type { DashboardFieldDefinitions } from "./dashboard-page/dashboard-table-field-contract";
import type { StudentStageRow } from "./student-stage-contract";
import { studentStageTableFields } from "./student-stage-table-fields";

/** 内嵌首联沿用七列表格，列条件使用外层学生名单的服务端字段合同。 */
export const FIRST_CONTACT_TABLE_COLUMNS = {
  name: ["name"], phone: ["phone"], grade: ["grade"], owner: ["owner", "group", "scope"],
  state: ["detail", "sourceReview", "sourceArrangement"], note: ["note"], updated: ["lastContactAt"],
} as const;

export function firstContactTableFields(locale: string, currentUserId: string, rows: readonly StudentStageRow[]): DashboardFieldDefinitions<CommunicationTableRow> {
  const source = new Map(rows.map(row => [row.leadId ? `lead:${row.leadId}` : `student:${row.studentId}`, row]));
  const fields = studentStageTableFields(locale, "awaiting_first_contact", currentUserId);
  return Object.fromEntries(Object.entries(fields).map(([id, field]) => {
    const rowFor = (row: CommunicationTableRow) => source.get(communicationTableRowKey(row));
    const sortValue = field.sortValue ? (row: CommunicationTableRow) => {
      const value = rowFor(row);
      return value ? field.sortValue!(value) : null;
    } : undefined;
    const common = { label: field.label, hint: field.hint, sortable: field.sortable, requiresSingleValue: field.requiresSingleValue, sortValue };
    if (field.kind === "enum") return [id, { ...common, kind: field.kind, options: field.options, multiple: field.multiple, values: (row: CommunicationTableRow) => {
      const value = rowFor(row);
      return value ? field.values(value) : [];
    } }];
    if (field.kind === "number") return [id, { ...common, kind: field.kind, step: field.step, value: (row: CommunicationTableRow) => {
      const value = rowFor(row);
      return value ? field.value(value) : null;
    } }];
    return [id, { ...common, kind: field.kind, value: (row: CommunicationTableRow) => {
      const value = rowFor(row);
      return value ? field.value(value) : null;
    } }];
  }));
}
