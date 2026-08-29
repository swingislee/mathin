"use client";

import "katex/dist/katex.min.css";
import { useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import type { GameMirrorState } from "@/features/games/types";
import { SudokuBoard } from "@/features/games/sudoku/SudokuBoard";
import { isGamePageDoc } from "./game-page-schema";
import GamePageStage from "@/features/games/courseware/GamePageStage";
import { isAixuexiPageDoc } from "./aixuexi-schema";
import AixuexiStage from "./AixuexiStage";
import DocStage, { type DocStageProps } from "./DocStage";
import { useH5FrameRegistration } from "./useH5FrameRegistration";
import {
  isMicrocoursePageDoc,
  type MicrocoursePageDoc,
  type MicrocourseSourceDoc,
} from "./microcourse-schema";
import { isSpatialPageDoc } from "./spatial";
import SpatialCoursewareStage from "./SpatialCoursewareStage";
import { isSourceRuntimePageDoc } from "./source-runtime-schema";
import SourceRuntimeStage from "./SourceRuntimeStage";

export type MicrocourseStageRuntimeProps = Omit<DocStageProps, "doc"> & {
  onAdvance?: () => void;
  gameMirror?: GameMirrorState | null;
  onGameMirror?: (state: GameMirrorState) => void;
};

export type MicrocourseStageProps = MicrocourseStageRuntimeProps & {
  doc: MicrocoursePageDoc;
};

export function MicrocourseSourceStage({
  doc,
  props,
}: {
  doc: MicrocourseSourceDoc;
  props: MicrocourseStageRuntimeProps;
}) {
  if (isSourceRuntimePageDoc(doc)) {
    return (
      <SourceRuntimeStage
        doc={doc}
        bindingUrls={props.bindingUrls}
        stageMode="board43"
        className="size-full"
        interactive={props.interactive}
        videoControl={props.videoControl}
        onAdvance={props.onAdvance}
        h5PointerBridge={props.h5PointerBridge}
      />
    );
  }
  if (isGamePageDoc(doc)) {
    return (
      <GamePageStage
        doc={doc}
        className="size-full"
        interactive={props.interactive}
        mirror={props.gameMirror}
        onMirror={props.onGameMirror}
        bindingUrls={props.bindingUrls}
      />
    );
  }
  if (isAixuexiPageDoc(doc)) {
    return (
      <AixuexiStage
        doc={doc}
        bindingUrls={props.bindingUrls}
        stageMode="board43"
        className="size-full"
        interactive={props.interactive}
        videoControl={props.videoControl}
        onAdvance={props.onAdvance}
        h5PointerBridge={props.h5PointerBridge}
      />
    );
  }
  if (isSpatialPageDoc(doc)) {
    return <SpatialCoursewareStage doc={doc} className="size-full" />;
  }
  return (
    <DocStage
      doc={doc}
      bindingUrls={props.bindingUrls}
      stageMode="board43"
      className="size-full"
      interactive={props.interactive}
      onClickTrigger={props.onClickTrigger}
      replaySteps={props.replaySteps}
      videoControl={props.videoControl}
      h5PointerBridge={props.h5PointerBridge}
    />
  );
}

export function MicrocourseH5ArtifactFrame({ artifact, props }: {
  artifact: { artifactId: string; sha256: string };
  props: MicrocourseStageRuntimeProps;
}) {
  const locale = useLocale();
  const frameId = `microcourse-h5:${artifact.artifactId}`;
  const { iframeRef, onFrameLoad } = useH5FrameRegistration(
    props.h5PointerBridge,
    frameId,
  );

  return (
    <iframe
      key={artifact.sha256}
      ref={iframeRef}
      src={`/api/microcourse-h5/${artifact.artifactId}`}
      title={locale === "en" ? "Interactive microcourse" : "微课互动内容"}
      sandbox="allow-scripts"
      className="size-full border-0 bg-white"
      data-classroom-input="native"
      tabIndex={props.interactive === false ? -1 : undefined}
      style={{ pointerEvents: props.interactive === false ? "none" : "auto" }}
      onLoad={onFrameLoad}
    />
  );
}

/** Renders every microcourse mode in Studio, preparation and live classroom. */
export default function MicrocourseStage(props: MicrocourseStageProps) {
  const { doc } = props;
  if (!isMicrocoursePageDoc(doc)) return null;

  return (
    <div
      className={cn("relative aspect-[4/3] w-full overflow-hidden bg-white", props.className)}
      data-microcourse-mode={doc.mode}
      data-classroom-input={doc.mode === "sudoku" || doc.mode === "h5" ? "native" : "ink"}
    >
      {doc.mode === "composition" ? (
        <>
          {doc.source ? (
            <div className="absolute inset-0">
              <MicrocourseSourceStage doc={doc.source.doc} props={props} />
            </div>
          ) : null}
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
        </>
      ) : null}

      {doc.mode === "sudoku" ? (
        <div className="size-full overflow-auto p-3 sm:p-5">
          <SudokuBoard
            seed={`microcourse:${doc.analysis.status}`}
            difficulty="medium"
            puzzle={doc.puzzle}
            showCoordinates={doc.display.showCoordinates}
            allowCandidates={doc.display.allowCandidates}
            allowAnswerReveal={doc.display.allowAnswerReveal}
            showTeachingTools={doc.display.showTeachingTools}
            finished={false}
            onComplete={() => undefined}
            mirror={props.gameMirror}
            onMirror={props.onGameMirror}
            readOnly={!props.interactive}
          />
        </div>
      ) : null}

      {doc.mode === "h5" ? <MicrocourseH5ArtifactFrame artifact={doc} props={props} /> : null}
    </div>
  );
}
