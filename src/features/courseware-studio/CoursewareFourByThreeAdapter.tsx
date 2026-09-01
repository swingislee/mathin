"use client";

import { useCallback, useMemo, useState } from "react";
import { LayoutTemplate, RotateCcw, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  COURSEWARE_43_STRATEGIES,
  courseware43ViewportPlacement,
  defaultCourseware43Session,
  deriveCourseware43PageDoc,
  isWholeStageCourseware43Strategy,
  supportsCourseware43Strategy,
  type Courseware43SessionState,
  type Courseware43Strategy,
} from "@/features/courseware-doc/courseware-4x3-strategy";
import { CoursewareStageViewport } from "@/features/courseware-doc/CoursewareStageViewport";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import type { PageDoc } from "@/features/courseware-doc/schema";
import type { SourceRuntimePageDoc } from "@/features/courseware-doc/source-runtime-schema";
import { cn } from "@/lib/utils";
import { StagePreview } from "./StagePreview";

type Courseware43AdapterSource =
  | { kind: "page-doc"; doc: PageDoc; bindingUrls: ResolvedBindingUrls }
  | { kind: "source-runtime"; doc: SourceRuntimePageDoc; bindingUrls: ResolvedBindingUrls };

export interface CoursewareFourByThreeController {
  source: Courseware43AdapterSource;
  state: Courseware43SessionState;
  initialState: Courseware43SessionState;
  canUndo: boolean;
  changed: boolean;
  selectStrategy: (strategy: Courseware43Strategy) => void;
  undo: () => void;
  reset: () => void;
}

export function useCoursewareFourByThreeAdapter(source: Courseware43AdapterSource) {
  const initialState = useMemo(
    () => defaultCourseware43Session(source.kind),
    [source.kind],
  );
  const [state, setState] = useState<Courseware43SessionState>(initialState);
  const [history, setHistory] = useState<Courseware43SessionState[]>([]);

  const commit = useCallback((next: Courseware43SessionState) => {
    setState((current) => {
      if (current.strategy === next.strategy) return current;
      setHistory((items) => [...items, current].slice(-20));
      return next;
    });
  }, []);
  const selectStrategy = useCallback((strategy: Courseware43Strategy) => {
    if (!supportsCourseware43Strategy(source.kind, strategy)) return;
    commit({ strategy });
  }, [commit, source.kind]);
  const undo = useCallback(() => {
    setHistory((items) => {
      const previous = items.at(-1);
      if (!previous) return items;
      setState(previous);
      return items.slice(0, -1);
    });
  }, []);
  const reset = useCallback(() => commit(initialState), [commit, initialState]);

  return useMemo<CoursewareFourByThreeController>(() => ({
    source,
    state,
    initialState,
    canUndo: history.length > 0,
    changed: state.strategy !== initialState.strategy,
    selectStrategy,
    undo,
    reset,
  }), [history.length, initialState, reset, selectStrategy, source, state, undo]);
}

const STRATEGY_COPY: Record<Courseware43Strategy, { label: string; description: string }> = {
  "fit-width-top": { label: "fitWidthTop", description: "fitWidthTopDescription" },
  "fit-width-center": { label: "fitWidthCenter", description: "fitWidthCenterDescription" },
  "fit-height-left": { label: "fitHeightLeft", description: "fitHeightLeftDescription" },
  "fit-height-center": { label: "fitHeightCenter", description: "fitHeightCenterDescription" },
  "background-height-content-width": {
    label: "backgroundHeightContentWidth",
    description: "backgroundHeightContentWidthDescription",
  },
};

function Courseware43StrategyIcon({ strategy }: { strategy: Courseware43Strategy }) {
  const canvas = <rect x="20" y="8" width="56" height="42" rx="4" className="stroke-current" fill="none" strokeWidth="1.5" />;
  if (strategy === "fit-width-top" || strategy === "fit-width-center") {
    const y = strategy === "fit-width-top" ? 8 : 13.25;
    return (
      <svg viewBox="0 0 96 58" aria-hidden="true" className="h-10 w-16 overflow-visible">
        <rect x="20" y="8" width="56" height="42" rx="4" className="fill-amber-200/65 dark:fill-amber-200/35" />
        <rect x="20" y={y} width="56" height="31.5" rx="3" className="fill-emerald-300/90" />
        {canvas}
      </svg>
    );
  }
  if (strategy === "fit-height-left" || strategy === "fit-height-center") {
    const x = strategy === "fit-height-left" ? 20 : 10.67;
    const viewportX = strategy === "fit-height-left" ? 20 : 20;
    return (
      <svg viewBox="0 0 96 58" aria-hidden="true" className="h-10 w-16 overflow-visible">
        <rect x={x} y="8" width="74.67" height="42" rx="4" className="fill-cyan-200/70 dark:fill-cyan-200/35" />
        <rect x={viewportX} y="8" width="56" height="42" rx="4" className="fill-emerald-300/75" />
        {canvas}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 96 58" aria-hidden="true" className="h-10 w-16 overflow-visible">
      <rect x="20" y="8" width="56" height="42" rx="4" className="fill-cyan-200/70 dark:fill-cyan-200/35" />
      <rect x="20" y="13.25" width="56" height="31.5" rx="3" className="fill-emerald-300/90" />
      {canvas}
    </svg>
  );
}

export function CoursewareFourByThreePanel({
  adapter,
  className,
}: {
  adapter: CoursewareFourByThreeController;
  className?: string;
}) {
  const t = useTranslations("coursewareFourByThree");
  const { source, state, canUndo, changed, selectStrategy, undo, reset } = adapter;
  const activeCopy = STRATEGY_COPY[state.strategy];

  return (
    <section data-courseware-4x3-adapter data-persistence="session-only" className={cn("space-y-4", className)}>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-xs font-medium text-ink">
            <LayoutTemplate className="size-4 text-crater" />
            {t("title")}
          </h3>
          <Badge variant="outline">{t(changed ? "changed" : "sessionOnly")}</Badge>
        </div>
        <p className="text-xs leading-5 text-muted">{t("sessionHint")}</p>
      </div>

      <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("strategyLabel")}>
        {COURSEWARE_43_STRATEGIES.map((strategy, index) => {
          const supported = supportsCourseware43Strategy(source.kind, strategy);
          const copy = STRATEGY_COPY[strategy];
          return (
            <Button
              key={strategy}
              type="button"
              variant="secondary"
              className={cn(
                "h-auto min-h-20 min-w-0 flex-col gap-1.5 px-2 py-2 text-[11px]",
                index === COURSEWARE_43_STRATEGIES.length - 1 && "col-span-2",
                state.strategy === strategy && "border-crater bg-moon/45 text-ink",
              )}
              aria-pressed={state.strategy === strategy}
              disabled={!supported}
              onClick={() => selectStrategy(strategy)}
            >
              <Courseware43StrategyIcon strategy={strategy} />
              <span>{t(copy.label)}</span>
            </Button>
          );
        })}
      </div>

      <p className="text-xs leading-5 text-muted">{t(activeCopy.description)}</p>
      {source.kind === "source-runtime" ? (
        <p className="text-xs leading-5 text-muted">{t("sourceRuntimeHint")}</p>
      ) : null}

      <div className="grid grid-cols-2 gap-2 border-t border-line pt-4">
        <Button type="button" size="sm" variant="secondary" disabled={!canUndo} onClick={undo}>
          <Undo2 className="size-4" />
          {t("undo")}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={!changed} onClick={reset}>
          <RotateCcw className="size-4" />
          {t("reset")}
        </Button>
      </div>
    </section>
  );
}

function sourceAspect(source: Courseware43AdapterSource) {
  return source.kind === "page-doc"
    ? source.doc.canvas.width / source.doc.canvas.height
    : source.doc.viewport.width / source.doc.viewport.height;
}

function NaturalStage({ source }: { source: Courseware43AdapterSource }) {
  return (
    <StagePreview
      doc={source.doc}
      bindingUrls={source.bindingUrls}
      stageMode="natural"
      className="size-full"
      interactive={false}
      playAutoInteractions={false}
    />
  );
}

function WholeStageAdaptedPreview({
  source,
  strategy,
}: {
  source: Courseware43AdapterSource;
  strategy: Exclude<Courseware43Strategy, "background-height-content-width">;
}) {
  const placement = courseware43ViewportPlacement(strategy, sourceAspect(source));
  return (
    <div
      data-courseware-4x3-whole-stage={strategy}
      className="relative size-full overflow-hidden bg-card"
    >
      <div
        className="absolute overflow-hidden"
        style={{
          left: `${placement.leftPercent}%`,
          top: `${placement.topPercent}%`,
          width: `${placement.widthPercent}%`,
          height: `${placement.heightPercent}%`,
        }}
      >
        <NaturalStage source={source} />
      </div>
    </div>
  );
}

export function CoursewareFourByThreeComparison({
  adapter,
  className,
  view = "compare",
}: {
  adapter: CoursewareFourByThreeController;
  className?: string;
  view?: "compare" | "native-16x9" | "adapted-4x3";
}) {
  const t = useTranslations("coursewareFourByThree");
  const { source, state } = adapter;
  const layeredPageDoc = useMemo(
    () => source.kind === "page-doc" && state.strategy === "background-height-content-width"
      ? deriveCourseware43PageDoc(source.doc, state)
      : null,
    [source, state],
  );
  const originalAspect = sourceAspect(source);

  const original = (
    <section className="min-h-0 min-w-0 bg-paper" aria-label={t("originalLabel")}>
      <CoursewareStageViewport aspect={originalAspect} className="p-3">
        <NaturalStage source={source} />
      </CoursewareStageViewport>
    </section>
  );
  const adapted = (
    <section className="min-h-0 min-w-0 bg-paper" aria-label={t("adaptedLabel")}>
      <CoursewareStageViewport aspect={4 / 3} className="p-3">
        {layeredPageDoc && source.kind === "page-doc" ? (
          <StagePreview
            doc={layeredPageDoc}
            bindingUrls={source.bindingUrls}
            stageMode="natural"
            className="size-full"
            interactive={false}
            playAutoInteractions={false}
          />
        ) : isWholeStageCourseware43Strategy(state.strategy) ? (
          <WholeStageAdaptedPreview source={source} strategy={state.strategy} />
        ) : null}
      </CoursewareStageViewport>
    </section>
  );

  if (view === "native-16x9") return <div className={cn("size-full min-h-0", className)}>{original}</div>;
  if (view === "adapted-4x3") return <div className={cn("size-full min-h-0", className)}>{adapted}</div>;
  return (
    <div data-courseware-4x3-comparison className={cn("grid size-full min-h-0 grid-cols-2 gap-px bg-line", className)}>
      {original}
      {adapted}
    </div>
  );
}
