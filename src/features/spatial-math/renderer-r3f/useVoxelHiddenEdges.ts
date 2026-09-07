"use client";

import { useLayoutEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { VoxelRenderCell } from "./voxel-render-model";

export type VoxelHiddenEdgeUniforms = {
  uVoxelFrontDepth: { value: THREE.DepthTexture };
  uVoxelDepthSize: { value: THREE.Vector2 };
  uVoxelDepthBias: { value: number };
};

function updateDepthInstances(mesh: THREE.InstancedMesh, cells: readonly VoxelRenderCell[]) {
  const matrix = new THREE.Matrix4();
  mesh.count = cells.length;
  cells.forEach((cell, index) => mesh.setMatrixAt(index, matrix.makeTranslation(cell.x, cell.y, cell.z)));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
}

function updateDepthUniforms(uniforms: VoxelHiddenEdgeUniforms, size: THREE.Vector2, cameraRange: number) {
  uniforms.uVoxelDepthSize.value.copy(size);
  uniforms.uVoxelDepthBias.value = 0.035 / cameraRange;
}

/** 相机更新后先记录实体表面深度，再绘制原场景。只有半透明展示启用此附加 pass。 */
export function useVoxelHiddenEdges(cells: readonly VoxelRenderCell[], enabled: boolean): VoxelHiddenEdgeUniforms | null {
  const invalidate = useThree((state) => state.invalidate);
  const pass = useMemo(() => {
    if (!enabled) return null;
    const target = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ colorWrite: false });
    const mesh = new THREE.InstancedMesh(geometry, material, 512);
    const scene = new THREE.Scene(); scene.add(mesh);
    return { target, geometry, material, mesh, scene, size: new THREE.Vector2(),
      uniforms: { uVoxelFrontDepth: { value: target.depthTexture }, uVoxelDepthSize: { value: new THREE.Vector2(1, 1) }, uVoxelDepthBias: { value: 0.00001 } } };
  }, [enabled]);
  useLayoutEffect(() => {
    if (!pass) return;
    updateDepthInstances(pass.mesh, cells); invalidate();
  }, [cells, pass, invalidate]);
  useLayoutEffect(() => () => {
    if (!pass) return;
    pass.target.dispose(); pass.geometry.dispose(); pass.material.dispose(); pass.mesh.dispose();
  }, [pass]);
  // 正优先级由此处接管最终绘制，确保 Orbit 与平滑视角已更新，深度与主画面属于同一帧。
  useFrame(({ gl, scene, camera }) => {
    if (!pass) return;
    gl.getDrawingBufferSize(pass.size);
    if (pass.target.width !== pass.size.x || pass.target.height !== pass.size.y) pass.target.setSize(pass.size.x, pass.size.y);
    updateDepthUniforms(pass.uniforms, pass.size, camera.far - camera.near);
    const previousTarget = gl.getRenderTarget();
    const previousAutoClear = gl.autoClear;
    try {
      gl.autoClear = true;
      gl.setRenderTarget(pass.target); gl.render(pass.scene, camera);
    } finally {
      gl.setRenderTarget(previousTarget); gl.autoClear = previousAutoClear;
    }
    gl.render(scene, camera);
  }, enabled ? 1 : 0);
  return pass?.uniforms ?? null;
}
