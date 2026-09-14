"use client";

import { Suspense } from "react";
import { useTexture } from "@react-three/drei";
import { Matrix4, Quaternion, SRGBColorSpace, Vector3 } from "three";
import type { PolyhedronFoldRenderFace, PolyhedronFoldRenderModel } from "@/features/spatial-math/renderer-r3f/polyhedron-fold-render-model";
import { cubeAnnotationSvg } from "./cube-structures-annotations";
import { cubeNetFaceStyle, type CubeNetSurfaces } from "./cube-net-surfaces";

function FaceAnnotation({ face, label, lane }: {
  readonly face: PolyhedronFoldRenderFace; readonly label: Parameters<typeof cubeAnnotationSvg>[0]; readonly lane: -1 | 0 | 1;
}) {
  const texture = useTexture("data:image/svg+xml," + encodeURIComponent(cubeAnnotationSvg(label)), (loaded) => {
    if (!Array.isArray(loaded)) loaded.colorSpace = SRGBColorSpace;
  });
  const [a, b, c] = face.vertices.slice(0, 3).map(({ position: p }) => new Vector3(p.x, p.y, p.z));
  const u = b.sub(a).normalize(), n = u.clone().cross(c.sub(a)).normalize(), v = n.clone().cross(u);
  const center = new Vector3(face.centroid.x, face.centroid.y, face.centroid.z).addScaledVector(u, lane * 0.23);
  const size = lane ? 0.32 : 0.42;
  return <group>{([-1, 1] as const).map((side) => <mesh key={side} raycast={() => null}
    position={center.clone().addScaledVector(n, side * 0.012)}
    quaternion={new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(u.clone().multiplyScalar(side), v, n.clone().multiplyScalar(side)))}>
    <planeGeometry args={[size, size]} />
    <meshBasicMaterial map={texture} transparent alphaTest={0.04} depthWrite={false} toneMapped={false} />
  </mesh>)}</group>;
}

/** 与立方体结构共用图形／编号纹理；双面贴纸随纸片转动，标记与数字可并排共存。 */
export function CubeNetFaceAnnotations({ model, surfaces }: { readonly model: PolyhedronFoldRenderModel; readonly surfaces: CubeNetSurfaces }) {
  return <group>{model.faces.map((face) => {
    const { mark, number } = cubeNetFaceStyle(surfaces, face.label);
    return <Suspense key={face.faceId} fallback={null}>
      {mark && <FaceAnnotation face={face} lane={number ? -1 : 0} label={{ color: mark.color,
        ...(mark.kind === "letter" ? { text: face.label } : { shape: mark.kind }) }} />}
      {number && <FaceAnnotation face={face} lane={mark ? 1 : 0} label={number} />}
    </Suspense>;
  })}</group>;
}
