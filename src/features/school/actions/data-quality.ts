"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { DataQualityRun } from "../data-quality";
import { authorizedClient } from "./guards";

export async function runDataQualityScanAction(): Promise<ActionResult<DataQualityRun>> {
  try {
    const { supabase } = await authorizedClient("system.operations.manage");
    const { data, error } = await supabase.rpc("run_data_quality_scan");
    if (error || !data) throw new Error(error?.message || "QUALITY_SCAN_FAILED");
    revalidatePath("/[locale]/dashboard/data-maintenance", "page");
    return { ok: true, data: data as unknown as DataQualityRun };
  } catch (error) {
    return actionError<DataQualityRun>(error, ["UNAUTHENTICATED", "FORBIDDEN"], "QUALITY_SCAN_FAILED");
  }
}