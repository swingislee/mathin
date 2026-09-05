import { LEAD_STATUSES, type LeadPoolRow } from "./lead-contract";

export type LeadTableColumn =
  | "seed"
  | "interests"
  | "acquisitionLocation"
  | "acquiredAt"
  | "owner"
  | "latestContact"
  | "status";
export type LeadTableSortDirection = "asc" | "desc";
export type LeadTableFilters = Partial<Record<LeadTableColumn, string>>;
export interface LeadTableSort {
  column: LeadTableColumn;
  direction: LeadTableSortDirection;
}

export const NO_OWNER_FILTER = "$no-owner";
export const NO_CONTACT_FILTER = "$no-contact";
export const NO_ACQUISITION_LOCATION_FILTER = "$no-acquisition-location";
export const NO_ACQUISITION_TIME_FILTER = "$no-acquisition-time";
export const UNKNOWN_GRADE_FILTER = "$unknown-grade";

const ACQUISITION_TIME_ZONE = "Asia/Shanghai";

export function leadGradeFilterKey(lead: LeadPoolRow): string {
  if (lead.gradeText.trim()) return `text:${lead.gradeText.trim()}`;
  if (lead.gradeHint !== null) return `grade:${lead.gradeHint}`;
  return UNKNOWN_GRADE_FILTER;
}

export function leadAcquisitionDateFilterKey(value: string | null): string {
  if (!value) return NO_ACQUISITION_TIME_FILTER;
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: ACQUISITION_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function matchesFilters(lead: LeadPoolRow, filters: LeadTableFilters): boolean {
  if (filters.seed) {
    const selected = filters.seed;
    const matchesSeed = selected.startsWith("name:")
      ? lead.provisionalStudentName === selected.slice("name:".length)
      : selected.startsWith("phone:")
        ? lead.phone === selected.slice("phone:".length)
        : selected === "identity:unconfirmed"
          ? true
          : selected === "duplicate:true"
            ? lead.sourceMarkedDuplicate
            : selected.startsWith("suggested:")
              ? lead.suggestedStudentName === selected.slice("suggested:".length)
              : leadGradeFilterKey(lead) === selected;
    if (!matchesSeed) return false;
  }
  if (filters.interests && !lead.interests.includes(filters.interests)) return false;
  if (filters.acquisitionLocation) {
    const selected = filters.acquisitionLocation;
    const location = lead.acquisitionLocation.trim();
    const matchesAcquisition = selected.startsWith("promoter:")
      ? lead.acquisitionPromoter === selected.slice("promoter:".length)
      : selected.startsWith("method:")
        ? lead.acquisitionMethod === selected.slice("method:".length)
        : selected.startsWith("source-count:")
          ? lead.sourceCount === Number(selected.slice("source-count:".length))
          : selected === NO_ACQUISITION_LOCATION_FILTER
            ? location === ""
            : location === selected;
    if (!matchesAcquisition) return false;
  }
  if (filters.acquiredAt && leadAcquisitionDateFilterKey(lead.acquiredAt) !== filters.acquiredAt) return false;
  if (filters.owner) {
    if (filters.owner === NO_OWNER_FILTER ? lead.ownerId !== null : lead.ownerId !== filters.owner) return false;
  }
  if (filters.latestContact) {
    const selected = filters.latestContact;
    const matchesContact = selected.startsWith("contact-time:")
      ? lead.lastContactAt === selected.slice("contact-time:".length)
      : selected.startsWith("interest:")
        ? lead.interestLevel === selected.slice("interest:".length)
        : selected === "wechat:true"
          ? lead.wechatAdded === true
          : selected.startsWith("invitation:")
            ? `${lead.activeInvitation?.kind ?? ""}:${lead.activeInvitation?.state ?? ""}` === selected.slice("invitation:".length)
            : selected === "note:$empty"
              ? lead.lastContactAt !== null && lead.lastContactOutcome !== null && lead.lastContactNote === "" && lead.contactCount <= 1
              : selected.startsWith("note:")
                ? lead.lastContactNote === selected.slice("note:".length)
                : selected.startsWith("contact-count:")
                  ? lead.contactCount === Number(selected.slice("contact-count:".length))
                  : selected === NO_CONTACT_FILTER
                    ? lead.lastContactAt === null || lead.lastContactOutcome === null
                    : lead.lastContactOutcome === selected;
    if (!matchesContact) return false;
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
    if (sort.column === "acquiredAt") {
      return compareNullableTime(left.acquiredAt, right.acquiredAt, sort.direction);
    }
    if (sort.column === "status") {
      return direction * (LEAD_STATUSES.indexOf(left.status) - LEAD_STATUSES.indexOf(right.status));
    }
    const [leftValue, rightValue] = sort.column === "seed"
      ? [left.provisionalStudentName, right.provisionalStudentName]
      : sort.column === "interests"
        ? [left.interests.join(" · "), right.interests.join(" · ")]
        : sort.column === "acquisitionLocation"
          ? [left.acquisitionLocation, right.acquisitionLocation]
          : [left.ownerName, right.ownerName];
    return direction * collator.compare(leftValue, rightValue);
  });
}
