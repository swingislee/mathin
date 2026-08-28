import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ORGANIZATION_FEATURE_KEYS } from "./organization-settings-contract";
import type { CapabilityReleaseV2 } from "./capability-release-contract";

const capabilityReleaseSchema = z.array(z.object({
  flagKey: z.enum(ORGANIZATION_FEATURE_KEYS),
  enabled: z.boolean(),
  effectiveVersionId: z.string().uuid().nullable(),
  financeReleaseLocked: z.boolean(),
  versions: z.array(z.object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    enabled: z.boolean(),
    effectiveFrom: z.string(),
    effectiveUntil: z.string().nullable(),
    reason: z.string(),
    createdAt: z.string(),
    createdBy: z.string(),
    isEffective: z.boolean(),
  })),
}));

export async function listCapabilityReleaseV2(): Promise<CapabilityReleaseV2[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_capability_release_v2");
  if (error) throw new Error(error.message);
  return capabilityReleaseSchema.parse(data ?? []);
}
