import { Matrix4, Quaternion, Vector3 } from "three";

export const SPATIAL_CAMERA_TRANSITION_MS = 720;
export const SPATIAL_AXIS_SNAP_TRANSITION_MS = 240;
export const SPATIAL_AXIS_SNAP_DEGREES = 10;

export interface SpatialCameraVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SpatialCameraPose {
  readonly position: SpatialCameraVector;
  readonly target: SpatialCameraVector;
  readonly up: SpatialCameraVector;
}

function vector(value: SpatialCameraVector): Vector3 {
  if (![value.x, value.y, value.z].every(Number.isFinite)) {
    throw new RangeError("camera vectors must be finite");
  }
  return new Vector3(value.x, value.y, value.z);
}

function coordinates(value: Vector3): SpatialCameraVector {
  return { x: value.x, y: value.y, z: value.z };
}

function cameraFrame(pose: SpatialCameraPose) {
  const target = vector(pose.target);
  const backward = vector(pose.position).sub(target);
  const radius = backward.length();
  const right = vector(pose.up).cross(backward).normalize();
  if (radius <= 1e-9 || right.lengthSq() <= 1e-9) {
    throw new RangeError("camera needs a viewing direction and an independent up direction");
  }
  backward.normalize();
  const up = backward.clone().cross(right).normalize();
  const orientation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, backward));
  return { target, radius, orientation };
}

export function spatialCameraTransitionProgress(elapsedMs: number, durationMs: number): number {
  if (![elapsedMs, durationMs].every(Number.isFinite) || elapsedMs < 0 || durationMs < 0) {
    throw new RangeError("camera transition timing must be finite and non-negative");
  }
  if (durationMs === 0 || elapsedMs >= durationMs) return 1;
  const progress = elapsedMs / durationMs;
  return progress * progress * (3 - 2 * progress);
}

function uprightAngles(orientation: Quaternion) {
  const right = new Vector3(1, 0, 0).applyQuaternion(orientation);
  const up = new Vector3(0, 1, 0).applyQuaternion(orientation);
  if (Math.abs(right.y) > 1e-6 || up.y < -1e-6) return null;
  const backward = new Vector3(0, 0, 1).applyQuaternion(orientation);
  return {
    azimuth: Math.atan2(-right.z, right.x),
    elevation: Math.atan2(backward.y, Math.hypot(backward.x, backward.z)),
  };
}

/** 正立视角沿方位角/仰角过渡，侧视转俯视也保持竖直方向；兼容旧侧倾书签。 */
export function interpolateSpatialCameraPose(
  from: SpatialCameraPose,
  to: SpatialCameraPose,
  progress: number,
): SpatialCameraPose {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new RangeError("camera transition progress must be between 0 and 1");
  }
  const first = cameraFrame(from);
  const last = cameraFrame(to);
  if (progress === 0) return from;
  if (progress === 1) return to;
  const firstAngles = uprightAngles(first.orientation);
  const lastAngles = uprightAngles(last.orientation);
  let orientation: Quaternion;
  if (firstAngles && lastAngles) {
    const difference = lastAngles.azimuth - firstAngles.azimuth;
    const azimuth = firstAngles.azimuth + Math.atan2(Math.sin(difference), Math.cos(difference)) * progress;
    const elevation = firstAngles.elevation + (lastAngles.elevation - firstAngles.elevation) * progress;
    const right = new Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth));
    const backward = new Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));
    const up = backward.clone().cross(right);
    orientation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, backward));
  } else {
    orientation = first.orientation.slerp(last.orientation, progress);
  }
  const target = first.target.lerp(last.target, progress);
  const radius = first.radius + (last.radius - first.radius) * progress;
  return {
    target: coordinates(target),
    position: coordinates(new Vector3(0, 0, radius).applyQuaternion(orientation).add(target)),
    up: coordinates(new Vector3(0, 1, 0).applyQuaternion(orientation)),
  };
}

const PRINCIPAL_AXES: readonly { direction: SpatialCameraVector; up: SpatialCameraVector }[] = [
  { direction: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 } },
  { direction: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } },
  { direction: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
  { direction: { x: -1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
  { direction: { x: 0, y: 1, z: 0 }, up: { x: 0, y: 0, z: -1 } },
  { direction: { x: 0, y: -1, z: 0 }, up: { x: 0, y: 0, z: 1 } },
];

export function snapSpatialCameraPoseToPrincipalAxis(
  pose: SpatialCameraPose,
  maxAngleDegrees = SPATIAL_AXIS_SNAP_DEGREES,
): SpatialCameraPose | null {
  if (!Number.isFinite(maxAngleDegrees) || maxAngleDegrees < 0 || maxAngleDegrees > 45) {
    throw new RangeError("camera axis snap angle must be between 0 and 45 degrees");
  }
  const { radius, target, orientation } = cameraFrame(pose);
  let closest: SpatialCameraPose | null = null;
  let closestAngle = Infinity;
  // 六个观察方向各有四个直角朝向；自由翻转后也只吸附附近姿态，不突然翻正画面。
  for (const axis of PRINCIPAL_AXES) {
    for (let quarterTurn = 0; quarterTurn < 4; quarterTurn++) {
      const up = vector(axis.up).applyAxisAngle(vector(axis.direction), quarterTurn * Math.PI / 2).round();
      const candidate = {
        target: pose.target,
        position: coordinates(vector(axis.direction).multiplyScalar(radius).add(target)),
        up: { x: up.x || 0, y: up.y || 0, z: up.z || 0 },
      };
      const angle = orientation.angleTo(cameraFrame(candidate).orientation);
      if (angle < closestAngle) {
        closestAngle = angle;
        closest = candidate;
      }
    }
  }
  return closestAngle * 180 / Math.PI <= maxAngleDegrees ? closest : null;
}
