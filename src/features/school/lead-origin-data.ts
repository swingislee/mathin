import "server-only";
import { z } from "zod";
import { studentStageRpc } from "./student-stage-data";
import type { createClient } from "@/lib/supabase/server";

const origins = z.array(z.object({ leadId: z.string(), occurredAt: z.string().nullable(), sourceOwnerName: z.string().nullable(), imported: z.boolean() }));

export async function readLeadOrigins(client: Awaited<ReturnType<typeof createClient>>, leadIds: string[]) {
  if (!leadIds.length) return [];
  return origins.parse(await studentStageRpc(client, "get_lead_origin_events", { p_lead_ids: leadIds }));
}
