"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { isAixuexiPageDoc } from "@/features/courseware-doc/aixuexi-schema";
import type { CoursewareDoc } from "@/features/courseware-doc/document";
import type { DocVideoCtl } from "@/features/courseware-doc/DocStage";
import type { H5PointerBridgeHost } from "@/features/courseware-doc/h5-pointer-protocol";
import type { InteractionTrigger } from "@/features/courseware-doc/interactions";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import { StagePreview } from "@/features/courseware-studio/StagePreview";
import type { GameMirrorState } from "@/features/games/types";
import { resolveClassroomInteractionAudit } from "../sync/interaction-audit";
import { classroomInteractionSyncAttributes } from "../sync/interaction-provider";

interface Props {
  doc: CoursewareDoc | null;
  bindingUrls: ResolvedBindingUrls;
  /** 教师端：本地点击直接驱动舞台并广播 doc_step；学生端只回放。 */
  isController: boolean;
  steps: readonly InteractionTrigger[] | undefined;
  onStep: (trigger: InteractionTrigger) => void;
  videoCtl: DocVideoCtl | undefined;
  onVideoCtl: (action: DocVideoCtl["action"], time: number) => void;
  onAdvance: () => void;
  h5PointerBridge?: H5PointerBridgeHost;
  gameMirror: GameMirrorState | null;
  onGameMirror: (state: GameMirrorState) => void;
}

/** 课堂 doc 页舞台（P6-5）：4:3 顶置模式，16:9 内容占上部 75%、下部为板书带（§6.1）。 */
export function DocCoursewarePage({
  doc,
  bindingUrls,
  isController,
  steps,
  onStep,
  videoCtl,
  onVideoCtl,
  onAdvance,
  h5PointerBridge,
  gameMirror,
  onGameMirror,
}: Props) {
  const t = useTranslations("classroom.live");
  // Controller takes the persisted baseline once and then remains the single writer.
  // Display/viewer devices keep applying every incoming mirror object.
  const [initialGameMirror] = useState(() => gameMirror);
  if (!doc) {
    return <p className="grid size-full place-items-center text-sm text-muted">{t("docNotReady")}</p>;
  }
  const interactionAudit = resolveClassroomInteractionAudit(doc);
  const interactive = isController && interactionAudit.status !== "read-only";
  const stage = isAixuexiPageDoc(doc) ? (
    <StagePreview
      doc={doc}
      bindingUrls={bindingUrls}
      stageMode="board43"
      interactive={interactive}
      onAdvance={interactive ? onAdvance : undefined}
      videoControl={{ controller: isController, ctl: videoCtl, onCtl: onVideoCtl }}
      h5PointerBridge={h5PointerBridge}
      gameMirror={isController ? initialGameMirror : gameMirror}
      onGameMirror={isController ? onGameMirror : undefined}
    />
  ) : (
    <StagePreview
      doc={doc}
      bindingUrls={bindingUrls}
      stageMode="board43"
      interactive={interactive}
      onClickTrigger={interactive ? onStep : undefined}
      replaySteps={steps}
      videoControl={{ controller: isController, ctl: videoCtl, onCtl: onVideoCtl }}
      h5PointerBridge={h5PointerBridge}
      gameMirror={isController ? initialGameMirror : gameMirror}
      onGameMirror={isController ? onGameMirror : undefined}
    />
  );

  return (
    <div
      className="size-full"
      data-classroom-sync-status={interactionAudit.status}
      data-classroom-sync-ownership={interactionAudit.ownership}
      {...classroomInteractionSyncAttributes(interactionAudit.surface, interactionAudit.provider)}
    >
      {stage}
    </div>
  );
}
