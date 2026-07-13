"use server";

import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/database.types";
import { GRID_COLS, MAX_Y, nearestSize, normalizePlacements, sizeToWH, type TilePlacement } from "./tile-layout";
import { CHILD_TILE_PREFIX, findTileDef } from "./tiles";

// ---------------------------------------------------------------------------
// 工作台布局持久化（P4C-4 §5.2 + P4C-4b §5.8a）。tiles jsonb 是用户可写数据：
// 这里做形状与归属校验（k ∈ 注册表、childCard 动态键必须是自己名下孩子、
// 坐标为有限整数、去重、≤40），非法整体拒；档位吸附 allowedSizes、坐标钳制、
// 重叠 push 消解后落库（与客户端共用 tile-layout 纯函数，结果不漂移）。
// 渲染侧 mergeTileLayout 再按权限过滤兜底。
// ---------------------------------------------------------------------------

const MAX_TILES = 40;

function isFiniteInt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

export async function saveDashboardLayout(tiles: TilePlacement[]): Promise<void> {
  if (!Array.isArray(tiles) || tiles.length > MAX_TILES) throw new Error("INVALID_LAYOUT");

  const seen = new Set<string>();
  const childIds: string[] = [];
  const accepted: TilePlacement[] = [];
  for (const raw of tiles) {
    if (typeof raw !== "object" || raw === null) throw new Error("INVALID_LAYOUT");
    const { k, x, y, w, h } = raw as { k?: unknown; x?: unknown; y?: unknown; w?: unknown; h?: unknown };
    if (typeof k !== "string" || seen.has(k)) throw new Error("INVALID_LAYOUT");
    const def = findTileDef(k);
    if (!def) throw new Error("INVALID_LAYOUT");
    if (!isFiniteInt(x) || !isFiniteInt(y) || !isFiniteInt(w) || !isFiniteInt(h)) throw new Error("INVALID_LAYOUT");
    if (x < 0 || x >= GRID_COLS || y < 0 || y > MAX_Y || w < 1 || w > GRID_COLS || h < 1 || h > 6) throw new Error("INVALID_LAYOUT");
    if (k.startsWith(CHILD_TILE_PREFIX)) childIds.push(k.slice(CHILD_TILE_PREFIX.length));
    seen.add(k);
    // 档位吸附：不在 allowedSizes 的 w/h 落到最近档，不整体拒（拖拽端已吸附，这里兜底）。
    accepted.push({ k, x, y, ...sizeToWH(nearestSize(def.allowedSizes, w, h)) });
  }
  const normalized = normalizePlacements(accepted);

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
    .upsert({ user_id: user.id, tiles: normalized as unknown as Json, updated_at: new Date().toISOString() });
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
