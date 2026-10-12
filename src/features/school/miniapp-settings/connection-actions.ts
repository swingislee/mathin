"use server";
import { z } from "zod";
import { authorizedClient } from "../actions/guards";
import { actionError, type ActionResult } from "@/lib/action-result";
import { providerConfiguration, providerHandshake } from "@/features/participant-portal/provider-transport";
import { experienceId } from "./experience-schema";
import type { ProviderCapability } from "../../../../contracts/participant-api/miniapp-experience";
export async function inspectExperienceConnection(id: string, probe = false): Promise<ActionResult<{ configured: boolean; connected: boolean; capabilities: ProviderCapability[]; contracts: string[] }>> {
  try { experienceId.parse(id); z.boolean().parse(probe); await authorizedClient("organization.profile.manage");
    if (!providerConfiguration(id)) return { ok: true, data: { configured: false, connected: false, capabilities: [], contracts: [] } };
    if (!probe) return { ok: true, data: { configured: true, connected: false, capabilities: [], contracts: [] } };
    const response = await providerHandshake(id, true); return { ok: true, data: { configured: true, connected: true, capabilities: response.capabilities, contracts: response.contracts } };
  } catch (e) { return actionError(e, ["FORBIDDEN", "VALIDATION", "UNAVAILABLE"]); }
}
