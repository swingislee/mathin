"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Line } from "@react-three/drei";
import { BoxGeometry, Color, DataTexture, DoubleSide, FloatType, InstancedBufferAttribute, Matrix4, Quaternion, RGBAFormat, Vector3, type InstancedMesh, type ShaderMaterial } from "three";
import { VOXEL_EDGE_COLOR, VOXEL_SELECTION_EDGE_SCALE } from "@/features/spatial-math/renderer-r3f/voxel-visual-model";
import { CUBE_AXIS_COLORS, CUBE_COLORS, CUBE_SELECTION_COLOR } from "../spatial-lab/cube-structures-contract";
import { SpatialSurfaceLabel } from "../spatial-interaction/SpatialSurfaceLabel";
import { groupSize, type PlaceValueGroup, type PlaceValueSide, type PlaceValueSnapshot } from "./radix-contract";
import { placeValueColumn, placeValueGroup, placeValueOffset, placeValueRedSpans } from "./radix-model";
import { placeValueBoxCapacity, placeValueBoxPose, placeValueBoxRedSpans, type PlaceValueBoxPart } from "./box-model";
import { writePlaceValueBoxColors } from "./box-colors";
import { placeValueMessages } from "./messages";

const ignoreRaycast = () => null;
const vertexShader = `
attribute vec3 divisions; attribute vec4 appearance; attribute float detail; attribute vec2 spanRange;
varying vec3 p; varying vec3 n; varying vec3 d; varying vec4 a; varying float unpacked; varying vec2 spans;
void main() { p = position + .5; n = normal; d = divisions; a = appearance; unpacked = detail; spans = spanRange;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.);
}`;
const fragmentShader = `
varying vec3 p; varying vec3 n; varying vec3 d; varying vec4 a; varying float unpacked; varying vec2 spans;
uniform vec3 yellow; uniform vec3 blue; uniform vec3 warning; uniform vec3 edge; uniform vec3 selected; uniform vec3 neutral; uniform float shell;
uniform sampler2D palette; uniform vec2 paletteSize;
vec2 colorSpan(float index) {
  return texture2D(palette, (vec2(mod(index, paletteSize.x), floor(index / paletteSize.x)) + .5) / paletteSize).rg;
}
float originalPhase(float number) {
  float low = spans.x, high = spans.x + spans.y - 1.;
  // 每组最多 2048 段；二分次数固定，不循环遍历单位数量。
  for (int i = 0; i < 12; i++) {
    if (low < high) {
      float middle = floor((low + high) * .5);
      if (number < colorSpan(middle).x) high = middle; else low = middle + 1.;
    }
  }
  return number + colorSpan(low).y;
}
float lines(vec2 uv) {
  vec2 pixel = max(fwidth(uv), vec2(.00001));
  vec2 distance = min(fract(uv), 1. - fract(uv));
  vec2 grid = (1. - smoothstep(vec2(.008), pixel * .65 + .015, distance)) * (1. - smoothstep(vec2(.3), vec2(1.), pixel));
  return max(grid.x, grid.y);
}
void main() {
  vec3 unit = floor(clamp(p * d, vec3(.00001), d - .00001));
  float number = unit.z + unit.x * d.z + unit.y * d.x * d.z;
  float colorIndex = shell > .5 ? 0. : step(5., mod(originalPhase(number), 10.));
  // 前端色带表示本列第几个单位；顶面/侧面格线表示这个单位的内部组成。
  if (n.z > .5) colorIndex = mix(a.w, colorIndex, unpacked);
  float pixel = max(fwidth(number), .00001);
  vec3 face = mix(yellow, blue, n.z > .5 ? colorIndex : mix(colorIndex, .5, smoothstep(8., 24., pixel)));
  face = mix(face, warning, a.y);
  face *= .88 + .12 * max(n.y, n.z * .65);
  vec2 uv = abs(n.x) > .5 ? p.yz : abs(n.y) > .5 ? p.xz : p.xy;
  vec2 count = abs(n.x) > .5 ? d.yz : abs(n.y) > .5 ? d.xz : d.xy;
  float distance = min(min(uv.x, 1. - uv.x), min(uv.y, 1. - uv.y));
  float edgeScale = mix(1., ${VOXEL_SELECTION_EDGE_SCALE.toFixed(2)}, a.z);
  float outline = 1. - smoothstep(.016 * edgeScale, .027 * edgeScale, distance);
  float grid = lines(uv * count) * (n.z > .5 ? unpacked : 1.);
  // 黄色留在轮廓内侧；深色外棱和内部格线始终保留，待进位红色优先。
  float selectionBand = (1. - smoothstep(.05, .065, distance)) * a.z * (1. - a.y);
  vec3 surface = mix(shell > .5 ? neutral : face, selected, selectionBand);
  vec3 color = mix(surface, edge, shell > .5 ? outline : max(grid * .7, outline));
  float alpha = shell > .5 ? mix(.13, .9, max(outline, selectionBand * .6)) * a.x : a.x;
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
  const spanCount = Math.max(1, parts.reduce((count, part) => count + part.group.length, 0));
  const width = Math.min(2048, spanCount), height = Math.ceil(spanCount / width);
  const palette = useMemo(() => new DataTexture(new Float32Array(width * height * 4), width, height, RGBAFormat, FloatType), [width, height]);
  const previousPalette = useRef<{ texture: DataTexture; groups: PlaceValueGroup[] } | null>(null);
  useEffect(() => () => palette.dispose(), [palette]);
  const geometry = useMemo(() => {
    const result = new BoxGeometry(1, 1, 1);
    if (shell) {
      // BoxGeometry 的第三组是 +Y 面：移除顶盖，保留底和四侧。
      const indices = Array.from(result.index!.array);
      result.setIndex(indices.filter((_, i) => i < 12 || i >= 18)); result.clearGroups();
    }
    result.setAttribute("divisions", new InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
    result.setAttribute("appearance", new InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
    result.setAttribute("detail", new InstancedBufferAttribute(new Float32Array(capacity), 1));
    result.setAttribute("spanRange", new InstancedBufferAttribute(new Float32Array(capacity * 2), 2));
    return result;
  }, [capacity, shell]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const uniforms = useMemo(() => ({ yellow: { value: new Color(CUBE_COLORS[2]) }, blue: { value: new Color(CUBE_COLORS[3]) }, warning: { value: new Color(CUBE_COLORS[1]) },
    edge: { value: new Color(VOXEL_EDGE_COLOR) }, selected: { value: new Color(CUBE_SELECTION_COLOR) }, neutral: { value: new Color(CUBE_COLORS[5]) }, shell: { value: Number(shell) },
    palette: { value: palette }, paletteSize: { value: [width, height] } }), [shell, palette, width, height]);
  useLayoutEffect(() => {
    const mesh = ref.current; if (!mesh) return;
    const texture = (mesh.material as ShaderMaterial).uniforms.palette.value as DataTexture;
    const matrix = new Matrix4(), position = new Vector3(), scale = new Vector3(), rotation = new Quaternion();
    const divisions = geometry.getAttribute("divisions"), appearance = geometry.getAttribute("appearance"), detail = geometry.getAttribute("detail");
    if (previousPalette.current?.texture !== texture || parts.length !== previousPalette.current.groups.length || parts.some((part, i) => part.group !== previousPalette.current!.groups[i])) {
      const groups = parts.map((part) => part.group), ranges = writePlaceValueBoxColors(groups, texture.image.data as Float32Array);
      const spanRange = geometry.getAttribute("spanRange");
      ranges.forEach((range, i) => spanRange.setXY(i, ...range)); spanRange.needsUpdate = true;
      texture.needsUpdate = true; previousPalette.current = { texture, groups };
    }
    parts.forEach((part, i) => {
      position.set(part.position[0] + offset, part.position[1], part.position[2]);
      matrix.compose(position, rotation.fromArray(part.rotation), scale.fromArray(part.size)); mesh.setMatrixAt(i, matrix);
      divisions.setXYZ(i, ...part.divisions);
      const pending = part.group.some((member) => red.some((span) => member.start < span.start + span.count && span.start < member.start + member.count));
      appearance.setXYZW(i, part.opacity, Number(pending), Number(selected(part)), part.frontTone);
      detail.setX(i, part.detail);
    });
    mesh.count = parts.length; mesh.instanceMatrix.needsUpdate = true; divisions.needsUpdate = true; appearance.needsUpdate = true; detail.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [parts, offset, geometry, red, selected, palette]);
  return <instancedMesh name={shell ? "place-value-box-shells" : "place-value-box-contents"} key={capacity} ref={ref} args={[geometry, undefined, capacity]} frustumCulled={false} renderOrder={shell ? 2 : 0}
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
  const sides: PlaceValueSide[] = snapshot.mode === "compare" ? ["left", "right"] : ["left"], m = placeValueMessages(locale);
  return <group name="place-value-box-mapping">{sides.map((side) => {
    const board = snapshot[side], parts = placeValueBoxPose(snapshot, side, progress, contentsProgress);
    const offset = placeValueOffset(snapshot.mode, side, board.places.length);
    const choice = selected && snapshot.selection?.side === side ? placeValueGroup(board, snapshot.selection.unit) : null;
    const emphasis = (part: PlaceValueBoxPart) => choice?.group[0].start === part.unit || snapshot.highlight === part.level;
    const red = placeValueBoxRedSpans(snapshot, side, progress);
    const mapping = parts.find((part) => part.role !== "shell" && part.position[2] < -1 && part.opacity > .5 && choice?.group[0].start === part.unit);
    const front = mapping && parts.find((part) => part.role === "shell" && part.unit === mapping.unit);
    return <group key={side}>
      <BoxInstances parts={parts.filter((part) => part.role !== "shell" && part.opacity > .005)} offset={offset} red={red} selected={emphasis} interactive={interactive} onSelect={(unit) => onSelect(side, unit)} shell={false} />
      <BoxInstances parts={parts.filter((part) => part.role === "shell" && part.opacity > .005)} offset={offset} red={red} selected={emphasis} interactive={interactive} onSelect={(unit) => onSelect(side, unit)} shell />
      {board.places.map((_, level) => {
        const x = placeValueColumn(level, board.places.length) + offset;
        const { limit: height, overflow, opacity } = placeValueBoxCapacity(board, level, parts);
        const rimColor = overflow ? CUBE_AXIS_COLORS.x : VOXEL_EDGE_COLOR;
        return <group key={level} name="place-value-front-case">
          <mesh position={[x, height / 2, -.76]} raycast={ignoreRaycast}><planeGeometry args={[1.5, height]} /><meshBasicMaterial color={CUBE_COLORS[3]} transparent opacity={.045} side={DoubleSide} depthWrite={false} /></mesh>
          {[-.76, .76].map((dx) => <Line key={dx} points={[[x + dx, 0, .76], [x + dx, height, .76], [x + dx, height, -.76], [x + dx, 0, -.76]]} color={CUBE_COLORS[3]} transparent opacity={.26} lineWidth={1} raycast={ignoreRaycast} />)}
          <Line points={[[x - .82, height, .82], [x + .82, height, .82], [x + .82, height, -.82], [x - .82, height, -.82], [x - .82, height, .82]]}
            color={rimColor} lineWidth={overflow ? 2.5 : 1.5} raycast={ignoreRaycast} />
          <Line points={[[x + .82, height, .82], [x + 1.2, height, .82]]} color={rimColor} lineWidth={1.5} raycast={ignoreRaycast} />
          <SpatialSurfaceLabel text={m.boxCapacity(height)} position={[x + 2.25, height - .2, .84]} rotation={[0, 0, 0]} height={.3} />
          {overflow > 0 && <group name="place-value-case-overflow">
            <mesh position={[x, height + overflow / 2, -.78]} raycast={ignoreRaycast}><planeGeometry args={[1.64, overflow]} /><meshBasicMaterial color={CUBE_AXIS_COLORS.x} transparent opacity={.12 * opacity} side={DoubleSide} depthWrite={false} /></mesh>
            <Line points={[[x + .82, height, .82], [x + 1.05, height, .82], [x + 1.05, height + overflow, .82], [x + .82, height + overflow, .82]]}
              color={CUBE_AXIS_COLORS.x} transparent opacity={opacity} lineWidth={2.5} raycast={ignoreRaycast} />
            <SpatialSurfaceLabel text={m.boxOverflow(overflow)} position={[x + 2.25, height + overflow / 2, .84]} rotation={[0, 0, 0]} height={.3} />
          </group>}
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
