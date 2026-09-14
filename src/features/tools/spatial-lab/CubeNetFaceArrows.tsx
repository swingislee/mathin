"use client";

import { useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { BackSide, Mesh, OrthographicCamera, Quaternion, Vector3 } from "three";
import type { CubeNetRevealFace } from "./cube-net-face-reveal";

function FaceArrow({ face, onMove }: { readonly face: CubeNetRevealFace; readonly onMove?: (faceId: string) => void }) {
  const [hovered, setHovered] = useState(false);
  const hit = useRef<Mesh>(null);
  const { camera, size } = useThree();
  const rotation = useMemo(() => new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), face.direction), [face.direction]);
  useFrame(() => {
    if (!hit.current) return;
    const distance = camera instanceof OrthographicCamera ? 1 : camera.position.distanceTo(face.position);
    const unitsPerPixel = 2 * distance / Math.abs(camera.projectionMatrix.elements[5]) / size.height;
    // 透明命中球保持至少 44px 直径，手机与课堂触摸屏都能轻点。
    hit.current.scale.setScalar(Math.max(0.20, unitsPerPixel * 22));
  });
  return <group position={face.position} quaternion={rotation} userData={{ cubeNetFaceArrow: face.faceId }}>
    <group scale={hovered && onMove ? 1.08 : 1}>
      <mesh position={[0, 0.105, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.07, 0.085, 0.25, 16]} />
        <meshBasicMaterial color={face.expanded ? "#a8d8dd" : "#ffda79"} />
      </mesh>
      <mesh position={[0, 0.105, 0]} scale={[1.17, 1.08, 1.17]} raycast={() => null}>
        <cylinderGeometry args={[0.07, 0.085, 0.25, 16]} />
        <meshBasicMaterial color="#34372f" side={BackSide} />
      </mesh>
      <mesh position={[0, 0.30, 0]} raycast={() => null}>
        <coneGeometry args={[0.16, 0.24, 16]} />
        <meshBasicMaterial color={face.expanded ? "#bde9e5" : "#ffe8a0"} />
      </mesh>
      <mesh position={[0, 0.30, 0]} scale={1.12} raycast={() => null}>
        <coneGeometry args={[0.16, 0.24, 16]} />
        <meshBasicMaterial color="#34372f" side={BackSide} />
      </mesh>
    </group>
    {onMove && <mesh ref={hit} position={[0, 0.23, 0]} scale={0.20} userData={{ cubeNetArrowHit: face.faceId }}
      onPointerOver={(event) => { event.stopPropagation(); setHovered(true); }} onPointerOut={() => setHovered(false)}
      onClick={(event) => { event.stopPropagation(); if (event.button === 0 && event.delta <= 5) onMove(face.faceId); }}>
      <sphereGeometry args={[1, 16, 12]} />
      <meshBasicMaterial colorWrite={false} depthWrite={false} />
    </mesh>}
  </group>;
}

export function CubeNetFaceArrows({ faces, onMove }: { readonly faces: readonly CubeNetRevealFace[]; readonly onMove?: (faceId: string) => void }) {
  return <>{faces.map((face) => <FaceArrow key={face.faceId} face={face} onMove={onMove} />)}</>;
}
