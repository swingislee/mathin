export type TeachingCalendarKind = "closed" | "teaching" | "makeup";
export type TeachingCalendarScheduleMode = "mapped" | "manual" | null;

export interface TeachingCalendarEntryV2 {
  id: string;
  campusId: string | null;
  campusName: string | null;
  name: string;
  kind: TeachingCalendarKind;
  startsOn: string;
  endsOn: string;
  scheduleMode: TeachingCalendarScheduleMode;
  mappedWeekday: number | null;
  createdAt: string;
}

export function effectiveTeachingCalendarEntry(
  entries: readonly TeachingCalendarEntryV2[],
  day: string,
  campusId: string | null,
): TeachingCalendarEntryV2 | null {
  const matches = entries.filter((entry) => entry.startsOn <= day && entry.endsOn >= day);
  if (campusId) {
    const campusEntry = matches.find((entry) => entry.campusId === campusId);
    if (campusEntry) return campusEntry;
  }
  return matches.find((entry) => entry.campusId === null) ?? null;
}

/**
 * A configured day replaces the ordinary weekly rule for that date:
 * - closed: never generated;
 * - mapped: generated only for classes whose weekly rule contains mappedWeekday;
 * - manual: open for explicit scheduling but never generated automatically.
 */
export function isAutomaticTeachingDay(
  entries: readonly TeachingCalendarEntryV2[],
  day: string,
  actualWeekday: number,
  classWeekdays: ReadonlySet<number>,
  campusId: string | null,
): boolean {
  const entry = effectiveTeachingCalendarEntry(entries, day, campusId);
  if (!entry) return classWeekdays.has(actualWeekday);
  if (entry.kind === "closed" || entry.scheduleMode === "manual") return false;
  return entry.scheduleMode === "mapped"
    && entry.mappedWeekday !== null
    && classWeekdays.has(entry.mappedWeekday);
}
