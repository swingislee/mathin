import type { HTMLAttributes, ReactNode } from "react";
import { CoursewareStageViewport } from "@/features/courseware-doc/CoursewareStageViewport";
import { cn } from "@/lib/utils";

/**
 * Fits a read-only courseware stage into the exact remaining workspace area.
 * Step 1 only needs sizing; editing, selection, and persistence stay outside
 * this leaf until the product layout is accepted.
 */
export function FittedCoursewareCanvas({
  aspect,
  children,
  className,
}: {
  aspect: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <CoursewareStageViewport
      aspect={aspect}
      className={cn("p-3", className)}
      hostProps={{
        "data-fitted-courseware-canvas": true,
      } as HTMLAttributes<HTMLDivElement>}
      stageProps={{ "data-fitted-courseware-stage": true } as HTMLAttributes<HTMLDivElement>}
    >
      {children}
    </CoursewareStageViewport>
  );
}
