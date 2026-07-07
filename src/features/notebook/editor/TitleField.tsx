"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { updateNoteMeta } from "../actions";
import { useNotebookStore } from "../store";
import { useNotebookSync } from "../workspace/NotebookSync";

export function TitleField({ noteId }: { noteId: string }) {
  const t = useTranslations("notebook.editor");
  const note = useNotebookStore((state) => state.notes[noteId]);
  const patch = useNotebookStore((state) => state.patch);
  const upsert = useNotebookStore((state) => state.upsert);
  const broadcast = useNotebookSync();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  if (!note) return null;

  function scheduleSave(title: string) {
    patch(noteId, { title });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const updated = await updateNoteMeta(noteId, { title });
      upsert(updated);
      broadcast({ type: "meta", note: updated });
    }, 600);
  }

  return (
    <textarea
      value={note.title}
      onChange={(event) => scheduleSave(event.currentTarget.value)}
      placeholder={t("titlePlaceholder")}
      rows={1}
      maxLength={200}
      className="field-sizing-content min-h-14 w-full resize-none bg-transparent font-display text-4xl leading-tight outline-none placeholder:text-muted/55 md:text-5xl"
    />
  );
}
