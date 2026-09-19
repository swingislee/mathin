"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { Axis3d, Droplets, Eraser, Grid2X2, Hand, Hash, Maximize, Orbit, RotateCcw, Ruler, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { SpatialAxisSnapButton, useSpatialAxisSnap } from "@/features/spatial-math/renderer-r3f/SpatialCameraControls";
import { CubeCanvasPanel, CubeIconButton, CubeViewIcon } from "../spatial-lab/CubeWorkbenchControls";
import { CUBE_COLORS } from "../spatial-lab/cube-structures-contract";
import { useToolSnapshot } from "../scenes/useToolSnapshot";
import { useSceneCapture } from "../courseware/useSceneCapture";
import { createSolidEntity, createSolidGeometryInitial, type SolidEntity } from "../solid-geometry/solid-geometry-contract";
import { getSolidsFrame } from "../solid-geometry/solid-geometry";
import styles from "../spatial-lab/CubeStructuresWorkbench.module.css";
import { CAPACITY_DIMENSIONS, createDefaultSolidCapacityInitial, solidCapacityInitial, solidCapacitySnapshot, solidCapacitySnapshotSchema, type CapacityVesselKind, type SolidCapacityInitial, type SolidCapacitySnapshot } from "./solid-capacity-contract";
import { capacityCenters, equalBaseAndHeight, matchCapacityDimensions, resizeCapacityVessel, transferLiquid, vesselCapacity } from "./solid-capacity";
import { solidCapacityMessages } from "./solid-capacity-messages";
import { useCapacityPresentation } from "./useCapacityPresentation";
import { SolidCapacityLiquids } from "./SolidCapacityLiquids";

const Canvas = dynamic(() => import("../solid-geometry/SolidGeometryCanvas"), { ssr: false, loading: () => <Skeleton className="size-full" /> });
const noop = () => {};
type Panel = "liquid" | "dimensions" | "settings" | null;
export interface SolidCapacityWorkspaceProps {
  initial?: SolidCapacityInitial; onSnapshot?: (initial: SolidCapacityInitial | null) => void; readOnly?: boolean;
  classroom?: { state?: SolidCapacitySnapshot; onChange?: (next: SolidCapacitySnapshot) => Promise<void> };
}
function shells(state: Pick<SolidCapacityInitial, "cone" | "cylinder">, coneAngle: number): SolidEntity[] {
  const centers = capacityCenters(state);
  return (["cone", "cylinder"] as const).map((kind) => {
    const vessel = state[kind], entity = createSolidEntity(kind, `capacity-${kind}`, { x: centers[kind], y: vessel.height / 2, z: 0 });
    return { ...entity, dimensions: { width: vessel.radius * 2, height: vessel.height, depth: vessel.radius * 2, radius: vessel.radius },
      rotation: { x: kind === "cone" ? coneAngle : 0, y: 0, z: 0 }, color: CUBE_COLORS[5], opacity: 0.16 };
  });
}
/** 容积比较单独提供两容器语义，其备课、课堂写者、视角与工作台外观仍走共用能力。 */
export function SolidCapacityWorkspace({ initial, onSnapshot, classroom, readOnly = false }: SolidCapacityWorkspaceProps) {
  const locale = useLocale() === "en" ? "en" : "zh", m = solidCapacityMessages(locale);
  const origin = useMemo(() => solidCapacitySnapshot(initial ?? createDefaultSolidCapacityInitial()), [initial]);
  const host = useToolSnapshot(origin, classroom), snapshot = host.snapshot;
  const presentation = useCapacityPresentation(snapshot);
  const readOnlyView = readOnly || Boolean(classroom && !classroom.onChange);
  const disabled = readOnlyView || host.publishing || presentation.animating;
  const [panel, setPanel] = useState<Panel>(null), [navigation, setNavigation] = useState<"orbit" | "pan">("orbit");
  const [portion, setPortion] = useState<"all" | "halfCone" | "oneCone">("all");
  const axisSnap = useSpatialAxisSnap();
  const entities = useMemo(() => shells(presentation.frame, presentation.frame.coneAngle), [presentation.frame]);
  const targetEntities = useMemo(() => shells(snapshot, snapshot.coneOrientation === "tip-down" ? Math.PI : 0), [snapshot]);
  const frame = useMemo(() => { const fit = getSolidsFrame(targetEntities); return { ...fit, radius: fit.radius * 1.08 }; }, [targetEntities]);
  const state = useMemo(() => ({ ...createSolidGeometryInitial(), entities: targetEntities, selectedId: null, feature: null, axes: snapshot.axes, grid: snapshot.grid, view: snapshot.view }), [targetEntities, snapshot.axes, snapshot.grid, snapshot.view]);
  const captureValue = useMemo(() => solidCapacityInitial(snapshot), [snapshot]);
  const capture = useSceneCapture(disabled ? null : captureValue, onSnapshot);
  const update = useCallback((next: SolidCapacitySnapshot) => {
    if (disabled) return false;
    const parsed = solidCapacitySnapshotSchema.safeParse(next); return parsed.success && host.update(parsed.data);
  }, [disabled, host]);
  const fill = (kind: CapacityVesselKind, value: number) => update({ ...snapshot, [kind]: { ...snapshot[kind], fill: value } });
  const empty = () => update({ ...snapshot, cone: { ...snapshot.cone, fill: 0 }, cylinder: { ...snapshot.cylinder, fill: 0 } });
  const requested = portion === "all" ? Infinity : vesselCapacity(snapshot.cone, "cone") * (portion === "halfCone" ? 0.5 : 1);
  const pour = (kind: CapacityVesselKind) => { const result = transferLiquid(snapshot, kind, requested); if (result.amount > 0) update(result.snapshot); };
  const open = (next: Panel) => setPanel((current) => current === next ? null : next);
  return <section className={styles.workspace} data-workbench-mode="courseware" data-solid-capacity-workspace="v1" aria-label={m.title} {...capture}>
    <div className={styles.viewport}><div className={styles.canvas}>
      <Canvas state={state} entities={entities} selectedId={null} frame={frame} cameraRevision={snapshot.cameraRevision} axisSnap={axisSnap} moveSnap={false}
        navigationMode={navigation} moveAxis="x" onMoveAxis={noop} onMove={noop} onDragging={noop} readOnly={readOnlyView} fallback={m.fallback}
        renderScene={() => <SolidCapacityLiquids frame={presentation.frame} snapshot={snapshot} locale={locale} />} />
      <div className={`${styles.dock} ${styles.meta}`}>
        <CubeIconButton label={m.settings} active={panel === "settings"} disabled={readOnlyView} onClick={() => open("settings")}><Settings2 aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.reset} disabled={disabled} onClick={() => { update({ ...structuredClone(origin), cameraRevision: snapshot.cameraRevision + 1 }); setNavigation("orbit"); setPanel(null); }}><RotateCcw aria-hidden /></CubeIconButton>
      </div>
      <div className={`${styles.dock} ${styles.views}`} aria-label={m.fit}>
        {(["angle", "front", "left", "right", "top", "bottom"] as const).map((view) => <CubeIconButton key={view} label={m.views[view]} active={snapshot.view === view} disabled={disabled}
          onClick={() => update({ ...snapshot, view, cameraRevision: snapshot.cameraRevision + 1 })}><CubeViewIcon view={view} /></CubeIconButton>)}
        <CubeIconButton label={m.fit} disabled={disabled} onClick={() => update({ ...snapshot, cameraRevision: snapshot.cameraRevision + 1 })}><Maximize aria-hidden /></CubeIconButton>
        <SpatialAxisSnapButton messages={m} disabled={readOnlyView} iconOnly className={styles.icon} />
      </div>
      <div className={`${styles.dock} ${styles.tools}`} role="toolbar" aria-label={m.tools} data-capacity-tools-toolbar>
        <CubeIconButton label={m.orbit} active={navigation === "orbit"} disabled={readOnlyView} onClick={() => setNavigation("orbit")}><Orbit aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.pan} active={navigation === "pan"} disabled={readOnlyView} onClick={() => setNavigation("pan")}><Hand aria-hidden /></CubeIconButton>
        <span className={styles.toolSeparator} />
        <CubeIconButton label={m.liquid} active={panel === "liquid"} disabled={readOnlyView} onClick={() => open("liquid")}><Droplets aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.dimensions} active={panel === "dimensions"} disabled={readOnlyView} onClick={() => open("dimensions")}><Ruler aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.numbers} active={snapshot.showAmounts} disabled={disabled} onClick={() => update({ ...snapshot, showAmounts: !snapshot.showAmounts })}><Hash aria-hidden /></CubeIconButton>
        <CubeIconButton label={m.clear} disabled={disabled || (snapshot.cone.fill === 0 && snapshot.cylinder.fill === 0)} onClick={empty}><Eraser aria-hidden /></CubeIconButton>
      </div>
      {panel && <CubeCanvasPanel title={m[panel]} closeLabel={m.close} anchor={panel === "settings" ? "meta" : "tool"} onClose={() => setPanel(null)}>
        <div className="space-y-3 text-xs">
          {panel === "liquid" && <>
            <div className="grid grid-cols-2 gap-1">
              <Button size="sm" variant="secondary" disabled={disabled || snapshot.cone.fill === 1} onClick={() => fill("cone", 1)}>{m.fillCone}</Button>
              <Button size="sm" variant="ghost" disabled={disabled || snapshot.cone.fill === 0} onClick={() => fill("cone", 0)}>{m.emptyCone}</Button>
              <Button size="sm" variant="secondary" disabled={disabled || snapshot.cylinder.fill === 1} onClick={() => fill("cylinder", 1)}>{m.fillCylinder}</Button>
              <Button size="sm" variant="ghost" disabled={disabled || snapshot.cylinder.fill === 0} onClick={() => fill("cylinder", 0)}>{m.emptyCylinder}</Button>
            </div>
            <p className="text-muted">{m.portion}</p><div className="flex flex-wrap gap-1">{(["all", "halfCone", "oneCone"] as const).map((value) => <Button key={value} size="sm" variant={portion === value ? "secondary" : "ghost"} disabled={disabled} onClick={() => setPortion(value)}>{m[value]}</Button>)}</div>
            <div className="flex flex-col gap-1">
              <Button size="sm" variant="secondary" disabled={disabled || snapshot.cone.fill === 0 || snapshot.cylinder.fill === 1} onClick={() => pour("cone")}>{m.pourCone}</Button>
              <Button size="sm" variant="secondary" disabled={disabled || snapshot.cylinder.fill === 0 || snapshot.cone.fill === 1} onClick={() => pour("cylinder")}>{m.pourCylinder}</Button>
            </div><p className="leading-5 text-muted">{m.liquidHint}</p>
          </>}
          {panel === "dimensions" && <>
            <div className="flex flex-wrap gap-1"><Button size="sm" variant={snapshot.linkedDimensions ? "secondary" : "ghost"} disabled={disabled} onClick={() => { if (!snapshot.linkedDimensions) update(matchCapacityDimensions(snapshot)); }}>{m.equalDimensions}</Button>
              <Button size="sm" variant={!snapshot.linkedDimensions ? "secondary" : "ghost"} disabled={disabled} onClick={() => update({ ...snapshot, linkedDimensions: false })}>{m.independent}</Button></div>
            {(snapshot.linkedDimensions ? ["cone"] as const : ["cone", "cylinder"] as const).map((kind) => <div key={kind} className="space-y-2"><p>{snapshot.linkedDimensions ? m.equalDimensions : m[kind]}</p>
              {(["radius", "height"] as const).map((key) => <div key={`${kind}-${key}`} className="flex items-center gap-2"><Label className="w-20 text-xs" htmlFor={`capacity-${kind}-${key}`}>{m[key]}</Label>
                <Input key={snapshot[kind][key]} id={`capacity-${kind}-${key}`} className="h-8 w-24" type="number" min={CAPACITY_DIMENSIONS.min} max={CAPACITY_DIMENSIONS.max} step={0.25} defaultValue={snapshot[kind][key]} disabled={disabled}
                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={(event) => { const value = Number(event.currentTarget.value);
                    if (event.currentTarget.value.trim() && Number.isFinite(value) && value >= CAPACITY_DIMENSIONS.min && value <= CAPACITY_DIMENSIONS.max) { if (value !== snapshot[kind][key]) update(resizeCapacityVessel(snapshot, kind, key, value)); }
                    else event.currentTarget.value = String(snapshot[kind][key]); }} />
              </div>)}
            </div>)}<p className="leading-5 text-muted">{m.dimensionHint}</p>
          </>}
          {panel === "settings" && <>
            <div className="flex flex-wrap gap-1">{(["tip-down", "tip-up"] as const).map((orientation) => <Button key={orientation} size="sm" variant={snapshot.coneOrientation === orientation ? "secondary" : "ghost"} disabled={disabled}
              onClick={() => { if (snapshot.coneOrientation !== orientation) update({ ...snapshot, coneOrientation: orientation, cone: { ...snapshot.cone, fill: 0 } }); }}>{orientation === "tip-down" ? m.tipDown : m.tipUp}</Button>)}</div>
            <p className="leading-5 text-muted">{m.orientationHint}</p>
            <div className="flex flex-wrap gap-1"><Button size="sm" variant={snapshot.showDimensions ? "secondary" : "ghost"} aria-pressed={snapshot.showDimensions} disabled={disabled} onClick={() => update({ ...snapshot, showDimensions: !snapshot.showDimensions })}><Ruler className="size-4" />{m.dimensionLabels}</Button>
              <Button size="sm" variant={snapshot.axes ? "secondary" : "ghost"} aria-pressed={snapshot.axes} disabled={disabled} onClick={() => update({ ...snapshot, axes: !snapshot.axes })}><Axis3d className="size-4" />{m.axes}</Button>
              <Button size="sm" variant={snapshot.grid ? "secondary" : "ghost"} aria-pressed={snapshot.grid} disabled={disabled} onClick={() => update({ ...snapshot, grid: !snapshot.grid })}><Grid2X2 className="size-4" />{m.grid}</Button></div>
          </>}
        </div>
      </CubeCanvasPanel>}
      {snapshot.showAmounts && <p className={styles.cutStatus}>{equalBaseAndHeight(snapshot) ? m.ratio : m.ratioDifferent}</p>}
      {host.failed && <p role="alert" className={styles.notice}>{m.syncError}</p>}
    </div></div>
  </section>;
}
