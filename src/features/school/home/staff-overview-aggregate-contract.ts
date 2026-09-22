import { z } from "zod";

export const OVERVIEW_AGGREGATE_METRICS = ["leads", "contacts"] as const;
const count = z.number().int().nonnegative();
const comparison = z.object({
  current: count,
  previous: count,
  trend: z.array(z.object({
    currentDate: z.string().datetime().nullable(),
    previousDate: z.string().datetime().nullable(),
    current: count.nullable(),
    previous: count.nullable(),
  })).max(32),
});
const metric = z.object({
  available: z.boolean(),
  missingDates: count,
  comparison: comparison.nullable(),
  people: z.array(z.object({ personId: z.string().nullable(), current: count, previous: count })),
}).superRefine((value, context) => {
  if (value.available !== (value.comparison !== null) || !value.available && value.people.length !== 0) {
    context.addIssue({ code: "custom", message: "Overview availability and values disagree" });
  }
});

/** 两项指标的数据库结果；不包含来源原文或全量业务记录。 */
export const overviewAcquisitionContactSummarySchema = z.object({
  schemaVersion: z.literal(2),
  // 不可用获客的计数仍为 null；保留原本可见的人员行身份。
  leadPersonIds: z.array(z.string().nullable()),
  sourceStaffIds: z.array(z.string().startsWith("source-staff:").refine(value => {
    try { return encodeURIComponent(decodeURIComponent(value.slice(13))) === value.slice(13); } catch { return false; }
  })),
  metrics: z.object({ leads: metric, contacts: metric }),
});
export type OverviewAcquisitionContactSummary = z.infer<typeof overviewAcquisitionContactSummarySchema>;
