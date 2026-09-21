"use client";

import { SpatialActionButton } from "../spatial-interaction/SpatialActionButton";
import { SpatialActionIcon } from "../spatial-interaction/SpatialActionIcon";

import { useSpatialToolState } from "../spatial-interaction/useSpatialToolState";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { SpatialViewButtons } from "../spatial-interaction/SpatialViewButtons";
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
import { CubeNetGalleryWindow } from "./CubeNetGalleryWindow";
import { CubeNetSurfacePanel, DEFAULT_CUBE_NET_BRUSH, cubeNetBrushOperation } from "./CubeNetSurfacePanel";
import { reduceCubeNetSurfaces, type CubeNetSurfaceTool, type CubeNetSurfaceOperation } from "./cube-net-surfaces";
import { createCubeNetRecenter } from "./cube-net-recenter";
import { SpatialCanvasPanel, SpatialIconButton } from "../spatial-interaction/SpatialWorkbenchControls";
import { type CubeView } from "./cube-structures-contract";
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
import { createCubeNetCutUnfoldMotion, cubeNetAvailableCutMoves, cubeNetCutPoseModel, type CubeNetCutMove } from "./cube-net-cut-unfold";
import { createCubeNetTableAlignment } from "./cube-net-table-alignment";
import { CUBE_NET_FACE_REVEAL_MS, cubeNetRevealFaces, revealCubeNetFaces, sampleCubeNetFaceReveal, type CubeNetFaceOffsets } from "./cube-net-face-reveal";
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
import { cubeNetTeachingSnapshotSchema, NET_FACE_IDS, type CubeNetTeachingSnapshot as CoursewareNetSnapshot } from "../courseware/spatial-teaching-content";
import { netTeachingCommandSchema, type NetLiveSnapshot, type NetTeachingCommand, type TeachingWorkbenchPort } from "../courseware/workbench-classroom-contract";
type NetInitial = CoursewareNetSnapshot & Partial<Pick<NetLiveSnapshot, "judgment" | "galleryOpen">>;

const CubeNetFoldViewport = dynamic(() => import("./CubeNetFoldViewport").then((module) => module.CubeNetFoldViewport), { ssr: false });

type CubeNetBuildState =
  | { readonly status: "building" | "error" }
  | { readonly status: "ready"; readonly builds: readonly CubeNetGalleryFoldingBuild[] };

interface CubeNetPlaybackFrame {
  readonly current: { readonly model: PolyhedronFoldRenderModel; readonly hinges: readonly CubeNetWorkbenchHinge[] };
  readonly kind: "unfold" | "planar" | "close" | "reveal" | "settle" | "recenter";
  readonly step: number;
  readonly total: number;
  readonly movingCount?: number;
  readonly faceOffsets?: CubeNetFaceOffsets;
}
const labelModel = (model: PolyhedronFoldRenderModel, labels: Readonly<Record<string, string>>) => ({
  ...model, faces: model.faces.map((face) => ({ ...face, label: labels[face.faceId] ?? face.label })),
});

function CubeNetFoldRehearsal({ builds, locale, workspaceSelector, modeSelector, initial, initialBuild, onSnapshot, readOnly, courseware, classroom }: {
  readonly builds: readonly CubeNetGalleryFoldingBuild[];
  readonly locale: "zh" | "en";
  readonly workspaceSelector?: ReactNode;
  readonly modeSelector?: ReactNode;
  readonly initial?: NetInitial;
  readonly classroom?: TeachingWorkbenchPort<NetLiveSnapshot, NetTeachingCommand>;
  readonly initialBuild?: CubeNetGalleryFoldingBuild;
  readonly onSnapshot?: (snapshot: CoursewareNetSnapshot | null) => void;
  readonly readOnly?: boolean;
  readonly courseware?: boolean;
}) {
  const t = useTranslations("tools.spatialLab");
  const m = cubeStructuresMessages(locale);
  const [build, setBuild] = useState(initialBuild ?? builds[0]);
  const [source, setSource] = useState<CoursewareNetSnapshot["source"]>(initial?.source ?? { entryId: builds[0].entry.id, cuts: null });
  const [labels, setLabels] = useState<Readonly<Record<string, string>>>(initial?.labels ?? {});
  const [buildingCuts, setBuildingCuts] = useState(false);
  const cutRequest = useRef(0);
  const cancelClassroom = classroom?.cancel;
  const interrupt = useCallback(() => { cancelClassroom?.(); cutRequest.current++; setBuildingCuts(false); }, [cancelClassroom]);
  const playback = useCubeNetPlayback<CubeNetPlaybackFrame>({ essential: true, interactive: !readOnly, onInterrupt: interrupt });
  const { page, sceneInput } = build;
  const resolver = useMemo(() => createCubeNetWorkbenchResolver(build, locale), [build, locale]);
  const [session, setSession] = useState(() => {
    const empty = createCubeNetTeachingSession(sceneInput.hingeGraph.hinges.map((hinge) => hinge.edgeId));
    return initial ? { ...empty, angles: initial.angles, anchor: initial.anchor, surfaces: initial.surfaces } : empty;
  });
  const [activeFold, setActiveFold] = useState<CubeNetPaperSelection | null>(null);
  const [preview, setPreview] = useState<CubeNetFoldChange | null>(null);
  const [judgment, setJudgment] = useState<CubeNetFoldJudgment | null>(initial?.judgment ?? null);
  const [cutting, setCutting] = useState<CubeNetCutSession | null>(() => initial?.cutting ? { ...initial.cutting, past: [], future: [] } : null);
  const [revealEnabled, setRevealEnabled] = useState(initial?.revealEnabled ?? false);
  const [faceOffsets, setFaceOffsets] = useState<CubeNetFaceOffsets>(initial?.faceOffsets ?? {});
  const [cutError, setCutError] = useState(false);
  const [restoreCutBlocked, setRestoreCutBlocked] = useState(false);
  useEffect(() => () => { cutRequest.current++; }, []);
  const [view, setView] = useState<CubeView>(initial?.view ?? "angle");
  const [frame, setFrame] = useState(() => initial?.frame ?? resolver.resolve({}).model.bounds);
  const [cameraRequestKey, setCameraRequestKey] = useState(0);
  const controls = useSpatialToolState<"orbit" | "pan" | "fold" | "cut" | CubeNetSurfaceTool, "settings" | CubeNetSurfaceTool>({ defaultTool: cutting ? "cut" : "fold", onClearSelection: () => { setSelectedPaper(null); setActiveFold(null); setOpacityPreview(null); }, panels: {
    settings: cutting ? "cut" : "fold", face: "face", transparent: "transparent", mark: "mark", number: "number",
  } });
  const { tool, panel, setTool, setPanel } = controls;
  const [brush, setBrush] = useState(DEFAULT_CUBE_NET_BRUSH);
  const [selectedPaper, setSelectedPaper] = useState<string | null>(null);
  const [opacityPreview, setOpacityPreview] = useState<number | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(initial?.galleryOpen ?? false);
  const [axesVisible, setAxesVisible] = useState(initial?.axesVisible ?? true);
  const [dragging, setDragging] = useState(false);
  const axisSnapEnabled = useSpatialAxisSnap();
  const angles = useMemo(() => cutting ? Object.fromEntries(Object.keys(session.angles).map((id) => [id, 90]))
    : preview ? { ...session.angles, [preview.edgeId]: preview.degrees } : session.angles, [cutting, preview, session.angles]);
  const sourceCurrent = useMemo(() => {
    const resolved = resolver.resolve(angles, activeFold?.edgeId, cutting ? null : preview?.anchor ?? session.anchor, activeFold?.movingFaceIds);
    return { ...resolved, model: labelModel(resolved.model, labels) };
  }, [activeFold, angles, cutting, labels, preview, resolver, session.anchor]);
  const paperCurrent = useMemo(() => cutting ? { ...sourceCurrent, model: cubeNetCutPoseModel(sourceCurrent.model, cutting.poses) } : sourceCurrent,
    [cutting, sourceCurrent]);
  const manualCurrent = useMemo(() => cutting ? { ...paperCurrent, model: revealCubeNetFaces(paperCurrent.model, faceOffsets) } : paperCurrent,
    [cutting, faceOffsets, paperCurrent]);
  const revealBounds = useMemo(() => {
    const bounds = revealCubeNetFaces(paperCurrent.model, Object.fromEntries(paperCurrent.model.faces.map((face) => [face.faceId, 1]))).bounds;
    return { ...bounds, radius: bounds.radius + 0.4 };
  }, [paperCurrent.model]);
  const current = playback.frame?.current ?? manualCurrent;
  const faceArrows = useMemo(() => cutting && revealEnabled && (!playback.playing || playback.frame?.kind === "reveal")
    ? cubeNetRevealFaces(paperCurrent.model, playback.frame?.faceOffsets ?? faceOffsets) : undefined,
  [cutting, faceOffsets, paperCurrent.model, playback.frame, playback.playing, revealEnabled]);
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
  const busy = dragging || playback.playing || buildingCuts;
  const capture = classroom?.capture;
  useEffect(() => {
    // 只在手势或教学动画完成后提供完整起点；不冻结临时半帧或撤销历史。
    if (!onSnapshot && !capture) return;
    if (busy || opacityPreview !== null) { onSnapshot?.(null); capture?.(null); return; }
    const result = cubeNetTeachingSnapshotSchema.safeParse({ source, labels, angles: session.angles, anchor: session.anchor,
      surfaces: session.surfaces, cutting: cutting ? { cuts: [...cutting.cuts], poses: Object.fromEntries(Object.entries(cutting.poses).map(([id, pose]) => [id, [...pose]])), surfaces: cutting.surfaces } : null,
      faceOffsets, revealEnabled, view, axesVisible, frame });
    onSnapshot?.(result.success ? result.data : null);
    capture?.(result.success ? { ...result.data, judgment, galleryOpen } : null, cameraRequestKey);
  }, [onSnapshot, capture, busy, opacityPreview, source, labels, session.angles, session.anchor, session.surfaces, cutting, faceOffsets, revealEnabled, view, axesVisible, frame, judgment, galleryOpen, cameraRequestKey, classroom?.pending]);
  const surfaces = (cutting ?? session).surfaces;
  const previewSurfaces = selectedPaper && opacityPreview !== null ? reduceCubeNetSurfaces(surfaces, { kind: "opacity", ids: [selectedPaper], opacity: opacityPreview / 100 }) : surfaces;
  const surfaceTool = tool === "face" || tool === "transparent" || tool === "mark" || tool === "number" ? tool : null;
  const applySurface = (operation: CubeNetSurfaceOperation) => {
    if (busy) return;
    if (cutting) setCutting(reduceCubeNetCutSession(cutting, { kind: "surface", operation }));
    else apply({ kind: "surface", operation });
  };
  const paintFace = (faceId: string) => {
    const identity = current.model.faces.find((face) => face.faceId === faceId)?.label;
    if (!surfaceTool || !identity || busy) return;
    setSelectedPaper(identity);
    applySurface(cubeNetBrushOperation(surfaceTool, brush, [identity]));
  };
  const chooseSurfaceTool = (next: CubeNetSurfaceTool) => {
    controls.togglePanel(next); setActiveFold(null); setPreview(null); setOpacityPreview(null);
    if (tool !== next) setSelectedPaper(null);
  };
  const cutAnalysis = useMemo(() => cutting ? analyzeCubeNetCuts(sceneInput, cutting.cuts) : null, [cutting, sceneInput]);
  const cutMoves = useMemo(() => cutting ? cubeNetAvailableCutMoves(sceneInput, cutting.cuts, paperCurrent.model, true) : [], [cutting, paperCurrent.model, sceneInput]);
  const cutEdges = useMemo(() => cutting && (!playback.playing || playback.frame?.kind === "reveal")
    ? revealEnabled ? [] : cubeNetCutEdges(sceneInput, current.model, cutting.cuts) : undefined,
    [current.model, cutting, playback.frame?.kind, playback.playing, revealEnabled, sceneInput]);
  const toggleCut = useCallback((edgeId: string) => {
    setCutError(false);
    if (cutting?.cuts.includes(edgeId) && cubeNetCutEdges(sceneInput, paperCurrent.model, cutting.cuts).filter((edge) => edge.edgeId === edgeId).length > 1) {
      setRestoreCutBlocked(true); return;
    }
    setRestoreCutBlocked(false);
    setCutting((state) => state ? reduceCubeNetCutSession(state, { kind: "toggle", edgeId }) : null);
  }, [cutting, paperCurrent.model, sceneInput]);
  const preparePlayback = () => { setPreview(null); setActiveFold(null); setJudgment(null); setPanel(null); };
  const unfoldMotion = () => createCubeNetUnfoldMotion(session, current.hinges, sceneInput.layout.rootFaceId);
  const unfoldFrame = (motion: ReturnType<typeof createCubeNetUnfoldMotion>, elapsed: number): CubeNetPlaybackFrame => {
    const frame = motion.sample(elapsed);
    const next = resolver.resolve(frame.angles, frame.edgeId, frame.anchor, frame.movingFaceIds);
    return { current: { ...next, model: labelModel(next.model, labels) }, kind: "unfold", step: frame.step, total: frame.total };
  };
  const animateUnfold = () => {
    const motion = unfoldMotion();
    const flat = unfoldFrame(motion, motion.durationMs).current.model;
    const placement = createCubeNetTableAlignment(flat, resolver.resolve({}).model, sceneInput.layout.rootFaceId);
    preparePlayback();
    playback.start({ durationMs: motion.durationMs + placement.durationMs,
      sample: (elapsed) => elapsed < motion.durationMs ? unfoldFrame(motion, elapsed)
        : { current: { model: placement.sample(elapsed - motion.durationMs), hinges: [] }, kind: "settle", step: 1, total: 1 },
      onFinish: () => apply({ kind: "unfold", anchor: placement.anchor }) });
  };
  const animateFaces = (next: CubeNetFaceOffsets, onFinish?: () => void) => {
    if ([...new Set([...Object.keys(faceOffsets), ...Object.keys(next)])].every((id) => (faceOffsets[id] ?? 0) === (next[id] ?? 0))) { onFinish?.(); return; }
    playback.start({ durationMs: CUBE_NET_FACE_REVEAL_MS,
      sample: (elapsed) => {
        const offsets = sampleCubeNetFaceReveal(faceOffsets, next, elapsed);
        return { current: { ...paperCurrent, model: revealCubeNetFaces(paperCurrent.model, offsets) }, kind: "reveal", step: 1, total: 1, faceOffsets: offsets };
      },
      onFinish: () => { setFaceOffsets(next); onFinish?.(); },
    });
  };
  const closeReveal = (onFinish?: () => void) => animateFaces({}, () => {
    setRevealEnabled(false); onFinish?.();
  });
  const toggleReveal = () => {
    if (revealEnabled) closeReveal();
    else { setRevealEnabled(true); setFrame(revealBounds); setCameraRequestKey((key) => key + 1); }
  };
  const moveFace = (faceId: string) => animateFaces({ ...faceOffsets, [faceId]: faceOffsets[faceId] ? 0 : 1 });
  const startCutting = () => {
    setGalleryOpen(false); setPanel(null); setActiveFold(null);
    if (cutting) { if (revealEnabled) closeReveal(); setTool("cut"); return; }
    const motion = createCubeNetUnfoldMotion(session, current.hinges, sceneInput.layout.rootFaceId, 90);
    const closed = resolver.resolve(motion.sample(motion.durationMs).angles).model;
    const placement = createCubeNetTableAlignment(unfoldFrame(motion, motion.durationMs).current.model, closed, sceneInput.layout.rootFaceId, false);
    preparePlayback(); setCutError(false); setRestoreCutBlocked(false);
    playback.start({ durationMs: motion.durationMs + placement.durationMs,
      sample: (elapsed) => elapsed < motion.durationMs ? { ...unfoldFrame(motion, elapsed), kind: "close" }
        : { current: { model: placement.sample(elapsed - motion.durationMs), hinges: [] }, kind: "settle", step: 1, total: 1 },
      onFinish: () => {
        setCutting(createCubeNetCutSession(session.surfaces)); setTool("cut"); setFaceOffsets({}); setRevealEnabled(false);
        setFrame({ ...closed.bounds, radius: Math.max(frame.radius, closed.bounds.radius) });
        setCameraRequestKey((key) => key + 1);
      },
    });
  };
  const unfoldCuts = async (selection?: CubeNetCutMove) => {
    if (!cutting) return;
    const motion = createCubeNetCutUnfoldMotion(sceneInput, sourceCurrent.model, cutting, selection);
    if (!motion.steps.length) return;
    const request = ++cutRequest.current;
    setBuildingCuts(true); setCutError(false); setRestoreCutBlocked(false);
    try {
      const final = motion.sample(motion.durationMs).model;
      const complete = cutAnalysis?.status === "ready" && cubeNetAvailableCutMoves(sceneInput, cutting.cuts, final).length === 0;
      const nextBuild = complete ? await buildCubeNetFromCuts(build, cutting.cuts) : null;
      if (cutRequest.current !== request) return;
      const placement = nextBuild ? createCubeNetTableAlignment(final, createCubeNetWorkbenchResolver(nextBuild, locale).resolve({}).model, nextBuild.sceneInput.layout.rootFaceId) : null;
      preparePlayback();
      // 逐面展开沿用现有取景，避免纸片开始转动时整体突然缩放或回到预设视角。
      playback.start({ durationMs: motion.durationMs + (placement?.durationMs ?? 0),
        sample: (elapsed) => {
          if (placement && elapsed >= motion.durationMs) return { current: { model: placement.sample(elapsed - motion.durationMs), hinges: [] }, kind: "settle", step: 1, total: 1 };
          const value = motion.sample(elapsed);
          return { current: { model: value.model, hinges: [] }, kind: "unfold", step: value.step, total: value.total };
        },
        onFinish: () => {
          if (!nextBuild || !placement) { setCutting(reduceCubeNetCutSession(cutting, { kind: "unfold", poses: motion.target })); return; }
          const support = paperCurrent.model.faces.find((face) => face.faceId === nextBuild.sceneInput.layout.rootFaceId)!;
          const points = support.vertices.slice(0, 3).map((vertex) => vertex.position);
          const anchor: CubeNetTeachingAnchor = { faceId: support.faceId, vertices: [points[0], points[1], points[2]] };
          const initial = { ...createCubeNetTeachingSession(nextBuild.sceneInput.hingeGraph.hinges.map((hinge) => hinge.edgeId)), surfaces: cutting.surfaces };
          const before = { ...initial, anchor, angles: Object.fromEntries(Object.keys(initial.angles).map((id) => [id, cutMoves.some((move) => move.edgeId === id) ? 90 : 0])) };
          setBuild(nextBuild); setSource({ entryId: source.entryId, cuts: [...cutting.cuts] }); setCutting(null); setTool("fold"); setRevealEnabled(false); setFaceOffsets({});
          setSession(reduceCubeNetTeachingSession(before, { kind: "unfold", anchor: placement.anchor }));
        },
      });
    } catch {
      if (cutRequest.current === request) setCutError(true);
    } finally {
      if (cutRequest.current === request) setBuildingCuts(false);
    }
  };
  const requestUnfoldCuts = (selection?: CubeNetCutMove) => revealEnabled ? closeReveal(() => void unfoldCuts(selection)) : void unfoldCuts(selection);
  const openCutFace = (faceId: string) => {
    const move = cutMoves.find((candidate) => candidate.movingFaceIds.includes(faceId));
    if (move) runCommand({ kind: "unfold-cuts", faceId: faceId as typeof NET_FACE_IDS[number] });
  };
  const cancelAnimation = () => { interrupt(); playback.cancel(); };
  const selectEntry = (target: CubeNetGalleryFoldingBuild) => {
    if (busy || cutting) return;
    if (target.entry.id === build.entry.id) return;
    const motion = unfoldMotion();
    const flat = resolver.resolve(Object.fromEntries(Object.keys(session.angles).map((id) => [id, 0])), null, session.anchor);
    const placement = createCubeNetTableAlignment(labelModel(flat.model, labels), resolver.resolve({}).model, sceneInput.layout.rootFaceId);
    const plan = planCubeNetPlanarChange(cubeNetPlanarTiles(build), target.entry.net.cells);
    const transition = createCubeNetPlanarPresentation(build, target, placement.sample(placement.durationMs), plan);
    preparePlayback();
    playback.start({ durationMs: motion.durationMs + placement.durationMs + transition.durationMs,
      sample: (elapsed) => {
        if (elapsed < motion.durationMs) return unfoldFrame(motion, elapsed);
        if (elapsed < motion.durationMs + placement.durationMs) return { current: { model: placement.sample(elapsed - motion.durationMs), hinges: [] }, kind: "settle", step: 1, total: 1 };
        const frame = transition.sample(elapsed - motion.durationMs - placement.durationMs);
        return { current: { model: frame.model, hinges: [] }, kind: "planar", step: frame.step, total: frame.total, movingCount: frame.movingCount };
      },
      onFinish: () => {
        setBuild(target); setSource({ entryId: target.entry.id, cuts: null }); setLabels(transition.labels);
        setSession({ ...createCubeNetTeachingSession(target.sceneInput.hingeGraph.hinges.map((hinge) => hinge.edgeId)), anchor: transition.anchor, surfaces });
      },
    });
  };
  const chooseView = (nextView: CubeView) => {
    setFrame(revealEnabled ? revealBounds : current.model.bounds);
    setView(nextView);
    setCameraRequestKey((current) => current + 1);
  };
  const recenter = () => {
    const motion = createCubeNetRecenter(paperCurrent.model, sceneInput.layout.rootFaceId, cutting?.poses);
    const finish = () => {
      if (motion.durationMs) {
        if (cutting) setCutting(reduceCubeNetCutSession(cutting, { kind: "recenter", poses: motion.poses }));
        else apply({ kind: "recenter", anchor: motion.anchor });
      }
      const target = revealEnabled ? revealCubeNetFaces(motion.target, Object.fromEntries(motion.target.faces.map((face) => [face.faceId, 1]))) : motion.target;
      setFrame(target.bounds); setCameraRequestKey((key) => key + 1);
    };
    preparePlayback();
    playback.start({ durationMs: motion.durationMs, sample: (elapsed) => ({
      current: { model: revealCubeNetFaces(motion.sample(elapsed), faceOffsets), hinges: [] }, kind: "recenter", step: 1, total: 1,
    }), onFinish: finish });
  };
  const executeCommand = (command: NetTeachingCommand, replay = false) => {
    switch (command.kind) {
      case "unfold": animateUnfold(); break;
      case "cut": startCutting(); break;
      case "toggle-reveal": toggleReveal(); break;
      case "restore-faces": animateFaces({}); break;
      case "move-face": moveFace(command.faceId); break;
      case "unfold-cuts": requestUnfoldCuts(command.faceId ? cutMoves.find((move) => move.movingFaceIds.includes(command.faceId!)) : undefined); break;
      case "gallery": { const target = builds.find((item) => item.entry.id === command.entryId); if (target) selectEntry(target); break; }
      case "recenter": recenter(); break;
      case "fold": {
        const action: CubeNetTeachingAction = { kind: "fold", edgeId: command.edgeId, degrees: command.degrees, ...(command.anchor ? { anchor: command.anchor } : {}) };
        if (!replay) { apply(action); break; }
        const start = session.angles[command.edgeId];
        playback.start({ durationMs: 320, sample: (elapsed) => {
          const next = resolver.resolve({ ...session.angles, [command.edgeId]: Math.round(start + (command.degrees - start) * elapsed / 320) }, command.edgeId, command.anchor ?? session.anchor);
          return { current: { ...next, model: labelModel(next.model, labels) }, kind: "unfold", step: 1, total: 1 };
        }, onFinish: () => apply(action) });
      }
    }
  };
  const runCommand = (command: NetTeachingCommand) => {
    const execute = () => { playback.seekFrom(null); executeCommand(command); };
    if (classroom) classroom.command(command, execute); else execute();
  };
  const replayed = useRef<unknown>(null);
  useEffect(() => {
    if (classroom?.replay && replayed.current !== classroom.replay) {
      replayed.current = classroom.replay; playback.seekFrom(classroom.replay.startedAt); executeCommand(classroom.replay.command, true);
    }
  });
  const commitFold = (value: CubeNetFoldChange) => runCommand(netTeachingCommandSchema.parse({ kind: "fold", edgeId: value.edgeId, degrees: value.degrees, anchor: value.anchor ?? null }));

  return (
    <div className={styles.workspace} data-cube-net-teaching={CUBE_NET_TEACHING_VERSION} data-folding-entry={build.entry.id} data-workbench-mode={courseware ? "courseware" : undefined} inert={readOnly || classroom?.pending} {...controls.bindings}>
      <div className={styles.viewport}>
        <div className={styles.canvas} data-cube-workspace-frame="4:3" data-cube-net-workbench data-net-gallery-open={galleryOpen}
          aria-label={t("cubeNet.title")} style={{ cursor: tool === "fold" ? dragging ? "grabbing" : "grab" : tool === "pan" ? "grab" : "default" }}>
          <CubeNetFoldViewport scene={page.scene} entityId={sceneInput.entityId} model={model} hinges={current.hinges}
            onPointerMissed={!readOnly && !busy && !classroom?.pending ? controls.onPointerMissed : undefined}
            activeEdgeId={activeFold?.edgeId ?? null} tool={tool} locale={locale}
            axisSnapEnabled={axisSnapEnabled} axesVisible={axesVisible} cameraRequestKey={cameraRequestKey} dragging={dragging}
            animating={playback.playing} foldingEnabled={!readOnly && !classroom?.pending && !playback.playing && !buildingCuts && !cutting} cutEdges={cutEdges} onCutToggle={tool === "cut" && !busy && !revealEnabled ? toggleCut : undefined}
            onCutFaceOpen={tool === "cut" && !busy && !revealEnabled && cutMoves.length > 0 ? openCutFace : undefined}
            faceArrows={faceArrows} onFaceMove={!busy ? (faceId) => runCommand({ kind: "move-face", faceId: faceId as typeof NET_FACE_IDS[number] }) : undefined}
            surfaces={previewSurfaces} onSurfaceFaceSelect={!busy && surfaceTool ? paintFace : undefined}
            messages={{ webglUnavailable: t("renderer.webglUnavailable"), contextLost: t("renderer.contextLost") }}
            onFoldStart={startFold} onPreview={previewFold} onCommit={commitFold} onDraggingChange={setDragging} />

          <div className={cn(styles.dock, styles.meta)} role="toolbar" aria-label={t("cubeNet.title")}>
            {modeSelector}
            <SpatialActionButton action="settings" label={m.modelPanel} active={panel === "settings"} disabled={busy}
              onClick={() => setPanel(panel === "settings" ? null : "settings")} />
          </div>
          <div className={cn(styles.dock, styles.views)} role="toolbar" aria-label={m.view} data-cube-view-toolbar>
            <SpatialViewButtons views={CUBE_WORKBENCH_VIEWS} value={view} labels={m} disabled={dragging} onChange={chooseView} fit={{ label: m.fit, onClick: () => chooseView(view) }} />
            <SpatialAxisSnapButton messages={cameraMessages} iconOnly className={styles.icon} disabled={dragging} />
            <SpatialActionButton action="axes" label={axesVisible ? m.hideAxes : m.showAxes} active={axesVisible} onClick={() => setAxesVisible(!axesVisible)} />
          </div>
          <div className={cn(styles.dock, styles.tools)} role="toolbar" aria-label={m.tools} data-cube-tools-toolbar>
            {([{ id: "orbit", label: m.orbit }, { id: "pan", label: m.pan }] as const).map(({ id, label }) =>
              <SpatialActionButton action={id} key={id} label={label} active={tool === id} disabled={busy}
                onClick={() => { controls.chooseTool(id); setPreview(null); setActiveFold(null); }} data-cube-net-tool={id} />)}
            <SpatialActionButton action="recenter" label={t("cubeNet.manual.recenter")} disabled={busy} onClick={() => runCommand({ kind: "recenter" })} data-cube-net-recenter />
            {classroom && <SpatialActionButton action="reset" label={classroom.resetLabel ?? t("cubeNet.manual.recenter")} disabled={busy} onClick={classroom.reset} data-teaching-reset />}
            <span className={styles.toolSeparator} aria-hidden />
            <SpatialActionButton action="fold" label={t("cubeNet.manual.foldTool")} active={tool === "fold"} disabled={busy} data-cube-net-tool="fold"
              onClick={() => {
                setTool("fold"); setPreview(null);
                if (cutting) {
                  setSession((session) => ({ ...session, surfaces: cutting.surfaces }));
                  setCutting(null); setCutError(false); setRestoreCutBlocked(false); setRevealEnabled(false); setFaceOffsets({});
                  setFrame(resolver.resolve(session.angles, null, session.anchor).model.bounds); setCameraRequestKey((key) => key + 1);
                }
              }} />
            <SpatialActionButton action="cut" label={t("cubeNet.manual.cutTool")} active={tool === "cut"} disabled={busy} onClick={() => runCommand({ kind: "cut" })} data-cube-net-tool="cut" />
            <SpatialActionButton action="netGallery" label={t("cubeNet.manual.chooseNet")} active={galleryOpen} disabled={busy || !!cutting}
              onClick={() => setGalleryOpen(!galleryOpen)} data-cube-net-gallery-toggle />
            <SpatialActionButton action="faceReveal" label={t("cubeNet.manual.faceReveal")} active={revealEnabled} disabled={busy || !cutting}
              onClick={() => runCommand({ kind: "toggle-reveal" })} data-cube-net-face-reveal-toggle />
            <SpatialIconButton label={t(playback.playing || buildingCuts ? "cubeNet.manual.cancelAnimation" : cutting ? "cubeNet.manual.unfoldAvailable" : "cubeNet.manual.unfold")}
              disabled={dragging || (!playback.playing && !buildingCuts && (cutting ? cutMoves.length === 0 : Object.values(session.angles).every((angle) => angle === 0) && (!session.anchor || session.anchor.vertices.every((point) => Math.abs(point.y) < 1e-6))))}
              onClick={playback.playing || buildingCuts ? cancelAnimation : () => runCommand({ kind: cutting ? "unfold-cuts" : "unfold" })}>{playback.playing || buildingCuts ? <SpatialActionIcon action="stop" aria-hidden /> : <SpatialActionIcon action="unfold" aria-hidden />}</SpatialIconButton>
            <SpatialActionButton action="validateFold" label={t("cubeNet.manual.judge")} disabled={busy || !!cutting}
              onClick={() => setJudgment(judgeCubeNetFold(frameResolver.resolveHinges(cubeNetHingeProgress(angles))))} />
            <span className={styles.toolSeparator} aria-hidden />
            {([{ id: "face", label: m.face, action: "faceColor" }, { id: "transparent", label: m.transparent, action: "opacity" },
              { id: "mark", label: t("cubeNet.manual.surface.mark"), action: "mark" }, { id: "number", label: m.number, action: "number" }] as const).map(({ id, label, action }) =>
              <SpatialActionButton action={action} key={id} label={label} active={tool === id} disabled={busy} onClick={() => chooseSurfaceTool(id)} data-cube-net-tool={id} />)}
            <span className={styles.toolSeparator} aria-hidden />
            <SpatialActionButton action="undo" label={t("cubeNet.manual.undo")} disabled={busy || revealEnabled || (cutting ?? session).past.length === 0}
              onClick={() => { setRestoreCutBlocked(false); if (cutting) setCutting(reduceCubeNetCutSession(cutting, { kind: "undo" })); else apply({ kind: "undo" }); }} />
            <SpatialActionButton action="redo" label={t("cubeNet.manual.redo")} disabled={busy || revealEnabled || (cutting ?? session).future.length === 0}
              onClick={() => cutting ? setCutting(reduceCubeNetCutSession(cutting, { kind: "redo" })) : apply({ kind: "redo" })} />
          </div>

          {panel === "settings" && <SpatialCanvasPanel title={m.modelPanel}
            anchor="meta" closeLabel={m.closePanel} onClose={() => setPanel(null)}>
            <div className="space-y-3 text-xs">{workspaceSelector}{!courseware && <p className="leading-5 text-muted">{t("cubeNet.manual.localOnly")}</p>}</div>
          </SpatialCanvasPanel>}
          {panel && panel !== "settings" && <CubeNetSurfacePanel locale={locale} tool={panel} brush={brush} surfaces={surfaces}
            identities={current.model.faces.map((face) => face.label)} selected={selectedPaper} busy={busy}
            onBrush={setBrush} onApply={applySurface} onPreview={setOpacityPreview} onClose={() => setPanel(null)} />}
          {galleryOpen && <CubeNetGalleryWindow builds={builds} selectedId={build.entry.id} busy={busy || !!cutting} closeLabel={m.closePanel}
            onSelect={(entry) => runCommand({ kind: "gallery", entryId: entry.entry.id })} onClose={() => setGalleryOpen(false)} />}
          {playback.frame ? <div className={styles.cutStatus} role="status" data-cube-net-animation={playback.frame.kind}>
            {playback.frame.kind === "recenter" ? t("cubeNet.manual.recentering") : playback.frame.kind === "settle" ? t("cubeNet.manual.settling") : playback.frame.kind === "reveal" ? t("cubeNet.manual.faceMoving") : playback.frame.kind !== "planar" ? t(playback.frame.kind === "close" ? "cubeNet.manual.closing" : "cubeNet.manual.unfolding", { step: playback.frame.step, total: playback.frame.total })
              : t("cubeNet.manual.transforming", { count: playback.frame.movingCount ?? 0, step: playback.frame.step, total: playback.frame.total })}
          </div> : cutting && cutAnalysis ? <div className={styles.cutStatus} role="status" data-cube-net-cut-status={cutAnalysis.status}>
            <p className="font-medium">{t("cubeNet.manual.cutProgress", { count: cutting.cuts.length })}</p>
            <p>{t(cutMoves.length > 0 ? "cubeNet.manual.cutReady" : cutAnalysis.status === "disconnected" ? "cubeNet.manual.cutDisconnected" : "cubeNet.manual.cutMore")}</p>
            <p>{t(revealEnabled ? "cubeNet.manual.faceRevealHint" : "cubeNet.manual.cutHint")}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              <Button size="sm" variant="secondary" disabled={busy || cutMoves.length === 0} onClick={() => runCommand({ kind: "unfold-cuts" })}>{t(buildingCuts ? "common.previewBuilding" : "cubeNet.manual.unfoldAvailable")}</Button>
              {revealEnabled ? <Button size="sm" variant="ghost" disabled={busy || !Object.values(faceOffsets).some(Boolean)} onClick={() => runCommand({ kind: "restore-faces" })}>{t("cubeNet.manual.restoreFaces")}</Button>
                : <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setCutting(createCubeNetCutSession(cutting.surfaces)); setCutError(false); setRestoreCutBlocked(false); setFrame(sourceCurrent.model.bounds); setCameraRequestKey((key) => key + 1); }}>{t("cubeNet.manual.resetCuts")}</Button>}
            </div>
          </div> : tool === "fold" && <div className={styles.cutStatus} role="status" data-cube-net-drag-status>
            {activePaper ? <><p className="font-medium">{t("cubeNet.manual.activePaper", { face: activePaper.label, angle: currentAngle })}</p>
              <p>{t("cubeNet.manual.dragPaper")}</p></> : t("cubeNet.manual.grabPaper")}
          </div>}
          {judgment && <div className={styles.notice} role="status" data-cube-net-judgment={judgment}>{t(`cubeNet.manual.results.${judgment}`)}</div>}
          {cutError && <div className={styles.notice} role="alert">{t("cubeNet.manual.cutError")}</div>}
          {restoreCutBlocked && <div className={styles.notice} role="status">{t("cubeNet.manual.restoreCutBlocked")}</div>}
        </div>
      </div>
    </div>
  );
}

export function CubeNetFoldWorkspace({ locale, workspaceSelector, modeSelector, initial, onSnapshot, readOnly, courseware, classroom }: {
  readonly locale: "zh" | "en"; readonly workspaceSelector?: ReactNode; readonly modeSelector?: ReactNode; readonly initial?: NetInitial;
  readonly classroom?: TeachingWorkbenchPort<NetLiveSnapshot, NetTeachingCommand>;
  readonly onSnapshot?: (snapshot: CoursewareNetSnapshot | null) => void; readonly readOnly?: boolean; readonly courseware?: boolean;
}) {
  const t = useTranslations("tools.spatialLab");
  const entries = useMemo(() => createCubeNetGalleryCatalog().entries.filter((entry) => entry.classification === "legal"), []);
  const [buildState, setBuildState] = useState<CubeNetBuildState>({ status: "building" });
  const [initialBuild, setInitialBuild] = useState<CubeNetGalleryFoldingBuild>();

  useEffect(() => {
    let current = true;
    void Promise.all(entries.map((entry) => buildCubeNetGalleryFolding(createCubeNetGalleryFoldingRequest(entry.id)))).then(
      async (builds) => {
        try {
          const base = initial ? builds.find((build) => build.entry.id === initial.source.entryId) : builds[0];
          if (!base) throw new Error("UNKNOWN_CUBE_NET_SOURCE");
          const restored = initial?.source.cuts ? await buildCubeNetFromCuts(base, initial.source.cuts) : base;
          if (initial && restored.sceneInput.hingeGraph.hinges.some((hinge) => !Object.hasOwn(initial.angles, hinge.edgeId))) throw new Error("INVALID_CUBE_NET_HINGES");
          if (current) { setInitialBuild(restored); setBuildState({ status: "ready", builds }); }
        } catch { if (current) setBuildState({ status: "error" }); }
      },
      () => { if (current) setBuildState({ status: "error" }); },
    );
    return () => { current = false; };
  }, [entries, initial]);

  return buildState.status === "ready" ? (
    <CubeNetFoldRehearsal builds={buildState.builds} initialBuild={initialBuild} locale={locale} workspaceSelector={workspaceSelector} modeSelector={modeSelector} initial={initial} onSnapshot={onSnapshot} readOnly={readOnly} courseware={courseware} classroom={classroom} />
  ) : (
    <div className={styles.workspace} data-workbench-mode={courseware ? "courseware" : undefined}><div className={styles.viewport}>
      <div className={cn(styles.canvas, "grid place-items-center text-sm text-muted")} data-layout-profile="standard-4x3" role="status">
        {buildState.status === "error" ? t("common.previewError") : t("common.previewBuilding")}
      </div>
    </div></div>
  );
}
