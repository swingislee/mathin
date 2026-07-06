"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import * as THREE from "three";
import type { LandmarkKind } from "../universe";

function subscribeReducedMotion(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

function hash01(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = (h * 33) ^ seed.charCodeAt(i);
  return ((h >>> 0) % 10000) / 10000;
}

/** 低多边形星球几何：ico 球逐顶点径向抖动（同位置顶点同位移，保证不裂面） */
export function useLowPolyGeometry(seed: string, radius: number, detail = 2, amp = 0.045): THREE.BufferGeometry {
  const geo = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(radius, detail);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const factors = new Map<string, number>();
    for (let i = 0; i < pos.count; i++) {
      const key = `${pos.getX(i).toFixed(4)}|${pos.getY(i).toFixed(4)}|${pos.getZ(i).toFixed(4)}`;
      let f = factors.get(key);
      if (f === undefined) {
        f = 1 + (hash01(seed + key) - 0.5) * 2 * amp;
        factors.set(key, f);
      }
      pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f);
    }
    g.computeVertexNormals();
    return g;
  }, [seed, radius, detail, amp]);
  useEffect(() => () => geo.dispose(), [geo]);
  return geo;
}

export function latLonToVec3(lat: number, lon: number, r: number): THREE.Vector3 {
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  return new THREE.Vector3(r * Math.cos(la) * Math.sin(lo), r * Math.sin(la), r * Math.cos(la) * Math.cos(lo));
}

/** 岛屿地标：低多边形简单几何体（第一阶段占位，docs §4.4） */
export function Landmark({ kind, color }: { kind: LandmarkKind; color: string }) {
  switch (kind) {
    case "tower":
      return (
        <group>
          <mesh position={[0, 0.09, 0]}>
            <cylinderGeometry args={[0.045, 0.06, 0.18, 6]} />
            <meshStandardMaterial color={color} flatShading />
          </mesh>
          <mesh position={[0, 0.215, 0]}>
            <coneGeometry args={[0.065, 0.09, 6]} />
            <meshStandardMaterial color={color} flatShading />
          </mesh>
        </group>
      );
    case "tree":
      return (
        <group>
          <mesh position={[0, 0.05, 0]}>
            <cylinderGeometry args={[0.02, 0.025, 0.1, 5]} />
            <meshStandardMaterial color="#8a6a4a" flatShading />
          </mesh>
          <mesh position={[0, 0.16, 0]}>
            <coneGeometry args={[0.075, 0.16, 6]} />
            <meshStandardMaterial color={color} flatShading />
          </mesh>
        </group>
      );
    case "gear":
      return (
        <mesh position={[0, 0.09, 0]} rotation={[Math.PI / 2.4, 0, 0]}>
          <torusGeometry args={[0.07, 0.028, 5, 8]} />
          <meshStandardMaterial color={color} flatShading />
        </mesh>
      );
    case "crystal":
      return (
        <mesh position={[0, 0.11, 0]} rotation={[0, 0.5, 0]}>
          <octahedronGeometry args={[0.09]} />
          <meshStandardMaterial color={color} flatShading />
        </mesh>
      );
    case "arch":
      return (
        <mesh position={[0, 0.06, 0]}>
          <torusGeometry args={[0.07, 0.024, 5, 10, Math.PI]} />
          <meshStandardMaterial color={color} flatShading />
        </mesh>
      );
    case "flag":
      return (
        <group>
          <mesh position={[0, 0.1, 0]}>
            <cylinderGeometry args={[0.012, 0.012, 0.2, 5]} />
            <meshStandardMaterial color="#8a6a4a" flatShading />
          </mesh>
          <mesh position={[0.045, 0.165, 0]}>
            <boxGeometry args={[0.08, 0.05, 0.012]} />
            <meshStandardMaterial color={color} flatShading />
          </mesh>
        </group>
      );
    case "beacon":
      return (
        <group>
          <mesh position={[0, 0.09, 0]}>
            <cylinderGeometry args={[0.035, 0.055, 0.18, 6]} />
            <meshStandardMaterial color={color} flatShading />
          </mesh>
          <mesh position={[0, 0.2, 0]}>
            <sphereGeometry args={[0.032, 8, 6]} />
            <meshStandardMaterial color="#ffd98a" emissive="#ffd98a" emissiveIntensity={0.9} />
          </mesh>
        </group>
      );
  }
}

interface IslandCell {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  r: number;
  h: number;
  color: string;
}

/**
 * 生成岛屿的六边形模块簇：中心格 + 一圈 6 格 + 外圈随机若干格。
 * 每个模块沿自己所在点的法线立在球面上，因此整片大陆贴合球面弧线。
 * cellStep 为相邻模块的角距（度），足印半径约 2.2×cellStep。
 */
function buildCells(lat: number, lon: number, R: number, cellStep: number, seed: string, baseColor: string): IslandCell[] {
  const center = latLonToVec3(lat, lon, 1).normalize();
  const t1 = new THREE.Vector3(0, 1, 0).cross(center).normalize();
  const t2 = center.clone().cross(t1).normalize();
  const twist = hash01(seed) * Math.PI * 2;
  const step = (cellStep * Math.PI) / 180;
  const cellR = R * Math.tan(step) * 0.62;
  const base = new THREE.Color(baseColor);
  const up = new THREE.Vector3(0, 1, 0);

  const offsets: { d: number; a: number }[] = [{ d: 0, a: 0 }];
  for (let i = 0; i < 6; i++) offsets.push({ d: step, a: twist + (i * Math.PI) / 3 });
  for (let i = 0; i < 12; i++) {
    if (hash01(seed + "o" + i) > 0.5) offsets.push({ d: step * 1.9, a: twist + (i * Math.PI) / 6 + 0.26 });
  }

  return offsets.map((o, i) => {
    const dir = center
      .clone()
      .add(t1.clone().multiplyScalar(Math.tan(o.d) * Math.cos(o.a)))
      .add(t2.clone().multiplyScalar(Math.tan(o.d) * Math.sin(o.a)))
      .normalize();
    const tall = hash01(seed + "h" + i);
    const h = R * (0.05 + tall * 0.045) * (tall > 0.78 ? 1.7 : 1);
    const c = base.clone();
    c.offsetHSL(0, 0, (hash01(seed + "c" + i) - 0.5) * 0.1);
    return {
      pos: dir.clone().multiplyScalar(R + h / 2 - R * 0.012),
      quat: new THREE.Quaternion().setFromUnitVectors(up, dir),
      r: cellR * (0.9 + hash01(seed + "r" + i) * 0.25),
      h,
      color: `#${c.getHexString()}`,
    };
  });
}

/**
 * 球面上的岛屿：围攻式六边形模块大陆——占地大、贴着球面、高度低。
 * children 挂在岛屿中心的表面坐标系里（命中区、标签等）。
 */
export function IslandMount({ lat, lon, R, color, landmark, landmarkColor, cellStep = 12, lift = 0, seed = "", landmarkScale = 1, children }: {
  lat: number;
  lon: number;
  /** 星球半径 */
  R: number;
  color: string;
  landmark: LandmarkKind;
  landmarkColor: string;
  /** 模块角距（度）：决定岛屿占地 */
  cellStep?: number;
  /** hover 沿法向抬升量 */
  lift?: number;
  seed?: string;
  landmarkScale?: number;
  children?: React.ReactNode;
}) {
  const cells = useMemo(() => buildCells(lat, lon, R, cellStep, seed, color), [lat, lon, R, cellStep, seed, color]);
  const centerDir = useMemo(() => latLonToVec3(lat, lon, 1).normalize(), [lat, lon]);
  const centerQuat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), centerDir), [centerDir]);
  const centerTopH = cells[0]?.h ?? R * 0.07;
  return (
    <group position={centerDir.clone().multiplyScalar(lift)}>
      {cells.map((c, i) => (
        <mesh key={i} position={c.pos} quaternion={c.quat}>
          <cylinderGeometry args={[c.r, c.r * 0.82, c.h, 6]} />
          <meshStandardMaterial color={c.color} flatShading />
        </mesh>
      ))}
      {/* 岛屿中心表面坐标系：地标 + children */}
      <group position={centerDir.clone().multiplyScalar(R + centerTopH - R * 0.012)} quaternion={centerQuat}>
        <group scale={landmarkScale}>
          <Landmark kind={landmark} color={landmarkColor} />
        </group>
        {children}
      </group>
    </group>
  );
}
