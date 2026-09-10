import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { studentStageRpc } from "./student-stage-data";
import { baseLeadAcquisitionSchema } from "./base-business-fields-contract";
import { applyBaseLeadAcquisition } from "./base-lead-acquisition";
import type { LeadPoolRow } from "./lead-contract";

export async function withBaseLeadAcquisition(client: Awaited<ReturnType<typeof createClient>>, rows: readonly LeadPoolRow[]) {
  if (!rows.length) return [];
  const data = baseLeadAcquisitionSchema.parse(await studentStageRpc(client, "read_base_lead_acquisition", { p_lead_ids: rows.map(row => row.id) }));
  const sources = new Map(data.map(row => [row.leadId, row.sources]));
  return rows.map(row => applyBaseLeadAcquisition(row, sources.get(row.id) ?? []));
}
