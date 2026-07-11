"use server";

import { createClient } from "@/lib/supabase/server";
import { CHILD_TILE_PREFIX, findTileDef, TILE_SIZES, type TileLayoutEntry, type TileSize } from "./tiles";

// ---------------------------------------------------------------------------
// 工作台布局持久化（P4C-4 §5.2）。tiles jsonb 是用户可写数据：这里做形状与
// 归属校验（k ∈ 注册表、childCard 动态键必须是自己名下孩子、s ∈ 该磁贴档位、
// 去重、≤40），非法整体拒；渲染侧 mergeTileLayout 再按权限过滤兜底。
// ---------------------------------------------------------------------------

const MAX_TILES = 40;

function isTileSize(value: unknown): value is TileSize {
  return typeof value === "string" && (TILE_SIZES as readonly string[]).includes(value);
}

export async function saveDashboardLayout(tiles: TileLayoutEntry[]): Promise<void> {
  if (!Array.isArray(tiles) || tiles.length > MAX_TILES) throw new Error("INVALID_LAYOUT");

  const seen = new Set<string>();
  const childIds: string[] = [];
  const normalized: TileLayoutEntry[] = [];
  for (const raw of tiles) {
    if (typeof raw !== "object" || raw === null) throw new Error("INVALID_LAYOUT");
    const { k, s } = raw as { k?: unknown; s?: unknown };
    if (typeof k !== "string" || seen.has(k)) throw new Error("INVALID_LAYOUT");
    const def = findTileDef(k);
    if (!def || !isTileSize(s) || !def.allowedSizes.includes(s)) throw new Error("INVALID_LAYOUT");
    if (k.startsWith(CHILD_TILE_PREFIX)) childIds.push(k.slice(CHILD_TILE_PREFIX.length));
    seen.add(k);
    normalized.push({ k, s });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");

  // childCard 动态键校验查 student_guardians（§10：别只校验 uuid 形状）。
  if (childIds.length > 0) {
    const { data, error } = await supabase
      .from("student_guardians")
      .select("student_id")
      .eq("guardian_id", user.id)
      .returns<Array<{ student_id: string }>>();
    if (error) throw new Error(error.message);
    const mine = new Set((data ?? []).map((row) => row.student_id));
    if (childIds.some((id) => !mine.has(id))) throw new Error("INVALID_LAYOUT");
  }

  const { error } = await supabase
    .from("dashboard_layouts")
    .upsert({ user_id: user.id, tiles: normalized, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export async function resetDashboardLayout(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  const { error } = await supabase.from("dashboard_layouts").delete().eq("user_id", user.id);
  if (error) throw new Error(error.message);
}
