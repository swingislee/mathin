import type { ComponentProps, HTMLAttributes, LabelHTMLAttributes, ReactNode } from "react";
import { Fragment } from "react";
import { LoaderCircle, Save, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface CoursewareEditorDirectory {
  ariaLabel: string;
  header: ReactNode;
  content: ReactNode;
  footer?: ReactNode;
}

interface CoursewareEditorCanvas {
  ariaLabel: string;
  content: ReactNode;
  footer?: ReactNode;
}

interface CoursewareEditorInspector {
  ariaLabel: string;
  header: ReactNode;
  content: ReactNode;
}

export interface CoursewareEditorInsertAction {
  id: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  onSelect?: () => void;
  control?: ReactNode;
}

export type CoursewareEditorSaveState = "saved" | "saving" | "dirty" | "error";

export function CoursewareEditorSaveControls({
  state,
  labels,
  onSave,
  disabled = false,
  statusTestId,
  className,
}: {
  state: CoursewareEditorSaveState;
  labels: Record<CoursewareEditorSaveState, string> & { saveNow: string };
  onSave: () => void;
  disabled?: boolean;
  statusTestId?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex w-full min-w-0 items-center justify-end gap-2", className)}>
      <span
        data-testid={statusTestId}
        role="status"
        aria-live="polite"
        className={cn(
          "inline-flex min-w-0 items-center gap-1 truncate text-xs",
          state === "error" ? "text-rose" : "text-muted",
        )}
      >
        {state === "saving" ? <LoaderCircle className="size-3.5 shrink-0 animate-spin" /> : null}
        {labels[state]}
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="size-9 shrink-0 p-0"
        aria-label={labels.saveNow}
        title={labels.saveNow}
        disabled={disabled || state === "saving"}
        onClick={onSave}
      >
        <Save className="size-4" />
      </Button>
    </div>
  );
}

/**
 * Shared editor chrome for formal courseware and teacher compositions.
 * Document adapters own selection, editing and persistence; this component
 * owns the stable card, canvas and inspector geometry they render into.
 */
export function CoursewareEditorWorkbench({
  adapter,
  capabilities,
  layout,
  directory,
  toolbar,
  canvas,
  inspector,
  className,
  ...props
}: Omit<ComponentProps<typeof Card>, "children"> & {
  adapter: string;
  capabilities: { adapt4x3: boolean };
  layout: "viewport" | "workspace";
  directory: CoursewareEditorDirectory;
  toolbar: ReactNode;
  canvas: CoursewareEditorCanvas;
  inspector: CoursewareEditorInspector;
}) {
  const viewportLayout = layout === "viewport";
  return (
    <Card
      data-courseware-editor-workbench
      data-courseware-editor-adapter={adapter}
      data-courseware-editor-adapt-4x3={capabilities.adapt4x3 ? "enabled" : "disabled"}
      data-courseware-editor-layout={layout}
      className={cn(
        "grid min-h-0 min-w-0 grid-cols-1 grid-rows-[minmax(12rem,32dvh)_2.75rem_minmax(22rem,1fr)_2.75rem_minmax(12rem,30dvh)] overflow-hidden",
        viewportLayout
          ? "xl:grid-cols-[13rem_minmax(0,1fr)_22rem] xl:grid-rows-[2.75rem_minmax(0,1fr)]"
          : "@4xl/workspace:grid-cols-[224px_minmax(0,1fr)_320px] @4xl/workspace:grid-rows-[2.75rem_minmax(0,1fr)]",
        className,
      )}
      {...props}
    >
      <nav
        data-courseware-editor-slot="directory"
        aria-label={directory.ariaLabel}
        className={cn(
          "flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-line",
          viewportLayout
            ? "xl:row-span-2 xl:border-b-0 xl:border-r"
            : "@4xl/workspace:row-span-2 @4xl/workspace:border-b-0 @4xl/workspace:border-r",
        )}
      >
        <div data-courseware-editor-part="directory-header" className="flex min-h-11 shrink-0 items-center justify-between gap-2 px-3 py-2">
          {directory.header}
        </div>
        <div data-courseware-editor-part="directory-content" className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {directory.content}
        </div>
        {directory.footer ? (
          <div data-courseware-editor-part="directory-footer" className="shrink-0">
            {directory.footer}
          </div>
        ) : null}
      </nav>
      <div
        data-courseware-editor-slot="toolbar"
        className={cn(
          "min-h-0 min-w-0 overflow-hidden border-b border-line",
          viewportLayout
            ? "xl:col-start-2 xl:row-start-1"
            : "@4xl/workspace:col-start-2 @4xl/workspace:row-start-1",
        )}
      >
        <div data-courseware-editor-part="insert-toolbar" className="flex size-full min-w-0 items-center px-3">
          {toolbar}
        </div>
      </div>
      <main
        data-courseware-editor-slot="canvas"
        aria-label={canvas.ariaLabel}
        className={cn(
          "flex min-h-0 min-w-0 flex-col overflow-hidden",
          viewportLayout
            ? "xl:col-start-2 xl:row-start-2"
            : "@4xl/workspace:col-start-2 @4xl/workspace:row-start-2",
        )}
      >
        <div data-courseware-editor-part="canvas-content" className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {canvas.content}
        </div>
        {canvas.footer ? (
          <div data-courseware-editor-part="canvas-footer" className="flex min-h-11 shrink-0 items-center border-t border-line px-2 py-1.5">
            {canvas.footer}
          </div>
        ) : null}
      </main>
      <div
        data-courseware-editor-slot="inspector-header"
        className={cn(
          "min-h-0 min-w-0 overflow-hidden border-y border-line",
          viewportLayout
            ? "xl:col-start-3 xl:row-start-1 xl:border-y-0 xl:border-b xl:border-l"
            : "@4xl/workspace:col-start-3 @4xl/workspace:row-start-1 @4xl/workspace:border-y-0 @4xl/workspace:border-b @4xl/workspace:border-l",
        )}
      >
        <div data-courseware-editor-part="inspector-header" className="flex size-full min-w-0 items-center gap-3 px-3 py-2">
          {inspector.header}
        </div>
      </div>
      <div
        data-courseware-editor-slot="inspector"
        className={cn(
          "min-h-0 min-w-0 overflow-hidden",
          viewportLayout
            ? "xl:col-start-3 xl:row-start-2 xl:border-l xl:border-line"
            : "@4xl/workspace:col-start-3 @4xl/workspace:row-start-2 @4xl/workspace:border-l @4xl/workspace:border-line",
        )}
      >
        <aside className="size-full min-h-0 min-w-0 overflow-hidden" aria-label={inspector.ariaLabel}>
          {inspector.content}
        </aside>
      </div>
    </Card>
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

export function CoursewareInsertionToolbar({
  actions,
  className,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, "children"> & { actions: CoursewareEditorInsertAction[] }) {
  return (
    <CoursewareEditorToolbar className={cn("flex-nowrap", className)} {...props}>
      {actions.map(({ id, label, icon: Icon, disabled, onSelect, control }) => (
        control ? <Fragment key={id}>{control}</Fragment> : (
          <CoursewareEditorToolbarButton
            key={id}
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={onSelect}
          >
            <Icon className="size-4" />
          </CoursewareEditorToolbarButton>
        )
      ))}
    </CoursewareEditorToolbar>
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
