"use client";

import type { PartialBlock } from "@blocknote/core";
import * as locales from "@blocknote/core/locales";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveNoteDoc } from "../actions";
import { useNotebookStore } from "../store";
import { useNotebookSync } from "../workspace/NotebookSync";
import { createNoteUpload } from "./upload";

function useEditorTheme() {
  const getTheme = () => document.documentElement.classList.contains("dark")
    || (!document.documentElement.classList.contains("light") && matchMedia("(prefers-color-scheme: dark)").matches)
    ? "dark" as const : "light" as const;
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const update = () => setTheme(getTheme());
    update();
    const observer = new MutationObserver(update);
    const media = matchMedia("(prefers-color-scheme: dark)");
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    media.addEventListener("change", update);
    return () => { observer.disconnect(); media.removeEventListener("change", update); };
  }, []);
  return theme;
}

export function BlockEditor({ noteId, userId, initialDocument, initialVersion, locale }: {
  noteId: string;
  userId: string;
  initialDocument: unknown[] | null;
  initialVersion: number;
  locale: "zh" | "en";
}) {
  const t = useTranslations("notebook.editor");
  const router = useRouter();
  const theme = useEditorTheme();
  const setSaveState = useNotebookStore((state) => state.setSaveState);
  const patch = useNotebookStore((state) => state.patch);
  const broadcast = useNotebookSync();
  const versionRef = useRef(initialVersion);
  const documentRef = useRef<unknown[]>(initialDocument ?? []);
  const sequenceRef = useRef(0);
  const savedSequenceRef = useRef(0);
  const savingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => undefined);
  const [failure, setFailure] = useState<"conflict" | "too_large" | "invalid" | "network" | null>(null);
  const dictionary = locale === "zh" ? locales.zh : locales.en;
  const editor = useCreateBlockNote({
    dictionary: {
      ...dictionary,
      placeholders: { ...dictionary.placeholders, default: t("placeholder") },
    },
    initialContent: initialDocument?.length ? initialDocument as PartialBlock[] : undefined,
    uploadFile: createNoteUpload(userId, noteId),
  });

  const flush = useCallback(async () => {
    if (savingRef.current || savedSequenceRef.current === sequenceRef.current) return;
    savingRef.current = true;
    setSaveState(noteId, "saving");
    const sequence = sequenceRef.current;
    const document = documentRef.current;
    let result;
    try {
      result = await saveNoteDoc(noteId, document, versionRef.current);
    } catch {
      try {
        result = await saveNoteDoc(noteId, document, versionRef.current);
      } catch {
        setFailure("network");
        setSaveState(noteId, "error");
        savingRef.current = false;
        return;
      }
    }
    savingRef.current = false;
    if (!result.ok) {
      setFailure(result.reason);
      setSaveState(noteId, result.reason === "conflict" ? "conflict" : "error");
      return;
    }
    versionRef.current = result.version;
    savedSequenceRef.current = sequence;
    patch(noteId, { version: result.version, updatedAt: result.updatedAt });
    setFailure(null);
    setSaveState(noteId, "saved");
    broadcast({ type: "doc", id: noteId, version: result.version });
    if (sequenceRef.current !== sequence) timerRef.current = setTimeout(() => void flushRef.current(), 1500);
  }, [broadcast, noteId, patch, setSaveState]);
  useEffect(() => { flushRef.current = flush; }, [flush]);

  const schedule = useCallback(() => {
    documentRef.current = editor.document;
    sequenceRef.current += 1;
    setSaveState(noteId, "saving");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush(), 1500);
  }, [editor, flush, noteId, setSaveState]);

  useEffect(() => {
    setSaveState(noteId, "saved");
    const beforeUnload = () => void flush();
    const visibility = () => { if (document.visibilityState === "hidden") void flush(); };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", visibility);
      void flush();
    };
  }, [flush, noteId, setSaveState]);

  return (
    <div className="relative mt-5">
      {failure && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-rose/40 bg-cheek/20 px-4 py-3 text-sm">
          <AlertTriangle size={17} className="shrink-0 text-rose" />
          <span className="flex-1">{t(`errors.${failure}`)}</span>
          <button type="button" onClick={() => failure === "conflict" ? router.refresh() : void flush()} className="inline-flex items-center gap-1 rounded-full border border-crater px-3 py-1.5"><RotateCcw size={14} />{failure === "conflict" ? t("loadLatest") : t("retry")}</button>
        </div>
      )}
      <BlockNoteView editor={editor} theme={theme} onChange={schedule} className="notebook-editor" />
    </div>
  );
}
