"use client";

import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import GamePageStage from "@/features/games/courseware/GamePageStage";
import type { GameMirrorState } from "@/features/games/types";
import { CoursewareToolView } from "@/features/tools/components";
import { getToolCoursewareContract } from "@/features/tools/courseware/registry";
import type { ClassroomToolRuntime, CoursewareToolRuntime } from "@/features/tools/courseware/tool-classroom";
import {
  classroomToolInstanceKey, coursewareToolOriginHash, hasClassroomToolAdapter, isClassroomToolContractLoaded,
  loadClassroomToolContract, verifyClassroomToolState, type ClassroomToolEnvelope,
} from "@/features/tools/courseware/tool-classroom-runtime";
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

type ToolBlock = Extract<CoursewareCompositionPage["layout"]["blocks"][number], { type: "tool" }>;

/**
 * 课堂同步的工具：先加载该工具族的状态合同，课堂状态经严格校验后才交给工具。
 * 合同与工具代码并行按需加载，课件中没有的工具不下载。
 */
function SynchronizedCoursewareTool({ tool, entry, matches, onChange }: {
  tool: ToolBlock["tool"]; entry: ClassroomToolEnvelope | undefined; matches: (entry: ClassroomToolEnvelope) => boolean;
  onChange: CoursewareToolRuntime["onChange"];
}) {
  const [loaded, setLoaded] = useState(() => isClassroomToolContractLoaded(tool));
  useEffect(() => {
    if (loaded) return;
    let active = true;
    const done = () => { if (active) setLoaded(true); };
    void loadClassroomToolContract(tool).then(done, done);
    return () => { active = false; };
  }, [loaded, tool]);
  if (!loaded) return <Skeleton className="h-64 w-full" />;
  const verified = entry && matches(entry) ? verifyClassroomToolState(entry) ?? undefined : undefined;
  return <CoursewareToolView tool={tool} classroom={{ state: verified, onChange }} />;
}

/** Shared renderer for Studio, preparation and live classroom composition pages. */
export default function CoursewareCompositionStage(props: CoursewareCompositionStageProps) {
  const { doc } = props;
  const classroomActive = Boolean(props.classroomTools);
  const toolOrigins = useMemo(() => classroomActive ? Object.fromEntries(doc.layout.blocks.flatMap((block) =>
    block.type === "tool" && hasClassroomToolAdapter(block.tool) && "payload" in block.tool
      ? [[block.id, coursewareToolOriginHash(block.tool.payload)]] : [])) : {}, [doc, classroomActive]);
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
        const toolSynced = block.type === "tool" && hasClassroomToolAdapter(block.tool)
          && getToolCoursewareContract(block.tool.toolId, block.tool.contentVersion)?.classroomSync.mode === "snapshot" && Boolean(props.classroomTools);
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
                {toolSynced ? <SynchronizedCoursewareTool
                  key={`${props.classroomTools!.pageId}:${classroomToolInstanceKey(props.classroomTools!.docId, block.id, originHash)}`}
                  tool={block.tool}
                  entry={toolEntry}
                  matches={(entry) => entry.pageId === props.classroomTools?.pageId && entry.docId === props.classroomTools.docId
                    && entry.instanceId === block.id && entry.originHash === originHash
                    && entry.toolId === block.tool.toolId && entry.contentVersion === block.tool.contentVersion}
                  onChange={toolEditable ? (update) => {
                    if (update.toolId !== block.tool.toolId || update.contentVersion !== block.tool.contentVersion) return Promise.reject(new Error("CLASSROOM_TOOL_VERSION_MISMATCH"));
                    return props.classroomTools!.onChange!(block.id, originHash, update);
                  } : undefined}
                /> : <CoursewareToolView key={block.id} tool={block.tool} />}
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
