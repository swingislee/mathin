"use client";

import { useState, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { ToolShelf } from "./shelves";

export interface ToolDeskItem {
  id: string;
  no: number;
  shelf: ToolShelf;
  name: string;
  desc: string;
  grades: string;
  thumb: ReactNode;
}

export interface ToolDeskShelfOption {
  id: ToolShelf | "all";
  label: string;
  count: string;
}

/**
 * 工具台目录：左侧木格架选分类，中间纸面列出工具，右侧夹子便签显示指向中的工具。
 * 台面坐标与窄屏排列由 globals.css 的 `.tool-desk` 维护。
 */
export function ToolDesk({ header, shelves, items, shelfLabel, noteHint }: {
  header: ReactNode;
  shelves: ToolDeskShelfOption[];
  items: ToolDeskItem[];
  shelfLabel: string;
  noteHint: string;
}) {
  const [shelf, setShelf] = useState<ToolDeskShelfOption["id"]>("all");
  const [pointedId, setPointedId] = useState<string | null>(null);
  const visible = shelf === "all" ? items : items.filter((item) => item.shelf === shelf);
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
        <div key={shelf} className="tool-desk-list" onPointerLeave={() => setPointedId(null)}>
          {visible.map((item, index) => (
            <Link
              key={item.id}
              href={`/tools/${item.id}`}
              className="tool-desk-card scene-enter group"
              style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }}
              onPointerEnter={() => setPointedId(item.id)}
              onFocus={() => setPointedId(item.id)}
              onBlur={() => setPointedId(null)}
            >
              <div className="relative aspect-[5/3] overflow-hidden rounded-lg border border-[#c9a87b] bg-[#f5ead5]">
                {item.thumb}
                <span className="absolute right-1.5 top-1 text-[0.65rem] tracking-[0.12em] text-[#8d6a43]">Nº {String(item.no).padStart(2, "0")}</span>
              </div>
              <div className="flex items-start gap-1.5 px-0.5 pt-2">
                <div className="min-w-0 flex-1">
                  <h2 className="tool-desk-card-name font-display">{item.name}</h2>
                  <p className="tool-desk-card-desc line-clamp-2">{item.desc}</p>
                </div>
                <ArrowUpRight size={15} className="mt-0.5 shrink-0 text-[#866647] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
              </div>
            </Link>
          ))}
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
