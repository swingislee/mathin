"use client";

import { OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { SpatialPageDoc, SpatialRuntimeState } from "../domain";
import { VoxelFallback, type VoxelRendererMessages } from "./VoxelFallback";
import {
  buildVoxelRenderModel,
  VOXEL_RENDERER_MAX_DPR,
  type VoxelRenderModel,
  type VoxelRendererLocale,
} from "./voxel-render-model";

export interface VoxelCanvasProps {
  readonly page: SpatialPageDoc;
  readonly state: SpatialRuntimeState;
  readonly entityId: string;
  readonly locale: VoxelRendererLocale;
  readonly selectedCellKeys?: readonly string[];
  readonly readOnly?: boolean;
  readonly onCellSelect?: (cellKey: string) => void;
  readonly messages: VoxelRendererMessages;
  readonly materialColors?: Readonly<Record<string, string>>;
}

interface VoxelPalette {
  readonly paper: string;
  readonly leaf: string;
  readonly moon: string;
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

function VoxelCameraRig({ model, interactive }: { readonly model: VoxelRenderModel; readonly interactive: boolean }) {
  const size = useThree((state) => state.size);
  const aspect = size.width / Math.max(1, size.height);
  const halfHeight = model.bounds.radius * 1.35;
  const halfWidth = halfHeight * aspect;
  const target: [number, number, number] = [model.camera.target.x, model.camera.target.y, model.camera.target.z];
  const position: [number, number, number] = [model.camera.position.x, model.camera.position.y, model.camera.position.z];
  const up: [number, number, number] = [model.camera.up.x, model.camera.up.y, model.camera.up.z];
  const controls = (
    <OrbitControls makeDefault target={target} enablePan={interactive} enableRotate={interactive} enableZoom={interactive} enableDamping={false} />
  );
  if (model.camera.projection === "orthographic") {
    return (
      <>
        <OrthographicCamera makeDefault position={position} up={up} left={-halfWidth} right={halfWidth} top={halfHeight} bottom={-halfHeight} near={0.01} far={1_000} zoom={model.camera.zoom} />
        {controls}
      </>
    );
  }
  return (
    <>
      <PerspectiveCamera makeDefault position={position} up={up} fov={model.camera.fovDegrees} near={0.01} far={1_000} />
      {controls}
    </>
  );
}

function VoxelInstances({
  model,
  palette,
  readOnly,
  materialColors,
  onCellSelect,
}: {
  readonly model: VoxelRenderModel;
  readonly palette: VoxelPalette;
  readonly readOnly: boolean;
  readonly materialColors?: Readonly<Record<string, string>>;
  readonly onCellSelect?: (cellKey: string) => void;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    model.cells.forEach((cell, index) => {
      matrix.makeTranslation(cell.x, cell.y, cell.z);
      mesh.current?.setMatrixAt(index, matrix);
      mesh.current?.setColorAt(
        index,
        new THREE.Color(cell.selected ? palette.moon : materialColors?.[cell.materialToken] ?? palette.leaf),
      );
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
    mesh.current.computeBoundingBox();
    mesh.current.computeBoundingSphere();
    invalidate();
  }, [invalidate, materialColors, matrix, model.cells, palette.leaf, palette.moon]);
  const select = (event: ThreeEvent<MouseEvent>) => {
    if (readOnly || !onCellSelect || event.instanceId === undefined) return;
    const cell = model.cells[event.instanceId];
    if (!cell) return;
    event.stopPropagation();
    onCellSelect(cell.key);
  };
  if (model.cells.length === 0) return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, model.cells.length]} onClick={select}>
      <boxGeometry args={[0.92, 0.92, 0.92]} />
      <meshStandardMaterial vertexColors roughness={0.86} metalness={0} />
    </instancedMesh>
  );
}

function VoxelScene({
  model,
  palette,
  readOnly,
  materialColors,
  onCellSelect,
}: {
  readonly model: VoxelRenderModel;
  readonly palette: VoxelPalette;
  readonly readOnly: boolean;
  readonly materialColors?: Readonly<Record<string, string>>;
  readonly onCellSelect?: (cellKey: string) => void;
}) {
  return (
    <>
      <color attach="background" args={[model.background === "night" ? palette.workspacePanel : palette.paper]} />
      <ambientLight intensity={model.lighting === "flat" ? 1.2 : 0.72} />
      <directionalLight position={[6, 9, 7]} intensity={model.lighting === "flat" ? 0.78 : 1.12} />
      <directionalLight position={[-4, 2, -3]} intensity={0.22} />
      <VoxelCameraRig model={model} interactive={!readOnly} />
      <VoxelInstances model={model} palette={palette} readOnly={readOnly} materialColors={materialColors} onCellSelect={onCellSelect} />
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
  onCellSelect,
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
  const invalidateCanvas = useRef<() => void>(() => undefined);
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
    <div className="relative h-full w-full" data-spatial-renderer="voxel-instanced-r3f-v1">
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
        <VoxelScene model={model} palette={palette} readOnly={readOnly} materialColors={materialColors} onCellSelect={onCellSelect} />
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
