"use client";

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, OrthographicCamera, PerspectiveCamera } from "three";
import { CUBE_COLORS, CUBE_SELECTION_COLOR } from "../spatial-lab/cube-structures-contract";
import { VOXEL_EDGE_COLOR } from "@/features/spatial-math/renderer-r3f/voxel-visual-model";
import type { PlaceValueSpan } from "./radix-contract";
import type { PlaceValueRod } from "./radix-model";
import { placeValueRodSegments } from "./render-plan";
import { PLACE_VALUE_COLOR_GROUP_SIZE, PLACE_VALUE_COLOR_PERIOD } from "./color-policy";

const vertexShader = `varying vec3 p; varying vec3 n;
void main() { p = position; n = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const fragmentShader = `
varying vec3 p; varying vec3 n;
uniform float units; uniform float colorPeriod; uniform float colorGroupSize; uniform float phase; uniform float red; uniform float emphasis; uniform float opacity;
uniform vec3 yellow; uniform vec3 blue; uniform vec3 warning; uniform vec3 edge; uniform vec3 selected;
void main() {
  float depth = clamp(units * .5 - p.z, .0001, units - .0001);
  float pixel = max(fwidth(depth), .00001);
  float blueUnit = step(colorGroupSize, mod(floor(depth) + phase, colorPeriod));
  float detailedColor = 1. - smoothstep(colorPeriod * .4, colorPeriod * 1.5, pixel);
  vec3 face = mix(yellow, blue, mix(.5, blueUnit, detailedColor));
  face = mix(face, warning, red);
  float gridDistance = min(fract(depth), 1. - fract(depth));
  float grid = (1. - smoothstep(.015, .025 + pixel * .5, gridDistance)) * (1. - smoothstep(.3, 1., pixel)) * (1. - abs(n.z));
  float sideEdge = abs(n.x) > .5 ? abs(p.y) : abs(n.y) > .5 ? abs(p.x) : max(abs(p.x), abs(p.y));
  float outline = smoothstep(.47, .49, sideEdge);
  vec3 color = mix(face, mix(edge, selected, emphasis), max(grid, outline));
  gl_FragColor = vec4(color, opacity);
  #include <colorspace_fragment>
}`;
type Segment = ReturnType<typeof placeValueRodSegments>[number];
function RodSegment({ segment, rod, selected, interactive, onSelect }: { segment: Segment; rod: PlaceValueRod; selected: boolean; interactive: boolean; onSelect: (unit: number) => void }) {
  const uniforms = useMemo(() => ({ units: { value: segment.count }, colorPeriod: { value: PLACE_VALUE_COLOR_PERIOD }, colorGroupSize: { value: PLACE_VALUE_COLOR_GROUP_SIZE }, phase: { value: segment.phase }, red: { value: Number(segment.red) }, emphasis: { value: Number(selected) }, opacity: { value: rod.opacity },
    yellow: { value: new Color(CUBE_COLORS[2]) }, blue: { value: new Color(CUBE_COLORS[3]) }, warning: { value: new Color(CUBE_COLORS[1]) }, edge: { value: new Color(VOXEL_EDGE_COLOR) }, selected: { value: new Color(CUBE_SELECTION_COLOR) } }),
  [segment.count, segment.phase, segment.red, rod.opacity, selected]);
  return <mesh position={[0, 0, (rod.length - segment.count) / 2 - segment.offset]} onClick={(event) => {
    if (!interactive || event.delta > 5 || event.button !== 0) return;
    event.stopPropagation();
    const local = event.object.worldToLocal(event.point.clone());
    onSelect(segment.start + Math.max(0, Math.min(segment.count - 1, Math.floor(segment.count / 2 - local.z))));
  }}>
    <boxGeometry args={[1, 1, segment.count]} />
    <shaderMaterial uniforms={uniforms} vertexShader={vertexShader} fragmentShader={fragmentShader} transparent={rod.opacity < 1} depthWrite={rod.opacity >= 1} toneMapped={false} />
  </mesh>;
}
export function PlaceValueRodMesh({ rod, red, offset, selected, interactive, onSelect }: { rod: PlaceValueRod; red: PlaceValueSpan[]; offset: number; selected: boolean; interactive: boolean; onSelect: (unit: number) => void }) {
  return <group position={[rod.center.x + offset, rod.center.y, rod.center.z]} quaternion={rod.quaternion} name="place-value-compact-rod">
    {placeValueRodSegments(rod, red).map((segment) => <RodSegment key={segment.start} segment={segment} rod={rod} selected={selected} interactive={interactive} onSelect={onSelect} />)}
  </group>;
}
/** 只扩充几何裁剪深度，不改共用相机的支点、缩放、方向或交互。 */
export function PlaceValueClipDepth({ depth }: { depth: number }) {
  useFrame(({ camera }) => {
    if (!(camera instanceof OrthographicCamera || camera instanceof PerspectiveCamera)) return;
    const far = Math.max(1000, depth * 3 + camera.position.length() * 2);
    if (Math.abs(camera.far - far) > .01) { camera.far = far; camera.updateProjectionMatrix(); }
  });
  return null;
}
