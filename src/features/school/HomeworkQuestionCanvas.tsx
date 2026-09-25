"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { CoursewareWorkbench, CoursewareWorkbenchPageRail, CoursewareWorkbenchDirectoryHeader } from "@/features/courseware-doc/CoursewareEditorWorkbench";
import { InteractiveQuestionEditor, type InteractiveQuestionEditorHandle, type InteractiveQuestionPersistence } from "@/features/interactive-questions/InteractiveQuestionEditor";
import { questionCompositionFromText } from "@/features/interactive-questions/contract";
import type { CoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";
import type { HomeworkScope } from "./homework-document-contract";
import { createHomeworkGame, createHomeworkH5, loadHomeworkH5, uploadHomeworkImage } from "./homework-interactive-actions";

/** 只维护当前画布，所有变更立即进入父级整份作业草稿；外层保存负责持久化。 */
export default function HomeworkQuestionCanvas({ scope, targetId, questionId, title, field, composition, text, bindingUrls,
  questions, onSelect, onChange, onBack, disabled, readOnly, onAsset, onPendingChange,
}: {
  scope: HomeworkScope; targetId: string; questionId: string; title: string; field: "content" | "answer";
  composition: CoursewareCompositionPage | null; text: string; bindingUrls: Record<string, string>;
  questions: { id: string; title: string }[]; onSelect: (id: string) => void;
  onChange: (doc: CoursewareCompositionPage) => void; onBack: () => void; disabled: boolean;
  readOnly: boolean;
  onAsset: (bindingKey: string, url: string) => void; onPendingChange: (pending: boolean) => void;
}) {
  const en = useLocale() === "en";
  const t = (zh: string, english: string) => en ? english : zh;
  const [message, setMessage] = useState("");
  const [page] = useState(() => ({ pageDocId: questionId, title: title || "1", revisionNo: 1, doc: composition ?? questionCompositionFromText(text), bindingUrls }));
  const ref = useRef<InteractiveQuestionEditorHandle>(null);
  const latestChange = useRef(onChange);
  useLayoutEffect(() => { latestChange.current = onChange; }, [onChange]);
  const change = useCallback((doc: CoursewareCompositionPage) => latestChange.current(doc), []);
  const persisted = useCallback(() => {}, []);
  const persistence = useMemo<InteractiveQuestionPersistence>(() => ({
    save: async input => ({ ok: true, data: { doc: input.doc, revisionNo: input.baseRevisionNo + 1 } }),
    uploadImage: async file => { const result = await uploadHomeworkImage({ scope, targetId, file }); if (result.ok) onAsset(result.data.bindingKey, result.data.url); return result; },
    createH5: async html => { const result = await createHomeworkH5({ scope, targetId, html }); if (result.ok) onAsset(result.data.bindingKey, result.data.url); return result; }, loadH5: loadHomeworkH5,
    createGame: input => createHomeworkGame({ scope, targetId, ...input }), toolSurface: "microcourse",
    savedLabel: en ? "In homework draft · Click Save to keep changes" : "已记入作业草稿 · 请点击保存",
  }), [scope, targetId, en, onAsset]);
  async function navigate(action: () => void) {
    if (!disabled && await ref.current?.flush()) action();
  }
  return <div className="flex min-h-0 flex-1 flex-col" data-homework-interactive-editor>
    <div className="flex items-center gap-3 pb-2 text-sm">
      <Button size="sm" variant="secondary" disabled={disabled} onClick={() => void navigate(onBack)}>{t("返回题目表格", "Back to question table")}</Button>
      <span>{title} · {field === "answer" ? t("答案／解析", "Answer / explanation") : t("题干", "Question")}</span>
      {message && <span role="status" className="text-xs text-muted">{message}</span>}
    </div>
    <div inert={disabled || readOnly || undefined} className="min-h-0 flex-1">
      <CoursewareWorkbench mode="interactive-question-editor" adapter="courseware-composition-v1" layout="viewport" layoutId="homework-question-editor" className="h-full min-h-[32rem]"
        directory={{ ariaLabel: t("题目目录", "Question directory"), header: <CoursewareWorkbenchDirectoryHeader title={t("题目目录", "Question directory")} />,
          content: <CoursewareWorkbenchPageRail items={questions} selectedIndex={questions.findIndex(q => q.id === questionId)} onSelectedIndexChange={index => void navigate(() => onSelect(questions[index].id))} /> }}
        canvas={{ ariaLabel: t("交互题目编辑器", "Interactive question editor"), content: <InteractiveQuestionEditor ref={ref} page={page} persistence={persistence} onDraftChange={change} onPendingChange={onPendingChange} onPersisted={persisted} onStatus={setMessage} /> }}
        inspector={{ ariaLabel: t("组件与属性", "Components and properties"), header: null }} />
    </div>
  </div>;
}
