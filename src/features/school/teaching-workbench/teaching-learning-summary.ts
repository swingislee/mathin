import { z } from "zod";
import type { TeachingRecords } from "./teaching-records-contract";

export const teachingObservationSchema = z.object({
  explained: z.number(), independent: z.number(), prompted: z.number(), imitated: z.number(), incomplete: z.number(),
  recordedChecks: z.number(), totalChecks: z.number(),
  focusChecks: z.array(z.object({ title: z.string(), supported: z.number(), recorded: z.number() })),
});
export type TeachingObservations = z.infer<typeof teachingObservationSchema>;
export function hasWrittenReview(review: TeachingRecords["reviews"][number]) {
  return Boolean(review.comment.trim()) || [review.entryScore, review.exitScore, review.focus, review.participation, review.mastery].some(value => value !== null);
}
export function summarizeTeachingObservations(data: TeachingRecords): TeachingObservations {
  const counts = { explained: 0, independent: 0, prompted: 0, imitated: 0, incomplete: 0 };
  for (const result of data.results) counts[result.status]++;
  const checks = data.checks.map(check => {
    const results = data.results.filter(result => result.checkId === check.id);
    return { title: check.title, recorded: results.length, supported: results.filter(result => ["prompted", "imitated", "incomplete"].includes(result.status)).length };
  });
  return { ...counts, recordedChecks: checks.filter(check => check.recorded).length, totalChecks: checks.length,
    focusChecks: checks.filter(check => check.supported).sort((a,b) => b.supported / b.recorded - a.supported / a.recorded || b.supported - a.supported) };
}
export function mergeTeachingObservations(values: TeachingObservations[]) {
  if (!values.length) return undefined;
  return values.reduce((sum, item) => ({ explained: sum.explained + item.explained, independent: sum.independent + item.independent,
    prompted: sum.prompted + item.prompted, imitated: sum.imitated + item.imitated, incomplete: sum.incomplete + item.incomplete,
    recordedChecks: sum.recordedChecks + item.recordedChecks, totalChecks: sum.totalChecks + item.totalChecks,
    focusChecks: [...sum.focusChecks, ...item.focusChecks].sort((a,b) => b.supported / b.recorded - a.supported / a.recorded || b.supported - a.supported),
  }), { explained: 0, independent: 0, prompted: 0, imitated: 0, incomplete: 0, recordedChecks: 0, totalChecks: 0, focusChecks: [] } as TeachingObservations);
}
