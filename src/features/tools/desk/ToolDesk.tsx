"use client";

import { createContext, useContext, useState, useTransition, type DragEvent, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { moveToolGroup } from "./actions";
import type { ToolShelf } from "./shelves";

/** 便签只需要文字信息；卡片与缩略图由服务端渲染后作为 children 传入。 */
export interface ToolDeskNoteItem {
  id: string;
  no: number;
  name: string;
  grades: string;
}

export interface ToolDeskShelfOption {
  id: ToolShelf | "all" | "draft";
  label: string;
  count: string;
}

interface ToolGroupMover {
  pending: boolean;
  move: (toolId: string, draft: boolean) => void;
}

const ToolGroupContext = createContext<ToolGroupMover | null>(null);

function toolCard(target: EventTarget) {
  return target instanceof Element ? target.closest<HTMLElement>("[data-tool-id]") : null;
}

/**
 * 工具台目录：左侧木格架选分类，左下抽屉是草稿，中间纸面列出工具，右侧夹子便签显示指向中的工具。
 * 卡片带 `data-tool-id` / `data-shelf` / `data-draft`，分组筛选与台面坐标由 globals.css 的 `.tool-desk` 维护。
 * 管理员把卡片拖到草稿格即移入草稿，把草稿卡片拖到其他格即转为正式；触屏用卡片上的按钮完成同一操作。
 */
export function ToolDesk({ header, shelves, items, shelfLabel, noteHint, canManage, moveFailed, children }: {
  header: ReactNode;
  shelves: ToolDeskShelfOption[];
  items: ToolDeskNoteItem[];
  shelfLabel: string;
  noteHint: string;
  canManage: boolean;
  moveFailed: string;
  children: ReactNode;
}) {
  const locale = useLocale() === "en" ? "en" : "zh";
  const router = useRouter();
  const [shelf, setShelf] = useState<ToolDeskShelfOption["id"]>("all");
  const [pointedId, setPointedId] = useState<string | null>(null);
  const [dragged, setDragged] = useState<{ id: string; draft: boolean } | null>(null);
  const [dropSlot, setDropSlot] = useState<ToolDeskShelfOption["id"] | null>(null);
  const [pending, startTransition] = useTransition();
  const pointed = items.find((item) => item.id === pointedId);
  const current = shelves.find((option) => option.id === shelf);

  const move = (toolId: string, draft: boolean) => startTransition(async () => {
    const result = await moveToolGroup({ locale, toolId, draft });
    if (result.ok) router.refresh();
    else toast.error(moveFailed);
  });
  // 草稿卡片只能落到正式分组，正式卡片只能落到草稿格。
  const accepts = (slot: ToolDeskShelfOption["id"]) => dragged !== null && (slot === "draft") !== dragged.draft;

  const startDrag = (event: DragEvent) => {
    const card = toolCard(event.target);
    if (!canManage || !card?.dataset.toolId) return;
    event.dataTransfer.setData("text/plain", card.dataset.toolId);
    event.dataTransfer.effectAllowed = "move";
    setDragged({ id: card.dataset.toolId, draft: card.dataset.draft === "true" });
  };
  const endDrag = () => {
    setDragged(null);
    setDropSlot(null);
  };

  return (
    <ToolGroupContext.Provider value={canManage ? { pending, move } : null}>
      <div className="tool-desk-stage" data-pending={pending || undefined}>
        {/* 横屏时 frame 按原图铺开，stage 只露出台面所在的裁切窗口。 */}
        <div className="tool-desk-frame">
          <div className="tool-desk-art" aria-hidden>
            <div className="scene-illustration" />
            <div className="scene-illustration-wash" />
          </div>

          <nav className="tool-desk-shelf" aria-label={shelfLabel}>
            {shelves.map((option) => (
              <button
                key={option.id}
                type="button"
                data-slot={option.id}
                data-drop={dropSlot === option.id || undefined}
                aria-pressed={shelf === option.id}
                className="tool-desk-shelf-item"
                onClick={() => setShelf(option.id)}
                onDragOver={(event) => {
                  if (!accepts(option.id)) return;
                  event.preventDefault();
                  setDropSlot(option.id);
                }}
                onDragLeave={() => setDropSlot((slot) => (slot === option.id ? null : slot))}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragged && accepts(option.id)) move(dragged.id, option.id === "draft");
                  endDrag();
                }}
              >
                <span className="tool-desk-shelf-label">
                  {option.label}
                  <span className="tool-desk-shelf-count">{option.count}</span>
                </span>
              </button>
            ))}
          </nav>

          <section className="tool-desk-paper" aria-label={current?.label}>
            {header}
            {/* 切换分类时重挂列表，让卡片重新播放入场。 */}
            <div
              key={shelf}
              className="tool-desk-list"
              data-shelf={shelf}
              onPointerOver={(event: PointerEvent) => setPointedId(toolCard(event.target)?.dataset.toolId ?? null)}
              onPointerLeave={() => setPointedId(null)}
              onFocus={(event: FocusEvent) => setPointedId(toolCard(event.target)?.dataset.toolId ?? null)}
              onBlur={() => setPointedId(null)}
              onDragStart={startDrag}
              onDragEnd={endDrag}
            >
              {children}
            </div>
          </section>

          <aside className="tool-desk-note" aria-live="polite">
            {pointed ? (
              <>
                <span className="tool-desk-note-no">Nº {String(pointed.no).padStart(2, "0")}</span>
                <strong className="font-display">{pointed.name}</strong>
                <span>{pointed.grades}</span>
              </>
            ) : (
              <>
                <strong className="font-display">{current?.label}</strong>
                <span>{current?.count}</span>
                <span className="tool-desk-note-hint">{noteHint}</span>
              </>
            )}
          </aside>
        </div>
      </div>
    </ToolGroupContext.Provider>
  );
}

/** 管理员在卡片上调整分组的按钮；拖拽不可用的触屏也能完成同一操作。 */
export function ToolGroupButton({ toolId, draft, label }: { toolId: string; draft: boolean; label: string }) {
  const mover = useContext(ToolGroupContext);
  if (!mover) return null;
  return (
    <button
      type="button"
      className="tool-desk-group-button"
      disabled={mover.pending}
      onClick={() => mover.move(toolId, !draft)}
    >
      {label}
    </button>
  );
}
