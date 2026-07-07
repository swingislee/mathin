"use client";

import { Archive, ChevronRight, FileText, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { createNote, setNoteArchived, updateNoteMeta } from "../actions";
import { useNotebookStore } from "../store";
import type { NoteMeta } from "../types";
import { useNotebookSync } from "./NotebookSync";

export function TreeItem({ note, childNotes, activeId, depth = 0, onNavigate }: {
  note: NoteMeta;
  childNotes: NoteMeta[];
  activeId: string | null;
  depth?: number;
  onNavigate: () => void;
}) {
  const t = useTranslations("notebook.workspace");
  const router = useRouter();
  const [expanded, setExpanded] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const upsert = useNotebookStore((state) => state.upsert);
  const patch = useNotebookStore((state) => state.patch);
  const broadcast = useNotebookSync();

  async function addChild() {
    const created = await createNote(note.id, t("untitled"));
    upsert(created);
    broadcast({ type: "meta", note: created });
    setExpanded(true);
  }

  async function archive() {
    patch(note.id, { isArchived: true });
    try {
      const updated = await setNoteArchived(note.id, true);
      updated.forEach((meta) => {
        upsert(meta);
        broadcast({ type: "meta", note: meta });
      });
      // 打开中的笔记被归档（含子孙）时离开该页，否则页面停留在服务端渲染的旧状态。
      if (activeId && updated.some((meta) => meta.id === activeId)) {
        router.push(note.parentId ? `/notebook/me/${note.parentId}` : "/notebook/me");
      }
    } catch {
      patch(note.id, { isArchived: false });
    }
  }

  async function finishRename(value: string) {
    setRenaming(false);
    const oldTitle = note.title;
    patch(note.id, { title: value });
    try {
      const updated = await updateNoteMeta(note.id, { title: value });
      upsert(updated);
      broadcast({ type: "meta", note: updated });
    } catch {
      patch(note.id, { title: oldTitle });
    }
  }

  return (
    <li>
      <div
        className={`group flex items-center gap-1 rounded-xl pr-1 text-sm transition-colors duration-200 ${activeId === note.id ? "bg-[var(--ws-sheet)]/15 text-[var(--ws-panel-ink)]" : "text-[var(--ws-panel-ink)]/75 hover:bg-[var(--ws-sheet)]/10"}`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        <button
          type="button"
          aria-label={expanded ? t("collapse") : t("expand")}
          onClick={() => setExpanded((value) => !value)}
          className={`p-1 ${childNotes.length ? "opacity-100" : "pointer-events-none opacity-0"}`}
        >
          <ChevronRight size={14} className={`transition-transform duration-200 ${expanded ? "rotate-90" : ""}`} />
        </button>
        {renaming ? (
          <input
            autoFocus
            defaultValue={note.title}
            aria-label={t("rename")}
            onBlur={(event) => void finishRename(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setRenaming(false);
            }}
            className="min-w-0 flex-1 rounded-md bg-[var(--ws-sheet)] px-2 py-1 text-ink outline-none"
          />
        ) : (
          <Link
            href={`/notebook/me/${note.id}`}
            onClick={onNavigate}
            onDoubleClick={(event) => { event.preventDefault(); setRenaming(true); }}
            className="flex min-w-0 flex-1 items-center gap-2 py-2"
          >
            <span aria-hidden>{note.icon ?? <FileText size={14} />}</span>
            <span className="truncate">{note.title || t("untitled")}</span>
          </Link>
        )}
        <button type="button" onClick={() => void addChild()} aria-label={t("newChild")} className="p-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"><Plus size={13} /></button>
        <button type="button" onClick={() => void archive()} aria-label={t("archive")} className="p-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"><Archive size={13} /></button>
      </div>
      {expanded && childNotes.length > 0 && (
        <ul>
          {childNotes.map((child) => (
            <TreeItemConnected key={child.id} note={child} activeId={activeId} depth={depth + 1} onNavigate={onNavigate} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function TreeItemConnected({ note, activeId, depth, onNavigate }: { note: NoteMeta; activeId: string | null; depth: number; onNavigate: () => void }) {
  const noteMap = useNotebookStore((state) => state.notes);
  const notes = Object.values(noteMap);
  const childNotes = notes.filter((candidate) => !candidate.isArchived && candidate.parentId === note.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return <TreeItem note={note} childNotes={childNotes} activeId={activeId} depth={depth} onNavigate={onNavigate} />;
}
