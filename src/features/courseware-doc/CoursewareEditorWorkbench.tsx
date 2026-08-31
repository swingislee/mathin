"use client";

import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type HTMLAttributes,
  type KeyboardEvent,
  type LabelHTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Save,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { usePanelLayout } from "@/hooks/use-panel-layout";
import { useSplitOrientation } from "@/hooks/use-split-orientation";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { CoursewareStageViewport } from "./CoursewareStageViewport";

const PREVIEW_SIDE_BY_SIDE_MIN_WIDTH = 560;
const EDITOR_THREE_COLUMN_MIN_WIDTH = 960;
const DIRECTORY_DEFAULT_SIZE = { standard: 200, wide: 224 } as const;
const DIRECTORY_MIN_SIZE = 180;
const CANVAS_MIN_SIZE = 320;
const INSPECTOR_DEFAULT_SIZE = 320;
const INSPECTOR_MIN_SIZE = 280;

interface CoursewareEditorDirectory {
  ariaLabel: string;
  header: ReactNode;
  content: ReactNode;
  footer?: ReactNode;
  width?: "standard" | "wide";
}

interface CoursewareEditorCanvas {
  ariaLabel: string;
  header?: ReactNode;
  content: ReactNode;
  footer?: ReactNode;
}

interface CoursewareEditorInspector {
  ariaLabel: string;
  header: ReactNode;
  summary?: ReactNode;
  content?: ReactNode;
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

export interface CoursewareWorkbenchListItem {
  id: string;
  title: string;
  href?: string;
  leading?: ReactNode;
  titleContent?: ReactNode;
  trailing?: ReactNode;
  selectable?: boolean;
  disabled?: boolean;
}

export interface CoursewareEditorChrome {
  toolbar?: ReactNode;
  saveControls?: ReactNode;
  inspectorHeader?: ReactNode;
  inspector?: ReactNode;
}

interface RegisteredEditorChrome {
  ownerId: string;
  chrome: CoursewareEditorChrome;
}

interface CoursewareEditorChromeContextValue {
  register: (ownerId: string, chrome: CoursewareEditorChrome) => void;
  unregister: (ownerId: string) => void;
}

const CoursewareEditorChromeContext = createContext<CoursewareEditorChromeContextValue | null>(null);

/**
 * An editor adapter registers its controls with the one workbench that owns
 * their geometry. This replaces DOM-id portals, so toolbar, save state and the
 * inspector cannot silently mount in different page structures.
 */
export function useCoursewareEditorChrome({
  toolbar,
  saveControls,
  inspectorHeader,
  inspector,
}: CoursewareEditorChrome) {
  const context = useContext(CoursewareEditorChromeContext);
  const ownerId = useId();

  useLayoutEffect(() => {
    if (!context) return;
    context.register(ownerId, { toolbar, saveControls, inspectorHeader, inspector });
    return () => context.unregister(ownerId);
  }, [context, inspector, inspectorHeader, ownerId, saveControls, toolbar]);
}

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

type CoursewareAuthoringWorkbenchProps = Omit<ComponentProps<typeof Card>, "children"> & {
  mode: "formal-editor" | "microcourse-editor";
  adapter: string;
  layout: "viewport" | "workspace";
  layoutId?: string;
  directory: CoursewareEditorDirectory;
  toolbar?: ReactNode;
  saveControls?: ReactNode;
  canvas: CoursewareEditorCanvas;
  inspector: CoursewareEditorInspector;
};

export interface CoursewarePreviewWorkbenchProps {
  mode: "preview";
  items: CoursewareWorkbenchListItem[];
  selectedIndex: number;
  onSelectedIndexChange?: (index: number) => void;
  directoryLabel: string;
  previewLabel: string;
  previousLabel: string;
  nextLabel: string;
  toolbarTargetId?: string;
  selectedPageLabel?: string;
  railStatus?: ReactNode;
  railFooter?: ReactNode;
  preview: ReactNode;
  previewAspect?: number;
  railWidth?: "standard" | "wide";
  layoutId?: string;
  className?: string;
}

export type CoursewareWorkbenchMode = "preview" | "formal-editor" | "microcourse-editor";

// Directory, canvas toolbar and inspector title are one visual row. Keep the
// height contract here so adapter content cannot make one product drift taller.
const WORKBENCH_HEADER_ROW_CLASS = "h-11 min-h-11 max-h-11 shrink-0 border-b border-line";

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

function CoursewareWorkbenchFrame({
  mode,
  adapter,
  layout,
  layoutId,
  directory,
  toolbar,
  saveControls,
  canvas,
  inspector,
  containerRef,
  fullscreen = false,
  className,
  cardProps,
}: {
  mode: CoursewareWorkbenchMode;
  adapter?: string;
  layout: "viewport" | "workspace";
  layoutId: string;
  directory: CoursewareEditorDirectory;
  toolbar?: ReactNode;
  saveControls?: ReactNode;
  canvas: CoursewareEditorCanvas;
  inspector?: CoursewareEditorInspector;
  containerRef?: Ref<HTMLDivElement>;
  fullscreen?: boolean;
  className?: string;
  cardProps?: Omit<ComponentProps<typeof Card>, "children" | "className">;
}) {
  const editable = mode !== "preview";
  const [measureRef, orientation] = useSplitOrientation(
    editable ? EDITOR_THREE_COLUMN_MIN_WIDTH : PREVIEW_SIDE_BY_SIDE_MIN_WIDTH,
  );
  const { groupRef, onLayoutChanged } = usePanelLayout(`${layoutId}:${mode}:${orientation}`);
  const [registered, setRegistered] = useState<RegisteredEditorChrome | null>(null);

  const register = useCallback((ownerId: string, chrome: CoursewareEditorChrome) => {
    setRegistered({ ownerId, chrome });
  }, []);
  const unregister = useCallback((ownerId: string) => {
    setRegistered((current) => current?.ownerId === ownerId ? null : current);
  }, []);
  const chromeContext = useMemo(() => ({ register, unregister }), [register, unregister]);
  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    measureRef.current = node;
    assignRef(containerRef, node);
  }, [containerRef, measureRef]);

  const horizontal = orientation === "horizontal";
  const activeToolbar = registered?.chrome.toolbar ?? toolbar;
  const activeSaveControls = registered?.chrome.saveControls ?? saveControls;
  const activeInspectorHeader = registered?.chrome.inspectorHeader;
  const activeInspector = registered?.chrome.inspector ?? inspector?.content;

  return (
    <Card
      ref={setContainerRef}
      data-courseware-workbench
      data-courseware-workbench-mode={mode}
      data-courseware-editor-workbench={editable ? true : undefined}
      data-courseware-editor-adapter={adapter}
      data-courseware-editor-adapt-4x3={mode === "formal-editor" ? "enabled" : "disabled"}
      data-courseware-editor-layout={layout}
      data-courseware-preview-workspace={mode === "preview" ? true : undefined}
      data-orientation={orientation}
      data-fullscreen={fullscreen ? "true" : undefined}
      className={cn(
        "h-full min-h-0 min-w-0 overflow-hidden",
        fullscreen && "bg-paper p-3",
        className,
      )}
      {...cardProps}
    >
      <CoursewareEditorChromeContext.Provider value={chromeContext}>
        <ResizablePanelGroup
          groupRef={groupRef}
          orientation={orientation}
          onLayoutChanged={onLayoutChanged}
          className="size-full min-h-0 min-w-0"
        >
          <ResizablePanel
            id="directory"
            minSize={horizontal ? DIRECTORY_MIN_SIZE : "18%"}
            maxSize={horizontal ? "45%" : "45%"}
            defaultSize={horizontal ? DIRECTORY_DEFAULT_SIZE[directory.width ?? "wide"] : "28%"}
            groupResizeBehavior={horizontal ? "preserve-pixel-size" : undefined}
            className="overflow-hidden"
          >
            <nav
              data-courseware-editor-slot="directory"
              aria-label={directory.ariaLabel}
              className="flex size-full min-h-0 min-w-0 flex-col overflow-hidden"
            >
              <div
                data-courseware-editor-part="directory-header"
                className={cn(WORKBENCH_HEADER_ROW_CLASS, "flex items-center justify-between gap-2 px-3 py-2")}
              >
                {directory.header}
              </div>
              <div data-courseware-editor-part="directory-content" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {directory.content}
              </div>
              {directory.footer ? (
                <div data-courseware-editor-part="directory-footer" className="shrink-0 border-t border-line">
                  {directory.footer}
                </div>
              ) : null}
            </nav>
          </ResizablePanel>

          <ResizableHandle orientation={orientation} />

          <ResizablePanel
            id="canvas"
            minSize={horizontal ? CANVAS_MIN_SIZE : "30%"}
            defaultSize={horizontal ? undefined : editable ? "44%" : "72%"}
            className="overflow-hidden"
          >
            {editable ? (
              <div
                data-courseware-editor-slot="toolbar"
                className={cn(WORKBENCH_HEADER_ROW_CLASS, "flex items-center gap-3 px-3")}
              >
                <div data-courseware-editor-part="insert-toolbar" className="min-w-0 flex-1">
                  {activeToolbar}
                </div>
                {activeSaveControls ? (
                  <div data-courseware-editor-part="save-controls" className="ml-auto shrink-0">
                    {activeSaveControls}
                  </div>
                ) : null}
              </div>
            ) : canvas.header ? (
              <div data-courseware-editor-part="canvas-header" className={WORKBENCH_HEADER_ROW_CLASS}>
                {canvas.header}
              </div>
            ) : null}
            <main
              data-courseware-editor-slot="canvas"
              aria-label={canvas.ariaLabel}
              className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
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
          </ResizablePanel>

          {editable && inspector ? (
            <>
              <ResizableHandle orientation={orientation} />
              <ResizablePanel
                id="inspector"
                minSize={horizontal ? INSPECTOR_MIN_SIZE : "20%"}
                maxSize={horizontal ? "48%" : "50%"}
                defaultSize={horizontal ? INSPECTOR_DEFAULT_SIZE : "28%"}
                groupResizeBehavior={horizontal ? "preserve-pixel-size" : undefined}
                className="overflow-hidden"
              >
                <div
                  data-courseware-editor-slot="inspector-header"
                  className={cn(WORKBENCH_HEADER_ROW_CLASS, "flex items-center gap-3 px-3 py-2")}
                >
                  {inspector.header}
                  {activeInspectorHeader ? (
                    <div data-courseware-editor-part="inspector-header-controls" className="ml-auto min-w-0 flex-1">
                      {activeInspectorHeader}
                    </div>
                  ) : null}
                </div>
                <aside
                  data-courseware-editor-slot="inspector"
                  className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                  aria-label={inspector.ariaLabel}
                >
                  {inspector.summary ? <div className="shrink-0">{inspector.summary}</div> : null}
                  <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{activeInspector}</div>
                </aside>
              </ResizablePanel>
            </>
          ) : null}
        </ResizablePanelGroup>
      </CoursewareEditorChromeContext.Provider>
    </Card>
  );
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select, [role='textbox']");
}

function blocksPaging(target: EventTarget | null, key: string) {
  if (isEditableTarget(target)) return true;
  return key === " " && target instanceof HTMLElement && target.matches("button, [role='button']");
}

export function CoursewareWorkbenchPageRail({
  items,
  selectedIndex,
  onSelectedIndexChange,
  onItemTitleChange,
  onItemTitleCommit,
  titleInputLabel,
  titleInputDisabled = false,
}: {
  items: CoursewareWorkbenchListItem[];
  selectedIndex: number;
  onSelectedIndexChange?: (index: number) => void;
  onItemTitleChange?: (item: CoursewareWorkbenchListItem, index: number, value: string) => void;
  onItemTitleCommit?: (item: CoursewareWorkbenchListItem, index: number, value: string) => void;
  titleInputLabel?: string;
  titleInputDisabled?: boolean;
}) {
  const railRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      railRef.current
        ?.querySelector<HTMLElement>(`[data-courseware-page-rail-index="${selectedIndex}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [items.length, selectedIndex]);

  const selectByKeyboard = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelectedIndexChange?.(index);
  };

  return (
    <ol ref={railRef} data-courseware-page-rail className="h-full min-h-0 w-full divide-y divide-line overflow-y-auto overscroll-contain">
      {items.map((item, index) => {
        const active = selectedIndex === index;
        const selectable = item.selectable !== false;
        const editingTitle = active && Boolean(onItemTitleChange);
        const content = (
          <>
            <span className="w-5 shrink-0 text-right font-mono text-[11px] text-muted">{index + 1}</span>
            {item.leading}
            <span className="min-w-0 flex-1">{editingTitle ? (
              <Input
                aria-label={titleInputLabel}
                value={item.title}
                maxLength={500}
                disabled={titleInputDisabled}
                className="h-7 min-w-0 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-1"
                onChange={(event) => onItemTitleChange?.(item, index, event.target.value)}
                onBlur={(event) => onItemTitleCommit?.(item, index, event.target.value)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            ) : item.titleContent ?? <span className="block truncate text-xs text-ink">{item.title}</span>}</span>
            {item.trailing}
          </>
        );
        const rowClass = cn(
          "group flex min-h-11 items-center gap-1.5 px-2 py-1.5 transition-colors",
          active ? "bg-crater/10" : "bg-line/10 hover:bg-moon/20",
        );
        return (
          <li key={item.id} data-courseware-page-rail-index={index}>
            {editingTitle ? (
              <div aria-current="page" title={item.title} className={rowClass}>
                {content}
              </div>
            ) : item.href ? (
              <Link href={item.href} aria-current={active ? "page" : undefined} title={item.title} className={rowClass}>
                {content}
              </Link>
            ) : (
              selectable ? (
                <div
                  role="button"
                  tabIndex={item.disabled ? -1 : 0}
                  aria-current={active ? "page" : undefined}
                  aria-disabled={item.disabled || undefined}
                  title={item.title}
                  onClick={() => { if (!item.disabled) onSelectedIndexChange?.(index); }}
                  onKeyDown={(event) => { if (!item.disabled) selectByKeyboard(event, index); }}
                  className={cn(rowClass, item.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer")}
                >
                  {content}
                </div>
              ) : (
                <div aria-current={active ? "page" : undefined} title={item.title} className={rowClass}>
                  {content}
                </div>
              )
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function CoursewareWorkbenchPager({
  previousLabel,
  nextLabel,
  previousDisabled,
  nextDisabled,
  onPrevious,
  onNext,
  previousHref,
  nextHref,
  center,
}: {
  previousLabel: string;
  nextLabel: string;
  previousDisabled: boolean;
  nextDisabled: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  previousHref?: string | null;
  nextHref?: string | null;
  center?: ReactNode;
}) {
  const router = useRouter();
  const goPrevious = useCallback(() => {
    if (previousDisabled) return;
    if (previousHref) router.push(previousHref);
    else onPrevious?.();
  }, [onPrevious, previousDisabled, previousHref, router]);
  const goNext = useCallback(() => {
    if (nextDisabled) return;
    if (nextHref) router.push(nextHref);
    else onNext?.();
  }, [nextDisabled, nextHref, onNext, router]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (blocksPaging(event.target, event.key)) return;
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        if (previousDisabled) return;
        event.preventDefault();
        goPrevious();
      } else if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        if (nextDisabled) return;
        event.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, goPrevious, nextDisabled, previousDisabled]);

  return (
    <div className="flex w-full items-center justify-between gap-2">
      {previousHref ? (
        <Link href={previousHref} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium hover:bg-moon/30">
          <ChevronLeft size={15} />
          {previousLabel}
        </Link>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={previousDisabled}
          aria-keyshortcuts="ArrowLeft PageUp"
          onClick={goPrevious}
        >
          <ChevronLeft size={15} />
          {previousLabel}
        </Button>
      )}
      {center ? <div className="flex min-w-0 flex-1 items-center justify-center overflow-hidden">{center}</div> : <span className="flex-1" />}
      {nextHref ? (
        <Link href={nextHref} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium hover:bg-moon/30">
          {nextLabel}
          <ChevronRight size={15} />
        </Link>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={nextDisabled}
          aria-keyshortcuts="ArrowRight PageDown Space"
          onClick={goNext}
        >
          {nextLabel}
          <ChevronRight size={15} />
        </Button>
      )}
    </div>
  );
}

function CoursewarePreviewMode({
  mode,
  items,
  selectedIndex,
  onSelectedIndexChange,
  directoryLabel,
  previewLabel,
  previousLabel,
  nextLabel,
  toolbarTargetId,
  selectedPageLabel,
  railStatus,
  railFooter,
  preview,
  previewAspect = 4 / 3,
  railWidth = "standard",
  layoutId = "courseware-preview",
  className,
}: CoursewarePreviewWorkbenchProps) {
  const router = useRouter();
  const commonT = useTranslations("common");
  const elementRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === elementRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const element = elementRef.current;
    if (!element) return;
    if (document.fullscreenElement === element) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    void element.requestFullscreen().catch(() => undefined);
  }, []);

  const goTo = useCallback((index: number) => {
    const item = items[index];
    if (!item) return;
    if (item.href) {
      router.push(item.href);
      return;
    }
    onSelectedIndexChange?.(index);
  }, [items, onSelectedIndexChange, router]);
  const goPrevious = useCallback(() => goTo(selectedIndex - 1), [goTo, selectedIndex]);
  const goNext = useCallback(() => goTo(selectedIndex + 1), [goTo, selectedIndex]);

  return (
    <CoursewareWorkbenchFrame
      mode={mode}
      layout="viewport"
      layoutId={layoutId}
      containerRef={elementRef}
      fullscreen={fullscreen}
      className={className}
      directory={{
        ariaLabel: directoryLabel,
        width: railWidth,
        header: <>
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted">{directoryLabel}</span>
          {railStatus}
        </>,
        content: <CoursewareWorkbenchPageRail
          items={items}
          selectedIndex={selectedIndex}
          onSelectedIndexChange={onSelectedIndexChange}
        />,
        footer: railFooter ? <div className="p-1.5">{railFooter}</div> : undefined,
      }}
      canvas={{
        ariaLabel: previewLabel,
        header: <div className="flex min-h-11 items-center gap-2 px-3 py-1.5">
          <span className="shrink-0 text-xs font-medium text-muted">{previewLabel}</span>
          {selectedPageLabel ? <span className="min-w-0 flex-1 truncate text-right text-xs text-muted">{selectedPageLabel}</span> : <span className="flex-1" />}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-courseware-preview-fullscreen
            className="size-7 shrink-0 rounded-full p-0 text-muted hover:text-ink"
            aria-pressed={fullscreen}
            aria-label={commonT(fullscreen ? "exitFullscreen" : "enterFullscreen")}
            title={commonT(fullscreen ? "exitFullscreen" : "enterFullscreen")}
            onClick={toggleFullscreen}
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </Button>
        </div>,
        content: <CoursewareStageViewport
          aspect={previewAspect}
          align="start"
          stageProps={{ "data-courseware-preview-stage": true } as HTMLAttributes<HTMLDivElement>}
        >
          {preview}
        </CoursewareStageViewport>,
        footer: <CoursewareWorkbenchPager
          previousLabel={previousLabel}
          nextLabel={nextLabel}
          previousDisabled={selectedIndex <= 0}
          nextDisabled={selectedIndex >= items.length - 1}
          onPrevious={goPrevious}
          onNext={goNext}
          center={toolbarTargetId ? <div id={toolbarTargetId} className="min-w-0 flex-1" /> : undefined}
        />,
      }}
    />
  );
}

/**
 * One actual workbench with three modes. All modes render the same panel tree;
 * preview omits the authoring top bar and inspector, while formal authoring is
 * the only mode that exposes the 4:3 adaptation capability.
 */
export function CoursewareWorkbench(
  props: CoursewarePreviewWorkbenchProps | CoursewareAuthoringWorkbenchProps,
) {
  if (props.mode === "preview") {
    return <CoursewarePreviewMode {...props} />;
  }

  const {
    mode,
    adapter,
    layout,
    layoutId = `${mode}-${layout}`,
    directory,
    toolbar,
    saveControls,
    canvas,
    inspector,
    className,
    ...cardProps
  } = props;
  return (
    <CoursewareWorkbenchFrame
      mode={mode}
      adapter={adapter}
      layout={layout}
      layoutId={layoutId}
      directory={directory}
      toolbar={toolbar}
      saveControls={saveControls}
      canvas={canvas}
      inspector={inspector}
      className={className}
      cardProps={cardProps}
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
