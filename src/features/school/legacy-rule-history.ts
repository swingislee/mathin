import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ORGANIZATION_RULE_DOMAINS, type OrganizationRuleDomain } from "./organization-settings-contract";

export interface LegacyOrganizationRuleVersionV2 {
  id: string;
  domain: OrganizationRuleDomain;
  version: number;
  value: Record<string, unknown>;
  effectiveFrom: string;
  effectiveUntil: string | null;
  reason: string;
  createdAt: string;
  createdBy: string;
  legacyCampusName: string | null;
}

const legacyRuleHistorySchema = z.array(z.object({
  id: z.string().uuid(),
  domain: z.enum(ORGANIZATION_RULE_DOMAINS),
  version: z.number().int().positive(),
  value: z.record(z.string(), z.unknown()),
  effectiveFrom: z.string(),
  effectiveUntil: z.string().nullable(),
  reason: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
  legacyCampusName: z.string().nullable(),
}));

export async function listLegacyOrganizationRuleHistoryV2(): Promise<LegacyOrganizationRuleVersionV2[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_legacy_organization_rule_history_v2");
  if (error) throw new Error(error.message);
  return legacyRuleHistorySchema.parse(data ?? []);
}
