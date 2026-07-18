"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import type { InteractionTrigger } from "@/features/courseware-doc/interactions";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import type { PageDoc } from "@/features/courseware-doc/schema";

// 渲染器懒加载（games/boards.tsx 模式）：doc 页第一次出现才拉 DocStage 代码，
// 无 doc 页的课堂不多付一字节。
const DocStage = dynamic(() => import("@/features/courseware-doc/DocStage"), {
  ssr: false,
  loading: () => (
    <div className="grid size-full place-items-center">
      <LoaderCircle size={20} className="animate-spin text-muted motion-reduce:animate-none" />
    </div>
  ),
});

interface Props {
  doc: PageDoc | null;
  bindingUrls: ResolvedBindingUrls;
  /** 教师端：本地点击直接驱动舞台并广播 doc_step；学生端只回放。 */
  isController: boolean;
  steps: readonly InteractionTrigger[] | undefined;
  onStep: (trigger: InteractionTrigger) => void;
}

/** 课堂 doc 页舞台（P6-5）：4:3 顶置模式，16:9 内容占上部 75%、下部为板书带（§6.1）。 */
export function DocCoursewarePage({ doc, bindingUrls, isController, steps, onStep }: Props) {
  const t = useTranslations("classroom.live");
  if (!doc) {
    return <p className="grid size-full place-items-center text-sm text-muted">{t("docNotReady")}</p>;
  }
  return (
    <DocStage
      doc={doc}
      bindingUrls={bindingUrls}
      stageMode="board43"
      interactive={isController}
      onClickTrigger={isController ? onStep : undefined}
      replaySteps={steps}
    />
  );
}
