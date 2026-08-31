"use client";

import {
  CoursewareWorkbench,
  type CoursewarePreviewWorkbenchProps,
  type CoursewareWorkbenchListItem,
} from "@/features/courseware-doc/CoursewareEditorWorkbench";

export type CoursewarePreviewListItem = CoursewareWorkbenchListItem;

/**
 * Compatibility entry for existing read-only consumers. The rendered panel
 * tree, fitted stage and paging behavior live in the same CoursewareWorkbench
 * as the formal-course and microcourse editors.
 */
export function CoursewarePreviewWorkspace(props: Omit<CoursewarePreviewWorkbenchProps, "mode">) {
  return <CoursewareWorkbench mode="preview" {...props} />;
}
