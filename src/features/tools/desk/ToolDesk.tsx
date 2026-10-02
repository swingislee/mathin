"use client";

import { useState, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import type { ToolShelf } from "./shelves";

/** 便签只需要文字信息；卡片与缩略图由服务端渲染后作为 children 传入。 */
export interface ToolDeskNoteItem {
  id: string;
  no: number;
  name: string;
  grades: string;
}

export interface ToolDeskShelfOption {
  id: ToolShelf | "all";
  label: string;
  count: string;
}

function pointedToolId(target: EventTarget) {
  return target instanceof Element ? target.closest<HTMLElement>("[data-tool-id]")?.dataset.toolId ?? null : null;
}

/**
 * 工具台目录：左侧木格架选分类，中间纸面列出工具，右侧夹子便签显示指向中的工具。
 * 卡片带 `data-tool-id` / `data-shelf`，分类筛选与台面坐标由 globals.css 的 `.tool-desk` 维护。
 */
export function ToolDesk({ header, shelves, items, shelfLabel, noteHint, children }: {
  header: ReactNode;
  shelves: ToolDeskShelfOption[];
  items: ToolDeskNoteItem[];
  shelfLabel: string;
  noteHint: string;
  children: ReactNode;
}) {
  const [shelf, setShelf] = useState<ToolDeskShelfOption["id"]>("all");
  const [pointedId, setPointedId] = useState<string | null>(null);
  const pointed = items.find((item) => item.id === pointedId);
  const current = shelves.find((option) => option.id === shelf);

  return (
    <div className="tool-desk-stage">
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
            aria-pressed={shelf === option.id}
            className="tool-desk-shelf-item"
            onClick={() => setShelf(option.id)}
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
          onPointerOver={(event: PointerEvent) => setPointedId(pointedToolId(event.target))}
          onPointerLeave={() => setPointedId(null)}
          onFocus={(event: FocusEvent) => setPointedId(pointedToolId(event.target))}
          onBlur={() => setPointedId(null)}
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
  );
}
