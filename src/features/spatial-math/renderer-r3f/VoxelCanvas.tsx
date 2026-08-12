"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import {
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentRef,
} from "react";
import * as THREE from "three";
import type { SpatialPageDoc, SpatialRuntimeState, VoxelFaceSelection } from "../domain";
import { VoxelFallback, type VoxelRendererMessages } from "./VoxelFallback";
import {
  VOXEL_AXIS_SNAP_TRANSITION_MS,
  VOXEL_CAMERA_TRANSITION_MS,
  interpolateVoxelCameraPose,
  snapVoxelCameraPoseToPrincipalAxis,
  voxelCameraTransitionProgress,
  type VoxelCameraPose,
} from "./voxel-camera-transition";
import {
  buildVoxelRenderModel,
  VOXEL_RENDERER_MAX_DPR,
  type VoxelRenderModel,
  type VoxelRendererLocale,
} from "./voxel-render-model";
import {
  VOXEL_EDGE_COLOR,
  VOXEL_SOLID_SIZE,
  buildVoxelEdgeInstances,
  buildVoxelPaintFaceInstances,
  voxelFaceDirectionFromNormal,
  type VoxelEdgeInstance,
} from "./voxel-visual-model";

export interface VoxelCanvasProps {
  readonly page: SpatialPageDoc;
  readonly state: SpatialRuntimeState;
  readonly entityId: string;
  readonly locale: VoxelRendererLocale;
  readonly selectedCellKeys?: readonly string[];
  readonly readOnly?: boolean;
  readonly axisSnapEnabled?: boolean;
  readonly onCellSelect?: (cellKey: string) => void;
  readonly paintedFaces?: readonly VoxelFaceSelection[];
  readonly paintedFaceMaterialToken?: string;
  readonly onFaceSelect?: (face: VoxelFaceSelection) => void;
  readonly messages: VoxelRendererMessages;
  readonly materialColors?: Readonly<Record<string, string>>;
}

interface VoxelPalette {
  readonly paper: string;
  readonly leaf: string;
  readonly moon: string;
  readonly rose: string;
  readonly workspacePanel: string;
}

function readPalette(): VoxelPalette {
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.documentElement.appendChild(probe);
  const read = (name: string) => {
    probe.style.color = `var(${name})`;
    return getComputedStyle(probe).color;
  };
  const palette = {
    paper: read("--paper"),
    leaf: read("--leaf"),
    moon: read("--moon"),
    rose: read("--rose"),
    workspacePanel: read("--ws-panel"),
  };
  probe.remove();
  return palette;
}

function useVoxelPalette(): VoxelPalette | null {
  const [palette, setPalette] = useState<VoxelPalette | null>(null);
  useEffect(() => {
    const update = () => setPalette(readPalette());
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

type VoxelCamera = THREE.OrthographicCamera | THREE.PerspectiveCamera;

interface ActiveCameraTransition {
  readonly camera: VoxelCamera;
  readonly from: VoxelCameraPose;
  readonly to: VoxelCameraPose;
  readonly projectionFrom: number;
  readonly projectionTo: number;
  readonly startedAtMs: number;
  readonly durationMs: number;
}

function cameraPose(camera: VoxelCamera, target: VoxelCameraPose["target"]): VoxelCameraPose {
  return {
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target,
    up: { x: camera.up.x, y: camera.up.y, z: camera.up.z },
  };
}

function applyCameraPose(
  camera: VoxelCamera,
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

function projectionValue(camera: VoxelCamera): number {
  return camera instanceof THREE.OrthographicCamera ? camera.zoom : camera.fov;
}

function applyProjectionValue(camera: VoxelCamera, value: number) {
  if (camera instanceof THREE.OrthographicCamera) camera.zoom = value;
  else camera.fov = value;
  camera.updateProjectionMatrix();
}

function VoxelCameraRig({
  model,
  interactive,
  axisSnapEnabled,
  onTransitionStateChange,
}: {
  readonly model: VoxelRenderModel;
  readonly interactive: boolean;
  readonly axisSnapEnabled: boolean;
  readonly onTransitionStateChange: (active: boolean) => void;
}) {
  const size = useThree((state) => state.size);
  const renderedCamera = useThree((state) => state.camera);
  const setThree = useThree((state) => state.set);
  const invalidate = useThree((state) => state.invalidate);
  const reducedMotion = useReducedMotion();
  const aspect = size.width / Math.max(1, size.height);
  const halfHeight = model.bounds.radius * 1.35;
  const halfWidth = halfHeight * aspect;
  const orthographicCamera = useRef<THREE.OrthographicCamera>(null);
  const perspectiveCamera = useRef<THREE.PerspectiveCamera>(null);
  if (orthographicCamera.current == null) {
    orthographicCamera.current = new THREE.OrthographicCamera();
  }
  if (perspectiveCamera.current == null) {
    perspectiveCamera.current = new THREE.PerspectiveCamera();
  }
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const activeCamera = useRef<VoxelCamera | null>(null);
  const currentTarget = useRef<VoxelCameraPose["target"]>({
    x: model.camera.target.x,
    y: model.camera.target.y,
    z: model.camera.target.z,
  });
  const transition = useRef<ActiveCameraTransition | null>(null);
  const targetPose = useMemo<VoxelCameraPose>(() => ({
    position: model.camera.position,
    target: model.camera.target,
    up: model.camera.up,
  }), [model.camera.position, model.camera.target, model.camera.up]);

  useLayoutEffect(() => {
    const orthographic = orthographicCamera.current!;
    const perspective = perspectiveCamera.current!;
    orthographic.left = -halfWidth;
    orthographic.right = halfWidth;
    orthographic.top = halfHeight;
    orthographic.bottom = -halfHeight;
    orthographic.near = 0.01;
    orthographic.far = 1_000;
    orthographic.updateProjectionMatrix();
    perspective.aspect = aspect;
    perspective.near = 0.01;
    perspective.far = 1_000;
    perspective.updateProjectionMatrix();
  }, [aspect, halfHeight, halfWidth]);

  useLayoutEffect(() => {
    const nextCamera = model.camera.projection === "orthographic"
      ? orthographicCamera.current!
      : perspectiveCamera.current!;
    const previousCamera = activeCamera.current;
    if (!previousCamera) {
      activeCamera.current = nextCamera;
      currentTarget.current = targetPose.target;
      applyProjectionValue(
        nextCamera,
        nextCamera instanceof THREE.OrthographicCamera ? model.camera.zoom : model.camera.fovDegrees,
      );
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
        new THREE.Vector3(currentTarget.current.x, currentTarget.current.y, currentTarget.current.z),
      );
      if (nextCamera instanceof THREE.OrthographicCamera) {
        const previousHalfHeight = previousCamera instanceof THREE.PerspectiveCamera
          ? Math.tan(THREE.MathUtils.degToRad(previousCamera.fov / 2)) * currentDistance
          : halfHeight / previousCamera.zoom;
        nextCamera.zoom = halfHeight / Math.max(0.01, previousHalfHeight);
      } else {
        const previousHalfHeight = previousCamera instanceof THREE.OrthographicCamera
          ? halfHeight / previousCamera.zoom
          : Math.tan(THREE.MathUtils.degToRad(previousCamera.fov / 2)) * currentDistance;
        nextCamera.fov = THREE.MathUtils.radToDeg(
          2 * Math.atan(previousHalfHeight / Math.max(0.01, currentDistance)),
        );
      }
      nextCamera.updateProjectionMatrix();
    }

    activeCamera.current = nextCamera;
    setThree({ camera: nextCamera });
    const projectionTo = nextCamera instanceof THREE.OrthographicCamera
      ? model.camera.zoom
      : model.camera.fovDegrees;
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
      from: cameraPose(nextCamera, currentTarget.current),
      to: targetPose,
      projectionFrom: projectionValue(nextCamera),
      projectionTo,
      startedAtMs: performance.now(),
      durationMs: VOXEL_CAMERA_TRANSITION_MS,
    };
    onTransitionStateChange(true);
    invalidate();
  }, [
    halfHeight,
    invalidate,
    model.camera.fovDegrees,
    model.camera.id,
    model.camera.projection,
    model.camera.zoom,
    onTransitionStateChange,
    reducedMotion,
    setThree,
    targetPose,
  ]);

  useFrame(() => {
    const activeTransition = transition.current;
    if (!activeTransition) return;
    const progress = voxelCameraTransitionProgress(
      Math.max(0, performance.now() - activeTransition.startedAtMs),
      activeTransition.durationMs,
    );
    const pose = interpolateVoxelCameraPose(
      activeTransition.from,
      activeTransition.to,
      progress,
    );
    currentTarget.current = pose.target;
    applyProjectionValue(
      activeTransition.camera,
      THREE.MathUtils.lerp(
        activeTransition.projectionFrom,
        activeTransition.projectionTo,
        progress,
      ),
    );
    applyCameraPose(activeTransition.camera, pose, controls.current);
    if (progress === 1) {
      transition.current = null;
      onTransitionStateChange(false);
    }
    else invalidate();
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
        if (!axisSnapEnabled) return;
        const camera = activeCamera.current;
        const orbitControls = controls.current;
        if (!camera || !orbitControls) return;
        const target = {
          x: orbitControls.target.x,
          y: orbitControls.target.y,
          z: orbitControls.target.z,
        };
        currentTarget.current = target;
        const snappedPose = snapVoxelCameraPoseToPrincipalAxis(cameraPose(camera, target));
        if (!snappedPose) return;
        if (reducedMotion) {
          applyCameraPose(camera, snappedPose, orbitControls);
          onTransitionStateChange(false);
          invalidate();
          return;
        }
        transition.current = {
          camera,
          from: cameraPose(camera, target),
          to: snappedPose,
          projectionFrom: projectionValue(camera),
          projectionTo: projectionValue(camera),
          startedAtMs: performance.now(),
          durationMs: VOXEL_AXIS_SNAP_TRANSITION_MS,
        };
        onTransitionStateChange(true);
        invalidate();
      }}
    />
  );
}

function VoxelInstances({
  model,
  palette,
  readOnly,
  materialColors,
  onCellSelect,
  onFaceSelect,
}: {
  readonly model: VoxelRenderModel;
  readonly palette: VoxelPalette;
  readonly readOnly: boolean;
  readonly materialColors?: Readonly<Record<string, string>>;
  readonly onCellSelect?: (cellKey: string) => void;
  readonly onFaceSelect?: (face: VoxelFaceSelection) => void;
}) {
  const groups = useMemo(() => {
    const grouped = new Map<string, Array<VoxelRenderModel["cells"][number]>>();
    for (const cell of model.cells) {
      const color = cell.selected
        ? palette.moon
        : materialColors?.[cell.materialToken] ?? palette.leaf;
      const cells = grouped.get(color);
      if (cells) cells.push(cell);
      else grouped.set(color, [cell]);
    }
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [materialColors, model.cells, palette.leaf, palette.moon]);
  if (model.cells.length === 0) return null;
  return (
    <group>
      {groups.map(([color, cells]) => (
        <VoxelMaterialInstances
          key={color}
          cells={cells}
          color={color}
          readOnly={readOnly}
          onCellSelect={onCellSelect}
          onFaceSelect={onFaceSelect}
        />
      ))}
    </group>
  );
}

function VoxelMaterialInstances({
  cells,
  color,
  readOnly,
  onCellSelect,
  onFaceSelect,
}: {
  readonly cells: VoxelRenderModel["cells"];
  readonly color: string;
  readonly readOnly: boolean;
  readonly onCellSelect?: (cellKey: string) => void;
  readonly onFaceSelect?: (face: VoxelFaceSelection) => void;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    cells.forEach((cell, index) => {
      matrix.makeTranslation(cell.x, cell.y, cell.z);
      mesh.current?.setMatrixAt(index, matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingBox();
    mesh.current.computeBoundingSphere();
    invalidate();
  }, [cells, invalidate, matrix]);
  const select = (event: ThreeEvent<MouseEvent>) => {
    if (readOnly || event.instanceId === undefined) return;
    const cell = cells[event.instanceId];
    if (!cell) return;
    if (onFaceSelect && event.face) {
      const direction = voxelFaceDirectionFromNormal(event.face.normal);
      if (!direction) return;
      event.stopPropagation();
      onFaceSelect({ cell: { x: cell.x, y: cell.y, z: cell.z }, direction });
      return;
    }
    if (!onCellSelect) return;
    event.stopPropagation();
    onCellSelect(cell.key);
  };
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, cells.length]} onClick={select}>
      <boxGeometry args={[VOXEL_SOLID_SIZE, VOXEL_SOLID_SIZE, VOXEL_SOLID_SIZE]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </instancedMesh>
  );
}

function VoxelPaintFaceInstances({
  model,
  faces,
  color,
}: {
  readonly model: VoxelRenderModel;
  readonly faces: readonly VoxelFaceSelection[];
  readonly color: string;
}) {
  const instances = useMemo(() => buildVoxelPaintFaceInstances(model.cells, faces), [faces, model.cells]);
  const groups = useMemo(() => {
    const grouped = new Map<VoxelFaceSelection["direction"], typeof instances>();
    for (const direction of ["x-", "x+", "y-", "y+", "z-", "z+"] as const) {
      const matching = instances.filter((instance) => instance.direction === direction);
      if (matching.length > 0) grouped.set(direction, matching);
    }
    return [...grouped.entries()];
  }, [instances]);
  if (instances.length === 0) return null;
  return (
    <group renderOrder={1}>
      {groups.map(([direction, directionInstances]) => (
        <VoxelPaintFaceDirectionInstances
          key={direction}
          instances={directionInstances}
          color={color}
        />
      ))}
    </group>
  );
}

function VoxelPaintFaceDirectionInstances({
  instances,
  color,
}: {
  readonly instances: readonly ReturnType<typeof buildVoxelPaintFaceInstances>[number][];
  readonly color: string;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const quaternion = useMemo(() => new THREE.Quaternion(), []);
  const euler = useMemo(() => new THREE.Euler(), []);
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    instances.forEach((instance, index) => {
      euler.set(instance.rotation.x, instance.rotation.y, instance.rotation.z);
      quaternion.setFromEuler(euler);
      matrix.compose(
        new THREE.Vector3(instance.center.x, instance.center.y, instance.center.z),
        quaternion,
        new THREE.Vector3(1, 1, 1),
      );
      mesh.current?.setMatrixAt(index, matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingBox();
    mesh.current.computeBoundingSphere();
    invalidate();
  }, [euler, instances, invalidate, matrix, quaternion]);
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, instances.length]} raycast={() => null}>
      <planeGeometry args={[VOXEL_SOLID_SIZE, VOXEL_SOLID_SIZE]} />
      <meshBasicMaterial
        color={color}
        side={THREE.DoubleSide}
        toneMapped={false}
        polygonOffset
        polygonOffsetFactor={-1}
      />
    </instancedMesh>
  );
}

function applyEdgeMatrices(
  mesh: THREE.InstancedMesh | null,
  instances: readonly VoxelEdgeInstance[],
  matrix: THREE.Matrix4,
) {
  if (!mesh) return;
  instances.forEach((edge, index) => {
    matrix.makeScale(edge.scale.x, edge.scale.y, edge.scale.z);
    matrix.setPosition(edge.center.x, edge.center.y, edge.center.z);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
}

function VoxelEdgeInstances({ model }: { readonly model: VoxelRenderModel }) {
  const xEdges = useRef<THREE.InstancedMesh>(null);
  const yEdges = useRef<THREE.InstancedMesh>(null);
  const zEdges = useRef<THREE.InstancedMesh>(null);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const groups = useMemo(() => buildVoxelEdgeInstances(model.cells), [model.cells]);
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    applyEdgeMatrices(xEdges.current, groups.x, matrix);
    applyEdgeMatrices(yEdges.current, groups.y, matrix);
    applyEdgeMatrices(zEdges.current, groups.z, matrix);
    invalidate();
  }, [groups, invalidate, matrix]);
  if (model.cells.length === 0) return null;
  return (
    <group renderOrder={2}>
      {(["x", "y", "z"] as const).map((axis) => (
        <instancedMesh
          key={axis}
          ref={axis === "x" ? xEdges : axis === "y" ? yEdges : zEdges}
          args={[undefined, undefined, groups[axis].length]}
          raycast={() => null}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color={VOXEL_EDGE_COLOR} toneMapped={false} />
        </instancedMesh>
      ))}
    </group>
  );
}

function VoxelScene({
  model,
  palette,
  readOnly,
  materialColors,
  onCellSelect,
  paintedFaces,
  paintedFaceColor,
  onFaceSelect,
  axisSnapEnabled,
  onCameraTransitionStateChange,
}: {
  readonly model: VoxelRenderModel;
  readonly palette: VoxelPalette;
  readonly readOnly: boolean;
  readonly materialColors?: Readonly<Record<string, string>>;
  readonly onCellSelect?: (cellKey: string) => void;
  readonly paintedFaces: readonly VoxelFaceSelection[];
  readonly paintedFaceColor: string;
  readonly onFaceSelect?: (face: VoxelFaceSelection) => void;
  readonly axisSnapEnabled: boolean;
  readonly onCameraTransitionStateChange: (active: boolean) => void;
}) {
  return (
    <>
      <color attach="background" args={[model.background === "night" ? palette.workspacePanel : palette.paper]} />
      <VoxelCameraRig
        model={model}
        interactive={!readOnly}
        axisSnapEnabled={axisSnapEnabled}
        onTransitionStateChange={onCameraTransitionStateChange}
      />
      <VoxelInstances model={model} palette={palette} readOnly={readOnly} materialColors={materialColors} onCellSelect={onCellSelect} onFaceSelect={onFaceSelect} />
      <VoxelPaintFaceInstances model={model} faces={paintedFaces} color={paintedFaceColor} />
      <VoxelEdgeInstances model={model} />
      {model.showAxes ? <axesHelper args={[Math.max(2, model.bounds.radius * 1.5)]} /> : null}
    </>
  );
}

export function VoxelCanvas({
  page,
  state,
  entityId,
  locale,
  selectedCellKeys = [],
  readOnly = false,
  axisSnapEnabled = false,
  onCellSelect,
  paintedFaces = [],
  paintedFaceMaterialToken = "voxel.paint",
  onFaceSelect,
  messages,
  materialColors,
}: VoxelCanvasProps) {
  const palette = useVoxelPalette();
  const model = useMemo(
    () => buildVoxelRenderModel(page, state, entityId, locale, selectedCellKeys),
    [entityId, locale, page, selectedCellKeys, state],
  );
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const rendererElement = useRef<HTMLDivElement>(null);
  const invalidateCanvas = useRef<() => void>(() => undefined);
  const setCameraTransitionState = useCallback((active: boolean) => {
    rendererElement.current?.setAttribute(
      "data-camera-transition-state",
      active ? "active" : "idle",
    );
  }, []);
  useEffect(() => {
    if (!canvasElement) return;
    const lost = (event: Event) => {
      event.preventDefault();
      setContextLost(true);
    };
    const restored = () => {
      setContextLost(false);
      invalidateCanvas.current();
    };
    canvasElement.addEventListener("webglcontextlost", lost);
    canvasElement.addEventListener("webglcontextrestored", restored);
    return () => {
      canvasElement.removeEventListener("webglcontextlost", lost);
      canvasElement.removeEventListener("webglcontextrestored", restored);
    };
  }, [canvasElement]);
  const fallback = (statusMessage: string) => <VoxelFallback model={model} messages={messages} statusMessage={statusMessage} />;
  if (!palette) return fallback(messages.webglUnavailable);
  return (
    <div
      ref={rendererElement}
      className="relative h-full w-full"
      data-spatial-renderer="voxel-instanced-r3f-v1"
      data-camera-transition="orbit-ease-in-out"
      data-camera-transition-state="idle"
      data-camera-axis-snap={axisSnapEnabled ? "enabled" : "disabled"}
      data-camera-projection="orthographic-only"
      data-voxel-visual="solid-fill-thick-edge"
      data-voxel-face-paint={paintedFaces.length}
    >
      <Canvas
        className="!absolute !inset-0"
        dpr={[1, VOXEL_RENDERER_MAX_DPR]}
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
        <VoxelScene
          model={model}
          palette={palette}
          readOnly={readOnly}
          materialColors={materialColors}
          onCellSelect={onCellSelect}
          paintedFaces={paintedFaces}
          paintedFaceColor={materialColors?.[paintedFaceMaterialToken] ?? palette.rose}
          onFaceSelect={onFaceSelect}
          axisSnapEnabled={axisSnapEnabled}
          onCameraTransitionStateChange={setCameraTransitionState}
        />
      </Canvas>
      <div className="sr-only">
        <p>{messages.formatProjection(model.projectionView)}</p>
        <ul>
          {model.projection.cells.map((cell) => (
            <li key={`${cell.u}:${cell.v}`}>
              {messages.formatProjectedCell(cell.u, cell.v, model.projectionDepthRevealed ? cell.stackSize : null)}
            </li>
          ))}
        </ul>
      </div>
      {contextLost ? <div className="absolute inset-0 z-10">{fallback(messages.contextLost)}</div> : null}
    </div>
  );
}
