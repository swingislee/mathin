import type { PermissionKey } from "./permissions";
import {
  nearestSize,
  normalizePlacements,
  placeSequential,
  sizeToWH,
  type TilePlacement,
} from "./tile-layout";

// ---------------------------------------------------------------------------
// 磁贴式工作台注册表与布局合并算法（P4C-4 §5.3 + P4C-4b §5.8）。
// 持久化真二维坐标 {k,x,y,w,h}（§5.8a，旧 {k,s} 数据自动重铺）；
// 服务端合并算法是安全边界：脏键/越权键丢弃、档位吸附、坐标钳制、重叠消解。
// ---------------------------------------------------------------------------

export const TILE_SIZES = ["1x1", "2x1", "1x2", "2x2", "3x1", "1x3", "3x2", "2x3", "3x3", "6x2"] as const;
export type TileSize = (typeof TILE_SIZES)[number];

export type TileAudience = "staff" | "student" | "parent";

/** 语义三档（§5.4）：rose=需要行动、leaf=健康、crater=中性强调；常规磁贴不上色。 */
export type TileTone = "crater" | "leaf" | "rose";

/** 磁贴头部图标（lucide 组件名，客户端 TileWorkspace 按名映射）。 */
export type TileIconName =
  | "Users"
  | "UserPlus"
  | "UserX"
  | "CalendarDays"
  | "AlarmClock"
  | "Filter"
  | "PhoneCall"
  | "PhoneForwarded"
  | "TrendingUp"
  | "School"
  | "ListChecks"
  | "Wallet"
  | "Undo2"
  | "ReceiptText"
  | "BookOpen"
  | "CircleAlert"
  | "ClipboardCheck"
  | "ClipboardList"
  | "Star"
  | "Trophy"
  | "NotebookPen"
  | "Baby"
  | "Link2";

export interface TileDef {
  /** 稳定机读键；家长孩子卡用动态键 `childCard:<student_id>`，注册表内以 childCard 占位。 */
  key: string;
  audiences: readonly TileAudience[];
  requiredPerm?: PermissionKey;
  /** 任一持有即放行（如业绩贴：学辅失 order.view 后靠 order.create）。 */
  requiredAnyPerm?: readonly PermissionKey[];
  /** 首个为默认档，尺寸按钮在档位间循环。 */
  allowedSizes: readonly TileSize[];
  icon: TileIconName;
  /** 静态 tone；随数据变的 tone（如欠费>0 才 rose）由页面渲染时在 item 上覆盖。 */
  tone?: TileTone;
}

/** 家长孩子卡动态键前缀（§5.6）：`childCard:<student_id>`。 */
export const CHILD_TILE_PREFIX = "childCard:";
const CHILD_TILE_BASE = "childCard";

// §5.8c：首档=默认档；小档（1x1=minimal、宽或高为 1 且面积 ≤3=compact）由页面
// 提供分档内容模板，绝不缩放裁剪。表单贴（bindChild）不配 minimal 档。
export const TILE_REGISTRY: readonly TileDef[] = [
  // ---- staff 池（P4B-7 卡片池换壳 + P4C-5 §0 反推七张新贴） ----
  { key: "statEnrolled", audiences: ["staff"], requiredPerm: "student.view.all", allowedSizes: ["1x1", "2x1"], icon: "Users" },
  { key: "statLeads", audiences: ["staff"], requiredPerm: "student.view.all", allowedSizes: ["1x1", "2x1"], icon: "UserPlus" },
  { key: "statWeekSessions", audiences: ["staff"], requiredPerm: "student.view.all", allowedSizes: ["1x1", "2x1"], icon: "CalendarDays" },
  { key: "statOverdueFollowUps", audiences: ["staff"], requiredPerm: "student.view.all", allowedSizes: ["1x1", "2x1"], icon: "AlarmClock", tone: "rose" },
  { key: "todaySchedule", audiences: ["staff"], allowedSizes: ["3x2", "3x3", "6x2", "2x2", "2x1", "1x1"], icon: "CalendarDays" },
  { key: "funnel", audiences: ["staff"], requiredPerm: "student.view.all", allowedSizes: ["2x2", "3x2", "2x1", "1x1"], icon: "Filter" },
  { key: "myFollowUps", audiences: ["staff"], requiredPerm: "followup.view", allowedSizes: ["3x2", "3x3", "2x2", "2x1", "1x1"], icon: "PhoneCall" },
  {
    key: "myPerformance",
    audiences: ["staff"],
    requiredAnyPerm: ["finance.order.view", "finance.order.create"],
    allowedSizes: ["2x1", "2x2", "1x1"],
    icon: "TrendingUp",
  },
  { key: "myTeaching", audiences: ["staff"], requiredPerm: "class.view.mine", allowedSizes: ["3x2", "3x3", "2x2", "2x1", "1x1"], icon: "School" },
  { key: "myClasses", audiences: ["staff"], requiredPerm: "class.view.mine", allowedSizes: ["3x2", "2x2", "2x1", "1x1"], icon: "ListChecks" },
  { key: "financeOverview", audiences: ["staff"], requiredPerm: "finance.report.view", allowedSizes: ["3x2", "6x2", "2x2", "2x1", "1x1"], icon: "Wallet" },
  { key: "refundQueue", audiences: ["staff"], requiredPerm: "finance.refund.approve", allowedSizes: ["2x1", "1x1"], icon: "Undo2", tone: "rose" },
  { key: "gradingQueue", audiences: ["staff"], requiredPerm: "grading.write", allowedSizes: ["3x2", "3x3", "2x2", "2x1", "1x1"], icon: "ClipboardCheck" },
  {
    key: "dueOrders",
    audiences: ["staff"],
    requiredAnyPerm: ["finance.order.view", "finance.order.create"],
    allowedSizes: ["3x2", "2x2", "2x1", "1x1"],
    icon: "ReceiptText",
  },
  { key: "templateUrgent", audiences: ["staff"], requiredPerm: "course.manage", allowedSizes: ["3x2", "2x2", "2x1", "1x1"], icon: "CircleAlert" },
  { key: "templateProgress", audiences: ["staff"], requiredPerm: "course.manage", allowedSizes: ["2x2", "3x2", "2x1", "1x1"], icon: "BookOpen" },
  { key: "unmarkedAttendance", audiences: ["staff"], requiredPerm: "class.view.all", allowedSizes: ["2x2", "3x2", "2x1", "1x1"], icon: "ClipboardList" },
  { key: "rosterMismatch", audiences: ["staff"], requiredPerm: "class.view.all", allowedSizes: ["2x1", "1x1"], icon: "UserX" },
  { key: "followupBoardEntry", audiences: ["staff"], requiredPerm: "followup.write", allowedSizes: ["2x1", "1x1"], icon: "PhoneForwarded" },
  { key: "activityToday", audiences: ["staff"], requiredPerm: "activity.register", allowedSizes: ["2x2", "2x1", "1x1"], icon: "CalendarDays" },
  { key: "reviewGaps", audiences: ["staff"], requiredPerm: "review.write", allowedSizes: ["2x1", "1x1"], icon: "ClipboardList", tone: "rose" },
  { key: "videoQueue", audiences: ["staff"], requiredPerm: "video.review", allowedSizes: ["2x1", "1x1"], icon: "ClipboardCheck", tone: "rose" },
  // ---- student 池（§0.7）。无费用磁贴（§4.4）。 ----
  { key: "mySchedule", audiences: ["student"], allowedSizes: ["3x2", "2x2", "2x1", "1x1"], icon: "CalendarDays" },
  { key: "pendingAssignments", audiences: ["student"], allowedSizes: ["2x1", "2x2", "3x2", "1x1"], icon: "ClipboardList" },
  { key: "myStars", audiences: ["student"], allowedSizes: ["1x1", "2x1", "2x2"], icon: "Star" },
  // ---- parent 池（§0.8） ----
  { key: CHILD_TILE_BASE, audiences: ["parent"], allowedSizes: ["2x2", "3x2", "2x1", "1x1"], icon: "Baby" },
  { key: "bindChild", audiences: ["parent"], allowedSizes: ["2x1", "2x2"], icon: "Link2" },
  // ---- 学生/家长共享三贴（原成绩/笔记/教室卡） ----
  { key: "myScores", audiences: ["student", "parent"], allowedSizes: ["2x2", "3x2", "2x1", "1x1"], icon: "Trophy" },
  { key: "myNotes", audiences: ["student", "parent"], allowedSizes: ["2x1", "3x2", "2x2", "1x1"], icon: "NotebookPen" },
  { key: "myClassrooms", audiences: ["student", "parent"], allowedSizes: ["2x2", "3x2", "2x1", "1x1"], icon: "School" },
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
  "activityToday",
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
  "reviewGaps",
  "videoQueue",
  "gradingQueue",
  "myClasses",
  "todaySchedule",
  "activityToday",
  "myFollowUps",
  "followupBoardEntry",
];

export const STAFF_RESEARCH_ORDER: readonly string[] = ["templateUrgent", "templateProgress", "todaySchedule"];

export const STAFF_SALES_ORDER: readonly string[] = [
  "followupBoardEntry",
  "activityToday",
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
// 布局合并（§5.5 键/权限过滤 + §5.8a 二维归一化，服务端执行）
// ---------------------------------------------------------------------------

export interface EligibleTile {
  key: string;
  allowedSizes: readonly TileSize[];
}

export interface MergedTileLayout {
  /** 归一化后的二维铺位（无重叠、无越界、已压实）。 */
  result: TilePlacement[];
  /** 有权限但不在用户布局里的键（编辑态「已隐藏磁贴」行）。 */
  hidden: string[];
}

function isTileSize(value: unknown): value is TileSize {
  return typeof value === "string" && (TILE_SIZES as readonly string[]).includes(value);
}

/** 键过滤后的用户条目：新格式带坐标，旧 {k,s} 只有档位。 */
interface AcceptedEntry {
  k: string;
  allowed: readonly TileSize[];
  size: TileSize;
  coords: { x: number; y: number } | null;
}

function defaultPlacements(eligible: readonly EligibleTile[], order: readonly string[], exclude: ReadonlySet<string>): TilePlacement[] {
  const sizesByKey = new Map(eligible.map((tile) => [tile.key, tile.allowedSizes]));
  const ordered = order.filter((key) => sizesByKey.has(key) && !exclude.has(key));
  const rest = eligible.map((tile) => tile.key).filter((key) => !ordered.includes(key) && !exclude.has(key));
  return placeSequential(
    [...ordered, ...rest].map((key) => ({ k: key, ...sizeToWH(sizesByKey.get(key)![0]) })),
  );
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

  let result: TilePlacement[];
  if (Array.isArray(userTiles)) {
    // 用户自定义过：按其顺序过滤脏键/越权键/重复键，档位吸附到 allowedSizes。
    const seen = new Set<string>();
    const accepted: AcceptedEntry[] = [];
    for (const raw of userTiles) {
      if (typeof raw !== "object" || raw === null) continue;
      const { k, s, x, y, w, h } = raw as { k?: unknown; s?: unknown; x?: unknown; y?: unknown; w?: unknown; h?: unknown };
      if (typeof k !== "string" || seen.has(k)) continue;
      const allowed = sizesByKey.get(k);
      if (!allowed) continue;
      seen.add(k);
      const hasCoords = typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y);
      const size =
        typeof w === "number" && typeof h === "number" && Number.isFinite(w) && Number.isFinite(h)
          ? nearestSize(allowed, Math.round(w), Math.round(h))
          : isTileSize(s) && allowed.includes(s)
            ? s
            : allowed[0];
      accepted.push({ k, allowed, size, coords: hasCoords ? { x: x as number, y: y as number } : null });
    }
    if (accepted.length > 0 && accepted.every((entry) => entry.coords !== null)) {
      // 全员带坐标：钳制 + push 消解 + 压实（§5.8a 安全边界）。
      result = normalizePlacements(
        accepted.map((entry) => ({ k: entry.k, ...entry.coords!, ...sizeToWH(entry.size) })),
      );
    } else {
      // 旧 {k,s} 数据或混入缺坐标条目：按数组顺序整体重铺一次，不报错。
      result = placeSequential(accepted.map((entry) => ({ k: entry.k, ...sizeToWH(entry.size) })));
    }
  } else {
    result = defaultPlacements(eligible, defaultOrder, new Set(defaultExclude));
  }

  const shown = new Set(result.map((entry) => entry.k));
  const hidden = eligible.map((tile) => tile.key).filter((key) => !shown.has(key));
  return { result, hidden };
}
