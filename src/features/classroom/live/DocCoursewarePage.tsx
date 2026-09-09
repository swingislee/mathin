"use client";

import { useTranslations } from "next-intl";
import { isAixuexiPageDoc } from "@/features/courseware-doc/aixuexi-schema";
import type { CoursewareDoc } from "@/features/courseware-doc/document";
import type { DocVideoCtl } from "@/features/courseware-doc/DocStage";
import type { H5PointerBridgeHost } from "@/features/courseware-doc/h5-pointer-protocol";
import type { InteractionTrigger } from "@/features/courseware-doc/interactions";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import { StagePreview } from "@/features/courseware-studio/StagePreview";
import type { GameMirrorState } from "@/features/games/types";
import type { ClassroomToolRuntime } from "@/features/tools/courseware/cube-structures-classroom";
import { resolveClassroomInteractionAudit } from "../sync/interaction-audit";
import { classroomInteractionSyncAttributes } from "../sync/interaction-provider";
import { isMediaControlEcho } from "../sync/media-control";
import { useClassroomGameMirror } from "./useClassroomGameMirror";

interface Props {
  doc: CoursewareDoc | null;
  bindingUrls: ResolvedBindingUrls;
  /** 教师端：本地点击直接驱动舞台并广播 doc_step；学生端只回放。 */
  isController: boolean;
  syncControllerMirror?: boolean;
  stageMode?: "board43" | "natural";
  steps: readonly InteractionTrigger[] | undefined;
  onStep: (trigger: InteractionTrigger) => void;
  videoCtl: DocVideoCtl | undefined;
  onVideoCtl: (action: DocVideoCtl["action"], time: number) => void;
  onAdvance: () => void;
  h5PointerBridge?: H5PointerBridgeHost;
  gameMirror: GameMirrorState | null;
  onGameMirror: (state: GameMirrorState) => void;
  classroomTools?: ClassroomToolRuntime;
}

/** 课堂 doc 页舞台（P6-5）：4:3 顶置模式，16:9 内容占上部 75%、下部为板书带（§6.1）。 */
export function DocCoursewarePage({
  doc,
  bindingUrls,
  isController,
  syncControllerMirror = false,
  stageMode = "board43",
  steps,
  onStep,
  videoCtl,
  onVideoCtl,
  onAdvance,
  h5PointerBridge,
  gameMirror,
  onGameMirror,
  classroomTools,
}: Props) {
  const t = useTranslations("classroom.live");
  const gameSync = useClassroomGameMirror(gameMirror, isController, syncControllerMirror, onGameMirror);
  if (!doc) {
    return <p className="grid size-full place-items-center text-sm text-muted">{t("docNotReady")}</p>;
  }
  const interactionAudit = resolveClassroomInteractionAudit(doc);
  const interactive = isController && interactionAudit.status !== "read-only";
  const publishVideoControl = (action: DocVideoCtl["action"], time: number) => {
    if (!syncControllerMirror || !isMediaControlEcho(action, time, videoCtl)) onVideoCtl(action, time);
  };
  const stage = isAixuexiPageDoc(doc) ? (
    <StagePreview
      doc={doc}
      bindingUrls={bindingUrls}
      stageMode={stageMode}
      interactive={interactive}
      onAdvance={interactive ? onAdvance : undefined}
      videoControl={{ controller: isController, followRemote: syncControllerMirror, ctl: videoCtl, onCtl: publishVideoControl }}
      h5PointerBridge={h5PointerBridge}
      gameMirror={gameSync.mirror}
      onGameMirror={isController ? gameSync.publish : undefined}
      classroomTools={classroomTools}
    />
  ) : (
    <StagePreview
      doc={doc}
      bindingUrls={bindingUrls}
      stageMode={stageMode}
      interactive={interactive}
      onClickTrigger={interactive ? onStep : undefined}
      replaySteps={steps}
      videoControl={{ controller: isController, followRemote: syncControllerMirror, ctl: videoCtl, onCtl: publishVideoControl }}
      h5PointerBridge={h5PointerBridge}
      gameMirror={gameSync.mirror}
      onGameMirror={isController ? gameSync.publish : undefined}
      classroomTools={classroomTools}
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
