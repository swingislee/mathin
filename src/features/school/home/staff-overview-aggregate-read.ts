import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getOrganizationTimezoneV2 } from "@/features/school/organization-locations";
import { buildStaffOverviewWindow, type StaffOverviewGrain, type StaffOverviewWindow } from "./staff-overview-contract";
import { overviewAcquisitionContactSummarySchema } from "./staff-overview-aggregate-contract";

/** 独立读取入口；总览可复用已经取得的客户端、时区和期间。 */
export async function readStaffOverviewAcquisitionContacts({ grain, date, now = new Date() }: {
  grain: StaffOverviewGrain;
  date?: string;
  now?: Date;
}) {
  const [supabase, timeZone] = await Promise.all([createClient(), getOrganizationTimezoneV2()]);
  const window = buildStaffOverviewWindow(grain, now, timeZone, date);
  if (grain === "month") window.previousCutoff = window.previousEnd;
  const summary = await readOverviewAcquisitionContactSummary(supabase, window, timeZone);
  return { ...summary, window, generatedAt: now.toISOString(), timeZone };
}

export async function readOverviewAcquisitionContactSummary(
  supabase: Awaited<ReturnType<typeof createClient>>, window: StaffOverviewWindow, timeZone: string,
) {
  const result = await supabase.rpc("get_staff_overview_acquisition_contacts_v2", {
    p_window: {
      grain: window.grain, timeZone,
      currentStart: window.currentStart.toISOString(), currentEnd: window.currentEnd.toISOString(), currentCutoff: window.currentCutoff.toISOString(),
      previousStart: window.previousStart.toISOString(), previousEnd: window.previousEnd.toISOString(), previousCutoff: window.previousCutoff.toISOString(),
    },
  });
  if (result.error) throw new Error("OVERVIEW_AGGREGATE_UNAVAILABLE", { cause: result.error });
  const parsed = overviewAcquisitionContactSummarySchema.safeParse(result.data);
  if (!parsed.success) throw new Error("OVERVIEW_AGGREGATE_INVALID_RESULT");
  return parsed.data;
}
