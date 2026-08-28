import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { TeachingCalendarEntryV2 } from "./teaching-calendar";

const calendarEntriesSchema = z.array(z.object({
  id: z.string().uuid(),
  campusId: z.string().uuid().nullable(),
  campusName: z.string().nullable(),
  name: z.string(),
  kind: z.enum(["closed", "teaching", "makeup"]),
  startsOn: z.string(),
  endsOn: z.string(),
  scheduleMode: z.enum(["mapped", "manual"]).nullable(),
  mappedWeekday: z.number().int().min(0).max(6).nullable(),
  createdAt: z.string(),
}));

function dateOnlyToUtc(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("VALIDATION");
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function utcToDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDateOnly(value: string, days: number): string {
  const date = dateOnlyToUtc(value);
  date.setUTCDate(date.getUTCDate() + days);
  return utcToDateOnly(date);
}

export async function getTeachingCalendarRangeV2(from: string, to: string): Promise<TeachingCalendarEntryV2[]> {
  if (to < from) throw new Error("VALIDATION");
  const supabase = await createClient();
  const entries = new Map<string, TeachingCalendarEntryV2>();
  let cursor = from;
  while (cursor <= to) {
    const chunkEnd = addDateOnly(cursor, 729) < to ? addDateOnly(cursor, 729) : to;
    const { data, error } = await supabase.rpc("get_teaching_calendar_v2", {
      p_from: cursor,
      p_to: chunkEnd,
    });
    if (error) throw new Error(error.message);
    for (const entry of calendarEntriesSchema.parse(data ?? [])) entries.set(entry.id, entry);
    if (chunkEnd === to) break;
    cursor = addDateOnly(chunkEnd, 1);
  }
  return Array.from(entries.values()).sort((left, right) => (
    left.startsOn.localeCompare(right.startsOn)
    || Number(left.campusId !== null) - Number(right.campusId !== null)
    || left.id.localeCompare(right.id)
  ));
}

export async function listTeachingCalendarEntriesV2(): Promise<TeachingCalendarEntryV2[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_teaching_calendar_entries_v2");
  if (error) throw new Error(error.message);
  return calendarEntriesSchema.parse(data ?? []);
}

export function scheduleCalendarRange(startDate: string, lectureCount: number): { from: string; to: string } {
  const safeCount = Math.max(1, Math.min(200, Math.trunc(lectureCount)));
  return { from: startDate, to: addDateOnly(startDate, safeCount * 14 + 60) };
}
