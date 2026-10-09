"use server";

import { z } from "zod";
import { authorizedClient } from "../actions/guards";
import { promotionDashboardSchema, promotionRecordSchema, promotionSettingsSchema, verifiedFamilySchema, type VerifiedFamily } from "./contract";
import { familyFormConfigSchema, familyFormSchema } from "@/features/parent-portal/family-form";
import type { FamilyFormConfig } from "../../../../contracts/participant-api/onboarding";

type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const scene = z.string().regex(/^[a-f0-9]{24}$/);
export async function readPromotionSettings() {
  const { supabase } = await authorizedClient("registration.invite.manage");
  const result = await (supabase.rpc as unknown as Rpc)("miniapp_promotion_settings", {});
  if (result.error) throw new Error("UNAVAILABLE");
  return promotionSettingsSchema.parse(result.data);
}
export async function readWechatFamily(input: { studentId: string | null; leadId: string | null }) {
  const value = z.object({ studentId: z.string().uuid().nullable(), leadId: z.string().uuid().nullable() }).strict().parse(input);
  const { supabase } = await authorizedClient("followup.view");
  const result = await (supabase.rpc as unknown as Rpc)("miniapp_family_for_subject", { p_student: value.studentId, p_lead: value.leadId });
  if (result.error) throw new Error("UNAVAILABLE");
  return promotionRecordSchema.nullable().parse(result.data);
}
export async function readPromotions(input: { scene: string | null; page: number }) {
  const value = z.object({ scene: scene.nullable(), page: z.number().int().min(1).max(100000) }).parse(input);
  const { supabase } = await authorizedClient("registration.invite.manage");
  const result = await (supabase.rpc as unknown as Rpc)("miniapp_promotion_dashboard", { p_scene: value.scene, p_page: value.page });
  if (result.error) throw new Error("UNAVAILABLE");
  return promotionDashboardSchema.parse(result.data);
}
export async function savePromotion(input: { scene: string | null; name: string; enabled: boolean }) {
  const value = z.object({ scene: scene.nullable(), name: z.string().trim().min(1).max(100), enabled: z.boolean() }).parse(input);
  const { supabase } = await authorizedClient("registration.invite.manage");
  const result = await (supabase.rpc as unknown as Rpc)("miniapp_manage_promotion", { p_scene: value.scene, p_name: value.name, p_enabled: value.enabled });
  if (result.error) throw new Error("UNAVAILABLE");
  return scene.parse(result.data);
}

export async function readPromotionForm(input: string | null) {
  const value = scene.nullable().parse(input);
  const { supabase } = await authorizedClient("registration.invite.manage");
  const result = await (supabase.rpc as unknown as Rpc)("miniapp_read_family_form", { p_scene: value });
  if (result.error) throw new Error("UNAVAILABLE");
  return familyFormSchema.parse(result.data);
}

export async function savePromotionForm(input: { scene: string | null; version: number; config: FamilyFormConfig }) {
  const value = z.object({ scene: scene.nullable(), version: z.number().int().positive(), config: familyFormConfigSchema }).strict().parse(input);
  const { supabase } = await authorizedClient("registration.invite.manage");
  const result = await (supabase.rpc as unknown as Rpc)("miniapp_save_family_form", { p_scene: value.scene, p_version: value.version, p_config: value.config });
  if (result.error) throw new Error(result.error.message === "FORM_CHANGED" ? "FORM_CHANGED" : "UNAVAILABLE");
  return familyFormSchema.parse(result.data);
}

export async function verifyPromotionFamily(input: { id: string; expectedAt: string | null; details: VerifiedFamily }) {
  const value = z.object({ id: z.string().uuid(), expectedAt: z.string().datetime({ offset: true }).nullable(), details: verifiedFamilySchema }).strict().parse(input);
  const { supabase } = await authorizedClient("registration.invite.manage");
  const result = await (supabase.rpc as unknown as Rpc)("miniapp_verify_family", { p_id: value.id, p_expected_at: value.expectedAt, p_details: value.details });
  if (result.error) throw new Error(result.error.message === "CONFLICT" ? "CONFLICT" : result.error.message === "FORBIDDEN" ? "FORBIDDEN" : "UNAVAILABLE");
}
