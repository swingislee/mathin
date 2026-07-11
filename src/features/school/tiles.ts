import type { PermissionKey } from "./permissions";

// ---------------------------------------------------------------------------
// 磁贴式工作台注册表与布局合并算法（P4C-4 §5.1/§5.3/§5.5）。
// 只持久化「顺序 + 尺寸档」，位置由 CSS grid dense 密排自动生成；
// 服务端合并算法是安全边界：用户 jsonb 里的脏键/越权键/非法档一律丢弃或回落。
// ---------------------------------------------------------------------------

export const TILE_SIZES = ["1x1", "2x1", "2x2", "3x2", "3x3", "6x2"] as const;
export type TileSize = (typeof TILE_SIZES)[number];

export type TileAudience = "staff" | "student" | "parent";

export interface TileDef {
  /** 稳定机读键；家长孩子卡用动态键 `childCard:<student_id>`，注册表内以 childCard 占位。 */
  key: string;
  audiences: readonly TileAudience[];
  requiredPerm?: PermissionKey;
  /** 任一持有即放行（如业绩贴：学辅失 order.view 后靠 order.create）。 */
  requiredAnyPerm?: readonly PermissionKey[];
  /** 首个为默认档，尺寸按钮在档位间循环。 */
  allowedSizes: readonly TileSize[];
}

/** 家长孩子卡动态键前缀（§5.6）：`childCard:<student_id>`。 */
export const CHILD_TILE_PREFIX = "childCard:";
const CHILD_TILE_BASE = "childCard";

export const TILE_REGISTRY: readonly TileDef[] = [
  // ---- staff 池（P4B-7 卡片池换壳；P4C-5 再补七张新贴） ----
  { key: "statEnrolled", audiences: ["staff"], requiredPerm: "student.view.all", allowedSizes: ["1x1"] },
  { key: "statLeads", audiences: ["staff"], requiredPerm: "student.view.all", allowedSizes: ["1x1"] },
  { key: "statWeekSessions", audiences: ["staff"], requiredPerm: "student.view.all", allowedSizes: ["1x1"] },
  { key: "statOverdueFollowUps", audiences: ["staff"], requiredPerm: "student.view.all", allowedSizes: ["1x1"] },
  { key: "todaySchedule", audiences: ["staff"], allowedSizes: ["3x2", "3x3", "6x2"] },
  { key: "funnel", audiences: ["staff"], requiredPerm: "student.view.all", allowedSizes: ["2x2", "3x2"] },
  { key: "myFollowUps", audiences: ["staff"], requiredPerm: "followup.view", allowedSizes: ["3x2", "3x3"] },
  {
    key: "myPerformance",
    audiences: ["staff"],
    requiredAnyPerm: ["finance.order.view", "finance.order.create"],
    allowedSizes: ["2x1", "2x2"],
  },
  { key: "myTeaching", audiences: ["staff"], requiredPerm: "class.view.mine", allowedSizes: ["3x2", "3x3"] },
  { key: "myClasses", audiences: ["staff"], requiredPerm: "class.view.mine", allowedSizes: ["3x2"] },
  { key: "financeOverview", audiences: ["staff"], requiredPerm: "finance.report.view", allowedSizes: ["3x2", "6x2"] },
  { key: "refundQueue", audiences: ["staff"], requiredPerm: "finance.refund.approve", allowedSizes: ["2x1"] },
  // ---- student 池（§0.7；myStars 在 P4C-7 落）。无费用磁贴（§4.4）。 ----
  { key: "mySchedule", audiences: ["student"], allowedSizes: ["3x2"] },
  { key: "pendingAssignments", audiences: ["student"], allowedSizes: ["2x1"] },
  // ---- parent 池（§0.8） ----
  { key: CHILD_TILE_BASE, audiences: ["parent"], allowedSizes: ["2x2", "3x2"] },
  { key: "bindChild", audiences: ["parent"], allowedSizes: ["2x1", "2x2"] },
  // ---- 学生/家长共享三贴（原成绩/笔记/教室卡） ----
  { key: "myScores", audiences: ["student", "parent"], allowedSizes: ["2x2", "3x2"] },
  { key: "myNotes", audiences: ["student", "parent"], allowedSizes: ["2x1", "3x2"] },
  { key: "myClassrooms", audiences: ["student", "parent"], allowedSizes: ["2x2", "3x2"] },
];

/** 按键找注册表定义；childCard:<uuid> 动态键归到 childCard 占位定义。 */
export function findTileDef(key: string): TileDef | null {
  const base = key.startsWith(CHILD_TILE_PREFIX) ? CHILD_TILE_BASE : key;
  return TILE_REGISTRY.find((def) => def.key === base) ?? null;
}

// ---------------------------------------------------------------------------
// 角色默认顺序（§5.6）。清单里可以出现尚未上线的键（P4C-5/7 的新磁贴）——
// 合并时会被 eligible 过滤，届时磁贴上线即自动进默认序，不需要回改这里。
// ---------------------------------------------------------------------------

export const STAFF_MANAGER_ORDER: readonly string[] = [
  "statEnrolled",
  "statLeads",
  "statWeekSessions",
  "statOverdueFollowUps",
  "todaySchedule",
  "dueOrders",
  "funnel",
  "financeOverview",
  "refundQueue",
  "unmarkedAttendance",
  "rosterMismatch",
  "templateProgress",
];

export const STAFF_TEACHER_ORDER: readonly string[] = [
  "myTeaching",
  "gradingQueue",
  "myClasses",
  "todaySchedule",
  "myFollowUps",
  "followupBoardEntry",
];

export const STAFF_RESEARCH_ORDER: readonly string[] = ["templateUrgent", "templateProgress", "todaySchedule"];

export const STAFF_SALES_ORDER: readonly string[] = [
  "followupBoardEntry",
  "myFollowUps",
  "dueOrders",
  "myPerformance",
  "todaySchedule",
];

/** staff 默认序画像判定（§5.5 第 4 步）：manager > 教师 > 教研 > 学辅，取首个命中。 */
export function staffDefaultOrder(perms: ReadonlySet<PermissionKey>): readonly string[] {
  if (perms.has("student.view.all")) return STAFF_MANAGER_ORDER;
  if (perms.has("class.view.mine")) return STAFF_TEACHER_ORDER;
  if (perms.has("course.manage")) return STAFF_RESEARCH_ORDER;
  return STAFF_SALES_ORDER;
}

export const STUDENT_ORDER: readonly string[] = [
  "mySchedule",
  "pendingAssignments",
  "myStars",
  "myScores",
  "myNotes",
  "myClassrooms",
];

/** 家长默认序：孩子卡在前（页面按孩子列表展开动态键后传入）。 */
export function parentDefaultOrder(childKeys: readonly string[]): readonly string[] {
  return [...childKeys, "bindChild", "myScores", "myNotes", "myClassrooms"];
}

// ---------------------------------------------------------------------------
// 布局合并（§5.5，服务端执行）
// ---------------------------------------------------------------------------

export interface TileLayoutEntry {
  k: string;
  s: TileSize;
}

export interface EligibleTile {
  key: string;
  allowedSizes: readonly TileSize[];
}

export interface MergedTileLayout {
  result: TileLayoutEntry[];
  /** 有权限但不在用户布局里的键（编辑态「已隐藏磁贴」行）。 */
  hidden: string[];
}

function isTileSize(value: unknown): value is TileSize {
  return typeof value === "string" && (TILE_SIZES as readonly string[]).includes(value);
}

/**
 * @param eligible     当前身份+权限下可见的磁贴（注册表顺序；家长孩子卡已展开为动态键）
 * @param userTiles    dashboard_layouts.tiles 原始 jsonb（null = 从未自定义）
 * @param defaultOrder 角色默认顺序（未列出的 eligible 键按注册表顺序追加）
 * @param defaultExclude 默认序里跳过的键（如管理者且待跟进为空时的 myFollowUps）——进 hidden，可手动加回
 */
export function mergeTileLayout(
  eligible: readonly EligibleTile[],
  userTiles: unknown,
  defaultOrder: readonly string[],
  defaultExclude: readonly string[] = [],
): MergedTileLayout {
  const sizesByKey = new Map(eligible.map((tile) => [tile.key, tile.allowedSizes]));

  let result: TileLayoutEntry[];
  if (Array.isArray(userTiles)) {
    // 用户自定义过：按其顺序过滤脏键/越权键/重复键，非法档回落默认档。
    const seen = new Set<string>();
    result = [];
    for (const raw of userTiles) {
      if (typeof raw !== "object" || raw === null) continue;
      const { k, s } = raw as { k?: unknown; s?: unknown };
      if (typeof k !== "string" || seen.has(k)) continue;
      const allowed = sizesByKey.get(k);
      if (!allowed) continue;
      seen.add(k);
      result.push({ k, s: isTileSize(s) && allowed.includes(s) ? s : allowed[0] });
    }
  } else {
    // 从未自定义：角色默认序 + 未列出的 eligible 按注册表顺序追加。
    const excluded = new Set(defaultExclude);
    const ordered = defaultOrder.filter((key) => sizesByKey.has(key) && !excluded.has(key));
    const rest = eligible.map((tile) => tile.key).filter((key) => !ordered.includes(key) && !excluded.has(key));
    result = [...ordered, ...rest].map((key) => ({ k: key, s: sizesByKey.get(key)![0] }));
  }

  const shown = new Set(result.map((entry) => entry.k));
  const hidden = eligible.map((tile) => tile.key).filter((key) => !shown.has(key));
  return { result, hidden };
}
