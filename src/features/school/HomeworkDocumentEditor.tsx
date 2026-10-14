"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import type { HomeworkScope, HomeworkWorkspace } from "./homework-document-contract";

// 编辑区引用完整的课件页校验（含教具合同与 three）；班级、课次与讲次页首屏只渲染按钮，首次打开时再加载。
const HomeworkDocumentWorkspace = dynamic(() => import("./HomeworkDocumentWorkspace"), { ssr: false });

export function homeworkEditorTitle(scope: HomeworkScope, en: boolean) {
  return scope === "classroom" ? (en ? "Class homework structure" : "班级作业题号模板")
    : scope === "lecture" ? (en ? "Lesson homework and teaching plan" : "本讲作业与标准教案")
      : (en ? "Edit homework and topic" : "编辑作业与课后主题");
}

export function HomeworkDocumentEditor({ scope, targetId, onSaved }: { scope: HomeworkScope; targetId: string; onSaved?: (data: HomeworkWorkspace) => void }) {
  const en = useLocale() === "en";
  const [openRequest, setOpenRequest] = useState(0);
  return <>
    <Button size="sm" variant="secondary" onClick={() => setOpenRequest(value => value + 1)}>{homeworkEditorTitle(scope, en)}</Button>
    {openRequest > 0 ? <HomeworkDocumentWorkspace key={openRequest} scope={scope} targetId={targetId} onSaved={onSaved} /> : null}
  </>;
}
