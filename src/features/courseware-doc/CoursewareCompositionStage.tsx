"use client";

import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import GamePageStage from "@/features/games/courseware/GamePageStage";
import type { GameMirrorState } from "@/features/games/types";
import { CoursewareToolView } from "@/features/tools/components";
import { CUBE_COURSEWARE_CONTENT_VERSION } from "@/features/tools/courseware/registry";
import { classroomToolInstanceKey, cubeCoursewareOriginHash, type ClassroomToolRuntime } from "@/features/tools/courseware/cube-structures-classroom";
import type { CoursewareCompositionPage } from "./composition-page-schema";
import { coursewareCanvasStyle } from "./courseware-surface";
import DocStage, { type DocStageProps } from "./DocStage";
import {
  MicrocourseH5ArtifactFrame,
  MicrocourseSourceStage,
  type MicrocourseStageRuntimeProps,
} from "./MicrocourseStage";

export type CoursewareCompositionStageProps = Omit<DocStageProps, "doc"> & {
  doc: CoursewareCompositionPage;
  onAdvance?: () => void;
  gameMirror?: GameMirrorState | null;
  onGameMirror?: (state: GameMirrorState) => void;
  classroomTools?: ClassroomToolRuntime;
};

const SOURCE_GAME_INSTANCE_ID = "source";

function placementStyle(placement: CoursewareCompositionPage["layout"]["blocks"][number]["placement"]) {
  return {
    left: `${(placement.column / 12) * 100}%`,
    top: `${(placement.row / 9) * 100}%`,
    width: `${(placement.columnSpan / 12) * 100}%`,
    height: `${(placement.rowSpan / 9) * 100}%`,
  };
}

/** Shared renderer for Studio, preparation and live classroom composition pages. */
export default function CoursewareCompositionStage(props: CoursewareCompositionStageProps) {
  const { doc } = props;
  const classroomActive = Boolean(props.classroomTools);
  const toolOrigins = useMemo(() => classroomActive ? Object.fromEntries(doc.layout.blocks.flatMap((block) =>
    block.type === "tool" && block.tool.contentVersion === CUBE_COURSEWARE_CONTENT_VERSION
      ? [[block.id, cubeCoursewareOriginHash(block.tool.payload)]] : [])) : {}, [doc, classroomActive]);
  const runtimeProps: MicrocourseStageRuntimeProps = props;
  const gameBlocks = doc.layout.blocks.filter((block) => block.type === "game");
  const initialInstances = props.gameMirror?.instances
    ?? (gameBlocks.length === 1 && props.gameMirror
      ? { [gameBlocks[0].id]: props.gameMirror }
      : {});
  const [appliedMirror, setAppliedMirror] = useState(props.gameMirror);
  const [gameInstances, setGameInstances] = useState<Record<string, GameMirrorState>>(initialInstances);

  if (props.gameMirror !== appliedMirror) {
    const nextInstances = props.gameMirror?.instances
      ?? (gameBlocks.length === 1 && props.gameMirror
        ? { [gameBlocks[0].id]: props.gameMirror }
        : {});
    setAppliedMirror(props.gameMirror);
    setGameInstances(nextInstances);
  }

  const updateGameInstance = (instanceId: string, state: GameMirrorState) => {
    const next = { ...gameInstances, [instanceId]: state };
    setGameInstances(next);
    props.onGameMirror?.({ values: [], selected: null, instances: next });
  };
  const sourceRuntimeProps: MicrocourseStageRuntimeProps = {
    ...runtimeProps,
    gameMirror: gameInstances[SOURCE_GAME_INSTANCE_ID] ?? null,
    onGameMirror: props.onGameMirror
      ? (state) => updateGameInstance(SOURCE_GAME_INSTANCE_ID, state)
      : undefined,
  };
  const readOnlyH5Props: MicrocourseStageRuntimeProps = { ...runtimeProps, interactive: false };

  return (
    <div
      className={cn("relative aspect-[4/3] w-full overflow-hidden", props.className)}
      data-courseware-composition="courseware-composition-v1"
      data-classroom-input={gameBlocks.length > 0 ? "native" : "ink"}
      style={coursewareCanvasStyle(doc.canvas.backgroundColor)}
    >
      {doc.source ? (
        <div className="absolute inset-0">
          <MicrocourseSourceStage doc={doc.source.doc} props={sourceRuntimeProps} />
        </div>
      ) : null}

      {doc.layout.blocks.map((block) => {
        if (block.type === "node") return null;
        const toolSynced = block.type === "tool" && block.tool.contentVersion === CUBE_COURSEWARE_CONTENT_VERSION && Boolean(props.classroomTools);
        const toolEditable = toolSynced && props.interactive && Boolean(props.classroomTools?.onChange);
        const originHash = toolOrigins[block.id];
        const toolEntry = props.classroomTools?.states[classroomToolInstanceKey(props.classroomTools.docId, block.id, originHash)]?.payload;
        return (
          <div key={block.id} className="absolute overflow-hidden" style={placementStyle(block.placement)}>
            {block.type === "game" ? (
              <GamePageStage
                doc={block.game}
                className="size-full"
                interactive={props.interactive}
                mirror={gameInstances[block.id] ?? null}
                onMirror={props.onGameMirror ? (state) => updateGameInstance(block.id, state) : undefined}
                bindingUrls={props.bindingUrls}
              />
            ) : block.type === "h5" ? (
              <MicrocourseH5ArtifactFrame artifact={block.h5} props={readOnlyH5Props} />
            ) : (
              <div
                className="size-full overflow-auto bg-paper"
                data-courseware-tool={block.tool.toolId}
                data-classroom-input={toolSynced ? "native" : undefined}
                data-classroom-tool={toolSynced ? "synchronized" : "read-only"}
                style={{ pointerEvents: toolEditable ? "auto" : "none" }}
              >
                <CoursewareToolView tool={block.tool} classroom={toolSynced ? {
                  state: toolEntry && toolEntry.docId === props.classroomTools?.docId ? toolEntry.state : undefined,
                  onChange: toolEditable ? (state) => props.classroomTools!.onChange!(block.id, originHash, state) : undefined,
                } : undefined} />
              </div>
            )}
          </div>
        );
      })}

      <div
        className="absolute inset-0"
        style={{ pointerEvents: props.onNodeSelect ? "auto" : "none" }}
      >
        <DocStage
          {...props}
          doc={doc.overlay}
          stageMode="natural"
          className="size-full"
          transparentCanvas
        />
      </div>
    </div>
  );
}
