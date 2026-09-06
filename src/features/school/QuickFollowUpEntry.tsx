"use client";

import { useRef, useState } from "react";
import { LoaderCircle, MessageSquarePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { STUDENT_360_REFRESH_EVENT } from "./student-360-contract";
import { addStudentFollowUp } from "./actions/followups";

export interface QuickFollowUpSaved {
  content: string;
  createdAt: string;
}

/**
 * 学生身份下的轻量“本次情况”登记。
 *
 * 这条入口只保存独立备注，不带下一步日期或状态转移；它可以嵌进任何工作现场，
 * 业务模块仍由现场自己的表单负责。保存成功后广播给 Student 360，让已打开的
 * 侧页立即重读同一条权威记录。
 */
export function QuickFollowUpEntry({
  studentId,
  onSaved,
  onSaveAndNext,
}: {
  studentId: string;
  onSaved?: (entry: QuickFollowUpSaved) => void;
  onSaveAndNext?: () => void;
}) {
  const t = useTranslations("school.quickFollowUp");
  const [content, setContent] = useState("");
  const advanceRef = useRef(false);
  const submittedContentRef = useRef("");
  const run = useAction(addStudentFollowUp, {
    successMessage: t("saved"),
    errorMessage: { default: t("saveFailed") },
    onSuccess: () => {
      const savedContent = submittedContentRef.current;
      setContent("");
      window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT));
      onSaved?.({ content: savedContent, createdAt: new Date().toISOString() });
      if (advanceRef.current) onSaveAndNext?.();
      advanceRef.current = false;
    },
    onError: () => {
      advanceRef.current = false;
    },
  });

  const submit = (advance: boolean) => {
    const value = content.trim();
    if (!value || run.pending) return;
    advanceRef.current = advance;
    submittedContentRef.current = value;
    run.run(studentId, {
      content: value,
      kind: "note",
      nextFollowUpAt: null,
      statusAfter: null,
    });
  };

  return (
    <form
      data-quick-follow-up
      className="space-y-2"
      onClick={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        submit(false);
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.repeat) return;
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          submit(false);
        }
      }}
    >
      <label className="block space-y-1 text-xs text-muted">
        <span>{t("title")}</span>
        <Textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={3}
          maxLength={2000}
          disabled={run.pending}
          aria-label={t("placeholder")}
          placeholder={t("placeholder")}
          className="resize-y text-xs"
        />
      </label>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-[11px] text-muted">{t("independentHint")}</span>
        <Button type="submit" size="sm" variant="secondary" disabled={run.pending || !content.trim()}>
          {run.pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <MessageSquarePlus className="size-3.5" />}
          {t("save")}
          <kbd className="text-[10px] opacity-70">Ctrl ↵</kbd>
        </Button>
        {onSaveAndNext ? (
          <Button type="button" size="sm" disabled={run.pending || !content.trim()} onClick={() => submit(true)}>
            {t("saveAndNext")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
