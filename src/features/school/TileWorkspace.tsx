"use client";

import {
  AlarmClock,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Baby,
  BookOpen,
  CalendarDays,
  CircleAlert,
  ClipboardCheck,
  ClipboardList,
  EyeOff,
  Filter,
  Link2,
  ListChecks,
  Maximize2,
  NotebookPen,
  PenLine,
  PhoneCall,
  PhoneForwarded,
  Plus,
  ReceiptText,
  RotateCcw,
  School,
  Star,
  TrendingUp,
  Trophy,
  Undo2,
  UserPlus,
  Users,
  UserX,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Link, useRouter } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SchoolPageHeader } from "./PageHeader";
import { resetDashboardLayout, saveDashboardLayout } from "./layout-actions";
import {
  GRID_COLS,
  GRID_COLS_MD,
  MAX_Y,
  nearestSize,
  placeSequential,
  reflowToCols,
  resolveLayout,
  sizeToWH,
  sortByPosition,
  type TilePlacement,
} from "./tile-layout";
import type { TileIconName, TileSize, TileTone } from "./tiles";

const TILE_ICONS: Record<TileIconName, LucideIcon> = {
  Users,
  UserPlus,
  UserX,
  CalendarDays,
  AlarmClock,
  Filter,
  PhoneCall,
  PhoneForwarded,
  TrendingUp,
  School,
  ListChecks,
  Wallet,
  Undo2,
  ReceiptText,
  BookOpen,
  CircleAlert,
  ClipboardCheck,
  ClipboardList,
  Star,
  Trophy,
  NotebookPen,
  Baby,
  Link2,
};

/** tone → 头部图标着色（§5.4 语义三档；文字仍用常规 token 保证对比度）。 */
const TONE_ICON_CLASS: Record<TileTone, string> = {
  crater: "text-crater",
  leaf: "text-leaf-deep",
  rose: "text-rose",
};

// ---------------------------------------------------------------------------
// 磁贴工作台客户端层（P4C-4b §5.8）：内容是服务端渲染好的三档 ReactNode，
// 这里只管真二维布局与编辑态（Pointer 拖拽移位/拖角调档吸附/隐藏/恢复默认）。
// 展示态用 CSS grid + 变量（lg/md 两套坐标 SSR 直出）；编辑态切绝对定位，
// push 消解走与服务端共用的 tile-layout 纯函数，拖动全程实时预览让位。
// ---------------------------------------------------------------------------

export interface TileGridItem {
  key: string;
  /** 规范 6 列坐标（服务端合并结果；hidden 磁贴给默认档占位即可）。 */
  placement: TilePlacement;
  label: string;
  allowedSizes: readonly TileSize[];
  icon: TileIconName;
  /** 语义洗底（§5.4）：只给需要行动/健康态的磁贴上色，常规素卡传 undefined。 */
  tone?: TileTone;
  /** 头部右上箭头直达；cover=true 时整贴可点（内容里不得再有链接）。 */
  href?: string;
  cover?: boolean;
  /** full 形态（完整卡体，放大弹窗也用它）。 */
  node: ReactNode;
  /** compact 形态（宽或高为 1 且面积 ≤3），缺省回落 full。 */
  compact?: ReactNode;
  /** minimal 形态（1x1），缺省回落 compact → full。 */
  minimal?: ReactNode;
}

const ROW_H = 96;
const GAP = 12;

type Variant = "minimal" | "compact" | "full";

function variantOf(w: number, h: number): Variant {
  if (w === 1 && h === 1) return "minimal";
  if ((w === 1 || h === 1) && w * h <= 3) return "compact";
  return "full";
}

function pickNode(item: TileGridItem, variant: Variant): ReactNode {
  if (variant === "minimal") return item.minimal ?? item.compact ?? item.node;
  if (variant === "compact") return item.compact ?? item.node;
  return item.node;
}

interface DragState {
  key: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  /** 拖动起点时磁贴的像素框（相对容器）。 */
  originLeft: number;
  originTop: number;
  originW: number;
  originH: number;
  /** 跟手的像素位置（move 模式）。 */
  px: { left: number; top: number } | null;
}

export function TileWorkspace({
  title,
  subtitle,
  prelude,
  items,
  hidden,
}: {
  title: string;
  subtitle?: string;
  /** 页头与网格之间的固定块（未绑定学生的绑定码卡、无权限提示等），不参与磁贴编辑。 */
  prelude?: ReactNode;
  items: TileGridItem[];
  hidden: TileGridItem[];
}) {
  const t = useTranslations("school.tileEdit");
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TilePlacement[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [containerW, setContainerW] = useState(0);
  const [wide, setWide] = useState(true);
  const [zoomKey, setZoomKey] = useState<string | null>(null);

  const itemByKey = useMemo(() => {
    const map = new Map<string, TileGridItem>();
    for (const item of [...items, ...hidden]) map.set(item.key, item);
    return map;
  }, [items, hidden]);

  // md 断点：编辑态 <768px 退化为纵排上移/下移（§5.8a 移动端不做拖拽）。
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!editing) return;
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => setContainerW(entries[0]?.contentRect.width ?? 0));
    observer.observe(node);
    setContainerW(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, [editing]);

  const cellW = containerW > 0 ? (containerW - GAP * (GRID_COLS - 1)) / GRID_COLS : 0;
  const toPx = (tile: TilePlacement) => ({
    left: tile.x * (cellW + GAP),
    top: tile.y * (ROW_H + GAP),
    width: tile.w * cellW + (tile.w - 1) * GAP,
    height: tile.h * ROW_H + (tile.h - 1) * GAP,
  });

  const startEdit = () => {
    setDraft(items.map((item) => ({ ...item.placement, k: item.key })));
    // 先用展示态网格宽度垫底，防止编辑画布首帧 cellW=0 闪烁（两容器同宽）。
    setContainerW(containerRef.current?.getBoundingClientRect().width ?? 0);
    setError(null);
    setEditing(true);
  };

  const finishEdit = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveDashboardLayout(resolveLayout(draft));
      setEditing(false);
      router.refresh();
    } catch {
      setError(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const resetLayout = async () => {
    setSaving(true);
    setError(null);
    try {
      await resetDashboardLayout();
      setEditing(false);
      router.refresh();
    } catch {
      setError(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  /** 移动端上移/下移：交换 (y,x) 序后按尺寸顺序重铺（§5.8a）。 */
  const move = (key: string, delta: -1 | 1) => {
    setDraft((prev) => {
      const sorted = sortByPosition(prev);
      const index = sorted.findIndex((entry) => entry.k === key);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= sorted.length) return prev;
      [sorted[index], sorted[target]] = [sorted[target], sorted[index]];
      return placeSequential(sorted);
    });
  };

  const hideTile = (key: string) => setDraft((prev) => resolveLayout(prev.filter((entry) => entry.k !== key)));

  const showTile = (key: string) => {
    const item = itemByKey.get(key);
    if (!item) return;
    setDraft((prev) => {
      const bottom = prev.reduce((max, entry) => Math.max(max, entry.y + entry.h), 0);
      const { w, h } = sizeToWH(item.allowedSizes[0]);
      return resolveLayout([...prev, { k: key, x: 0, y: bottom, w, h }]);
    });
  };

  const beginDrag = (event: ReactPointerEvent<HTMLElement>, key: string, mode: DragState["mode"]) => {
    if (!editing || !wide || cellW <= 0) return;
    const tile = draft.find((entry) => entry.k === key);
    if (!tile) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const px = toPx(tile);
    setDrag({
      key,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: px.left,
      originTop: px.top,
      originW: px.width,
      originH: px.height,
      px: mode === "move" ? { left: px.left, top: px.top } : null,
    });
  };

  const onDragMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag || cellW <= 0) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const tile = draft.find((entry) => entry.k === drag.key);
    if (!tile) return;

    if (drag.mode === "move") {
      const left = drag.originLeft + dx;
      const top = Math.max(0, drag.originTop + dy);
      setDrag((prev) => (prev ? { ...prev, px: { left, top } } : prev));
      const x = Math.max(0, Math.min(Math.round(left / (cellW + GAP)), GRID_COLS - tile.w));
      const y = Math.max(0, Math.min(Math.round(top / (ROW_H + GAP)), MAX_Y));
      if (x !== tile.x || y !== tile.y) {
        setDraft((prev) => resolveLayout(prev.map((entry) => (entry.k === drag.key ? { ...entry, x, y } : entry)), drag.key));
      }
      return;
    }

    // resize：像素宽高 → 目标格数 → allowedSizes 最近档吸附（§5.8b）。
    const allowed = itemByKey.get(drag.key)?.allowedSizes ?? [];
    if (allowed.length === 0) return;
    const rawW = Math.max(1, Math.round((drag.originW + dx + GAP) / (cellW + GAP)));
    const rawH = Math.max(1, Math.round((drag.originH + dy + GAP) / (ROW_H + GAP)));
    const snapped = sizeToWH(nearestSize(allowed, Math.min(rawW, GRID_COLS - tile.x), rawH));
    if (snapped.w !== tile.w || snapped.h !== tile.h) {
      setDraft((prev) =>
        resolveLayout(prev.map((entry) => (entry.k === drag.key ? { ...entry, ...snapped } : entry)), drag.key),
      );
    }
  };

  const endDrag = () => {
    if (!drag) return;
    setDraft((prev) => resolveLayout(prev));
    setDrag(null);
  };

  const visibleItems = editing
    ? draft
    : sortByPosition(items.map((item) => ({ ...item.placement, k: item.key })));
  const hiddenNow = editing
    ? [...items, ...hidden].filter((item) => !draft.some((entry) => entry.k === item.key))
    : hidden;
  const mdLayout = useMemo(
    () => new Map(reflowToCols(visibleItems, GRID_COLS_MD).map((tile) => [tile.k, tile])),
    [visibleItems],
  );
  const editRows = draft.reduce((max, entry) => Math.max(max, entry.y + entry.h), 1);
  // 编辑画布按 key 稳定序渲染：resolveLayout 会按 (y,x) 重排数组，若照它渲染，
  // React 会真实移动 DOM 节点 → 被拖元素丢失 pointer capture，拖动中断（实测坑）。
  const editTiles = useMemo(() => [...draft].sort((a, b) => (a.k < b.k ? -1 : 1)), [draft]);
  const zoomItem = zoomKey ? itemByKey.get(zoomKey) : null;

  const renderShell = (item: TileGridItem, tile: TilePlacement) => {
    const Icon = TILE_ICONS[item.icon];
    const variant = variantOf(tile.w, tile.h);
    return (
      <>
        <div className="flex shrink-0 items-center gap-2">
          <Icon size={16} strokeWidth={1.75} className={item.tone ? TONE_ICON_CLASS[item.tone] : "text-muted"} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[11px] uppercase tracking-[0.18em] text-muted">{item.label}</span>
          {variant !== "full" && !editing && (
            <button
              type="button"
              onClick={() => setZoomKey(item.key)}
              aria-label={t("maximize")}
              className="relative z-10 shrink-0 text-muted transition-colors hover:text-ink"
            >
              <Maximize2 size={13} />
            </button>
          )}
          {item.href && !editing && (
            <Link href={item.href} aria-label={item.label} className="shrink-0 text-muted transition-colors hover:text-ink">
              <ArrowUpRight size={14} />
              {/* cover：把点击面撑满整贴（此类磁贴内容里没有别的链接）。 */}
              {item.cover && <span className="absolute inset-0" aria-hidden />}
            </Link>
          )}
        </div>
        <div className="mt-2 flex min-h-0 flex-1 flex-col">{pickNode(item, variant)}</div>
      </>
    );
  };

  const editControls = (key: string) => (
    <>
      {/* 遮罩层统一挡掉磁贴内容交互；仅 md+ 是拖拽抓取面才需要隔离触摸滚动（§7）——
          移动端编辑态用上/下按钮改序，这层遮罩只用来挡点击，不能连带吞掉整页滚动手势。 */}
      <div
        className={cn("absolute inset-0 z-10 rounded-2xl", wide && "touch-none cursor-grab active:cursor-grabbing")}
        aria-hidden
        onPointerDown={(event) => beginDrag(event, key, "move")}
        onPointerMove={onDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
      <div className="absolute inset-x-1.5 top-1.5 z-20 flex items-center justify-end gap-1">
        {!wide && (
          <>
            <button
              type="button"
              onClick={() => move(key, -1)}
              aria-label={t("moveUp")}
              className="rounded-lg border border-line bg-card p-1 text-muted"
            >
              <ArrowUp size={14} />
            </button>
            <button
              type="button"
              onClick={() => move(key, 1)}
              aria-label={t("moveDown")}
              className="rounded-lg border border-line bg-card p-1 text-muted"
            >
              <ArrowDown size={14} />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => hideTile(key)}
          aria-label={t("hide")}
          className="rounded-lg border border-line bg-card p-1 text-muted"
        >
          <EyeOff size={14} />
        </button>
      </div>
      {wide && (itemByKey.get(key)?.allowedSizes.length ?? 0) > 1 && (
        <span
          aria-label={t("resize")}
          title={t("resize")}
          onPointerDown={(event) => beginDrag(event, key, "resize")}
          onPointerMove={onDragMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="absolute bottom-0 right-0 z-20 h-5 w-5 cursor-nwse-resize touch-none rounded-tl-lg border-l border-t border-line bg-card"
        >
          <span aria-hidden className="absolute bottom-1 right-1 h-2 w-2 border-b-2 border-r-2 border-muted" />
        </span>
      )}
    </>
  );

  return (
    <div className="mx-auto w-full max-w-7xl">
      <SchoolPageHeader
        title={title}
        actions={
          editing ? (
            <>
              <button
                type="button"
                onClick={resetLayout}
                disabled={saving}
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                <RotateCcw size={14} />
                {t("reset")}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={saving}
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={finishEdit}
                disabled={saving}
                className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
              >
                {t("done")}
              </button>
            </>
          ) : (
            <button type="button" onClick={startEdit} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
              <PenLine size={14} />
              {t("edit")}
            </button>
          )
        }
      >
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </SchoolPageHeader>

      {error && <p className="mt-4 text-sm text-rose">{error}</p>}
      {prelude && <div className="mt-6">{prelude}</div>}

      {editing && wide ? (
        // 编辑态（md+）：绝对定位画布，拖动/调档实时 push 预览（§5.8a）。
        <div
          ref={containerRef}
          data-tile-canvas="edit"
          className="relative mt-6"
          style={{ height: editRows * (ROW_H + GAP) - GAP }}
        >
          {editTiles.map((tile) => {
            const item = itemByKey.get(tile.k);
            if (!item) return null;
            const dragging = drag?.key === tile.k;
            const px = dragging && drag.mode === "move" && drag.px ? { ...toPx(tile), left: drag.px.left, top: drag.px.top } : toPx(tile);
            return (
              <section
                key={tile.k}
                aria-label={item.label}
                data-tile-tone={item.tone}
                className={cn(
                  "absolute flex min-w-0 select-none flex-col overflow-hidden rounded-2xl border border-line bg-card p-4",
                  "transition-[top,left,width,height] duration-150 motion-reduce:transition-none",
                  dragging && "z-30 shadow-lg transition-none",
                  dragging && drag.mode === "resize" && "border-dashed border-crater",
                )}
                style={{ left: px.left, top: px.top, width: px.width, height: px.height }}
              >
                {renderShell(item, tile)}
                {editControls(tile.k)}
                {dragging && (
                  <span className="absolute bottom-1.5 left-1.5 z-20 rounded-lg border border-line bg-card px-1.5 py-0.5 font-mono text-[11px] text-muted">
                    {tile.w}×{tile.h}
                  </span>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        // 展示态 / 移动端编辑态：CSS grid，lg/md 两套坐标走 .tile-cell 变量（SSR 直出）。
        <div ref={containerRef} data-tile-canvas="grid" className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-4 md:[grid-auto-rows:6rem] lg:grid-cols-6">
          {visibleItems.map((tile) => {
            const item = itemByKey.get(tile.k);
            if (!item) return null;
            const md = mdLayout.get(tile.k) ?? tile;
            return (
              <section
                key={tile.k}
                aria-label={item.label}
                data-tile-tone={item.tone}
                className={cn(
                  "tile-cell relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-card p-4",
                  item.href && !editing && "transition-colors hover:border-crater/50",
                  editing && "select-none",
                )}
                style={
                  {
                    "--tx-lg": tile.x + 1,
                    "--ty-lg": tile.y + 1,
                    "--tw-lg": tile.w,
                    "--th-lg": tile.h,
                    "--tx-md": md.x + 1,
                    "--ty-md": md.y + 1,
                    "--tw-md": md.w,
                    "--th-md": md.h,
                  } as React.CSSProperties
                }
              >
                {renderShell(item, tile)}
                {editing && editControls(tile.k)}
              </section>
            );
          })}
        </div>
      )}

      {editing && hiddenNow.length > 0 && (
        <div className="mt-4 rounded-2xl border border-dashed border-line p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-muted">{t("hiddenTitle")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {hiddenNow.map((item) => (
              <button
                type="button"
                key={item.key}
                onClick={() => showTile(item.key)}
                className="flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-xs text-muted transition hover:border-crater/50 hover:text-ink"
              >
                <Plus size={12} />
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 放大预览（§5.8c）：小档磁贴点开看 full 形态。 */}
      <Dialog open={zoomItem != null} onOpenChange={(next) => { if (!next) setZoomKey(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{zoomItem?.label ?? ""}</DialogTitle>
          </DialogHeader>
          {zoomItem && (
            <div className="flex max-h-[60vh] min-h-40 flex-col overflow-y-auto">{zoomItem.node}</div>
          )}
          {zoomItem?.href && (
            <Link
              href={zoomItem.href}
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "self-start")}
              onClick={() => setZoomKey(null)}
            >
              {zoomItem.label}
              <ArrowUpRight size={14} />
            </Link>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
