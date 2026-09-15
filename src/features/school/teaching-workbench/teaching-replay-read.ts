import "server-only";
import { readFile } from "node:fs/promises";
import { cache } from "react";
import { getMyPerms, requirePerm } from "@/lib/auth";
import { teachingReplayAllowed, teachingReplaySchema } from "./teaching-replay-contract";

/** 本地主管经现有身份闸门读取有限范围快照；文件路径固定，正文留在 gitignored 目录。 */
export const readTeachingReplay = cache(async (locale: string) => {
  const user = await requirePerm(locale, "class.view.all");
  const perms = await getMyPerms(user.id);
  if (!teachingReplayAllowed(process.env.NODE_ENV, process.env.NEXT_PUBLIC_SUPABASE_URL, perms)) throw new Error("REPLAY_FORBIDDEN");
  const raw = await readFile(".tmp/teaching-production-review/week-2026-09-07.private.json", "utf8");
  return teachingReplaySchema.parse(JSON.parse(raw));
});
