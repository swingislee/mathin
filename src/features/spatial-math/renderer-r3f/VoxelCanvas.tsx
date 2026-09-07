"use client";

import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import {
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { voxelKey, type SpatialPageDoc, type SpatialRuntimeState, type VoxelFaceSelection } from "../domain";
import { useVoxelHiddenEdges, type VoxelHiddenEdgeUniforms } from "./useVoxelHiddenEdges";
import { voxelHiddenEdgeShaders } from "./voxel-hidden-edge-shader";
import { VoxelFallback, type VoxelRendererMessages } from "./VoxelFallback";
import { SpatialCameraRig } from "./SpatialCameraRig";
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
  buildVoxelEmphasisFaceGroups,
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
  readonly preserveSelectedColors?: boolean;
  readonly readOnly?: boolean;
  readonly axisSnapEnabled?: boolean;
  /** 编辑预览允许本地观察，模型选择与课堂只读合同保持独立。 */
  readonly cameraInteractive?: boolean;
  readonly navigationMode?: "orbit" | "pan";
  readonly cameraRequestKey?: string | number;
  readonly onCellSelect?: (cellKey: string) => void;
  readonly paintedFaces?: readonly VoxelFaceSelection[];
  readonly paintedFaceMaterialToken?: string;
  readonly onFaceSelect?: (face: VoxelFaceSelection) => void;
  readonly onFaceHover?: (face: VoxelFaceSelection | null) => void;
  readonly paintedFaceGroups?: readonly { readonly color: string; readonly faces: readonly VoxelFaceSelection[] }[];
  readonly sceneOverlay?: ReactNode;
  readonly hiddenEdgesVisible?: boolean;
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

function VoxelInstances({
  model,
  palette,
  readOnly,
  materialColors,
  onCellSelect,
  onFaceSelect,
  onFaceHover,
  preserveSelectedColors,
}: {
  readonly model: VoxelRenderModel;
  readonly palette: VoxelPalette;
  readonly readOnly: boolean;
  readonly materialColors?: Readonly<Record<string, string>>;
  readonly onCellSelect?: (cellKey: string) => void;
  readonly onFaceSelect?: (face: VoxelFaceSelection) => void;
  readonly onFaceHover?: (face: VoxelFaceSelection | null) => void;
  readonly preserveSelectedColors?: boolean;
}) {
  const groups = useMemo(() => {
    const grouped = new Map<string, Array<VoxelRenderModel["cells"][number]>>();
    for (const cell of model.cells) {
      if ((cell.opacity ?? 1) < 1) continue;
      const color = cell.selected && !preserveSelectedColors
        ? palette.moon
        : materialColors?.[cell.materialToken] ?? palette.leaf;
      const cells = grouped.get(color);
      if (cells) cells.push(cell);
      else grouped.set(color, [cell]);
    }
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [materialColors, model.cells, palette.leaf, palette.moon, preserveSelectedColors]);
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
          onFaceHover={onFaceHover}
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
  onFaceHover,
}: {
  readonly cells: VoxelRenderModel["cells"];
  readonly color: string;
  readonly readOnly: boolean;
  readonly onCellSelect?: (cellKey: string) => void;
  readonly onFaceSelect?: (face: VoxelFaceSelection) => void;
  readonly onFaceHover?: (face: VoxelFaceSelection | null) => void;
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
    if (readOnly || event.delta > 5 || event.instanceId === undefined) return;
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
  const hover = (event: ThreeEvent<PointerEvent>) => {
    if (readOnly || !onFaceHover || event.instanceId === undefined || !event.face) return;
    const cell = cells[event.instanceId];
    const direction = voxelFaceDirectionFromNormal(event.face.normal);
    if (!cell || !direction) return;
    event.stopPropagation();
    onFaceHover({ cell: { x: cell.x, y: cell.y, z: cell.z }, direction });
  };
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, cells.length]} onClick={select}
      onPointerMove={hover} onPointerOut={() => onFaceHover?.(null)}>
      <boxGeometry args={[VOXEL_SOLID_SIZE, VOXEL_SOLID_SIZE, VOXEL_SOLID_SIZE]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </instancedMesh>
  );
}

function VoxelPaintFaceInstances({
  model,
  faces,
  color,
  highlight = false,
  opacity = 1,
}: {
  readonly model: VoxelRenderModel;
  readonly faces: readonly VoxelFaceSelection[];
  readonly color: string;
  readonly highlight?: boolean;
  readonly opacity?: number;
}) {
  const instances = useMemo(() => buildVoxelPaintFaceInstances(model.cells.filter((cell) => (cell.opacity ?? 1) === 1), faces, highlight ? 0.503 : undefined), [faces, model.cells, highlight]);
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
    <group renderOrder={highlight ? 3 : 1}>
      {groups.map(([direction, directionInstances]) => (
        <VoxelPaintFaceDirectionInstances
          key={direction}
          instances={directionInstances}
          color={color}
          highlight={highlight}
          opacity={opacity}
        />
      ))}
    </group>
  );
}

function VoxelPaintFaceDirectionInstances({
  instances,
  color,
  highlight = false,
  opacity = 1,
}: {
  readonly instances: readonly ReturnType<typeof buildVoxelPaintFaceInstances>[number][];
  readonly color: string;
  readonly highlight?: boolean;
  readonly opacity?: number;
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
        transparent={highlight}
        opacity={opacity}
        depthWrite={!highlight}
        polygonOffset
        polygonOffsetFactor={highlight ? -2 : -1}
      />
    </instancedMesh>
  );
}

function applyEdgeMatrices(
  mesh: THREE.InstancedMesh | null,
  instances: readonly VoxelEdgeInstance[],
  matrix: THREE.Matrix4,
  color: THREE.Color,
) {
  if (!mesh) return;
  instances.forEach((edge, index) => {
    matrix.makeScale(edge.scale.x, edge.scale.y, edge.scale.z);
    matrix.setPosition(edge.center.x, edge.center.y, edge.center.z);
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, color.set(edge.color ?? VOXEL_EDGE_COLOR));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
}

function VoxelEdgeInstances({ model, hiddenEdgeUniforms }: { readonly model: VoxelRenderModel; readonly hiddenEdgeUniforms: VoxelHiddenEdgeUniforms | null }) {
  const xEdges = useRef<THREE.InstancedMesh>(null);
  const yEdges = useRef<THREE.InstancedMesh>(null);
  const zEdges = useRef<THREE.InstancedMesh>(null);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const groups = useMemo(() => buildVoxelEdgeInstances(model.cells), [model.cells]);
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    applyEdgeMatrices(xEdges.current, groups.x, matrix, color);
    applyEdgeMatrices(yEdges.current, groups.y, matrix, color);
    applyEdgeMatrices(zEdges.current, groups.z, matrix, color);
    invalidate();
  }, [groups, invalidate, matrix, color]);
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
          <meshBasicMaterial key={hiddenEdgeUniforms ? "dashed" : "solid"} color="#ffffff" toneMapped={false}
            customProgramCacheKey={() => `voxel-edges-${hiddenEdgeUniforms ? axis : "solid"}`}
            onBeforeCompile={(shader) => {
              if (!hiddenEdgeUniforms) return;
              Object.assign(shader.uniforms, hiddenEdgeUniforms);
              Object.assign(shader, voxelHiddenEdgeShaders(shader.vertexShader, shader.fragmentShader, axis));
            }} />
        </instancedMesh>
      ))}
    </group>
  );
}

/** 半透明块各自保留对象中心，使 Three 按真实深度排序；面染色与底色使用同一透明度。 */
function VoxelTranslucentCube({ cell, color, paint, readOnly, onFaceSelect, onFaceHover, onCellSelect }: {
  readonly cell: VoxelRenderModel["cells"][number]; readonly color: string;
  readonly paint: Partial<Record<VoxelFaceSelection["direction"], string>>;
  readonly readOnly: boolean; readonly onFaceSelect?: VoxelCanvasProps["onFaceSelect"];
  readonly onFaceHover?: VoxelCanvasProps["onFaceHover"]; readonly onCellSelect?: VoxelCanvasProps["onCellSelect"];
}) {
  const faceColors = useMemo(() => (["x+", "x-", "y+", "y-", "z+", "z-"] as const).map((direction) => {
    const base = new THREE.Color(paint[direction] ?? color);
    return cell.emphasis ? base.lerp(new THREE.Color(cell.emphasis.color), cell.emphasis.faceOpacity) : base;
  }), [cell.emphasis, color, paint]);
  return <mesh position={[cell.x, cell.y, cell.z]}
    onClick={(event) => {
      if (readOnly || event.delta > 5) return;
      const direction = event.face && voxelFaceDirectionFromNormal(event.face.normal);
      if (direction && onFaceSelect) { event.stopPropagation(); onFaceSelect({ cell, direction }); }
      else if (onCellSelect) { event.stopPropagation(); onCellSelect(cell.key); }
    }}
    onPointerMove={(event) => {
      const direction = event.face && voxelFaceDirectionFromNormal(event.face.normal);
      if (!readOnly && direction && onFaceHover) { event.stopPropagation(); onFaceHover({ cell, direction }); }
    }} onPointerOut={() => onFaceHover?.(null)}>
    <boxGeometry args={[VOXEL_SOLID_SIZE, VOXEL_SOLID_SIZE, VOXEL_SOLID_SIZE]} />
    {faceColors.map((faceColor, index) => <meshBasicMaterial key={index} attach={`material-${index}`} color={faceColor} opacity={cell.opacity} transparent depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />)}
  </mesh>;
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
  onFaceHover,
  paintedFaceGroups,
  sceneOverlay,
  hiddenEdgesVisible,
  preserveSelectedColors,
  axisSnapEnabled,
  navigationMode,
  cameraInteractive,
  cameraRequestKey,
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
  readonly onFaceHover?: (face: VoxelFaceSelection | null) => void;
  readonly paintedFaceGroups?: VoxelCanvasProps["paintedFaceGroups"];
  readonly sceneOverlay?: ReactNode;
  readonly hiddenEdgesVisible?: boolean;
  readonly preserveSelectedColors?: boolean;
  readonly axisSnapEnabled: boolean;
  readonly navigationMode?: "orbit" | "pan";
  readonly cameraInteractive: boolean;
  readonly cameraRequestKey: string;
  readonly onCameraTransitionStateChange: (active: boolean) => void;
}) {
  const emphasisFaces = useMemo(() => buildVoxelEmphasisFaceGroups(model.cells), [model.cells]);
  const hiddenEdgeUniforms = useVoxelHiddenEdges(model.cells, Boolean(hiddenEdgesVisible && model.cells.some((cell) => (cell.opacity ?? 1) < 1)));
  const paintByCell = useMemo(() => {
    const result = new Map<string, Partial<Record<VoxelFaceSelection["direction"], string>>>();
    for (const group of [{ color: paintedFaceColor, faces: paintedFaces }, ...(paintedFaceGroups ?? [])]) {
      for (const face of group.faces) {
        const key = voxelKey(face.cell);
        result.set(key, { ...result.get(key), [face.direction]: group.color });
      }
    }
    return result;
  }, [paintedFaceColor, paintedFaces, paintedFaceGroups]);
  return (
    <>
      <color attach="background" args={[model.background === "night" ? palette.workspacePanel : palette.paper]} />
      <SpatialCameraRig
        bookmark={model.camera}
        radius={model.bounds.radius}
        interactive={cameraInteractive}
        navigationMode={navigationMode}
        requestKey={cameraRequestKey}
        axisSnapEnabled={axisSnapEnabled}
        onTransitionStateChange={onCameraTransitionStateChange}
      />
      <VoxelInstances model={model} palette={palette} readOnly={readOnly} materialColors={materialColors} onCellSelect={onCellSelect} onFaceSelect={onFaceSelect} onFaceHover={onFaceHover} preserveSelectedColors={preserveSelectedColors} />
      {model.cells.filter((cell) => (cell.opacity ?? 1) < 1).map((cell) => <VoxelTranslucentCube key={cell.key} cell={cell}
        color={cell.selected && !preserveSelectedColors ? palette.moon : materialColors?.[cell.materialToken] ?? palette.leaf}
        paint={paintByCell.get(voxelKey(cell)) ?? {}} readOnly={readOnly} onFaceSelect={onFaceSelect} onFaceHover={onFaceHover} onCellSelect={onCellSelect} />)}
      <VoxelPaintFaceInstances model={model} faces={paintedFaces} color={paintedFaceColor} />
      {paintedFaceGroups?.map((group) => <VoxelPaintFaceInstances key={group.color} model={model} faces={group.faces} color={group.color} />)}
      <VoxelEdgeInstances model={model} hiddenEdgeUniforms={hiddenEdgeUniforms} />
      {emphasisFaces.map((group) => <VoxelPaintFaceInstances key={group.color + ":" + group.opacity} model={model} faces={group.faces} color={group.color} opacity={group.opacity} highlight />)}
      {model.showAxes ? <axesHelper args={[Math.max(2, model.bounds.radius * 1.5)]} /> : null}
      {sceneOverlay}
    </>
  );
}

export function VoxelCanvas({
  page,
  state,
  entityId,
  locale,
  selectedCellKeys = [],
  ...props
}: VoxelCanvasProps) {
  const model = useMemo(
    () => buildVoxelRenderModel(page, state, entityId, locale, selectedCellKeys),
    [entityId, locale, page, selectedCellKeys, state],
  );
  return <VoxelModelCanvas {...props} model={model} cameraRequestKey={`${state.resetEpoch}:${props.cameraRequestKey ?? 0}`} />;
}

export type VoxelModelCanvasProps = Omit<VoxelCanvasProps, "page" | "state" | "entityId" | "locale" | "selectedCellKeys"> & {
  readonly model: VoxelRenderModel;
};

/** 工作台与冻结课件共用同一画布和相机；各自的版本化状态在渲染模型处适配。 */
export function VoxelModelCanvas({
  model,
  readOnly = false,
  axisSnapEnabled = false,
  cameraInteractive = !readOnly,
  navigationMode = "orbit",
  cameraRequestKey,
  onCellSelect,
  paintedFaces = [],
  paintedFaceMaterialToken = "voxel.paint",
  onFaceSelect,
  onFaceHover,
  paintedFaceGroups,
  sceneOverlay,
  hiddenEdgesVisible,
  preserveSelectedColors,
  messages,
  materialColors,
}: VoxelModelCanvasProps) {
  const palette = useVoxelPalette();
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
      data-camera-controls="orbit"
      data-camera-transition="orbit-ease-in-out"
      data-camera-transition-state="idle"
      data-camera-axis-snap={axisSnapEnabled ? "enabled" : "disabled"}
      data-camera-projection="orthographic-only"
      data-voxel-visual="solid-fill-thick-edge"
      data-camera-navigation={navigationMode}
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
        style={{ touchAction: cameraInteractive ? "none" : "pan-x pan-y" }}
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
          onFaceHover={onFaceHover}
          paintedFaceGroups={paintedFaceGroups}
          sceneOverlay={sceneOverlay}
          hiddenEdgesVisible={hiddenEdgesVisible}
          preserveSelectedColors={preserveSelectedColors}
          axisSnapEnabled={axisSnapEnabled}
          cameraInteractive={cameraInteractive}
          navigationMode={navigationMode}
          cameraRequestKey={String(cameraRequestKey ?? 0)}
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
