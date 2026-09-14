"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Check, FoldHorizontal, Hand, Maximize, Orbit, Redo2, RotateCcw, Settings2, Shapes, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  buildCubeNetGalleryFolding,
  createCubeNetGalleryCatalog,
  createCubeNetGalleryFoldingRequest,
  createPolyhedronFoldFrameResolver,
  type CubeNetGalleryFoldingBuild,
} from "@/features/spatial-math/domain";
import { SpatialAxisSnapButton, useSpatialAxisSnap } from "@/features/spatial-math/renderer-r3f/SpatialCameraControls";
import { cn } from "@/lib/utils";
import { NetDiagram } from "./CubeNetGalleryPanel";
import { CubeCanvasPanel, CubeIconButton, CubeViewIcon } from "./CubeWorkbenchControls";
import { CUBE_AXIS_COLORS, type CubeView } from "./cube-structures-contract";
import { cubeStructuresMessages } from "./cube-structures-messages";
import { CUBE_WORKBENCH_VIEWS } from "./cube-workbench-camera";
import { createCubeNetWorkbenchResolver, frameCubeNetWorkbench } from "./cube-net-workbench-model";
import type { CubeNetFoldChange, CubeNetPaperSelection } from "./cube-net-fold-drag";
import {
  CUBE_NET_TEACHING_VERSION,
  createCubeNetTeachingSession,
  cubeNetHingeProgress,
  judgeCubeNetFold,
  reduceCubeNetTeachingSession,
  type CubeNetFoldJudgment,
  type CubeNetTeachingAction,
} from "./cube-net-teaching-session";
import styles from "./CubeStructuresWorkbench.module.css";

const CubeNetFoldViewport = dynamic(() => import("./CubeNetFoldViewport").then((module) => module.CubeNetFoldViewport), { ssr: false });

type CubeNetBuildState =
  | { readonly status: "building" | "error"; readonly entryId: string }
  | { readonly status: "ready"; readonly entryId: string; readonly build: CubeNetGalleryFoldingBuild };

function CubeNetFoldRehearsal({ build, locale, netSelector, workspaceSelector }: {
  readonly build: CubeNetGalleryFoldingBuild;
  readonly locale: "zh" | "en";
  readonly netSelector: ReactNode;
  readonly workspaceSelector?: ReactNode;
}) {
  const t = useTranslations("tools.spatialLab");
  const m = cubeStructuresMessages(locale);
  const { page, sceneInput } = build;
  const resolver = useMemo(() => createCubeNetWorkbenchResolver(build, locale), [build, locale]);
  const [session, setSession] = useState(() => createCubeNetTeachingSession(
    sceneInput.hingeGraph.hinges.map((hinge) => hinge.edgeId),
  ));
  const [activeFold, setActiveFold] = useState<CubeNetPaperSelection | null>(null);
  const [preview, setPreview] = useState<CubeNetFoldChange | null>(null);
  const [judgment, setJudgment] = useState<CubeNetFoldJudgment | null>(null);
  const [view, setView] = useState<CubeView>("angle");
  const [frame, setFrame] = useState(() => resolver.resolve({}).model.bounds);
  const [cameraRequestKey, setCameraRequestKey] = useState(0);
  const [tool, setTool] = useState<"orbit" | "pan" | "fold">("fold");
  const [panel, setPanel] = useState<"nets" | "settings" | null>(null);
  const [axesVisible, setAxesVisible] = useState(true);
  const [dragging, setDragging] = useState(false);
  const axisSnapEnabled = useSpatialAxisSnap();
  const angles = useMemo(() => preview ? { ...session.angles, [preview.edgeId]: preview.degrees } : session.angles, [preview, session.angles]);
  const current = useMemo(() => resolver.resolve(angles, activeFold?.edgeId, preview?.anchor ?? session.anchor, activeFold?.movingFaceIds), [activeFold, angles, preview, resolver, session.anchor]);
  const model = useMemo(() => frameCubeNetWorkbench(current.model, frame, view), [current.model, frame, view]);
  const activePaper = current.model.faces.find((face) => face.faceId === activeFold?.faceId);
  const currentAngle = activeFold ? angles[activeFold.edgeId] : 0;
  const frameResolver = useMemo(() => createPolyhedronFoldFrameResolver(
    sceneInput.topology, sceneInput.geometry, sceneInput.hingeGraph, sceneInput.layout,
  ), [sceneInput]);
  const cameraMessages = {
    axisSnap: t("teaching.axisSnap"),
    enableAxisSnap: t("teaching.enableAxisSnap"),
    disableAxisSnap: t("teaching.disableAxisSnap"),
  };
  const startFold = useCallback((selection: CubeNetPaperSelection) => {
    setActiveFold(selection);
    setPreview(null);
  }, []);
  const apply = useCallback((action: CubeNetTeachingAction) => {
    setPreview(null);
    setJudgment(null);
    if (action.kind !== "fold") setActiveFold(null);
    setSession((current) => reduceCubeNetTeachingSession(current, action));
  }, []);
  const previewFold = useCallback((value: CubeNetFoldChange | null) => {
    setPreview(value);
    setJudgment(null);
  }, []);
  const commitFold = useCallback((value: CubeNetFoldChange) => apply({ kind: "fold", ...value }), [apply]);
  const chooseView = (nextView: CubeView) => {
    setFrame(current.model.bounds);
    setView(nextView);
    setCameraRequestKey((current) => current + 1);
  };

  return (
    <div className={styles.workspace} data-cube-net-teaching={CUBE_NET_TEACHING_VERSION} data-folding-entry={build.entry.id}>
      <div className={styles.viewport}>
        <div className={styles.canvas} data-cube-workspace-frame="4:3" data-cube-net-workbench
          aria-label={t("cubeNet.title")} style={{ cursor: tool === "fold" ? dragging ? "grabbing" : "grab" : tool === "pan" ? "grab" : "default" }}>
          <CubeNetFoldViewport scene={page.scene} entityId={sceneInput.entityId} model={model} hinges={current.hinges}
            activeEdgeId={activeFold?.edgeId ?? null} tool={tool} locale={locale}
            axisSnapEnabled={axisSnapEnabled} axesVisible={axesVisible} cameraRequestKey={cameraRequestKey} dragging={dragging}
            messages={{ webglUnavailable: t("renderer.webglUnavailable"), contextLost: t("renderer.contextLost") }}
            onFoldStart={startFold} onPreview={previewFold} onCommit={commitFold} onDraggingChange={setDragging} />

          <div className={cn(styles.dock, styles.meta)} role="toolbar" aria-label={t("cubeNet.title")}>
            <CubeIconButton label={t("cubeNet.manual.chooseNet")} active={panel === "nets"} disabled={dragging}
              onClick={() => setPanel(panel === "nets" ? null : "nets")}><Shapes aria-hidden /></CubeIconButton>
            <CubeIconButton label={m.modelPanel} active={panel === "settings"} disabled={dragging}
              onClick={() => setPanel(panel === "settings" ? null : "settings")}><Settings2 aria-hidden /></CubeIconButton>
          </div>
          <div className={cn(styles.dock, styles.views)} role="toolbar" aria-label={m.view} data-cube-view-toolbar>
            {CUBE_WORKBENCH_VIEWS.map((item) => <CubeIconButton key={item} label={m[item]} active={view === item}
              disabled={dragging} onClick={() => chooseView(item)}><CubeViewIcon view={item} /></CubeIconButton>)}
            <CubeIconButton label={m.fit} disabled={dragging} onClick={() => chooseView(view)}><Maximize aria-hidden /></CubeIconButton>
            <SpatialAxisSnapButton messages={cameraMessages} iconOnly className={styles.icon} disabled={dragging} />
            <CubeIconButton label={axesVisible ? m.hideAxes : m.showAxes} active={axesVisible} onClick={() => setAxesVisible(!axesVisible)}>
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden><path d="M5 19h15" stroke={CUBE_AXIS_COLORS.x} /><path d="M5 19V3" stroke={CUBE_AXIS_COLORS.y} /><path d="m5 19 11-10" stroke={CUBE_AXIS_COLORS.z} /></svg>
            </CubeIconButton>
          </div>
          <div className={cn(styles.dock, styles.tools)} role="toolbar" aria-label={m.tools} data-cube-tools-toolbar>
            {([{ id: "orbit", label: m.orbit, Icon: Orbit }, { id: "pan", label: m.pan, Icon: Hand },
              { id: "fold", label: t("cubeNet.manual.foldTool"), Icon: FoldHorizontal }] as const).map(({ id, label, Icon }) =>
              <CubeIconButton key={id} label={label} active={tool === id} disabled={dragging}
                onClick={() => { setTool(id); setPreview(null); }} data-cube-net-tool={id}><Icon aria-hidden /></CubeIconButton>)}
            <CubeIconButton label={t("cubeNet.manual.judge")} disabled={dragging}
              onClick={() => setJudgment(judgeCubeNetFold(frameResolver.resolveHinges(cubeNetHingeProgress(angles))))}><Check aria-hidden /></CubeIconButton>
            <CubeIconButton label={t("cubeNet.manual.unfold")} disabled={dragging || (session.anchor === null && Object.values(session.angles).every((angle) => angle === 0))}
              onClick={() => apply({ kind: "unfold" })}><RotateCcw aria-hidden /></CubeIconButton>
            <span className="self-stretch border-t border-line" aria-hidden />
            <CubeIconButton label={t("cubeNet.manual.undo")} disabled={dragging || session.past.length === 0}
              onClick={() => apply({ kind: "undo" })}><Undo2 aria-hidden /></CubeIconButton>
            <CubeIconButton label={t("cubeNet.manual.redo")} disabled={dragging || session.future.length === 0}
              onClick={() => apply({ kind: "redo" })}><Redo2 aria-hidden /></CubeIconButton>
          </div>

          {panel && <CubeCanvasPanel title={panel === "nets" ? t("cubeNet.manual.chooseNet") : m.modelPanel}
            anchor="meta" closeLabel={m.closePanel} onClose={() => setPanel(null)}>
            {panel === "nets" ? netSelector : <div className="space-y-3 text-xs">{workspaceSelector}<p className="leading-5 text-muted">{t("cubeNet.manual.localOnly")}</p></div>}
          </CubeCanvasPanel>}
          {tool === "fold" && <div className={styles.cutStatus} role="status" data-cube-net-drag-status>
            {activePaper ? <><p className="font-medium">{t("cubeNet.manual.activePaper", { face: activePaper.label, angle: currentAngle })}</p>
              <p>{t("cubeNet.manual.dragPaper")}</p></> : t("cubeNet.manual.grabPaper")}
          </div>}
          {judgment && <div className={styles.notice} role="status" data-cube-net-judgment={judgment}>{t(`cubeNet.manual.results.${judgment}`)}</div>}
        </div>
      </div>
    </div>
  );
}

export function CubeNetFoldWorkspace({ locale, workspaceSelector }: { readonly locale: "zh" | "en"; readonly workspaceSelector?: ReactNode }) {
  const t = useTranslations("tools.spatialLab");
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

  const selectEntry = (entryId: string) => {
    if (entryId === selectedEntryId) return;
    setSelectedEntryId(entryId);
    setBuildState({ status: "building", entryId });
  };
  const netSelector = <div className="grid grid-cols-3 gap-2">
    {entries.map((entry, index) => <Button key={entry.id} variant={entry.id === selectedEntryId ? "secondary" : "ghost"}
      className="h-20 flex-col gap-1 p-1 text-xs" aria-pressed={entry.id === selectedEntryId} onClick={() => selectEntry(entry.id)}>
      <span className="w-full [&_svg]:h-12"><NetDiagram entry={entry} label="" compact /></span>{t("cubeNet.manual.net", { number: index + 1 })}
    </Button>)}
  </div>;

  return buildState.status === "ready" && buildState.entryId === selectedEntryId ? (
    <CubeNetFoldRehearsal key={buildState.build.page.sceneHash} build={buildState.build} locale={locale}
      netSelector={netSelector} workspaceSelector={workspaceSelector} />
  ) : (
    <div className={styles.workspace}><div className={styles.viewport}>
      <div className={cn(styles.canvas, "grid place-items-center text-sm text-muted")} data-layout-profile="standard-4x3" role="status">
        {buildState.status === "error" ? t("common.previewError") : t("common.previewBuilding")}
      </div>
    </div></div>
  );
}
