"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, CheckCircle2, FoldHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CUBE_NET_GALLERY_FOLDING_VERSION,
  SPATIAL_COMMAND_VERSION,
  buildCubeNetGalleryFolding,
  createCubeNetGalleryCatalog,
  createCubeNetGalleryFoldingRequest,
  createInitialSpatialRuntimeState,
  reduceSpatialRuntimeState,
  type CubeNetGalleryFoldingBuild,
  type SpatialCommandActor,
  type SpatialCommandPayload,
  type SpatialRuntimeState,
} from "@/features/spatial-math/domain";
import {
  PolyhedronFoldTeachingStage,
  type PolyhedronFoldTeachingMessages,
} from "@/features/spatial-math/renderer-r3f/PolyhedronFoldTeachingStage";
import { CubeNetGalleryPanel } from "./CubeNetGalleryPanel";

const TOOL_TEACHER: SpatialCommandActor = {
  kind: "teacher-controller",
  actorId: "tool.spatial-lab.cube-net.teacher",
};

type CubeNetBuildState =
  | { readonly status: "building"; readonly entryId: string }
  | { readonly status: "error"; readonly entryId: string }
  | { readonly status: "ready"; readonly entryId: string; readonly build: CubeNetGalleryFoldingBuild };

function CubeNetFoldRehearsal({
  build,
  locale,
  messages,
}: {
  readonly build: CubeNetGalleryFoldingBuild;
  readonly locale: "zh" | "en";
  readonly messages: PolyhedronFoldTeachingMessages;
}) {
  const { page, sceneInput } = build;
  const [runtime, setRuntime] = useState<SpatialRuntimeState>(() =>
    createInitialSpatialRuntimeState(page),
  );
  const [selectedFaceIds, setSelectedFaceIds] = useState<readonly string[]>([]);
  const t = useTranslations("tools.spatialLab.cubeNet");
  const progress = runtime.netFoldProgress.find(
    (entry) => entry.entityId === sceneInput.entityId,
  )?.progress ?? 0;
  const selectedLabel = selectedFaceIds.length > 0
    ? build.sceneBuild.folding.fallback.faceLabels.find(
        (entry) => entry.faceId === selectedFaceIds[0],
      )?.label[locale] ?? build.sceneBuild.folding.fallback.faceLabels.find(
        (entry) => entry.faceId === selectedFaceIds[0],
      )?.label.zh ?? selectedFaceIds[0]
    : null;

  const applyCommandIntent = useCallback((payload: SpatialCommandPayload) => {
    if (payload.kind === "scene.reset") setSelectedFaceIds([]);
    setRuntime((current) => {
      const sequence = current.lastAppliedSequence + 1;
      return reduceSpatialRuntimeState(page, current, {
        commandVersion: SPATIAL_COMMAND_VERSION,
        commandId: `tool.spatial-lab.cube-net.${current.resetEpoch}.${sequence}`,
        sceneRevisionHash: page.sceneHash,
        resetEpoch: current.resetEpoch,
        sequence,
        delivery: "durable-semantic",
        branch: current.branch,
        actor: TOOL_TEACHER,
        payload,
      });
    });
  }, [page]);

  return (
    <div
      className="space-y-4"
      data-cube-net-fold={CUBE_NET_GALLERY_FOLDING_VERSION}
      data-folding-entry={build.entry.id}
      data-fold-progress={progress.toFixed(2)}
      data-selected-face={selectedFaceIds[0] ?? ""}
    >
      <PolyhedronFoldTeachingStage
        page={page}
        state={runtime}
        entityId={sceneInput.entityId}
        actor={TOOL_TEACHER}
        locale={locale}
        messages={messages}
        controlsLayout="external"
        selectedFaceIds={selectedFaceIds}
        onSelectedFaceIdsChange={setSelectedFaceIds}
        onCommandIntent={applyCommandIntent}
        materialColors={{ "solid.primary": "#8fbf88" }}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <div>
            <p className="font-medium text-ink">
              {selectedLabel ? t("predictionSelected", { face: selectedLabel }) : t("predictionPending")}
            </p>
            <p className="mt-1 text-muted">
              {progress >= 1 ? t("verifiedConclusion") : t("foldToVerify")}
            </p>
          </div>
          {progress >= 1 ? (
            <Badge variant="secondary" className="gap-1.5">
              <CheckCircle2 aria-hidden="true" className="size-4" />
              {t("folded")}
            </Badge>
          ) : (
            <Badge variant="outline">{t("progressValue", { percent: Math.round(progress * 100) })}</Badge>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function CubeNetFoldWorkspace({ locale }: { readonly locale: "zh" | "en" }) {
  const t = useTranslations("tools.spatialLab");
  const catalog = useMemo(() => createCubeNetGalleryCatalog(), []);
  const legalEntries = useMemo(
    () => catalog.entries.filter((entry) => entry.classification === "legal"),
    [catalog],
  );
  const [selectedEntryId, setSelectedEntryId] = useState(legalEntries[0].id);
  const selectedEntry = legalEntries.find((entry) => entry.id === selectedEntryId) ?? legalEntries[0];
  const [buildState, setBuildState] = useState<CubeNetBuildState>({
    status: "building",
    entryId: selectedEntryId,
  });

  useEffect(() => {
    let current = true;
    void buildCubeNetGalleryFolding(createCubeNetGalleryFoldingRequest(selectedEntryId)).then(
      (build) => {
        if (current) setBuildState({ status: "ready", entryId: selectedEntryId, build });
      },
      () => {
        if (current) setBuildState({ status: "error", entryId: selectedEntryId });
      },
    );
    return () => {
      current = false;
    };
  }, [selectedEntryId]);

  const selectEntry = useCallback((entryId: string) => {
    setSelectedEntryId(entryId);
    setBuildState({ status: "building", entryId });
  }, []);

  const teachingMessages = useMemo<PolyhedronFoldTeachingMessages>(() => ({
    webglUnavailable: t("renderer.webglUnavailable"),
    contextLost: t("renderer.contextLost"),
    previousStep: t("teaching.previousStep"),
    nextStep: t("teaching.nextStep"),
    playSteps: t("teaching.playSteps"),
    pauseSteps: t("teaching.pauseSteps"),
    resetScene: t("teaching.resetScene"),
    foldProgress: t("cubeNet.foldProgress"),
    cameraBookmarks: t("teaching.cameraBookmarks"),
    submitChoice: t("cubeNet.keepPrediction"),
    teacherFollow: t("teaching.teacherFollow"),
    studentLocalExplore: t("teaching.studentLocalExplore"),
    studentSubmit: t("teaching.studentSubmit"),
    formatStepPosition: (current: number, total: number) =>
      t("teaching.stepPosition", { current, total }),
    formatProgress: (percent: number) => t("cubeNet.progressValue", { percent }),
  }), [t]);

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 md:p-5">
      <div className="mx-auto max-w-5xl space-y-4">
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FoldHorizontal aria-hidden="true" className="size-4 text-leaf-deep" />
              {t("cubeNet.title")}
            </CardTitle>
            <CardDescription>{t("cubeNet.description")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2 p-4 pt-2">
            <Badge variant="secondary" className="gap-1.5">
              <CheckCircle2 aria-hidden="true" className="size-4" />
              {t("cubeNet.legalNet")}
            </Badge>
            <Badge variant="outline" className="gap-1.5">
              <Box aria-hidden="true" className="size-4" />
              {t("cubeNet.facesAndHinges")}
            </Badge>
            <span className="text-xs leading-5 text-muted">{t("cubeNet.localOnly")}</span>
          </CardContent>
        </Card>

        <CubeNetGalleryPanel
          selectedLegalId={selectedEntryId}
          onSelectedLegalIdChange={selectEntry}
        />

        <div>
          <h2 className="text-base font-medium text-ink">
            {t("cubeNet.foldingDemoTitle", { ordinal: selectedEntry.classificationOrdinal })}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            {t("cubeNet.foldingDemoDescription", { ordinal: selectedEntry.classificationOrdinal })}
          </p>
        </div>

        {buildState.status === "ready" && buildState.entryId === selectedEntryId ? (
          <CubeNetFoldRehearsal
            key={buildState.build.page.sceneHash}
            build={buildState.build}
            locale={locale}
            messages={teachingMessages}
          />
        ) : (
          <Card className="grid aspect-[4/3] place-items-center" data-layout-profile="standard-4x3">
            <CardContent className="p-6 text-center text-sm text-muted" role="status">
              {buildState.status === "error" ? t("common.previewError") : t("common.previewBuilding")}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
