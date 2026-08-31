import type { ComponentProps, HTMLAttributes } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Shared editor chrome for formal courseware and teacher compositions.
 * Document adapters own selection, editing and persistence; this component
 * owns the stable card, canvas and inspector geometry they render into.
 */
export function CoursewareEditorWorkbench({
  adapter,
  className,
  ...props
}: ComponentProps<typeof Card> & { adapter: string }) {
  return (
    <Card
      data-courseware-editor-workbench
      data-courseware-editor-adapter={adapter}
      className={cn("min-h-0 min-w-0 overflow-hidden", className)}
      {...props}
    />
  );
}

export function CoursewareEditorHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-courseware-editor-slot="header"
      className={cn("shrink-0 border-b border-line p-3", className)}
      {...props}
    />
  );
}

export function CoursewareEditorBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-courseware-editor-slot="body"
      className={cn("min-h-0 min-w-0 flex-1", className)}
      {...props}
    />
  );
}

export function CoursewareEditorCanvasFrame({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-courseware-editor-slot="canvas"
      className={cn("overflow-hidden rounded-xl border border-line bg-white shadow-sm", className)}
      {...props}
    />
  );
}

export function CoursewareEditorActionGrid({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-courseware-editor-slot="actions"
      className={cn("grid grid-cols-2 gap-2", className)}
      {...props}
    />
  );
}
