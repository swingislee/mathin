"use client";

import type { PartialBlock } from "@blocknote/core";
import * as locales from "@blocknote/core/locales";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import "./session-lesson-plan-editor.css";
import { AlertTriangle, Copy, FilePlus2, LoaderCircle, Send } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { createNoteUpload } from "@/features/notebook/editor/upload";
import {
  publishSessionFamilyBriefAction,
  saveSessionKnowledgeSummaryAction,
} from "./actions/classes";
import type { KnowledgeSummarySource, SessionFamilyBrief } from "./classes";
import { LearningResultWithdrawButton } from "./LearningResultWithdrawButton";
import type { LearningResultStatus } from "./learning-results";

const TEMPLATE_VERSION = "mathin-knowledge-summary-v1";
type SaveState = "saved" | "saving" | "error" | "conflict";

function textRun(text: string) {
  return [{ type: "text" as const, text, styles: {} }];
}

function knowledgeTemplate(locale: "zh" | "en"): PartialBlock[] {
  const copy = locale === "zh"
    ? {
        overview: "本课知识",
        overviewHint: "总结本课探索的概念、关系与关键结论。",
        methods: "关键方法",
        methodsHint: "记录典型思路、图示、例题或需要留意的误区。",
        practice: "课后建议",
        practiceHint: "给学生和家长清晰、可执行的练习建议。",
      }
    : {
        overview: "What we learned",
        overviewHint: "Summarize the concepts, relationships, and conclusions explored in this lesson.",
        methods: "Key methods",
        methodsHint: "Record useful approaches, diagrams, examples, or misconceptions to watch.",
        practice: "Practice suggestions",
        practiceHint: "Give students and families clear, actionable next steps.",
      };
  return [
    { type: "heading", props: { level: 2 }, content: textRun(copy.overview) },
    { type: "paragraph", content: textRun(copy.overviewHint) },
    { type: "heading", props: { level: 2 }, content: textRun(copy.methods) },
    { type: "paragraph", content: textRun(copy.methodsHint) },
    { type: "heading", props: { level: 2 }, content: textRun(copy.practice) },
    { type: "paragraph", content: textRun(copy.practiceHint) },
  ];
}

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

export function SessionFamilyBriefForm({
  sessionId,
  userId,
  brief,
  sources,
  resultStatus,
}: {
  sessionId: string;
  userId: string;
  brief: SessionFamilyBrief;
  sources: KnowledgeSummarySource[];
  resultStatus: LearningResultStatus;
}) {
  const t = useTranslations("school.session");
  const locale = useLocale() === "zh" ? "zh" : "en";
  const router = useRouter();
  const theme = useEditorTheme();
  const dictionary = locale === "zh" ? locales.zh : locales.en;
  const initialDocument = brief.document.length > 0 ? brief.document as PartialBlock[] : knowledgeTemplate(locale);
  const [lessonTitle, setLessonTitle] = useState(brief.lessonTitle);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [status, setStatus] = useState(resultStatus);
  const [publishing, setPublishing] = useState(false);
  const [copySourceId, setCopySourceId] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const revisionRef = useRef(brief.revision);
  const titleRef = useRef(brief.lessonTitle);
  const documentRef = useRef<unknown[]>(initialDocument);
  const sequenceRef = useRef(brief.revision === 0 ? 1 : 0);
  const savedSequenceRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const savingRef = useRef<Promise<boolean> | null>(null);
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  const upload = createNoteUpload(userId, `knowledge-${sessionId}`);
  const editor = useCreateBlockNote({
    dictionary: {
      ...dictionary,
      placeholders: { ...dictionary.placeholders, default: t("knowledgeSummaryEditorPlaceholder") },
    },
    initialContent: initialDocument,
    uploadFile: async (file: File) => {
      try {
        const url = await upload(file);
        setUploadError(null);
        return url;
      } catch (cause) {
        setUploadError(cause instanceof Error ? cause.message : String(cause));
        throw cause;
      }
    },
  });

  const flush = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) await savingRef.current;
    if (savedSequenceRef.current === sequenceRef.current) return true;
    const sequence = sequenceRef.current;
    setSaveState("saving");
    const request = saveSessionKnowledgeSummaryAction({
      sessionId,
      lessonTitle: titleRef.current,
      document: documentRef.current,
      templateVersion: TEMPLATE_VERSION,
      baseRevision: revisionRef.current,
    }).then((result) => {
      if (!result.ok) {
        setSaveState(result.code === "VERSION_CONFLICT" ? "conflict" : "error");
        return false;
      }
      revisionRef.current = result.data.revision;
      savedSequenceRef.current = sequence;
      if (result.data.status === "draft" || result.data.status === "published" || result.data.status === "withdrawn" || result.data.status === "revised") {
        setStatus(result.data.status);
      }
      setSaveState("saved");
      if (sequenceRef.current !== sequence) {
        timerRef.current = window.setTimeout(() => void flushRef.current(), 1_000);
      }
      return true;
    }).catch(() => {
      setSaveState("error");
      return false;
    }).finally(() => {
      savingRef.current = null;
    });
    savingRef.current = request;
    return request;
  }, [sessionId]);

  useEffect(() => { flushRef.current = flush; }, [flush]);

  const schedule = useCallback(() => {
    documentRef.current = editor.document;
    sequenceRef.current += 1;
    setSaveState("saving");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flushRef.current(), 1_000);
  }, [editor]);

  const changeTitle = (value: string) => {
    setLessonTitle(value);
    titleRef.current = value;
    sequenceRef.current += 1;
    setSaveState("saving");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flushRef.current(), 1_000);
  };

  useEffect(() => {
    if (brief.revision === 0) void flush();
  }, [brief.revision, flush]);

  useEffect(() => {
    const visibility = () => { if (document.visibilityState === "hidden") void flush(); };
    const beforeUnload = () => void flush();
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", visibility);
      void flush();
    };
  }, [flush]);

  const replaceDocument = (document: unknown[], title?: string) => {
    editor.replaceBlocks(editor.document, document as PartialBlock[]);
    documentRef.current = editor.document;
    if (title !== undefined) {
      setLessonTitle(title);
      titleRef.current = title;
    }
    sequenceRef.current += 1;
    setSaveState("saving");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flushRef.current(), 1_000);
  };

  const copyPrevious = () => {
    const source = sources.find((item) => item.sessionId === copySourceId);
    if (!source) return;
    replaceDocument(source.document, source.lessonTitle);
    toast.success(t("knowledgeSummaryCopied"));
  };

  const publish = async () => {
    setPublishing(true);
    if (!(await flush())) {
      toast.error(t(saveState === "conflict" ? "knowledgeSummaryConflict" : "knowledgeSummarySaveFailed"));
      setPublishing(false);
      return;
    }
    const result = await publishSessionFamilyBriefAction(sessionId);
    if (result.ok) {
      setStatus("published");
      toast.success(t("knowledgeSummaryPublishedToast"));
      router.refresh();
    } else {
      toast.error(t("actionFailed"));
    }
    setPublishing(false);
  };

  const isRepublish = status === "published" || status === "withdrawn" || status === "revised";
  const saveLabel = saveState === "saving" ? t("knowledgeSummarySaving")
    : saveState === "conflict" ? t("knowledgeSummaryConflict")
      : saveState === "error" ? t("knowledgeSummarySaveFailed") : t("knowledgeSummarySavedAuto");

  return (
    <div className="flex min-h-[34rem] min-w-0 flex-col rounded-2xl border border-line bg-card">
      <div className="flex flex-wrap items-end gap-2 border-b border-line p-3">
        <Label className="min-w-56 flex-1 text-xs font-normal text-muted">
          <span className="mb-1 block">{t("knowledgeSummaryTitleLabel")}</span>
          <Input value={lessonTitle} onChange={(event) => changeTitle(event.target.value)} maxLength={200} />
        </Label>
        <Button type="button" size="sm" variant="secondary" onClick={() => replaceDocument(knowledgeTemplate(locale))}>
          <FilePlus2 size={14} />
          {t("knowledgeSummaryUseTemplate")}
        </Button>
        {sources.length > 0 && (
          <>
            <Select value={copySourceId} onValueChange={setCopySourceId}>
              <SelectTrigger className="w-56"><SelectValue placeholder={t("knowledgeSummaryChoosePrevious")} /></SelectTrigger>
              <SelectContent>
                {sources.map((source) => (
                  <SelectItem key={source.sessionId} value={source.sessionId}>
                    {source.lessonTitle || source.sessionTitle}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" size="sm" variant="secondary" disabled={!copySourceId} onClick={copyPrevious}>
              <Copy size={14} />
              {t("knowledgeSummaryCopyPrevious")}
            </Button>
          </>
        )}
        <Badge className="ml-auto self-center" variant={status === "published" ? "default" : "outline"}>
          {t("learningResultStatus_" + status)}
        </Badge>
      </div>

      {uploadError && (
        <div className="m-3 mb-0 flex items-center gap-3 rounded-xl border border-rose/40 bg-cheek/20 px-3 py-2 text-xs">
          <AlertTriangle size={15} className="shrink-0 text-rose" />
          <span className="min-w-0 flex-1 break-all">{t("knowledgeSummaryUploadFailed", { message: uploadError })}</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => setUploadError(null)}>{t("dismiss")}</Button>
        </div>
      )}

      <div className="min-h-[26rem] flex-1 overflow-y-auto px-2 py-2">
        <BlockNoteView editor={editor} theme={theme} editable onChange={schedule} className="notebook-editor lesson-plan-editor" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2">
        <span className={cn("text-xs", saveState === "error" || saveState === "conflict" ? "text-rose" : "text-muted")} aria-live="polite">
          {saveState === "saving" ? <LoaderCircle size={13} className="mr-1 inline animate-spin motion-reduce:animate-none" /> : null}
          {saveLabel}
        </span>
        <div className="flex items-center gap-2">
          {status === "published" && <LearningResultWithdrawButton mode="session" targetId={sessionId} disabled={publishing || saveState === "saving"} onSuccess={() => setStatus("withdrawn")} />}
          <Button type="button" size="sm" disabled={publishing || saveState === "conflict" || !lessonTitle.trim()} onClick={() => void publish()}>
            {publishing ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <Send size={14} />}
            {isRepublish ? t("republish") : t("publishKnowledgeSummary")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function KnowledgeSummaryDocumentView({ document }: { document: unknown[] }) {
  const locale = useLocale() === "zh" ? "zh" : "en";
  const theme = useEditorTheme();
  const editor = useCreateBlockNote({
    dictionary: locale === "zh" ? locales.zh : locales.en,
    initialContent: document.length > 0 ? document as PartialBlock[] : undefined,
  });
  return <BlockNoteView editor={editor} theme={theme} editable={false} className="notebook-editor lesson-plan-editor" />;
}
