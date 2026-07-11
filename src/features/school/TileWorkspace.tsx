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
  GripVertical,
  Link2,
  ListChecks,
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
import { useMemo, useState, type DragEvent, type ReactNode } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SchoolPageHeader } from "./PageHeader";
import { resetDashboardLayout, saveDashboardLayout } from "./layout-actions";
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
// 磁贴工作台客户端层（P4C-4 §5.3/§5.7）：内容是服务端渲染好的 ReactNode，
// 这里只管 grid 密排布局与编辑态（拖拽重排/尺寸档循环/隐藏/恢复默认）。
// 编辑操作不触发重新取数；「完成」保存后 router.refresh 拉新布局。
// ---------------------------------------------------------------------------

export interface TileGridItem {
  key: string;
  size: TileSize;
  label: string;
  allowedSizes: readonly TileSize[];
  icon: TileIconName;
  /** 语义洗底（§5.4）：只给需要行动/健康态的磁贴上色，常规素卡传 undefined。 */
  tone?: TileTone;
  /** 头部右上箭头直达；cover=true 时整贴可点（内容里不得再有链接）。 */
  href?: string;
  cover?: boolean;
  node: ReactNode;
}

/** 桌面 6 列 / md 4 列 / sm 单列（span 失效纵排），行高 96px（§5.1）。 */
const SIZE_CLASSES: Record<TileSize, string> = {
  "1x1": "md:col-span-1 md:row-span-1",
  "2x1": "md:col-span-2 md:row-span-1",
  "2x2": "md:col-span-2 md:row-span-2",
  "3x2": "md:col-span-3 md:row-span-2",
  "3x3": "md:col-span-3 md:row-span-3",
  "6x2": "md:col-span-4 md:row-span-2 lg:col-span-6",
};

interface DraftEntry {
  key: string;
  size: TileSize;
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DraftEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ key: string; before: boolean } | null>(null);

  const itemByKey = useMemo(() => {
    const map = new Map<string, TileGridItem>();
    for (const item of [...items, ...hidden]) map.set(item.key, item);
    return map;
  }, [items, hidden]);

  const visible: DraftEntry[] = editing ? draft : items.map((item) => ({ key: item.key, size: item.size }));
  const hiddenNow = editing
    ? [...items, ...hidden].filter((item) => !draft.some((entry) => entry.key === item.key))
    : hidden;

  const startEdit = () => {
    setDraft(items.map((item) => ({ key: item.key, size: item.size })));
    setError(null);
    setEditing(true);
  };

  const finishEdit = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveDashboardLayout(draft.map((entry) => ({ k: entry.key, s: entry.size })));
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

  const move = (key: string, delta: -1 | 1) => {
    setDraft((prev) => {
      const index = prev.findIndex((entry) => entry.key === key);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const cycleSize = (key: string) => {
    setDraft((prev) =>
      prev.map((entry) => {
        if (entry.key !== key) return entry;
        const allowed = itemByKey.get(key)?.allowedSizes ?? [entry.size];
        const next = allowed[(allowed.indexOf(entry.size) + 1) % allowed.length];
        return { ...entry, size: next };
      }),
    );
  };

  const hideTile = (key: string) => setDraft((prev) => prev.filter((entry) => entry.key !== key));

  const showTile = (key: string) => {
    const item = itemByKey.get(key);
    if (!item) return;
    setDraft((prev) => [...prev, { key, size: item.size }]);
  };

  const onDragOverCell = (event: DragEvent<HTMLElement>, key: string) => {
    if (!editing || !dragKey || dragKey === key) return;
    // §10：dragover 必须 preventDefault，否则 drop 不触发。
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setDropTarget({ key, before: event.clientX < rect.left + rect.width / 2 });
  };

  const onDropCell = (event: DragEvent<HTMLElement>, key: string) => {
    event.preventDefault();
    if (!dragKey || dragKey === key || !dropTarget) return;
    setDraft((prev) => {
      const without = prev.filter((entry) => entry.key !== dragKey);
      const dragged = prev.find((entry) => entry.key === dragKey);
      if (!dragged) return prev;
      const index = without.findIndex((entry) => entry.key === key);
      if (index < 0) return prev;
      without.splice(dropTarget.before ? index : index + 1, 0, dragged);
      return without;
    });
    setDragKey(null);
    setDropTarget(null);
  };

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

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-4 md:[grid-auto-flow:dense] md:[grid-auto-rows:6rem] lg:grid-cols-6">
        {visible.map((entry) => {
          const item = itemByKey.get(entry.key);
          if (!item) return null;
          const Icon = TILE_ICONS[item.icon];
          return (
            <section
              key={entry.key}
              aria-label={item.label}
              data-tile-tone={item.tone}
              draggable={editing}
              onDragStart={(event) => {
                if (!editing) return;
                event.dataTransfer.setData("text/plain", entry.key);
                event.dataTransfer.effectAllowed = "move";
                setDragKey(entry.key);
              }}
              onDragOver={(event) => onDragOverCell(event, entry.key)}
              onDrop={(event) => onDropCell(event, entry.key)}
              onDragEnd={() => {
                setDragKey(null);
                setDropTarget(null);
              }}
              className={cn(
                "relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-card p-4 transition-transform duration-150 motion-reduce:transition-none",
                SIZE_CLASSES[entry.size],
                item.href && !editing && "transition-colors hover:border-crater/50",
                editing && "select-none",
                editing && dragKey === entry.key && "opacity-60",
              )}
            >
              <div className="flex shrink-0 items-center gap-2">
                <Icon size={16} strokeWidth={1.75} className={item.tone ? TONE_ICON_CLASS[item.tone] : "text-muted"} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[11px] uppercase tracking-[0.18em] text-muted">{item.label}</span>
                {item.href && !editing && (
                  <Link href={item.href} aria-label={item.label} className="shrink-0 text-muted transition-colors hover:text-ink">
                    <ArrowUpRight size={14} />
                    {/* cover：把点击面撑满整贴（此类磁贴内容里没有别的链接）。 */}
                    {item.cover && <span className="absolute inset-0" aria-hidden />}
                  </Link>
                )}
              </div>
              <div className="mt-2 flex min-h-0 flex-1 flex-col">{item.node}</div>
              {editing && (
                <>
                  {/* 遮罩层统一挡掉磁贴内容交互（§10：别逐元素 pointer-events-none）。 */}
                  <div className="absolute inset-0 z-10 cursor-grab rounded-2xl" aria-hidden />
                  <div className="absolute inset-x-1.5 top-1.5 z-20 flex items-center justify-between gap-1">
                    <span className="hidden items-center rounded-lg border border-line bg-card p-1 text-muted md:flex" title={t("drag")}>
                      <GripVertical size={14} />
                    </span>
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => move(entry.key, -1)}
                        aria-label={t("moveUp")}
                        className="rounded-lg border border-line bg-card p-1 text-muted md:hidden"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(entry.key, 1)}
                        aria-label={t("moveDown")}
                        className="rounded-lg border border-line bg-card p-1 text-muted md:hidden"
                      >
                        <ArrowDown size={14} />
                      </button>
                      {item.allowedSizes.length > 1 && (
                        <button
                          type="button"
                          onClick={() => cycleSize(entry.key)}
                          aria-label={t("size")}
                          className="rounded-lg border border-line bg-card px-1.5 py-1 font-mono text-[11px] text-muted"
                        >
                          {entry.size.replace("x", "×")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => hideTile(entry.key)}
                        aria-label={t("hide")}
                        className="rounded-lg border border-line bg-card p-1 text-muted"
                      >
                        <EyeOff size={14} />
                      </button>
                    </span>
                  </div>
                  {dropTarget?.key === entry.key && (
                    <div
                      aria-hidden
                      className={cn("absolute inset-y-1 z-30 w-0.5 rounded-full bg-crater", dropTarget.before ? "left-0" : "right-0")}
                    />
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>

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
    </div>
  );
}
