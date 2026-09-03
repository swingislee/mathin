import { LEAD_STATUSES, type LeadPoolRow } from "./leads";

export type LeadTableColumn = "seed" | "interests" | "owner" | "latestContact" | "status";
export type LeadTableSortDirection = "asc" | "desc";
export type LeadTableFilters = Partial<Record<LeadTableColumn, string>>;
export interface LeadTableSort {
  column: LeadTableColumn;
  direction: LeadTableSortDirection;
}

export const NO_OWNER_FILTER = "$no-owner";
export const NO_CONTACT_FILTER = "$no-contact";
export const UNKNOWN_GRADE_FILTER = "$unknown-grade";

export function leadGradeFilterKey(lead: LeadPoolRow): string {
  if (lead.gradeText.trim()) return `text:${lead.gradeText.trim()}`;
  if (lead.gradeHint !== null) return `grade:${lead.gradeHint}`;
  return UNKNOWN_GRADE_FILTER;
}

function matchesFilters(lead: LeadPoolRow, filters: LeadTableFilters): boolean {
  if (filters.seed && leadGradeFilterKey(lead) !== filters.seed) return false;
  if (filters.interests && !lead.interests.includes(filters.interests)) return false;
  if (filters.owner) {
    if (filters.owner === NO_OWNER_FILTER ? lead.ownerId !== null : lead.ownerId !== filters.owner) return false;
  }
  if (filters.latestContact) {
    if (filters.latestContact === NO_CONTACT_FILTER
      ? lead.lastContactOutcome !== null
      : lead.lastContactOutcome !== filters.latestContact) return false;
  }
  if (filters.status && lead.status !== filters.status) return false;
  return true;
}

function compareNullableTime(left: string | null, right: string | null, direction: LeadTableSortDirection): number {
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  const result = new Date(left).getTime() - new Date(right).getTime();
  return direction === "asc" ? result : -result;
}

export function filterAndSortLeadRows(
  leads: readonly LeadPoolRow[],
  filters: LeadTableFilters,
  sort: LeadTableSort | null,
  locale: string,
): LeadPoolRow[] {
  const rows = leads.filter((lead) => matchesFilters(lead, filters));
  if (!sort) return rows;
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const direction = sort.direction === "asc" ? 1 : -1;

  return rows.sort((left, right) => {
    if (sort.column === "latestContact") {
      return compareNullableTime(left.lastContactAt, right.lastContactAt, sort.direction);
    }
    if (sort.column === "status") {
      return direction * (LEAD_STATUSES.indexOf(left.status) - LEAD_STATUSES.indexOf(right.status));
    }
    const [leftValue, rightValue] = sort.column === "seed"
      ? [left.provisionalStudentName, right.provisionalStudentName]
      : sort.column === "interests"
        ? [left.interests.join(" · "), right.interests.join(" · ")]
        : [left.ownerName, right.ownerName];
    return direction * collator.compare(leftValue, rightValue);
  });
}
