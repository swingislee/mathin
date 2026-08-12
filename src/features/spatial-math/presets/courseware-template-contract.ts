export const SPATIAL_COURSEWARE_TEMPLATE_ID = "sml0.voxel-layered-counting.v1" as const;

export const SPATIAL_COURSEWARE_TEMPLATE_IDS = [SPATIAL_COURSEWARE_TEMPLATE_ID] as const;

export type SpatialCoursewareTemplateId = (typeof SPATIAL_COURSEWARE_TEMPLATE_IDS)[number];

