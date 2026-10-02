"use server";

import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { getProfile, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { tools } from "../registry";

const TOOL_IDS = tools.map((tool) => tool.id) as [string, ...string[]];

const moveToolSchema = z.object({
  locale: z.enum(["zh", "en"]),
  toolId: z.enum(TOOL_IDS),
  draft: z.boolean(),
});

/** 管理员调整工具分组：移入草稿或转为正式。数据库 RLS 再次限定为管理员。 */
export async function moveToolGroup(input: z.input<typeof moveToolSchema>): Promise<ActionResult> {
  const parsed = moveToolSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const { locale, toolId, draft } = parsed.data;
  const user = await requireUser(locale);
  if ((await getProfile(user.id))?.role !== "admin") return { ok: false, code: "FORBIDDEN" };

  const supabase = await createClient();
  const { error } = draft
    ? await supabase.from("tool_catalog_drafts").upsert({ tool_id: toolId, moved_by: user.id }, { onConflict: "tool_id", ignoreDuplicates: true })
    : await supabase.from("tool_catalog_drafts").delete().eq("tool_id", toolId);
  if (error) return { ok: false, code: error.code === "42501" ? "FORBIDDEN" : "UNAVAILABLE" };
  return { ok: true };
}
