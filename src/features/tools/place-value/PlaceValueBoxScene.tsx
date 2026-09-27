"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Line } from "@react-three/drei";
import { BoxGeometry, Color, DoubleSide, InstancedBufferAttribute, Matrix4, Quaternion, Vector3, type InstancedMesh } from "three";
import { VOXEL_EDGE_COLOR } from "@/features/spatial-math/renderer-r3f/voxel-visual-model";
import { CUBE_COLORS, CUBE_SELECTION_COLOR } from "../spatial-lab/cube-structures-contract";
import { SpatialSurfaceLabel } from "../spatial-interaction/SpatialSurfaceLabel";
import { groupSize, type PlaceValueSide, type PlaceValueSnapshot } from "./radix-contract";
import { placeValueColumn, placeValueGroup, placeValueOffset, placeValueRedSpans } from "./radix-model";
import { placeValueBoxPose, type PlaceValueBoxPart } from "./box-model";

const ignoreRaycast = () => null;
const vertexShader = `
attribute vec3 divisions; attribute vec4 appearance;
varying vec3 p; varying vec3 n; varying vec3 d; varying vec4 a;
void main() { p = position + .5; n = normal; d = divisions; a = appearance;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.);
}`;
const fragmentShader = `
varying vec3 p; varying vec3 n; varying vec3 d; varying vec4 a;
uniform vec3 yellow; uniform vec3 blue; uniform vec3 warning; uniform vec3 edge; uniform vec3 selected; uniform vec3 neutral; uniform float shell;
float lines(vec2 uv) {
  vec2 pixel = max(fwidth(uv), vec2(.00001));
  vec2 distance = min(fract(uv), 1. - fract(uv));
  vec2 grid = (1. - smoothstep(vec2(.008), pixel * .65 + .015, distance)) * (1. - smoothstep(vec2(.3), vec2(1.), pixel));
  return max(grid.x, grid.y);
}
void main() {
  vec3 unit = floor(clamp(p * d, vec3(.00001), d - .00001));
  float number = unit.z + unit.x * d.z + unit.y * d.x * d.z;
  float colorIndex = step(5., mod(number, 10.));
  // 前端色带表示本列第几个单位；顶面/侧面格线表示这个单位的内部组成。
  if (n.z > .5) colorIndex = a.w;
  float pixel = max(fwidth(number), .00001);
  vec3 face = mix(yellow, blue, n.z > .5 ? colorIndex : mix(colorIndex, .5, smoothstep(8., 24., pixel)));
  face = mix(face, warning, a.y);
  face *= .88 + .12 * max(n.y, n.z * .65);
  vec2 uv = abs(n.x) > .5 ? p.yz : abs(n.y) > .5 ? p.xz : p.xy;
  vec2 count = abs(n.x) > .5 ? d.yz : abs(n.y) > .5 ? d.xz : d.xy;
  float outline = 1. - smoothstep(.016, .027, min(min(uv.x, 1. - uv.x), min(uv.y, 1. - uv.y)));
  float grid = lines(uv * count);
  vec3 color = shell > .5 ? mix(neutral, mix(edge, selected, a.z), outline) : mix(face, mix(edge, selected, a.z), max(grid * .7, outline));
  float alpha = shell > .5 ? mix(.13, .9, outline) * a.x : a.x;
  if (alpha < .005) discard;
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
}`;

/** 开口壳与内容分开实例化；格线由材质生成，百万个一也不创建百万个 mesh。 */
function BoxInstances({ parts, offset, selected, red, interactive, onSelect, shell }: {
  parts: PlaceValueBoxPart[]; offset: number; selected: (part: PlaceValueBoxPart) => boolean;
  red: ReturnType<typeof placeValueRedSpans>; interactive: boolean; onSelect: (unit: number) => void; shell: boolean;
}) {
  const ref = useRef<InstancedMesh>(null), capacity = Math.max(1, parts.length);
  const geometry = useMemo(() => {
    const result = new BoxGeometry(1, 1, 1);
    if (shell) {
      // BoxGeometry 的第三组是 +Y 面：移除顶盖，保留底和四侧。
      const indices = Array.from(result.index!.array);
      result.setIndex(indices.filter((_, i) => i < 12 || i >= 18)); result.clearGroups();
    }
    result.setAttribute("divisions", new InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
    result.setAttribute("appearance", new InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
    return result;
  }, [capacity, shell]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const uniforms = useMemo(() => ({ yellow: { value: new Color(CUBE_COLORS[2]) }, blue: { value: new Color(CUBE_COLORS[3]) }, warning: { value: new Color(CUBE_COLORS[1]) },
    edge: { value: new Color(VOXEL_EDGE_COLOR) }, selected: { value: new Color(CUBE_SELECTION_COLOR) }, neutral: { value: new Color(CUBE_COLORS[5]) }, shell: { value: Number(shell) } }), [shell]);
  useLayoutEffect(() => {
    const mesh = ref.current; if (!mesh) return;
    const matrix = new Matrix4(), position = new Vector3(), scale = new Vector3(), rotation = new Quaternion();
    const divisions = geometry.getAttribute("divisions"), appearance = geometry.getAttribute("appearance");
    parts.forEach((part, i) => {
      position.set(part.position[0] + offset, part.position[1], part.position[2]);
      matrix.compose(position, rotation.fromArray(part.rotation), scale.fromArray(part.size)); mesh.setMatrixAt(i, matrix);
      divisions.setXYZ(i, ...part.divisions);
      const pending = part.group.some((member) => red.some((span) => member.start < span.start + span.count && span.start < member.start + member.count));
      appearance.setXYZW(i, part.opacity, Number(pending), Number(selected(part)), Number(Math.floor(part.index / 5) % 2));
    });
    mesh.count = parts.length; mesh.instanceMatrix.needsUpdate = true; divisions.needsUpdate = true; appearance.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [parts, offset, geometry, red, selected]);
  return <instancedMesh key={capacity} ref={ref} args={[geometry, undefined, capacity]} frustumCulled={false} renderOrder={shell ? 2 : 0}
    onClick={(event) => {
      if (!interactive || event.delta > 5 || event.button !== 0 || event.instanceId === undefined) return;
      const item = parts[event.instanceId]; if (!item || item.opacity < .05) return;
      event.stopPropagation(); onSelect(item.unit);
    }}>
    <shaderMaterial uniforms={uniforms} vertexShader={vertexShader} fragmentShader={fragmentShader} transparent depthWrite={!shell} side={shell ? DoubleSide : undefined} toneMapped={false} />
  </instancedMesh>;
}

export function PlaceValueBoxScene({ snapshot, progress, contentsProgress, interactive, selected, locale, onSelect }: {
  snapshot: PlaceValueSnapshot; progress: number; contentsProgress: number; interactive: boolean; selected: boolean; locale: "zh" | "en";
  onSelect: (side: PlaceValueSide, unit: number) => void;
}) {
  const sides: PlaceValueSide[] = snapshot.mode === "compare" ? ["left", "right"] : ["left"];
  return <group name="place-value-box-mapping">{sides.map((side) => {
    const board = snapshot[side], parts = placeValueBoxPose(snapshot, side, progress, contentsProgress);
    const offset = placeValueOffset(snapshot.mode, side, board.places.length);
    const choice = selected && snapshot.selection?.side === side ? placeValueGroup(board, snapshot.selection.unit) : null;
    const emphasis = (part: PlaceValueBoxPart) => choice?.group[0].start === part.unit || snapshot.highlight === part.level;
    const red = placeValueRedSpans(snapshot, side, snapshot.motion?.boxStage && snapshot.motion.boxStage !== "place" ? 0 : progress);
    const mapping = parts.find((part) => part.role === "mapping" && part.opacity > .5 && choice?.group[0].start === part.unit);
    const front = mapping && parts.find((part) => part.role === "shell" && part.unit === mapping.unit);
    return <group key={side}>
      <BoxInstances parts={parts.filter((part) => part.role !== "shell" && part.opacity > .005)} offset={offset} red={red} selected={emphasis} interactive={interactive} onSelect={(unit) => onSelect(side, unit)} shell={false} />
      <BoxInstances parts={parts.filter((part) => part.role === "shell" && part.opacity > .005)} offset={offset} red={red} selected={emphasis} interactive={interactive} onSelect={(unit) => onSelect(side, unit)} shell />
      {board.places.map((_, level) => {
        const x = placeValueColumn(level, board.places.length) + offset, height = Math.max(board.radix, board.places[level].length) + .4;
        return <group key={level} name="place-value-front-case">
          <mesh position={[x, height / 2, -.76]} raycast={ignoreRaycast}><planeGeometry args={[1.5, height]} /><meshBasicMaterial color={CUBE_COLORS[3]} transparent opacity={.045} side={DoubleSide} depthWrite={false} /></mesh>
          {[-.76, .76].map((dx) => <Line key={dx} points={[[x + dx, 0, .76], [x + dx, height, .76], [x + dx, height, -.76], [x + dx, 0, -.76]]} color={CUBE_COLORS[3]} transparent opacity={.26} lineWidth={1} raycast={ignoreRaycast} />)}
        </group>;
      })}
      {mapping && front && <>
        <Line points={[[front.position[0] + offset, front.position[1], -.55], [mapping.position[0] + offset, mapping.position[1], mapping.position[2]]]} color={CUBE_SELECTION_COLOR} dashed dashSize={.13} gapSize={.12} transparent opacity={.65} lineWidth={1} raycast={ignoreRaycast} />
        <SpatialSurfaceLabel text={(locale === "zh" ? "组成 · " : "Contains · ") + groupSize(mapping.group) + (locale === "zh" ? " 个一" : " ones")}
          position={[mapping.position[0] + offset, mapping.position[1] + mapping.size[1] / 2 + .3, mapping.position[2]]} rotation={[0, 0, 0]} />
      </>}
    </group>;
  })}</group>;
}
