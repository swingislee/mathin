"use client";

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ComponentRef } from "react";
import * as THREE from "three";
import {
  SPATIAL_AXIS_SNAP_TRANSITION_MS,
  SPATIAL_CAMERA_TRANSITION_MS,
  interpolateSpatialCameraPose,
  snapSpatialCameraPoseToPrincipalAxis,
  spatialCameraTransitionProgress,
  type SpatialCameraPose,
} from "./spatial-camera-motion";

type SpatialCamera = THREE.OrthographicCamera | THREE.PerspectiveCamera;
type SpatialControls = ComponentRef<typeof OrbitControls>;
type CameraBookmark = SpatialCameraPose & { readonly id: string } & (
  | { readonly projection: "orthographic"; readonly zoom: number }
  | { readonly projection: "perspective"; readonly fovDegrees: number }
);
interface CameraTransition {
  readonly from: SpatialCameraPose;
  readonly to: SpatialCameraPose;
  readonly projectionFrom: number;
  readonly projectionTo: number;
  startedAtMs: number | null;
  readonly durationMs: number;
}

function subscribeReducedMotion(onChange: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
function cameraPose(camera: SpatialCamera, target: SpatialCameraPose["target"]): SpatialCameraPose {
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  return {
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target: { x: target.x, y: target.y, z: target.z },
    up: { x: up.x, y: up.y, z: up.z },
  };
}
function applyCameraPose(camera: SpatialCamera, pose: SpatialCameraPose, controls: SpatialControls | null) {
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  camera.up.set(pose.up.x, pose.up.y, pose.up.z);
  camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
  camera.updateMatrixWorld();
  if (controls?.object === camera) {
    // Orbit 的逐帧更新早于相机动画；这里只同步中心，保留本帧的精确插值姿态。
    controls.target.set(pose.target.x, pose.target.y, pose.target.z);
  }
}
function projectionValue(camera: SpatialCamera): number {
  return camera instanceof THREE.OrthographicCamera ? camera.zoom : camera.fov;
}
function applyProjectionValue(camera: SpatialCamera, value: number) {
  if (camera instanceof THREE.OrthographicCamera) camera.zoom = value;
  else camera.fov = value;
  camera.updateProjectionMatrix();
}

/** 体素、展开图、编辑预览和课堂舞台共用的表现层相机，不产生课堂语义写入。 */
export function SpatialCameraRig({ bookmark, radius, interactive, axisSnapEnabled = false, requestKey, minDistance = 0, maxDistance = Infinity, onTransitionStateChange }: {
  readonly bookmark: CameraBookmark;
  readonly radius: number;
  readonly interactive: boolean;
  readonly axisSnapEnabled?: boolean;
  readonly requestKey?: string | number;
  readonly minDistance?: number;
  readonly maxDistance?: number;
  readonly onTransitionStateChange: (active: boolean) => void;
}) {
  const size = useThree((state) => state.size);
  const renderedCamera = useThree((state) => state.camera);
  const setThree = useThree((state) => state.set);
  const invalidate = useThree((state) => state.invalidate);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => false);
  const orthographicRef = useRef(new THREE.OrthographicCamera());
  const perspectiveRef = useRef(new THREE.PerspectiveCamera());
  const activeCamera = useRef<SpatialCamera | null>(null);
  const controls = useRef<SpatialControls | null>(null);
  const startedOrientation = useRef(new THREE.Quaternion());
  const currentTarget = useRef<SpatialCameraPose["target"]>(bookmark.target);
  const transition = useRef<CameraTransition | null>(null);
  const attachControls = useCallback((instance: SpatialControls | null) => {
    controls.current = instance;
    const camera = activeCamera.current;
    if (!instance || !camera || instance.object !== camera) return;
    const target = currentTarget.current;
    instance.target.set(target.x, target.y, target.z);
    // 新相机接入原控件时保留当前中心，不在构造器的默认原点停留一帧。
    camera.lookAt(target.x, target.y, target.z);
    camera.updateMatrixWorld();
  }, []);
  // 数值相同的模型重建、染色、折叠帧和吸附偏好更新保留手动视角。
  const targetPose = useMemo<SpatialCameraPose>(() => ({
    position: { x: bookmark.position.x, y: bookmark.position.y, z: bookmark.position.z },
    target: { x: bookmark.target.x, y: bookmark.target.y, z: bookmark.target.z },
    up: { x: bookmark.up.x, y: bookmark.up.y, z: bookmark.up.z },
  }), [bookmark.position.x, bookmark.position.y, bookmark.position.z,
    bookmark.target.x, bookmark.target.y, bookmark.target.z, bookmark.up.x, bookmark.up.y, bookmark.up.z]);
  const projectionTarget = bookmark.projection === "orthographic" ? bookmark.zoom : bookmark.fovDegrees;

  useLayoutEffect(() => {
    const orthographic = orthographicRef.current;
    const perspective = perspectiveRef.current;
    const aspect = size.width / Math.max(1, size.height);
    const halfHeight = radius * 1.35;
    orthographic.left = -halfHeight * aspect;
    orthographic.right = halfHeight * aspect;
    orthographic.top = halfHeight;
    orthographic.bottom = -halfHeight;
    orthographic.near = perspective.near = 0.01;
    orthographic.far = perspective.far = Math.max(1_000, radius * 100);
    perspective.aspect = aspect;
    orthographic.updateProjectionMatrix();
    perspective.updateProjectionMatrix();
    invalidate();
  }, [invalidate, radius, size.height, size.width]);

  useLayoutEffect(() => {
    const camera = bookmark.projection === "orthographic" ? orthographicRef.current : perspectiveRef.current;
    const previous = activeCamera.current;
    const liveTarget = controls.current?.target ?? currentTarget.current;
    const from = previous ? cameraPose(previous, liveTarget) : targetPose;
    currentTarget.current = from.target;
    if (previous && previous !== camera) {
      const distance = previous.position.distanceTo(new THREE.Vector3(from.target.x, from.target.y, from.target.z));
      const visibleHalfHeight = previous instanceof THREE.OrthographicCamera
        ? (previous.top - previous.bottom) / (2 * previous.zoom)
        : Math.tan(THREE.MathUtils.degToRad(previous.fov / 2)) * distance;
      applyProjectionValue(camera, camera instanceof THREE.OrthographicCamera
        ? (camera.top - camera.bottom) / (2 * visibleHalfHeight)
        : THREE.MathUtils.radToDeg(2 * Math.atan(visibleHalfHeight / Math.max(0.01, distance))));
      applyCameraPose(camera, from, null);
    }
    activeCamera.current = camera;
    setThree({ camera });
    if (!previous) {
      transition.current = null;
      currentTarget.current = targetPose.target;
      applyProjectionValue(camera, projectionTarget);
      applyCameraPose(camera, targetPose, controls.current);
      onTransitionStateChange(false);
    } else {
      transition.current = { from, to: targetPose, projectionFrom: projectionValue(camera),
        projectionTo: projectionTarget, startedAtMs: null,
        // 主动教学视角切换保留空间对应关系；减少动态效果时使用短过渡。
        durationMs: reducedMotion ? SPATIAL_AXIS_SNAP_TRANSITION_MS : SPATIAL_CAMERA_TRANSITION_MS };
      onTransitionStateChange(true);
    }
    invalidate();
  }, [bookmark.id, bookmark.projection, invalidate, onTransitionStateChange, projectionTarget, reducedMotion, requestKey, setThree, targetPose]);

  const finishGesture = () => {
    const instance = controls.current;
    const camera = activeCamera.current;
    if (!camera || !instance) return;
    instance.update();
    const from = cameraPose(camera, instance.target);
    currentTarget.current = from.target;
    // 单纯点击、平移或滚轮缩放保留当前方向；只有实际旋转后的松手才考虑吸附。
    if (!axisSnapEnabled || startedOrientation.current.angleTo(camera.quaternion) < 1e-5) return;
    const to = snapSpatialCameraPoseToPrincipalAxis(from);
    if (!to) return;
    if (reducedMotion) {
      applyCameraPose(camera, to, instance);
    } else {
      transition.current = { from, to, projectionFrom: projectionValue(camera), projectionTo: projectionValue(camera),
        startedAtMs: null, durationMs: SPATIAL_AXIS_SNAP_TRANSITION_MS };
      onTransitionStateChange(true);
    }
    invalidate();
  };

  useFrame(() => {
    const camera = activeCamera.current;
    if (!camera) return;
    const active = transition.current;
    if (!active) return;
    const now = performance.now();
    // demand 画布可能晚于点击才绘制。首帧才开始计时，等待时间不消耗动画。
    active.startedAtMs ??= now;
    const progress = spatialCameraTransitionProgress(Math.max(0, now - active.startedAtMs), active.durationMs);
    const pose = interpolateSpatialCameraPose(active.from, active.to, progress);
    currentTarget.current = pose.target;
    applyProjectionValue(camera, THREE.MathUtils.lerp(active.projectionFrom, active.projectionTo, progress));
    applyCameraPose(camera, pose, controls.current);
    if (progress === 1) {
      transition.current = null;
      onTransitionStateChange(false);
    } else invalidate();
  });

  return (
    <OrbitControls
      ref={attachControls}
      makeDefault
      camera={renderedCamera}
      enablePan={interactive}
      enableRotate={interactive}
      enableZoom={interactive}
      enableDamping={false}
      minDistance={minDistance}
      maxDistance={maxDistance}
      onStart={() => {
        const camera = activeCamera.current;
        const instance = controls.current;
        if (!camera || !instance) return;
        startedOrientation.current.copy(camera.quaternion);
        transition.current = null;
        currentTarget.current = cameraPose(camera, instance.target).target;
        onTransitionStateChange(false);
        invalidate();
      }}
      onEnd={finishGesture}
    />
  );
}
