import type { ComponentProps, HTMLAttributes, LabelHTMLAttributes } from "react";
import { Button } from "@/components/ui/button";
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

export function CoursewareEditorToolbar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="toolbar"
      data-courseware-editor-slot="toolbar"
      className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}
      {...props}
    />
  );
}

export function CoursewareEditorToolbarButton({
  selected = false,
  className,
  ...props
}: ComponentProps<typeof Button> & { selected?: boolean }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-pressed={selected || undefined}
      className={cn("size-9 shrink-0 p-0", selected && "bg-crater/15 text-ink", className)}
      {...props}
    />
  );
}

export function CoursewareEditorToolbarLabel({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      data-courseware-editor-toolbar-label
      className={cn("inline-grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-moon/30 hover:text-ink", className)}
      {...props}
    />
  );
}
