import type { SpatialPageDoc } from "../domain";

export const VOXEL_EDITOR_STANDARD_PAGE_ERROR =
  "voxel editor preview requires a standard-4x3 1200x900 page" as const;

export function isVoxelEditorStandard4x3Page(page: SpatialPageDoc): boolean {
  return (
    page.layout.profile === "standard-4x3" &&
    page.presentation.viewport.width === 1_200 &&
    page.presentation.viewport.height === 900
  );
}

export function assertVoxelEditorStandard4x3Page(page: SpatialPageDoc): void {
  if (!isVoxelEditorStandard4x3Page(page)) {
    throw new TypeError(VOXEL_EDITOR_STANDARD_PAGE_ERROR);
  }
}
