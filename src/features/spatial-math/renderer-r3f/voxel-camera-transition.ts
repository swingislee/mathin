export const VOXEL_CAMERA_TRANSITION_MS = 720;

export interface VoxelCameraVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface VoxelCameraPose {
  readonly position: VoxelCameraVector;
  readonly target: VoxelCameraVector;
  readonly up: VoxelCameraVector;
}

function assertVector(value: VoxelCameraVector, label: string) {
  if (![value.x, value.y, value.z].every(Number.isFinite)) {
    throw new RangeError(`${label} must be finite`);
  }
}

function subtract(left: VoxelCameraVector, right: VoxelCameraVector): VoxelCameraVector {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function length(value: VoxelCameraVector): number {
  return Math.hypot(value.x, value.y, value.z);
}

function normalize(value: VoxelCameraVector, label: string): VoxelCameraVector {
  const magnitude = length(value);
  if (!Number.isFinite(magnitude) || magnitude <= 1e-9) {
    throw new RangeError(`${label} must have non-zero length`);
  }
  return { x: value.x / magnitude, y: value.y / magnitude, z: value.z / magnitude };
}

function dot(left: VoxelCameraVector, right: VoxelCameraVector): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function cross(left: VoxelCameraVector, right: VoxelCameraVector): VoxelCameraVector {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function lerpVector(
  from: VoxelCameraVector,
  to: VoxelCameraVector,
  progress: number,
): VoxelCameraVector {
  return {
    x: lerp(from.x, to.x, progress),
    y: lerp(from.y, to.y, progress),
    z: lerp(from.z, to.z, progress),
  };
}

function rotateAroundAxis(
  value: VoxelCameraVector,
  axis: VoxelCameraVector,
  angle: number,
): VoxelCameraVector {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const axisProjection = dot(axis, value) * (1 - cosine);
  const perpendicular = cross(axis, value);
  return {
    x: value.x * cosine + perpendicular.x * sine + axis.x * axisProjection,
    y: value.y * cosine + perpendicular.y * sine + axis.y * axisProjection,
    z: value.z * cosine + perpendicular.z * sine + axis.z * axisProjection,
  };
}

function slerpDirection(
  fromValue: VoxelCameraVector,
  toValue: VoxelCameraVector,
  progress: number,
  label: string,
): VoxelCameraVector {
  const from = normalize(fromValue, `${label} from`);
  const to = normalize(toValue, `${label} to`);
  const cosine = Math.max(-1, Math.min(1, dot(from, to)));
  if (cosine > 0.9995) return normalize(lerpVector(from, to, progress), label);
  if (cosine < -0.9995) {
    const basis = Math.abs(from.x) < 0.8 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const axis = normalize(cross(from, basis), `${label} axis`);
    return normalize(rotateAroundAxis(from, axis, Math.PI * progress), label);
  }
  const relative = normalize(
    {
      x: to.x - from.x * cosine,
      y: to.y - from.y * cosine,
      z: to.z - from.z * cosine,
    },
    `${label} relative`,
  );
  const angle = Math.acos(cosine) * progress;
  return {
    x: from.x * Math.cos(angle) + relative.x * Math.sin(angle),
    y: from.y * Math.cos(angle) + relative.y * Math.sin(angle),
    z: from.z * Math.cos(angle) + relative.z * Math.sin(angle),
  };
}

export function voxelCameraTransitionProgress(elapsedMs: number, durationMs: number): number {
  if (![elapsedMs, durationMs].every(Number.isFinite) || elapsedMs < 0 || durationMs < 0) {
    throw new RangeError("camera transition timing must be finite and non-negative");
  }
  if (durationMs === 0 || elapsedMs >= durationMs) return 1;
  const progress = elapsedMs / durationMs;
  return progress * progress * (3 - 2 * progress);
}

/** Interpolates on a spherical orbit, so the solid visibly rotates instead of cutting through it. */
export function interpolateVoxelCameraPose(
  from: VoxelCameraPose,
  to: VoxelCameraPose,
  progress: number,
): VoxelCameraPose {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new RangeError("camera transition progress must be between 0 and 1");
  }
  for (const [label, pose] of [["from", from], ["to", to]] as const) {
    assertVector(pose.position, `${label} position`);
    assertVector(pose.target, `${label} target`);
    assertVector(pose.up, `${label} up`);
  }
  if (progress === 0) return from;
  if (progress === 1) return to;

  const fromOffset = subtract(from.position, from.target);
  const toOffset = subtract(to.position, to.target);
  const radius = lerp(length(fromOffset), length(toOffset), progress);
  const direction = slerpDirection(fromOffset, toOffset, progress, "camera orbit");
  const target = lerpVector(from.target, to.target, progress);
  const up = slerpDirection(from.up, to.up, progress, "camera up");
  return {
    target,
    up,
    position: {
      x: target.x + direction.x * radius,
      y: target.y + direction.y * radius,
      z: target.z + direction.z * radius,
    },
  };
}
