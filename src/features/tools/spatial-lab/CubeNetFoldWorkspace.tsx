"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Redo2, RotateCcw, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  buildCubeNetGalleryFolding,
  createCubeNetGalleryCatalog,
  createCubeNetGalleryFoldingRequest,
  createPolyhedronFoldFrameResolver,
  type CubeNetGalleryFoldingBuild,
} from "@/features/spatial-math/domain";
import { PolyhedronFoldView } from "@/features/spatial-math/renderer-r3f/PolyhedronFoldView";
import { SpatialAxisSnapButton, useSpatialAxisSnap } from "@/features/spatial-math/renderer-r3f/SpatialCameraControls";
import { NetDiagram } from "./CubeNetGalleryPanel";
import {
  CUBE_NET_TEACHING_VERSION,
  createCubeNetTeachingSession,
  cubeNetHingeProgress,
  cubeNetTeachingFaces,
  judgeCubeNetFold,
  reduceCubeNetTeachingSession,
  type CubeNetFoldJudgment,
  type CubeNetTeachingAction,
} from "./cube-net-teaching-session";

type CubeNetBuildState =
  | { readonly status: "building" | "error"; readonly entryId: string }
  | { readonly status: "ready"; readonly entryId: string; readonly build: CubeNetGalleryFoldingBuild };

function CubeNetFoldRehearsal({ build, locale }: {
  readonly build: CubeNetGalleryFoldingBuild;
  readonly locale: "zh" | "en";
}) {
  const t = useTranslations("tools.spatialLab");
  const { page, sceneInput } = build;
  const faces = useMemo(() => cubeNetTeachingFaces(build, locale), [build, locale]);
  const [session, setSession] = useState(() => createCubeNetTeachingSession(
    sceneInput.hingeGraph.hinges.map((hinge) => hinge.edgeId),
  ));
  const [selectedFaceId, setSelectedFaceId] = useState(faces.find((face) => face.edgeId)!.faceId);
  const [previewAngle, setPreviewAngle] = useState<number | null>(null);
  const [judgment, setJudgment] = useState<CubeNetFoldJudgment | null>(null);
  const [cameraId, setCameraId] = useState(page.scene.presentation.defaultCameraId);
  const [cameraRequestKey, setCameraRequestKey] = useState(0);
  const axisSnapEnabled = useSpatialAxisSnap();
  const selectedFace = faces.find((face) => face.faceId === selectedFaceId)!;
  const edgeId = selectedFace.edgeId;
  const currentAngle = edgeId ? previewAngle ?? session.angles[edgeId] : 0;
  const hingeProgress = useMemo(() => cubeNetHingeProgress(
    edgeId && previewAngle !== null ? { ...session.angles, [edgeId]: previewAngle } : session.angles,
  ), [edgeId, previewAngle, session.angles]);
  const frameResolver = useMemo(() => createPolyhedronFoldFrameResolver(
    sceneInput.topology, sceneInput.geometry, sceneInput.hingeGraph, sceneInput.layout,
  ), [sceneInput]);
  const cameraMessages = {
    axisSnap: t("teaching.axisSnap"),
    enableAxisSnap: t("teaching.enableAxisSnap"),
    disableAxisSnap: t("teaching.disableAxisSnap"),
  };
  const selectFace = (faceId: string) => {
    setSelectedFaceId(faceId);
    setPreviewAngle(null);
  };
  const apply = (action: CubeNetTeachingAction) => {
    setPreviewAngle(null);
    setJudgment(null);
    setSession((current) => reduceCubeNetTeachingSession(current, action));
  };
  const commitAngle = (degrees: number) => {
    if (edgeId) apply({ kind: "fold", edgeId, degrees });
  };
  const parentLabel = faces.find((face) => face.faceId === selectedFace.parentFaceId)?.label;
  const movingLabels = faces.filter((face) => selectedFace.movingFaceIds.includes(face.faceId))
    .map((face) => face.label).join(locale === "zh" ? "、" : ", ");

  return (
    <div
      className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]"
      data-cube-net-teaching={CUBE_NET_TEACHING_VERSION}
      data-folding-entry={build.entry.id}
      data-selected-face={selectedFaceId}
    >
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("teaching.cameraBookmarks")}>
          {page.scene.presentation.cameraBookmarks.map((camera) => (
            <Button key={camera.id} type="button" size="sm" variant="ghost"
              aria-pressed={cameraId === camera.id}
              onClick={() => { setCameraId(camera.id); setCameraRequestKey((current) => current + 1); }}>
              {camera.label[locale] ?? camera.label.zh}
            </Button>
          ))}
          <SpatialAxisSnapButton messages={cameraMessages} className="h-9 px-3 text-sm" />
        </div>
        <PolyhedronFoldView
          scene={page.scene}
          entityId={sceneInput.entityId}
          progress={0}
          hingeProgress={hingeProgress}
          locale={locale}
          cameraId={cameraId}
          cameraRequestKey={cameraRequestKey}
          axisSnapEnabled={axisSnapEnabled}
          selectedFaceIds={[selectedFaceId]}
          selectableFaceIds={faces.map((face) => face.faceId)}
          onFaceSelect={selectFace}
          messages={{ webglUnavailable: t("renderer.webglUnavailable"), contextLost: t("renderer.contextLost") }}
          materialColors={{ "solid.primary": "#8fbf88" }}
        />
      </div>

      <div className="space-y-5 lg:pt-11">
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-ink">{t("cubeNet.manual.selectFace")}</h2>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label={t("cubeNet.manual.selectFace")}>
            {faces.map((face) => (
              <Button key={face.faceId} type="button" variant={selectedFaceId === face.faceId ? "secondary" : "ghost"}
                className="h-14 flex-col gap-0.5 px-2" aria-pressed={selectedFaceId === face.faceId}
                onClick={() => selectFace(face.faceId)}>
                <span>{t("cubeNet.manual.face", { face: face.label })}</span>
                <span className="text-xs tabular-nums text-muted">
                  {face.edgeId ? `${face.faceId === selectedFaceId ? currentAngle : session.angles[face.edgeId]}°` : t("cubeNet.manual.fixed")}
                </span>
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-3" data-cube-net-hinge-controls>
          <p className="text-sm font-medium text-ink">
            {edgeId ? t("cubeNet.manual.hinge", { face: selectedFace.label, parent: parentLabel! }) : t("cubeNet.manual.fixedFace", { face: selectedFace.label })}
          </p>
          <div className="flex items-center justify-between text-xs text-muted">
            <span>{t("cubeNet.manual.reverse")}</span>
            <output className="text-base font-medium tabular-nums text-ink">{currentAngle}°</output>
            <span>{t("cubeNet.manual.forward")}</span>
          </div>
          <Slider min={-90} max={90} step={1} value={[currentAngle]} disabled={!edgeId}
            className="h-8" thumbClassName="size-6"
            aria-label={t("cubeNet.manual.angle", { face: selectedFace.label })}
            aria-valuetext={`${currentAngle}°`}
            onValueChange={([angle]) => { setPreviewAngle(angle); setJudgment(null); }}
            onValueCommit={([angle]) => commitAngle(angle)}
            onPointerCancel={() => setPreviewAngle(null)}
          />
          <div className="grid grid-cols-3 gap-2">
            {[-90, 0, 90].map((angle) => (
              <Button key={angle} type="button" size="sm" variant="secondary" disabled={!edgeId}
                onClick={() => commitAngle(angle)}>{angle}°</Button>
            ))}
          </div>
          <p className="min-h-10 text-xs leading-5 text-muted">
            {edgeId ? t("cubeNet.manual.movingFaces", { faces: movingLabels }) : t("cubeNet.manual.fixedHint")}
          </p>
        </div>

        <div className="flex flex-wrap gap-1">
          <Button type="button" size="sm" variant="ghost" disabled={session.past.length === 0}
            onClick={() => apply({ kind: "undo" })}><Undo2 aria-hidden="true" className="size-4" />{t("cubeNet.manual.undo")}</Button>
          <Button type="button" size="sm" variant="ghost" disabled={session.future.length === 0}
            onClick={() => apply({ kind: "redo" })}><Redo2 aria-hidden="true" className="size-4" />{t("cubeNet.manual.redo")}</Button>
          <Button type="button" size="sm" variant="ghost" disabled={Object.values(session.angles).every((angle) => angle === 0)}
            onClick={() => apply({ kind: "unfold" })}><RotateCcw aria-hidden="true" className="size-4" />{t("cubeNet.manual.unfold")}</Button>
        </div>

        <div className="space-y-2">
          <Button type="button" variant="secondary" className="w-full"
            onClick={() => setJudgment(judgeCubeNetFold(frameResolver.resolveHinges(hingeProgress)))}>
            <Check aria-hidden="true" className="size-4" />{t("cubeNet.manual.judge")}
          </Button>
          <p className="min-h-12 text-sm leading-6 text-ink" role="status" data-cube-net-judgment={judgment ?? "hidden"}>
            {judgment ? t(`cubeNet.manual.results.${judgment}`) : null}
          </p>
        </div>
      </div>
    </div>
  );
}

export function CubeNetFoldWorkspace({ locale }: { readonly locale: "zh" | "en" }) {
  const t = useTranslations("tools.spatialLab");
  // 首批复用已有十一种形态；界面不预先揭示图形的合法性或相对面答案。
  const entries = useMemo(() => createCubeNetGalleryCatalog().entries.filter((entry) => entry.classification === "legal"), []);
  const [selectedEntryId, setSelectedEntryId] = useState(entries[0].id);
  const [buildState, setBuildState] = useState<CubeNetBuildState>({ status: "building", entryId: selectedEntryId });

  useEffect(() => {
    let current = true;
    void buildCubeNetGalleryFolding(createCubeNetGalleryFoldingRequest(selectedEntryId)).then(
      (build) => { if (current) setBuildState({ status: "ready", entryId: selectedEntryId, build }); },
      () => { if (current) setBuildState({ status: "error", entryId: selectedEntryId }); },
    );
    return () => { current = false; };
  }, [selectedEntryId]);

  const selectEntry = useCallback((entryId: string) => {
    setSelectedEntryId(entryId);
    setBuildState({ status: "building", entryId });
  }, []);

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 pb-20 md:p-5 md:pb-20">
      <div className="mx-auto max-w-7xl space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-base font-medium text-ink">{t("cubeNet.title")}</h1>
          <Select value={selectedEntryId} onValueChange={selectEntry}>
            <SelectTrigger className="w-44" aria-label={t("cubeNet.manual.chooseNet")}><SelectValue /></SelectTrigger>
            <SelectContent>
              {entries.map((entry, index) => (
                <SelectItem key={entry.id} value={entry.id} textValue={t("cubeNet.manual.net", { number: index + 1 })}>
                  <span className="flex items-center gap-3">
                    <span className="w-12 [&_svg]:h-8"><NetDiagram entry={entry} label="" compact /></span>
                    {t("cubeNet.manual.net", { number: index + 1 })}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted">{t("cubeNet.manual.localOnly")}</p>
        {buildState.status === "ready" && buildState.entryId === selectedEntryId ? (
          <CubeNetFoldRehearsal key={buildState.build.page.sceneHash} build={buildState.build} locale={locale} />
        ) : (
          <div className="grid aspect-[4/3] place-items-center text-sm text-muted" data-layout-profile="standard-4x3" role="status">
            {buildState.status === "error" ? t("common.previewError") : t("common.previewBuilding")}
          </div>
        )}
      </div>
    </div>
  );
}
