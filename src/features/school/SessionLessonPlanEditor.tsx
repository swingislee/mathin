"use client";

import type { PartialBlock } from "@blocknote/core";
import * as locales from "@blocknote/core/locales";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { LoaderCircle, Send, StickyNote } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  saveLessonPageNoteAction,
  saveSessionLessonPlanAction,
  submitSessionLessonPlanAction,
} from "./teacher-preparation-actions";
import type {
  LessonPageNote,
  LessonPlanStatus,
  SessionLessonPlan,
} from "./teacher-preparation-contract";

type SaveState = "saved" | "saving" | "error" | "conflict";

function useEditorTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const resolve = () => document.documentElement.classList.contains("dark")
      || (!document.documentElement.classList.contains("light") && matchMedia("(prefers-color-scheme: dark)").matches)
      ? "dark" as const : "light" as const;
    const update = () => setTheme(resolve());
    const observer = new MutationObserver(update);
    const media = matchMedia("(prefers-color-scheme: dark)");
    update();
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    media.addEventListener("change", update);
    return () => { observer.disconnect(); media.removeEventListener("change", update); };
  }, []);
  return theme;
}

function StatusBadge({ status }: { status: LessonPlanStatus }) {
  const t = useTranslations("school.session");
  const key = status === "approved" ? "prepReviewApproved"
    : status === "changes_requested" ? "prepReviewChangesRequested"
      : status === "pending" ? "prepReviewPending" : "lessonPlanDraft";
  return (
    <Badge
      variant={status === "changes_requested" ? "danger" : "secondary"}
      className={status === "approved" ? "border-leaf/50 bg-leaf/25 text-leaf-deep" : undefined}
    >
      {t(key)}
    </Badge>
  );
}

export interface LessonPlanReferencePage {
  pageDocId: string;
  pageNo: number;
  title: string;
}

export function SessionLessonPlanEditor({
  lessonPlan,
  pageNotes,
  pages,
  readOnly,
}: {
  lessonPlan: SessionLessonPlan;
  pageNotes: LessonPageNote[];
  pages: LessonPlanReferencePage[];
  readOnly: boolean;
}) {
  const t = useTranslations("school.session");
  const locale = useLocale() === "zh" ? "zh" : "en";
  const router = useRouter();
  const theme = useEditorTheme();
  const dictionary = locale === "zh" ? locales.zh : locales.en;
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [status, setStatus] = useState(lessonPlan.status);
  const [submitting, setSubmitting] = useState(false);
  const revisionRef = useRef(lessonPlan.revision);
  const sequenceRef = useRef(lessonPlan.id ? 0 : 1);
  const savedSequenceRef = useRef(0);
  const documentRef = useRef<unknown[]>(lessonPlan.content);
  const timerRef = useRef<number | null>(null);
  const savingRef = useRef<Promise<boolean> | null>(null);
  const editor = useCreateBlockNote({
    dictionary: {
      ...dictionary,
      placeholders: { ...dictionary.placeholders, default: t("lessonPlanEditorPlaceholder") },
    },
    initialContent: lessonPlan.content as PartialBlock[],
  });

  const flush = useCallback(async (): Promise<boolean> => {
    if (readOnly) return true;
    if (savingRef.current) await savingRef.current;
    if (savedSequenceRef.current === sequenceRef.current) return true;
    const sequence = sequenceRef.current;
    const content = documentRef.current;
    setSaveState("saving");
    const request = saveSessionLessonPlanAction({
      sessionId: lessonPlan.sessionId,
      templateVersion: lessonPlan.templateVersion,
      content,
      baseRevision: revisionRef.current,
    }).then((result) => {
      if (!result.ok) {
        setSaveState(result.code === "VERSION_CONFLICT" ? "conflict" : "error");
        return false;
      }
      revisionRef.current = result.data.revision;
      savedSequenceRef.current = sequence;
      setStatus("draft");
      setSaveState("saved");
      return true;
    }).catch(() => {
      setSaveState("error");
      return false;
    }).finally(() => {
      savingRef.current = null;
    });
    savingRef.current = request;
    return request;
  }, [lessonPlan.sessionId, lessonPlan.templateVersion, readOnly]);

  const schedule = useCallback(() => {
    documentRef.current = editor.document;
    sequenceRef.current += 1;
    setSaveState("saving");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flush(), 1_000);
  }, [editor, flush]);

  useEffect(() => {
    if (readOnly || lessonPlan.id) return;
    documentRef.current = editor.document;
    void flush();
  }, [editor, flush, lessonPlan.id, readOnly]);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    void flush();
  }, [flush]);

  const submit = async () => {
    setSubmitting(true);
    if (!(await flush())) {
      toast.error(t("lessonPlanSaveFailed"));
      setSubmitting(false);
      return;
    }
    const result = await submitSessionLessonPlanAction({
      sessionId: lessonPlan.sessionId,
      revision: revisionRef.current,
    });
    if (result.ok) {
      setStatus("pending");
      toast.success(t("lessonPlanSubmitted", { revision: result.data.reviewRevision }));
      router.refresh();
    } else {
      toast.error(t(result.code === "VERSION_CONFLICT" ? "lessonPlanConflict" : "actionFailed"));
    }
    setSubmitting(false);
  };

  const saveLabel = saveState === "saving" ? t("lessonPlanSaving")
    : saveState === "conflict" ? t("lessonPlanConflict")
      : saveState === "error" ? t("lessonPlanSaveFailed") : t("lessonPlanSaved");

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col rounded-2xl border border-line bg-card" data-lesson-plan-workspace>
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg text-ink">{t("lessonPlanWorkspaceTitle")}</h3>
          <p className="mt-0.5 text-xs text-muted">{t("lessonPlanTemplateVersion", { version: lessonPlan.templateVersion })}</p>
        </div>
        <StatusBadge status={status} />
        <span className={cn("text-xs", saveState === "error" || saveState === "conflict" ? "text-rose" : "text-muted")} aria-live="polite">
          {saveState === "saving" ? <LoaderCircle size={12} className="mr-1 inline animate-spin motion-reduce:animate-none" /> : null}
          {readOnly ? t("prepArchiveReadOnly") : saveLabel}
        </span>
        {!readOnly ? (
          <Button type="button" size="sm" disabled={submitting || saveState === "conflict"} onClick={() => void submit()}>
            {submitting ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <Send size={14} />}
            {status === "pending" ? t("lessonPlanResubmit") : t("lessonPlanSubmit")}
          </Button>
        ) : null}
      </header>
      <LessonPageNotesPanel
        sessionId={lessonPlan.sessionId}
        pages={pages}
        initialNotes={pageNotes}
        readOnly={readOnly}
        ensurePlanSaved={flush}
      />
      <div className="min-h-[24rem] flex-1 overflow-y-auto px-3 py-2">
        <BlockNoteView
          editor={editor}
          theme={theme}
          editable={!readOnly}
          onChange={readOnly ? undefined : schedule}
          className="notebook-editor lesson-plan-editor"
        />
      </div>
    </div>
  );
}

function LessonPageNotesPanel({
  sessionId,
  pages,
  initialNotes,
  readOnly,
  ensurePlanSaved,
}: {
  sessionId: string;
  pages: LessonPlanReferencePage[];
  initialNotes: LessonPageNote[];
  readOnly: boolean;
  ensurePlanSaved: () => Promise<boolean>;
}) {
  const t = useTranslations("school.session");
  const [selectedPageDocId, setSelectedPageDocId] = useState(pages[0]?.pageDocId ?? "");
  const [notes, setNotes] = useState<Record<string, string>>(() => Object.fromEntries(initialNotes.map((note) => [note.pageDocId, note.content])));
  const [noteState, setNoteState] = useState<SaveState>("saved");
  const noteTimerRef = useRef<number | null>(null);
  const selected = pages.find((page) => page.pageDocId === selectedPageDocId) ?? pages[0] ?? null;

  const persistNote = useCallback(async (pageDocId: string, content: string) => {
    if (readOnly) return;
    setNoteState("saving");
    if (!(await ensurePlanSaved())) {
      setNoteState("error");
      return;
    }
    const result = await saveLessonPageNoteAction({ sessionId, pageDocId, content });
    setNoteState(result.ok ? "saved" : result.code === "VERSION_CONFLICT" ? "conflict" : "error");
  }, [ensurePlanSaved, readOnly, sessionId]);

  const changeNote = (pageDocId: string, content: string) => {
    setNotes((current) => ({ ...current, [pageDocId]: content }));
    setNoteState("saving");
    if (noteTimerRef.current) window.clearTimeout(noteTimerRef.current);
    noteTimerRef.current = window.setTimeout(() => void persistNote(pageDocId, content), 800);
  };

  useEffect(() => () => {
    if (noteTimerRef.current) window.clearTimeout(noteTimerRef.current);
  }, []);

  return (
    <section className="shrink-0 border-b border-line bg-paper/45 px-3 py-3" data-lesson-page-notes>
      <div className="flex items-center gap-2">
        <StickyNote size={14} className="shrink-0 text-muted" aria-hidden />
        <h4 className="text-xs font-medium text-ink">{t("lessonPageNotesTitle")}</h4>
      </div>
      {selected ? (
        <>
          <Select value={selected.pageDocId} onValueChange={setSelectedPageDocId}>
            <SelectTrigger className="mt-2 w-full" aria-label={t("lessonPageNotePageLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pages.map((page) => (
                <SelectItem key={page.pageDocId} value={page.pageDocId}>
                  {page.pageNo}. {page.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-2 text-xs leading-5 text-muted">{t("lessonPageNoteIntro")}</p>
          <Textarea
            className="mt-2 min-h-20 resize-y text-xs"
            value={notes[selected.pageDocId] ?? ""}
            readOnly={readOnly}
            maxLength={5_000}
            rows={3}
            placeholder={t("lessonPageNotePlaceholder")}
            onChange={(event) => changeNote(selected.pageDocId, event.target.value)}
          />
          <p className={cn("mt-1 text-xs", noteState === "error" || noteState === "conflict" ? "text-rose" : "text-muted")} aria-live="polite">
            {readOnly ? t("prepArchiveReadOnly") : t(noteState === "saving" ? "lessonPageNoteSaving" : noteState === "error" || noteState === "conflict" ? "lessonPageNoteSaveFailed" : "lessonPageNoteSaved")}
          </p>
        </>
      ) : <p className="mt-2 text-xs text-muted">{t("lessonPageNoteEmpty")}</p>}
    </section>
  );
}

export function LessonPlanDocumentView({ content }: { content: unknown[] }) {
  const locale = useLocale() === "zh" ? "zh" : "en";
  const theme = useEditorTheme();
  const editor = useCreateBlockNote({
    dictionary: locale === "zh" ? locales.zh : locales.en,
    initialContent: content as PartialBlock[],
  });
  return <BlockNoteView editor={editor} theme={theme} editable={false} className="notebook-editor lesson-plan-editor" />;
}
