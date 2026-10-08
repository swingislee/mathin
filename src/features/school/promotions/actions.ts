"use server";

import { z } from "zod";
import { authorizedClient } from "../actions/guards";
import { promotionDashboardSchema } from "./contract";

type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const scene = z.string().regex(/^[a-f0-9]{24}$/);
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
