"use client";

import { Html, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as THREE from "three";
import type { SpatialScene } from "../domain";
import { PolyhedronNetFallback } from "./PolyhedronNetFallback";
import {
  POLYHEDRON_FOLD_RENDERER_MAX_DPR,
  POLYHEDRON_FOLD_RENDERER_MAX_TRANSITION_MS,
  createPolyhedronFoldRenderModelResolver,
  interpolatePolyhedronFoldProgress,
  type PolyhedronFoldEasing,
  type PolyhedronFoldRenderFace,
  type PolyhedronFoldRenderModel,
  type SpatialRendererLocale,
} from "./polyhedron-fold-render-model";

export interface PolyhedronFoldRendererMessages {
  readonly webglUnavailable: string;
  readonly contextLost: string;
}

export interface PolyhedronFoldCanvasProps {
  readonly scene: SpatialScene;
  readonly entityId: string;
  readonly progress: number;
  readonly locale: SpatialRendererLocale;
  readonly cameraId?: string;
  readonly selectedFaceIds?: readonly string[];
  readonly readOnly?: boolean;
  readonly onFaceSelect?: (faceId: string) => void;
  readonly messages: PolyhedronFoldRendererMessages;
  readonly materialColors?: Readonly<Record<string, string>>;
  readonly transition?: {
    readonly durationMs: number;
    readonly easing: PolyhedronFoldEasing;
  };
}

interface SpatialRendererPalette {
  readonly paper: string;
  readonly ink: string;
  readonly card: string;
  readonly leaf: string;
  readonly moon: string;
  readonly crater: string;
  readonly rose: string;
  readonly roseDeep: string;
  readonly workspacePanel: string;
  readonly workspacePanelInk: string;
}

function readSpatialRendererPalette(): SpatialRendererPalette {
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.documentElement.appendChild(probe);
  const read = (name: string) => {
    probe.style.color = `var(${name})`;
    return getComputedStyle(probe).color;
  };
  const palette = {
    paper: read("--paper"),
    ink: read("--ink"),
    card: read("--card"),
    leaf: read("--leaf"),
    moon: read("--moon"),
    crater: read("--crater"),
    rose: read("--rose"),
    roseDeep: read("--rose-deep"),
    workspacePanel: read("--ws-panel"),
    workspacePanelInk: read("--ws-panel-ink"),
  };
  probe.remove();
  return palette;
}

function useSpatialRendererPalette(): SpatialRendererPalette | null {
  const [palette, setPalette] = useState<SpatialRendererPalette | null>(null);
  useEffect(() => {
    const update = () => setPalette(readSpatialRendererPalette());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", update);
    };
  }, []);
  return palette;
}

function subscribeReducedMotion(onChange: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

function useAnimatedFoldProgress(
  target: number,
  transition: PolyhedronFoldCanvasProps["transition"],
): number {
  const reducedMotion = useReducedMotion();
  const [displayed, setDisplayed] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const requestedDurationMs = transition?.durationMs ?? 0;
    const durationMs = Number.isFinite(requestedDurationMs)
      ? Math.min(POLYHEDRON_FOLD_RENDERER_MAX_TRANSITION_MS, Math.max(0, requestedDurationMs))
      : 0;
    if (reducedMotion || durationMs === 0 || current.current === target) {
      current.current = target;
      setDisplayed(target);
      return;
    }
    const from = current.current;
    const startedAt = performance.now();
    let frameId = 0;
    const tick = (now: number) => {
      const next = interpolatePolyhedronFoldProgress(
        from,
        target,
        Math.max(0, now - startedAt),
        durationMs,
        transition?.easing ?? "linear",
      );
      current.current = next;
      setDisplayed(next);
      if (next !== target) frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [reducedMotion, target, transition?.durationMs, transition?.easing]);
  return displayed;
}

function FoldFace({
  face,
  showEdges,
  readOnly,
  palette,
  materialColors,
  onFaceSelect,
}: {
  readonly face: PolyhedronFoldRenderFace;
  readonly showEdges: boolean;
  readonly readOnly: boolean;
  readonly palette: SpatialRendererPalette;
  readonly materialColors?: Readonly<Record<string, string>>;
  readonly onFaceSelect?: (faceId: string) => void;
}) {
  const faceGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(face.trianglePositions, 3));
    geometry.computeVertexNormals();
    return geometry;
  }, [face.trianglePositions]);
  const edgeGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(face.edgePositions, 3));
    return geometry;
  }, [face.edgePositions]);
  useEffect(
    () => () => {
      faceGeometry.dispose();
      edgeGeometry.dispose();
    },
    [edgeGeometry, faceGeometry],
  );
  const fill = face.colliding
    ? palette.rose
    : face.selected
      ? palette.moon
      : materialColors?.[face.materialToken] ?? palette.leaf;
  const edge = face.colliding || face.selected ? palette.roseDeep : palette.crater;

  return (
    <group>
      <mesh
        geometry={faceGeometry}
        onClick={
          readOnly || !onFaceSelect
            ? undefined
            : (event) => {
                event.stopPropagation();
                onFaceSelect(face.faceId);
              }
        }
      >
        <meshStandardMaterial
          color={fill}
          side={THREE.DoubleSide}
          transparent
          opacity={face.selected ? 0.96 : 0.82}
          roughness={0.82}
          metalness={0}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      {showEdges ? (
        <lineSegments geometry={edgeGeometry}>
          <lineBasicMaterial color={edge} linewidth={1} />
        </lineSegments>
      ) : null}
      <Html
        position={[face.centroid.x, face.centroid.y, face.centroid.z]}
        center
        transform
        distanceFactor={6}
        style={{ pointerEvents: "none" }}
      >
        <span
          className="block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs shadow-sm"
          style={{ background: palette.card, borderColor: edge, color: palette.ink }}
        >
          {face.label}
        </span>
      </Html>
    </group>
  );
}

function CameraRig({ model, interactive }: { readonly model: PolyhedronFoldRenderModel; readonly interactive: boolean }) {
  const size = useThree((state) => state.size);
  const aspect = size.width / Math.max(size.height, 1);
  const target: [number, number, number] = [model.camera.target.x, model.camera.target.y, model.camera.target.z];
  const position: [number, number, number] = [model.camera.position.x, model.camera.position.y, model.camera.position.z];
  const up: [number, number, number] = [model.camera.up.x, model.camera.up.y, model.camera.up.z];
  const halfHeight = model.bounds.radius * 1.35;
  const halfWidth = halfHeight * aspect;
  const controls = (
    <OrbitControls
      makeDefault
      target={target}
      enablePan={interactive}
      enableRotate={interactive}
      enableZoom={interactive}
      enableDamping={false}
      minDistance={0.1}
      maxDistance={Math.max(20, model.bounds.radius * 20)}
    />
  );

  if (model.camera.projection === "orthographic") {
    return (
      <>
        <OrthographicCamera
          makeDefault
          position={position}
          up={up}
          left={-halfWidth}
          right={halfWidth}
          top={halfHeight}
          bottom={-halfHeight}
          near={0.01}
          far={Math.max(1_000, model.bounds.radius * 100)}
          zoom={model.camera.zoom}
        />
        {controls}
      </>
    );
  }
  return (
    <>
      <PerspectiveCamera
        makeDefault
        position={position}
        up={up}
        fov={model.camera.fovDegrees}
        near={0.01}
        far={Math.max(1_000, model.bounds.radius * 100)}
      />
      {controls}
    </>
  );
}

function FoldScene({
  model,
  palette,
  readOnly,
  materialColors,
  onFaceSelect,
}: {
  readonly model: PolyhedronFoldRenderModel;
  readonly palette: SpatialRendererPalette;
  readonly readOnly: boolean;
  readonly materialColors?: Readonly<Record<string, string>>;
  readonly onFaceSelect?: (faceId: string) => void;
}) {
  return (
    <>
      <color attach="background" args={[model.background === "night" ? palette.workspacePanel : palette.paper]} />
      <ambientLight intensity={model.lighting === "flat" ? 1.15 : 0.72} />
      <directionalLight position={[5, 8, 6]} intensity={model.lighting === "flat" ? 0.75 : 1.15} />
      <directionalLight position={[-4, 2, -3]} intensity={0.24} />
      <CameraRig model={model} interactive={!readOnly} />
      {model.faces.map((face) => (
        <FoldFace
          key={face.faceId}
          face={face}
          showEdges={model.showEdges}
          readOnly={readOnly}
          palette={palette}
          materialColors={materialColors}
          onFaceSelect={onFaceSelect}
        />
      ))}
    </>
  );
}

export function PolyhedronFoldCanvas({
  scene,
  entityId,
  progress,
  locale,
  cameraId,
  selectedFaceIds = [],
  readOnly = false,
  onFaceSelect,
  messages,
  materialColors,
  transition,
}: PolyhedronFoldCanvasProps) {
  const palette = useSpatialRendererPalette();
  const displayedProgress = useAnimatedFoldProgress(progress, transition);
  const renderModelResolver = useMemo(
    () => createPolyhedronFoldRenderModelResolver(scene, entityId, locale, cameraId),
    [cameraId, entityId, locale, scene],
  );
  const model = useMemo(
    () => renderModelResolver.resolve(displayedProgress, selectedFaceIds),
    [displayedProgress, renderModelResolver, selectedFaceIds],
  );
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const invalidateCanvas = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!canvasElement) return;
    const onLost = (event: Event) => {
      event.preventDefault();
      setContextLost(true);
    };
    const onRestored = () => {
      setContextLost(false);
      invalidateCanvas.current();
    };
    canvasElement.addEventListener("webglcontextlost", onLost);
    canvasElement.addEventListener("webglcontextrestored", onRestored);
    return () => {
      canvasElement.removeEventListener("webglcontextlost", onLost);
      canvasElement.removeEventListener("webglcontextrestored", onRestored);
    };
  }, [canvasElement]);

  const fallback = (statusMessage: string) => (
    <PolyhedronNetFallback
      scene={scene}
      entityId={entityId}
      locale={locale}
      selectedFaceIds={selectedFaceIds}
      readOnly={readOnly}
      onFaceSelect={onFaceSelect}
      statusMessage={statusMessage}
    />
  );
  if (!palette) return fallback(messages.webglUnavailable);

  return (
    <div className="relative h-full w-full" data-spatial-renderer="polyhedron-fold-r3f-v1">
      <Canvas
        className="!absolute !inset-0"
        dpr={[1, POLYHEDRON_FOLD_RENDERER_MAX_DPR]}
        frameloop="demand"
        fallback={fallback(messages.webglUnavailable)}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        onCreated={({ gl, invalidate }) => {
          invalidateCanvas.current = invalidate;
          setCanvasElement(gl.domElement);
        }}
        aria-label={model.label}
        style={{ touchAction: readOnly ? "pan-x pan-y" : "none" }}
      >
        <FoldScene
          model={model}
          palette={palette}
          readOnly={readOnly}
          materialColors={materialColors}
          onFaceSelect={onFaceSelect}
        />
      </Canvas>
      {contextLost ? <div className="absolute inset-0 z-10">{fallback(messages.contextLost)}</div> : null}
    </div>
  );
}
