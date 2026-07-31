"use client";

import type { PartialBlock } from "@blocknote/core";
import * as locales from "@blocknote/core/locales";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import "./session-lesson-plan-editor.css";
import { LoaderCircle, Send, Undo2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  saveSessionLessonPlanAction,
  submitSessionLessonPlanAction,
  withdrawSessionLessonPlanAction,
} from "./teacher-preparation-actions";
import type {
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
      className={cn(
        "shrink-0 px-1.5 py-0.5 text-[10px]",
        status === "approved" && "border-leaf/50 bg-leaf/25 text-leaf-deep",
      )}
    >
      {t(key)}
    </Badge>
  );
}

export function SessionLessonPlanEditor({
  lessonPlan,
  readOnly,
}: {
  lessonPlan: SessionLessonPlan;
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
  const [withdrawing, setWithdrawing] = useState(false);
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

  const withdraw = async () => {
    setWithdrawing(true);
    const result = await withdrawSessionLessonPlanAction({ sessionId: lessonPlan.sessionId });
    if (result.ok) {
      revisionRef.current = result.data.revision;
      setStatus("draft");
      toast.success(t("lessonPlanWithdrawn"));
      router.refresh();
    } else {
      toast.error(t(result.code === "REVIEW_ALREADY_DECIDED"
        ? "prepReviewAlreadyDecided"
        : "actionFailed"));
    }
    setWithdrawing(false);
  };

  const saveLabel = saveState === "saving" ? t("lessonPlanSaving")
    : saveState === "conflict" ? t("lessonPlanConflict")
      : saveState === "error" ? t("lessonPlanSaveFailed") : t("lessonPlanSaved");

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col rounded-2xl border border-line bg-card" data-lesson-plan-workspace>
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5">
        <h3
          className="min-w-0 flex-1 truncate text-xs font-medium text-ink"
          title={t("lessonPlanTemplateVersion", { version: lessonPlan.templateVersion })}
        >
          {t("lessonPlanWorkspaceTitle")}
        </h3>
        <StatusBadge status={status} />
        <span className={cn("max-w-24 shrink truncate text-[10px]", saveState === "error" || saveState === "conflict" ? "text-rose" : "text-muted")} aria-live="polite">
          {saveState === "saving" ? <LoaderCircle size={12} className="mr-1 inline animate-spin motion-reduce:animate-none" /> : null}
          {readOnly ? t("prepArchiveReadOnly") : saveLabel}
        </span>
        {!readOnly && status === "pending" ? (
          <Button type="button" size="sm" variant="secondary" className="h-7 shrink-0 px-2 text-[11px]" disabled={withdrawing || submitting} onClick={() => void withdraw()}>
            {withdrawing ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <Undo2 size={14} />}
            {t("lessonPlanWithdrawReview")}
          </Button>
        ) : !readOnly ? (
          <Button type="button" size="sm" className="h-7 shrink-0 px-2 text-[11px]" disabled={submitting || withdrawing || saveState === "conflict"} onClick={() => void submit()}>
            {submitting ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <Send size={14} />}
            {t("lessonPlanSubmitShort")}
          </Button>
        ) : null}
      </header>
      <div className="min-h-[24rem] flex-1 overflow-y-auto px-2 py-1.5">
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

export function LessonPlanDocumentView({ content }: { content: unknown[] }) {
  const locale = useLocale() === "zh" ? "zh" : "en";
  const theme = useEditorTheme();
  const editor = useCreateBlockNote({
    dictionary: locale === "zh" ? locales.zh : locales.en,
    initialContent: content as PartialBlock[],
  });
  return <BlockNoteView editor={editor} theme={theme} editable={false} className="notebook-editor lesson-plan-editor" />;
}
