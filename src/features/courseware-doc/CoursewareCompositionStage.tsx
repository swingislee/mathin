"use client";

import { cn } from "@/lib/utils";
import GamePageStage from "@/features/games/courseware/GamePageStage";
import type { GameMirrorState } from "@/features/games/types";
import type { CoursewareCompositionPage } from "./composition-page-schema";
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
};

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
  const runtimeProps: MicrocourseStageRuntimeProps = props;
  const interactive = doc.layout.blocks.find((block) => block.type === "game" || block.type === "h5");

  return (
    <div
      className={cn("relative aspect-[4/3] w-full overflow-hidden bg-white", props.className)}
      data-courseware-composition="courseware-composition-v1"
      data-classroom-input={interactive ? "native" : "ink"}
    >
      {doc.source ? (
        <div className="absolute inset-0">
          <MicrocourseSourceStage doc={doc.source.doc} props={runtimeProps} />
        </div>
      ) : null}

      {doc.layout.blocks.map((block) => {
        if (block.type === "node") return null;
        return (
          <div key={block.id} className="absolute overflow-hidden" style={placementStyle(block.placement)}>
            {block.type === "game" ? (
              <GamePageStage
                doc={block.game}
                className="size-full"
                interactive={props.interactive}
                mirror={props.gameMirror}
                onMirror={props.onGameMirror}
                bindingUrls={props.bindingUrls}
              />
            ) : (
              <MicrocourseH5ArtifactFrame artifact={block.h5} props={runtimeProps} />
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
