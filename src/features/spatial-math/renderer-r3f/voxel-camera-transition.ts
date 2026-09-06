// 兼容已有导出；空间实验室所有实体使用同一份相机运动合同。
export {
  SPATIAL_CAMERA_TRANSITION_MS as VOXEL_CAMERA_TRANSITION_MS,
  SPATIAL_AXIS_SNAP_TRANSITION_MS as VOXEL_AXIS_SNAP_TRANSITION_MS,
  SPATIAL_AXIS_SNAP_DEGREES as VOXEL_AXIS_SNAP_DEGREES,
  interpolateSpatialCameraPose as interpolateVoxelCameraPose,
  snapSpatialCameraPoseToPrincipalAxis as snapVoxelCameraPoseToPrincipalAxis,
  spatialCameraTransitionProgress as voxelCameraTransitionProgress,
  type SpatialCameraPose as VoxelCameraPose,
  type SpatialCameraVector as VoxelCameraVector,
} from "./spatial-camera-motion";
