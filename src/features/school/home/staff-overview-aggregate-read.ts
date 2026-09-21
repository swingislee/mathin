import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getOrganizationTimezoneV2 } from "@/features/school/organization-locations";
import { buildStaffOverviewWindow, type StaffOverviewGrain } from "./staff-overview-contract";
import { overviewAcquisitionContactSummarySchema } from "./staff-overview-aggregate-contract";

/** 首批读取器供完整 v2 总览接入；能力缺失或结果异常时显式失败。 */
export async function readStaffOverviewAcquisitionContacts({ grain, date, now = new Date() }: {
  grain: StaffOverviewGrain;
  date?: string;
  now?: Date;
}) {
  const [supabase, timeZone] = await Promise.all([createClient(), getOrganizationTimezoneV2()]);
  const window = buildStaffOverviewWindow(grain, now, timeZone, date);
  if (grain === "month") window.previousCutoff = window.previousEnd;
  const result = await supabase.rpc("get_staff_overview_acquisition_contacts_v2", {
    p_window: {
      grain, timeZone,
      currentStart: window.currentStart.toISOString(), currentEnd: window.currentEnd.toISOString(), currentCutoff: window.currentCutoff.toISOString(),
      previousStart: window.previousStart.toISOString(), previousEnd: window.previousEnd.toISOString(), previousCutoff: window.previousCutoff.toISOString(),
    },
  });
  if (result.error) throw new Error("OVERVIEW_AGGREGATE_UNAVAILABLE", { cause: result.error });
  const parsed = overviewAcquisitionContactSummarySchema.safeParse(result.data);
  if (!parsed.success) throw new Error("OVERVIEW_AGGREGATE_INVALID_RESULT");
  return { ...parsed.data, window, generatedAt: now.toISOString(), timeZone };
}
