"use client";

import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  type ComponentRef,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import * as THREE from "three";
import type { SpatialScene } from "../domain";
import { PolyhedronNetFallback } from "./PolyhedronNetFallback";
import {
  POLYHEDRON_FOLD_RENDERER_MAX_DPR,
  POLYHEDRON_FOLD_RENDERER_MAX_TRANSITION_MS,
  createPolyhedronFoldRenderModelResolver,
  isPolyhedronFoldFaceSelectable,
  interpolatePolyhedronFoldProgress,
  matchPolyhedronFoldProjectionValue,
  type PolyhedronFoldEasing,
  type PolyhedronFoldRenderFace,
  type PolyhedronFoldRenderModel,
  type SpatialRendererLocale,
} from "./polyhedron-fold-render-model";
import {
  VOXEL_CAMERA_TRANSITION_MS,
  interpolateVoxelCameraPose,
  voxelCameraTransitionProgress,
  type VoxelCameraPose,
} from "./voxel-camera-transition";

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
  readonly selectableFaceIds?: readonly string[];
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
  selectable,
  palette,
  materialColors,
  onFaceSelect,
}: {
  readonly face: PolyhedronFoldRenderFace;
  readonly selectable: boolean;
  readonly palette: SpatialRendererPalette;
  readonly materialColors?: Readonly<Record<string, string>>;
  readonly onFaceSelect?: (faceId: string) => void;
}) {
  const faceMesh = useRef<THREE.Mesh>(null);
  const faceGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(face.trianglePositions, 3));
    geometry.computeVertexNormals();
    return geometry;
  }, [face.trianglePositions]);
  useEffect(
    () => () => {
      faceGeometry.dispose();
    },
    [faceGeometry],
  );
  const fill = face.colliding
    ? palette.rose
    : face.selected
      ? palette.moon
      : materialColors?.[face.materialToken] ?? palette.leaf;
  const labelBorder = face.colliding || face.selected ? palette.roseDeep : palette.ink;
  const labelPosition = useMemo(() => {
    const first = face.vertices[0]?.position;
    const second = face.vertices[1]?.position;
    const third = face.vertices[2]?.position;
    if (!first || !second || !third) {
      return [face.centroid.x, face.centroid.y, face.centroid.z] as const;
    }
    const firstEdge = new THREE.Vector3(second.x - first.x, second.y - first.y, second.z - first.z);
    const secondEdge = new THREE.Vector3(third.x - first.x, third.y - first.y, third.z - first.z);
    const normal = firstEdge.clone().cross(secondEdge).normalize();
    const offset = Math.max(0.01, firstEdge.length() * 0.02);
    return [
      face.centroid.x + normal.x * offset,
      face.centroid.y + normal.y * offset,
      face.centroid.z + normal.z * offset,
    ] as const;
  }, [face.centroid, face.vertices]);

  return (
    <group>
      <mesh
        ref={faceMesh}
        geometry={faceGeometry}
        onClick={
          !onFaceSelect
            ? undefined
            : (event) => {
                event.stopPropagation();
                if (selectable) onFaceSelect(face.faceId);
              }
        }
      >
        <meshBasicMaterial
          color={fill}
          side={THREE.DoubleSide}
          toneMapped={false}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      <Html
        position={labelPosition}
        center
        occlude={[faceMesh as RefObject<THREE.Object3D>]}
        style={{ pointerEvents: "none" }}
      >
        <span
          className="block min-w-7 whitespace-nowrap rounded-full border px-2 py-1 text-center text-sm font-medium shadow-sm"
          style={{ background: palette.card, borderColor: labelBorder, color: palette.ink }}
        >
          {face.label}
        </span>
      </Html>
    </group>
  );
}

const POLYHEDRON_FOLD_EDGE_HALF_WIDTH_RATIO = 0.018;
const EDGE_AXIS = new THREE.Vector3(0, 1, 0);

/** One low-poly instanced draw keeps ink outlines thick on WebGL implementations that ignore lineWidth. */
function FoldEdges({
  faces,
  color,
}: {
  readonly faces: readonly PolyhedronFoldRenderFace[];
  readonly color: string;
}) {
  const instances = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const edgeSegments = useMemo(
    () => faces.flatMap((face) => {
      const segments: { readonly from: THREE.Vector3; readonly to: THREE.Vector3; readonly length: number }[] = [];
      for (let index = 0; index < face.edgePositions.length; index += 6) {
        const from = new THREE.Vector3(
          face.edgePositions[index] ?? 0,
          face.edgePositions[index + 1] ?? 0,
          face.edgePositions[index + 2] ?? 0,
        );
        const to = new THREE.Vector3(
          face.edgePositions[index + 3] ?? 0,
          face.edgePositions[index + 4] ?? 0,
          face.edgePositions[index + 5] ?? 0,
        );
        const length = from.distanceTo(to);
        if (length > Number.EPSILON) segments.push({ from, to, length });
      }
      return segments;
    }),
    [faces],
  );
  const edgeHalfWidth = useMemo(() => {
    if (edgeSegments.length === 0) return Number.EPSILON;
    return (
      edgeSegments.reduce((sum, segment) => sum + segment.length, 0) /
      edgeSegments.length *
      POLYHEDRON_FOLD_EDGE_HALF_WIDTH_RATIO
    );
  }, [edgeSegments]);

  useLayoutEffect(() => {
    const mesh = instances.current;
    if (!mesh) return;
    const transform = new THREE.Object3D();
    const direction = new THREE.Vector3();
    for (const [index, segment] of edgeSegments.entries()) {
      direction.subVectors(segment.to, segment.from);
      transform.position.addVectors(segment.from, segment.to).multiplyScalar(0.5);
      transform.quaternion.setFromUnitVectors(EDGE_AXIS, direction.normalize());
      transform.scale.set(edgeHalfWidth * 2, segment.length + edgeHalfWidth * 2, edgeHalfWidth * 2);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    invalidate();
  }, [edgeHalfWidth, edgeSegments, invalidate]);

  return (
    <instancedMesh
      ref={instances}
      args={[undefined, undefined, edgeSegments.length]}
      raycast={() => null}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </instancedMesh>
  );
}

type FoldCamera = THREE.OrthographicCamera | THREE.PerspectiveCamera;

interface ActiveCameraTransition {
  readonly camera: FoldCamera;
  readonly from: VoxelCameraPose;
  readonly to: VoxelCameraPose;
  readonly projectionFrom: number;
  readonly projectionTo: number;
  readonly startedAtMs: number;
}

function cameraPose(camera: FoldCamera, target: VoxelCameraPose["target"]): VoxelCameraPose {
  return {
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target,
    up: { x: camera.up.x, y: camera.up.y, z: camera.up.z },
  };
}

function applyCameraPose(
  camera: FoldCamera,
  pose: VoxelCameraPose,
  controls: ComponentRef<typeof OrbitControls> | null,
) {
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  camera.up.set(pose.up.x, pose.up.y, pose.up.z);
  camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
  camera.updateMatrixWorld();
  if (controls) {
    controls.target.set(pose.target.x, pose.target.y, pose.target.z);
    controls.update();
  }
}

function projectionValue(camera: FoldCamera): number {
  return camera instanceof THREE.OrthographicCamera ? camera.zoom : camera.fov;
}

function applyProjectionValue(camera: FoldCamera, value: number) {
  if (camera instanceof THREE.OrthographicCamera) camera.zoom = value;
  else camera.fov = value;
  camera.updateProjectionMatrix();
}

function CameraRig({
  model,
  interactive,
  onTransitionStateChange,
}: {
  readonly model: PolyhedronFoldRenderModel;
  readonly interactive: boolean;
  readonly onTransitionStateChange: (active: boolean) => void;
}) {
  const size = useThree((state) => state.size);
  const renderedCamera = useThree((state) => state.camera);
  const setThree = useThree((state) => state.set);
  const invalidate = useThree((state) => state.invalidate);
  const reducedMotion = useReducedMotion();
  const aspect = size.width / Math.max(size.height, 1);
  const target: [number, number, number] = [model.camera.target.x, model.camera.target.y, model.camera.target.z];
  const halfHeight = model.bounds.radius * 1.35;
  const halfWidth = halfHeight * aspect;
  const halfHeightRef = useRef(halfHeight);
  const orthographicCamera = useRef<THREE.OrthographicCamera>(null);
  const perspectiveCamera = useRef<THREE.PerspectiveCamera>(null);
  if (orthographicCamera.current == null) orthographicCamera.current = new THREE.OrthographicCamera();
  if (perspectiveCamera.current == null) perspectiveCamera.current = new THREE.PerspectiveCamera();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const activeCamera = useRef<FoldCamera | null>(null);
  const currentTarget = useRef<VoxelCameraPose["target"]>({ x: target[0], y: target[1], z: target[2] });
  const transition = useRef<ActiveCameraTransition | null>(null);
  const targetPose = useMemo<VoxelCameraPose>(() => ({
    position: {
      x: model.camera.position.x,
      y: model.camera.position.y,
      z: model.camera.position.z,
    },
    target: {
      x: model.camera.target.x,
      y: model.camera.target.y,
      z: model.camera.target.z,
    },
    up: {
      x: model.camera.up.x,
      y: model.camera.up.y,
      z: model.camera.up.z,
    },
  }), [
    model.camera.position.x,
    model.camera.position.y,
    model.camera.position.z,
    model.camera.target.x,
    model.camera.target.y,
    model.camera.target.z,
    model.camera.up.x,
    model.camera.up.y,
    model.camera.up.z,
  ]);
  const projectionTarget = model.camera.projection === "orthographic"
    ? model.camera.zoom
    : model.camera.fovDegrees;

  useLayoutEffect(() => {
    halfHeightRef.current = halfHeight;
    const orthographic = orthographicCamera.current!;
    const perspective = perspectiveCamera.current!;
    orthographic.left = -halfWidth;
    orthographic.right = halfWidth;
    orthographic.top = halfHeight;
    orthographic.bottom = -halfHeight;
    orthographic.near = 0.01;
    orthographic.far = Math.max(1_000, model.bounds.radius * 100);
    orthographic.updateProjectionMatrix();
    perspective.aspect = aspect;
    perspective.near = 0.01;
    perspective.far = Math.max(1_000, model.bounds.radius * 100);
    perspective.updateProjectionMatrix();
  }, [aspect, halfHeight, halfWidth, model.bounds.radius]);

  useLayoutEffect(() => {
    const nextCamera = model.camera.projection === "orthographic"
      ? orthographicCamera.current!
      : perspectiveCamera.current!;
    const previousCamera = activeCamera.current;
    const projectionTo = projectionTarget;
    const liveControlsTarget = controls.current
      ? {
          x: controls.current.target.x,
          y: controls.current.target.y,
          z: controls.current.target.z,
        }
      : currentTarget.current;
    currentTarget.current = liveControlsTarget;
    if (!previousCamera) {
      activeCamera.current = nextCamera;
      currentTarget.current = targetPose.target;
      applyProjectionValue(nextCamera, projectionTo);
      applyCameraPose(nextCamera, targetPose, controls.current);
      setThree({ camera: nextCamera });
      onTransitionStateChange(false);
      invalidate();
      return;
    }

    if (previousCamera !== nextCamera) {
      nextCamera.position.copy(previousCamera.position);
      nextCamera.quaternion.copy(previousCamera.quaternion);
      nextCamera.up.copy(previousCamera.up);
      const currentDistance = previousCamera.position.distanceTo(
        new THREE.Vector3(liveControlsTarget.x, liveControlsTarget.y, liveControlsTarget.z),
      );
      applyProjectionValue(
        nextCamera,
        matchPolyhedronFoldProjectionValue(
          previousCamera instanceof THREE.OrthographicCamera ? "orthographic" : "perspective",
          nextCamera instanceof THREE.OrthographicCamera ? "orthographic" : "perspective",
          projectionValue(previousCamera),
          halfHeightRef.current,
          Math.max(0.01, currentDistance),
        ),
      );
      nextCamera.updateProjectionMatrix();
    }

    activeCamera.current = nextCamera;
    setThree({ camera: nextCamera });
    if (reducedMotion) {
      transition.current = null;
      currentTarget.current = targetPose.target;
      applyProjectionValue(nextCamera, projectionTo);
      applyCameraPose(nextCamera, targetPose, controls.current);
      onTransitionStateChange(false);
      invalidate();
      return;
    }
    transition.current = {
      camera: nextCamera,
      from: cameraPose(nextCamera, liveControlsTarget),
      to: targetPose,
      projectionFrom: projectionValue(nextCamera),
      projectionTo,
      startedAtMs: performance.now(),
    };
    onTransitionStateChange(true);
    invalidate();
  }, [
    invalidate,
    model.camera.id,
    model.camera.projection,
    onTransitionStateChange,
    projectionTarget,
    reducedMotion,
    setThree,
    targetPose,
  ]);

  useFrame(() => {
    const activeTransition = transition.current;
    if (!activeTransition) return;
    const progress = voxelCameraTransitionProgress(
      Math.max(0, performance.now() - activeTransition.startedAtMs),
      VOXEL_CAMERA_TRANSITION_MS,
    );
    const pose = interpolateVoxelCameraPose(activeTransition.from, activeTransition.to, progress);
    currentTarget.current = pose.target;
    applyProjectionValue(
      activeTransition.camera,
      THREE.MathUtils.lerp(activeTransition.projectionFrom, activeTransition.projectionTo, progress),
    );
    applyCameraPose(activeTransition.camera, pose, controls.current);
    if (progress === 1) {
      transition.current = null;
      onTransitionStateChange(false);
    } else invalidate();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      camera={renderedCamera}
      enablePan={interactive}
      enableRotate={interactive}
      enableZoom={interactive}
      enableDamping={false}
      minDistance={0.1}
      maxDistance={Math.max(20, model.bounds.radius * 20)}
      onStart={() => {
        transition.current = null;
        onTransitionStateChange(false);
        if (controls.current) {
          currentTarget.current = {
            x: controls.current.target.x,
            y: controls.current.target.y,
            z: controls.current.target.z,
          };
        }
      }}
      onEnd={() => {
        if (controls.current) {
          currentTarget.current = {
            x: controls.current.target.x,
            y: controls.current.target.y,
            z: controls.current.target.z,
          };
        }
      }}
    />
  );
}

function FoldScene({
  model,
  palette,
  readOnly,
  selectableFaceIds,
  materialColors,
  onFaceSelect,
  onCameraTransitionStateChange,
}: {
  readonly model: PolyhedronFoldRenderModel;
  readonly palette: SpatialRendererPalette;
  readonly readOnly: boolean;
  readonly selectableFaceIds?: readonly string[];
  readonly materialColors?: Readonly<Record<string, string>>;
  readonly onFaceSelect?: (faceId: string) => void;
  readonly onCameraTransitionStateChange: (active: boolean) => void;
}) {
  const displayOffset: [number, number, number] = [
    model.displayTarget.x - model.bounds.center.x,
    model.displayTarget.y - model.bounds.center.y,
    model.displayTarget.z - model.bounds.center.z,
  ];
  return (
    <>
      <color attach="background" args={[model.background === "night" ? palette.workspacePanel : palette.paper]} />
      <CameraRig
        model={model}
        interactive={!readOnly}
        onTransitionStateChange={onCameraTransitionStateChange}
      />
      <group position={displayOffset}>
        {model.faces.map((face) => (
          <FoldFace
            key={face.faceId}
            face={face}
            selectable={
              !readOnly &&
              Boolean(onFaceSelect) &&
              isPolyhedronFoldFaceSelectable(face.faceId, selectableFaceIds)
            }
            palette={palette}
            materialColors={materialColors}
            onFaceSelect={onFaceSelect}
          />
        ))}
        {model.showEdges ? <FoldEdges faces={model.faces} color={palette.ink} /> : null}
      </group>
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
  selectableFaceIds,
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
  const rendererElement = useRef<HTMLDivElement>(null);
  const invalidateCanvas = useRef<() => void>(() => undefined);
  const setCameraTransitionState = useCallback((active: boolean) => {
    rendererElement.current?.setAttribute("data-camera-transition-state", active ? "active" : "idle");
  }, []);
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
      selectableFaceIds={selectableFaceIds}
      readOnly={readOnly}
      onFaceSelect={onFaceSelect}
      statusMessage={statusMessage}
    />
  );
  if (!palette) return fallback(messages.webglUnavailable);

  return (
    <div
      ref={rendererElement}
      className="relative h-full w-full"
      data-spatial-renderer="polyhedron-fold-r3f-v1"
      data-camera-transition="orbit-ease-in-out"
      data-camera-transition-state="idle"
    >
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
          selectableFaceIds={selectableFaceIds}
          materialColors={materialColors}
          onFaceSelect={onFaceSelect}
          onCameraTransitionStateChange={setCameraTransitionState}
        />
      </Canvas>
      {contextLost ? <div className="absolute inset-0 z-10">{fallback(messages.contextLost)}</div> : null}
    </div>
  );
}
