"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Check, FoldHorizontal, Hand, Maximize, Orbit, Redo2, RotateCcw, Scissors, Settings2, Shapes, Square, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { createCubeNetWorkbenchResolver, frameCubeNetWorkbench, type CubeNetWorkbenchHinge } from "./cube-net-workbench-model";
import type { PolyhedronFoldRenderModel } from "@/features/spatial-math/renderer-r3f/polyhedron-fold-render-model";
import type { CubeNetFoldChange, CubeNetPaperSelection } from "./cube-net-fold-drag";
import { createCubeNetUnfoldMotion } from "./cube-net-unfold-motion";
import { planCubeNetPlanarChange } from "./cube-net-planar-motion";
import { createCubeNetPlanarPresentation, cubeNetPlanarTiles } from "./cube-net-planar-presentation";
import { useCubeNetPlayback } from "./useCubeNetPlayback";
import { analyzeCubeNetCuts, buildCubeNetFromCuts, createCubeNetCutSession, cubeNetCutEdges, reduceCubeNetCutSession, type CubeNetCutSession } from "./cube-net-cutting";
import {
  CUBE_NET_TEACHING_VERSION,
  createCubeNetTeachingSession,
  cubeNetHingeProgress,
  judgeCubeNetFold,
  reduceCubeNetTeachingSession,
  type CubeNetFoldJudgment,
  type CubeNetTeachingAction,
  type CubeNetTeachingAnchor,
} from "./cube-net-teaching-session";
import styles from "./CubeStructuresWorkbench.module.css";

const CubeNetFoldViewport = dynamic(() => import("./CubeNetFoldViewport").then((module) => module.CubeNetFoldViewport), { ssr: false });

type CubeNetBuildState =
  | { readonly status: "building" | "error" }
  | { readonly status: "ready"; readonly builds: readonly CubeNetGalleryFoldingBuild[] };

interface CubeNetPlaybackFrame {
  readonly current: { readonly model: PolyhedronFoldRenderModel; readonly hinges: readonly CubeNetWorkbenchHinge[] };
  readonly kind: "unfold" | "planar" | "close";
  readonly step: number;
  readonly total: number;
  readonly movingCount?: number;
}
const labelModel = (model: PolyhedronFoldRenderModel, labels: Readonly<Record<string, string>>) => ({
  ...model, faces: model.faces.map((face) => ({ ...face, label: labels[face.faceId] ?? face.label })),
});

function CubeNetFoldRehearsal({ builds, locale, workspaceSelector }: {
  readonly builds: readonly CubeNetGalleryFoldingBuild[];
  readonly locale: "zh" | "en";
  readonly workspaceSelector?: ReactNode;
}) {
  const t = useTranslations("tools.spatialLab");
  const m = cubeStructuresMessages(locale);
  const [build, setBuild] = useState(builds[0]);
  const [labels, setLabels] = useState<Readonly<Record<string, string>>>({});
  const playback = useCubeNetPlayback<CubeNetPlaybackFrame>();
  const { page, sceneInput } = build;
  const resolver = useMemo(() => createCubeNetWorkbenchResolver(build, locale), [build, locale]);
  const [session, setSession] = useState(() => createCubeNetTeachingSession(
    sceneInput.hingeGraph.hinges.map((hinge) => hinge.edgeId),
  ));
  const [activeFold, setActiveFold] = useState<CubeNetPaperSelection | null>(null);
  const [preview, setPreview] = useState<CubeNetFoldChange | null>(null);
  const [judgment, setJudgment] = useState<CubeNetFoldJudgment | null>(null);
  const [cutting, setCutting] = useState<CubeNetCutSession | null>(null);
  const [buildingCuts, setBuildingCuts] = useState(false);
  const [cutError, setCutError] = useState(false);
  const cutRequest = useRef(0);
  useEffect(() => () => { cutRequest.current++; }, []);
  const [view, setView] = useState<CubeView>("angle");
  const [frame, setFrame] = useState(() => resolver.resolve({}).model.bounds);
  const [cameraRequestKey, setCameraRequestKey] = useState(0);
  const [tool, setTool] = useState<"orbit" | "pan" | "fold" | "cut">("fold");
  const [panel, setPanel] = useState<"settings" | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [axesVisible, setAxesVisible] = useState(true);
  const [dragging, setDragging] = useState(false);
  const axisSnapEnabled = useSpatialAxisSnap();
  const angles = useMemo(() => cutting ? Object.fromEntries(Object.keys(session.angles).map((id) => [id, 90]))
    : preview ? { ...session.angles, [preview.edgeId]: preview.degrees } : session.angles, [cutting, preview, session.angles]);
  const manualCurrent = useMemo(() => {
    const resolved = resolver.resolve(angles, activeFold?.edgeId, preview?.anchor ?? session.anchor, activeFold?.movingFaceIds);
    return { ...resolved, model: labelModel(resolved.model, labels) };
  }, [activeFold, angles, labels, preview, resolver, session.anchor]);
  const current = playback.frame?.current ?? manualCurrent;
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
  const busy = dragging || playback.playing || buildingCuts;
  const cutAnalysis = useMemo(() => cutting ? analyzeCubeNetCuts(sceneInput, cutting.cuts) : null, [cutting, sceneInput]);
  const cutEdges = useMemo(() => cutting && !playback.playing ? cubeNetCutEdges(sceneInput, current.model, cutting.cuts) : undefined,
    [current.model, cutting, playback.playing, sceneInput]);
  const toggleCut = useCallback((edgeId: string) => {
    setCutError(false);
    setCutting((state) => state ? reduceCubeNetCutSession(state, { kind: "toggle", edgeId }) : null);
  }, []);
  const preparePlayback = () => { setPreview(null); setActiveFold(null); setJudgment(null); setPanel(null); };
  const unfoldMotion = () => createCubeNetUnfoldMotion(session, current.hinges, sceneInput.layout.rootFaceId);
  const unfoldFrame = (motion: ReturnType<typeof createCubeNetUnfoldMotion>, elapsed: number): CubeNetPlaybackFrame => {
    const frame = motion.sample(elapsed);
    const next = resolver.resolve(frame.angles, frame.edgeId, frame.anchor, frame.movingFaceIds);
    return { current: { ...next, model: labelModel(next.model, labels) }, kind: "unfold", step: frame.step, total: frame.total };
  };
  const animateUnfold = () => {
    const motion = unfoldMotion();
    preparePlayback();
    playback.start({ durationMs: motion.durationMs, sample: (elapsed) => unfoldFrame(motion, elapsed),
      onFinish: () => apply({ kind: "unfold", anchor: session.anchor }) });
  };
  const startCutting = () => {
    setGalleryOpen(false);
    if (cutting) { setTool("cut"); return; }
    const motion = createCubeNetUnfoldMotion(session, current.hinges, sceneInput.layout.rootFaceId, 90);
    preparePlayback(); setCutError(false);
    playback.start({ durationMs: motion.durationMs,
      sample: (elapsed) => ({ ...unfoldFrame(motion, elapsed), kind: "close" }),
      onFinish: () => {
        setCutting(createCubeNetCutSession()); setTool("cut");
        setFrame(resolver.resolve(motion.sample(motion.durationMs).angles, null, session.anchor).model.bounds);
        setCameraRequestKey((key) => key + 1);
      },
    });
  };
  const unfoldCuts = async () => {
    if (!cutting || cutAnalysis?.status !== "ready") return;
    const request = ++cutRequest.current;
    setBuildingCuts(true); setCutError(false);
    try {
      const nextBuild = await buildCubeNetFromCuts(build, cutting.cuts);
      if (cutRequest.current !== request) return;
      const support = current.model.faces.find((face) => face.faceId === (session.anchor?.faceId ?? nextBuild.sceneInput.layout.rootFaceId))!;
      const points = support.vertices.slice(0, 3).map((vertex) => vertex.position);
      const anchor: CubeNetTeachingAnchor = { faceId: support.faceId, vertices: [points[0], points[1], points[2]] };
      const initial = createCubeNetTeachingSession(nextBuild.sceneInput.hingeGraph.hinges.map((hinge) => hinge.edgeId));
      const closed = { ...initial, anchor, angles: Object.fromEntries(Object.keys(initial.angles).map((id) => [id, 90])) };
      const nextResolver = createCubeNetWorkbenchResolver(nextBuild, locale);
      const motion = createCubeNetUnfoldMotion(closed, nextResolver.resolve(closed.angles, null, anchor).hinges, nextBuild.sceneInput.layout.rootFaceId);
      preparePlayback();
      setFrame(nextResolver.resolve({}, null, anchor).model.bounds); setCameraRequestKey((key) => key + 1);
      playback.start({ durationMs: motion.durationMs,
        sample: (elapsed) => {
          const value = motion.sample(elapsed);
          const next = nextResolver.resolve(value.angles, value.edgeId, value.anchor, value.movingFaceIds);
          return { current: { ...next, model: labelModel(next.model, labels) }, kind: "unfold", step: value.step, total: value.total };
        },
        onFinish: () => {
          setBuild(nextBuild); setCutting(null); setTool("fold");
          setSession(reduceCubeNetTeachingSession(closed, { kind: "unfold", anchor }));
        },
      });
    } catch {
      if (cutRequest.current === request) setCutError(true);
    } finally {
      if (cutRequest.current === request) setBuildingCuts(false);
    }
  };
  const cancelAnimation = () => { cutRequest.current++; setBuildingCuts(false); playback.cancel(); };
  const selectEntry = (target: CubeNetGalleryFoldingBuild) => {
    setGalleryOpen(false);
    if (target.entry.id === build.entry.id) return;
    const motion = unfoldMotion();
    const flat = resolver.resolve(Object.fromEntries(Object.keys(session.angles).map((id) => [id, 0])), null, session.anchor);
    const plan = planCubeNetPlanarChange(cubeNetPlanarTiles(build), target.entry.net.cells);
    const transition = createCubeNetPlanarPresentation(build, target, labelModel(flat.model, labels), plan);
    preparePlayback();
    playback.start({ durationMs: motion.durationMs + transition.durationMs,
      sample: (elapsed) => {
        if (elapsed < motion.durationMs) return unfoldFrame(motion, elapsed);
        const frame = transition.sample(elapsed - motion.durationMs);
        return { current: { model: frame.model, hinges: [] }, kind: "planar", step: frame.step, total: frame.total, movingCount: frame.movingCount };
      },
      onFinish: () => {
        setBuild(target); setLabels(transition.labels);
        setSession({ ...createCubeNetTeachingSession(target.sceneInput.hingeGraph.hinges.map((hinge) => hinge.edgeId)), anchor: transition.anchor });
      },
    });
  };
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
            foldingEnabled={!playback.playing && !buildingCuts && !cutting} cutEdges={cutEdges} onCutToggle={tool === "cut" && !busy ? toggleCut : undefined}
            messages={{ webglUnavailable: t("renderer.webglUnavailable"), contextLost: t("renderer.contextLost") }}
            onFoldStart={startFold} onPreview={previewFold} onCommit={commitFold} onDraggingChange={setDragging} />

          <div className={cn(styles.dock, styles.meta)} role="toolbar" aria-label={t("cubeNet.title")}>
            <CubeIconButton label={t("cubeNet.manual.chooseNet")} active={galleryOpen} disabled={busy || !!cutting}
              onClick={() => setGalleryOpen(true)}><Shapes aria-hidden /></CubeIconButton>
            <CubeIconButton label={m.modelPanel} active={panel === "settings"} disabled={busy}
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
              <CubeIconButton key={id} label={label} active={tool === id} disabled={busy}
                onClick={() => { setTool(id); setPreview(null); if (id === "fold") { setCutting(null); setCutError(false); } }} data-cube-net-tool={id}><Icon aria-hidden /></CubeIconButton>)}
            <CubeIconButton label={t("cubeNet.manual.cutTool")} active={tool === "cut"} disabled={busy} onClick={startCutting} data-cube-net-tool="cut"><Scissors aria-hidden /></CubeIconButton>
            <CubeIconButton label={t("cubeNet.manual.judge")} disabled={busy || !!cutting}
              onClick={() => setJudgment(judgeCubeNetFold(frameResolver.resolveHinges(cubeNetHingeProgress(angles))))}><Check aria-hidden /></CubeIconButton>
            <CubeIconButton label={t(playback.playing || buildingCuts ? "cubeNet.manual.cancelAnimation" : "cubeNet.manual.unfold")}
              disabled={dragging || (!playback.playing && !buildingCuts && (cutting ? cutAnalysis?.status !== "ready" : Object.values(session.angles).every((angle) => angle === 0)))}
              onClick={playback.playing || buildingCuts ? cancelAnimation : cutting ? () => void unfoldCuts() : animateUnfold}>{playback.playing || buildingCuts ? <Square aria-hidden /> : <RotateCcw aria-hidden />}</CubeIconButton>
            <span className="self-stretch border-t border-line" aria-hidden />
            <CubeIconButton label={t("cubeNet.manual.undo")} disabled={busy || (cutting ?? session).past.length === 0}
              onClick={() => cutting ? setCutting(reduceCubeNetCutSession(cutting, { kind: "undo" })) : apply({ kind: "undo" })}><Undo2 aria-hidden /></CubeIconButton>
            <CubeIconButton label={t("cubeNet.manual.redo")} disabled={busy || (cutting ?? session).future.length === 0}
              onClick={() => cutting ? setCutting(reduceCubeNetCutSession(cutting, { kind: "redo" })) : apply({ kind: "redo" })}><Redo2 aria-hidden /></CubeIconButton>
          </div>

          {panel && <CubeCanvasPanel title={m.modelPanel}
            anchor="meta" closeLabel={m.closePanel} onClose={() => setPanel(null)}>
            <div className="space-y-3 text-xs">{workspaceSelector}<p className="leading-5 text-muted">{t("cubeNet.manual.localOnly")}</p></div>
          </CubeCanvasPanel>}
          {playback.frame ? <div className={styles.cutStatus} role="status" data-cube-net-animation={playback.frame.kind}>
            {playback.frame.kind !== "planar" ? t(playback.frame.kind === "close" ? "cubeNet.manual.closing" : "cubeNet.manual.unfolding", { step: playback.frame.step, total: playback.frame.total })
              : t("cubeNet.manual.transforming", { count: playback.frame.movingCount ?? 0, step: playback.frame.step, total: playback.frame.total })}
          </div> : cutting && cutAnalysis ? <div className={styles.cutStatus} role="status" data-cube-net-cut-status={cutAnalysis.status}>
            <p className="font-medium">{t("cubeNet.manual.cutProgress", { count: cutting.cuts.length })}</p>
            <p>{t(cutAnalysis.status === "ready" ? "cubeNet.manual.cutReady" : cutAnalysis.status === "disconnected" ? "cubeNet.manual.cutDisconnected" : "cubeNet.manual.cutMore", { count: cutAnalysis.remainingCuts })}</p>
            <p>{t("cubeNet.manual.cutHint")}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              <Button size="sm" variant="secondary" disabled={busy || cutAnalysis.status !== "ready"} onClick={() => void unfoldCuts()}>{t(buildingCuts ? "common.previewBuilding" : "cubeNet.manual.unfold")}</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setCutting(createCubeNetCutSession()); setCutError(false); }}>{t("cubeNet.manual.resetCuts")}</Button>
            </div>
          </div> : tool === "fold" && <div className={styles.cutStatus} role="status" data-cube-net-drag-status>
            {activePaper ? <><p className="font-medium">{t("cubeNet.manual.activePaper", { face: activePaper.label, angle: currentAngle })}</p>
              <p>{t("cubeNet.manual.dragPaper")}</p></> : t("cubeNet.manual.grabPaper")}
          </div>}
          {judgment && <div className={styles.notice} role="status" data-cube-net-judgment={judgment}>{t(`cubeNet.manual.results.${judgment}`)}</div>}
          {cutError && <div className={styles.notice} role="alert">{t("cubeNet.manual.cutError")}</div>}
        </div>
      </div>
      <Dialog open={galleryOpen} onOpenChange={setGalleryOpen}>
        <DialogContent className="max-w-xl" data-cube-net-picker>
          <DialogHeader><DialogTitle>{t("cubeNet.manual.chooseNet")}</DialogTitle><DialogDescription>{t("cubeNet.manual.galleryHint")}</DialogDescription></DialogHeader>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {builds.map((item, index) => <Button key={item.entry.id} variant={item.entry.id === build.entry.id ? "secondary" : "ghost"}
              className="h-24 flex-col gap-1 p-1 text-xs" aria-pressed={item.entry.id === build.entry.id} onClick={() => selectEntry(item)}>
              <span className="w-full [&_svg]:h-14"><NetDiagram entry={item.entry} label="" compact /></span>{t("cubeNet.manual.net", { number: index + 1 })}
            </Button>)}
          </div>
          <Button variant="secondary" onClick={startCutting}><Scissors aria-hidden />{t("cubeNet.manual.cutEntry")}</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function CubeNetFoldWorkspace({ locale, workspaceSelector }: { readonly locale: "zh" | "en"; readonly workspaceSelector?: ReactNode }) {
  const t = useTranslations("tools.spatialLab");
  const entries = useMemo(() => createCubeNetGalleryCatalog().entries.filter((entry) => entry.classification === "legal"), []);
  const [buildState, setBuildState] = useState<CubeNetBuildState>({ status: "building" });

  useEffect(() => {
    let current = true;
    void Promise.all(entries.map((entry) => buildCubeNetGalleryFolding(createCubeNetGalleryFoldingRequest(entry.id)))).then(
      (builds) => { if (current) setBuildState({ status: "ready", builds }); },
      () => { if (current) setBuildState({ status: "error" }); },
    );
    return () => { current = false; };
  }, [entries]);

  return buildState.status === "ready" ? (
    <CubeNetFoldRehearsal builds={buildState.builds} locale={locale} workspaceSelector={workspaceSelector} />
  ) : (
    <div className={styles.workspace}><div className={styles.viewport}>
      <div className={cn(styles.canvas, "grid place-items-center text-sm text-muted")} data-layout-profile="standard-4x3" role="status">
        {buildState.status === "error" ? t("common.previewError") : t("common.previewBuilding")}
      </div>
    </div></div>
  );
}
