"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { ORGANIZATION_FEATURE_KEYS, type OrganizationFeatureKey } from "../organization-settings-contract";
import { authorizedClient } from "./guards";
import { COMMON_CODES, datetime, parse, requiredText, uuid } from "./schemas";

const CAPABILITY_CODES = [
  "INVALID_FEATURE_FLAG",
  "FINANCE_RELEASE_CLOSED",
  "NOT_FOUND",
  ...COMMON_CODES,
] as const;

const capabilityVersionSchema = z.object({
  flagKey: z.enum(ORGANIZATION_FEATURE_KEYS),
  enabled: z.boolean(),
  effectiveAt: datetime,
  reason: requiredText(200),
});

export async function setCapabilityReleaseAction(input: {
  flagKey: OrganizationFeatureKey;
  enabled: boolean;
  effectiveAt: string;
  reason: string;
}): Promise<ActionResult> {
  try {
    const value = parse(capabilityVersionSchema, input);
    const { supabase } = await authorizedClient("system.operations.manage");
    const { error } = await supabase.rpc("set_feature_flag_v2", {
      p_flag_key: value.flagKey,
      p_enabled: value.enabled,
      p_effective_from: value.effectiveAt,
      p_reason: value.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, CAPABILITY_CODES);
  }
}

export async function rollbackCapabilityReleaseAction(
  versionId: string,
  effectiveAt: string,
  reason: string,
): Promise<ActionResult> {
  try {
    const value = parse(z.object({ versionId: uuid, effectiveAt: datetime, reason: requiredText(200) }), {
      versionId,
      effectiveAt,
      reason,
    });
    const { supabase } = await authorizedClient("system.operations.manage");
    const { error } = await supabase.rpc("rollback_feature_flag_v2", {
      p_version_id: value.versionId,
      p_effective_from: value.effectiveAt,
      p_reason: value.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, CAPABILITY_CODES);
  }
}
