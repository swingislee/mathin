"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { LayoutTemplate, RotateCcw, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  COURSEWARE_43_STRATEGIES,
  defaultCourseware43Session,
  deriveCourseware43PageDoc,
  supportsCourseware43Strategy,
  type Courseware43SessionState,
  type Courseware43Strategy,
} from "@/features/courseware-doc/courseware-4x3-strategy";
import { CoursewareStageViewport } from "@/features/courseware-doc/CoursewareStageViewport";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import type { PageDoc } from "@/features/courseware-doc/schema";
import { sourceRuntimeFourByThreeMode } from "@/features/courseware-doc/source-runtime-four-by-three";
import type { SourceRuntimePageDoc } from "@/features/courseware-doc/source-runtime-schema";
import { cn } from "@/lib/utils";
import { StagePreview } from "./StagePreview";

type Courseware43AdapterSource =
  | { kind: "page-doc"; doc: PageDoc; bindingUrls: ResolvedBindingUrls }
  | { kind: "source-runtime"; doc: SourceRuntimePageDoc; bindingUrls: ResolvedBindingUrls };

interface Courseware43ContextValue {
  source: Courseware43AdapterSource;
  sourceMode: ReturnType<typeof sourceRuntimeFourByThreeMode> | undefined;
  state: Courseware43SessionState;
  initialState: Courseware43SessionState;
  canUndo: boolean;
  changed: boolean;
  selectStrategy: (strategy: Courseware43Strategy) => void;
  patchCustom: (patch: Partial<Courseware43SessionState["custom"]>) => void;
  undo: () => void;
  reset: () => void;
}

const Courseware43Context = createContext<Courseware43ContextValue | null>(null);

function useCourseware43Context() {
  const value = useContext(Courseware43Context);
  if (!value) throw new Error("COURSEWARE_43_ADAPTER_REQUIRED");
  return value;
}

export function CoursewareFourByThreeAdapter({
  source,
  children,
}: {
  source: Courseware43AdapterSource;
  children: ReactNode;
}) {
  const sourceMode = source.kind === "source-runtime"
    ? sourceRuntimeFourByThreeMode(source.doc)
    : undefined;
  const initialState = useMemo(
    () => defaultCourseware43Session(source.kind, sourceMode),
    [source.kind, sourceMode],
  );
  const [state, setState] = useState<Courseware43SessionState>(initialState);
  const [history, setHistory] = useState<Courseware43SessionState[]>([]);

  const commit = useCallback((next: Courseware43SessionState) => {
    setState((current) => {
      if (JSON.stringify(current) === JSON.stringify(next)) return current;
      setHistory((items) => [...items, current].slice(-20));
      return next;
    });
  }, []);
  const selectStrategy = useCallback((strategy: Courseware43Strategy) => {
    if (!supportsCourseware43Strategy(source.kind, strategy, sourceMode)) return;
    commit({ ...state, strategy });
  }, [commit, source.kind, sourceMode, state]);
  const patchCustom = useCallback((patch: Partial<Courseware43SessionState["custom"]>) => {
    commit({ ...state, strategy: "custom", custom: { ...state.custom, ...patch } });
  }, [commit, state]);
  const undo = useCallback(() => {
    setHistory((items) => {
      const previous = items.at(-1);
      if (!previous) return items;
      setState(previous);
      return items.slice(0, -1);
    });
  }, []);
  const reset = useCallback(() => {
    commit(initialState);
  }, [commit, initialState]);

  const value = useMemo<Courseware43ContextValue>(() => ({
    source,
    sourceMode,
    state,
    initialState,
    canUndo: history.length > 0,
    changed: JSON.stringify(state) !== JSON.stringify(initialState),
    selectStrategy,
    patchCustom,
    undo,
    reset,
  }), [history.length, initialState, patchCustom, reset, selectStrategy, source, sourceMode, state, undo]);

  return <Courseware43Context.Provider value={value}>{children}</Courseware43Context.Provider>;
}

function numberValue(value: string, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function CoursewareFourByThreePanel({ className }: { className?: string }) {
  const t = useTranslations("coursewareFourByThree");
  const {
    source,
    sourceMode,
    state,
    canUndo,
    changed,
    selectStrategy,
    patchCustom,
    undo,
    reset,
  } = useCourseware43Context();

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

      <div className="grid grid-cols-4 gap-2" role="group" aria-label={t("strategyLabel")}>
        {COURSEWARE_43_STRATEGIES.map((strategy) => {
          const supported = supportsCourseware43Strategy(source.kind, strategy, sourceMode);
          if (strategy === "source-native" && source.kind !== "source-runtime") return null;
          return (
            <Button
              key={strategy}
              type="button"
              size="sm"
              variant="secondary"
              className={cn(
                "h-9 min-w-0 px-2 text-xs",
                state.strategy === strategy && "border-crater bg-moon/45 text-ink",
              )}
              aria-pressed={state.strategy === strategy}
              disabled={!supported}
              onClick={() => selectStrategy(strategy)}
            >
              {t(strategy === "source-native" ? "sourceNativeShort" : strategy === "custom" ? "customShort" : `strategy${strategy}`)}
            </Button>
          );
        })}
      </div>

      <p className="text-xs leading-5 text-muted">
        {t(state.strategy === "source-native" ? "sourceNative" : state.strategy === "custom" ? "custom" : `description${state.strategy}`)}
      </p>

      {source.kind === "source-runtime" ? (
        <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">
          {t(sourceMode === "source-master" ? "sourceMasterHint" : "sourceCompatHint")}
        </p>
      ) : state.strategy === "D" ? (
        <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">{t("manualReflowGate")}</p>
      ) : null}

      {state.strategy === "custom" ? (
        <div className="grid grid-cols-3 gap-2 border-t border-line pt-4">
          <div className="space-y-1.5">
            <Label htmlFor="courseware-4x3-scale" className="text-xs">{t("scale")}</Label>
            <Input
              id="courseware-4x3-scale"
              type="number"
              min={25}
              max={150}
              step={1}
              value={state.custom.scale}
              onChange={(event) => patchCustom({ scale: numberValue(event.target.value, state.custom.scale, 25, 150) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="courseware-4x3-x" className="text-xs">{t("offsetX")}</Label>
            <Input
              id="courseware-4x3-x"
              type="number"
              min={-960}
              max={960}
              step={1}
              value={state.custom.translateX}
              onChange={(event) => patchCustom({ translateX: numberValue(event.target.value, state.custom.translateX, -960, 960) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="courseware-4x3-y" className="text-xs">{t("offsetY")}</Label>
            <Input
              id="courseware-4x3-y"
              type="number"
              min={-720}
              max={720}
              step={1}
              value={state.custom.translateY}
              onChange={(event) => patchCustom({ translateY: numberValue(event.target.value, state.custom.translateY, -720, 720) })}
            />
          </div>
        </div>
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

function SourceRuntimeAdaptedPreview({
  doc,
  bindingUrls,
  state,
}: {
  doc: SourceRuntimePageDoc;
  bindingUrls: ResolvedBindingUrls;
  state: Courseware43SessionState;
}) {
  const mode = state.strategy === "source-native" ? "source-master" : "source-player-compat";
  const custom = state.strategy === "custom";
  const content = (
    <StagePreview
      doc={doc}
      bindingUrls={bindingUrls}
      stageMode="board43"
      sourceRuntimeFourByThreeMode={mode}
      className="size-full"
      interactive={false}
    />
  );
  if (!custom) return content;
  return (
    <div className="relative size-full overflow-hidden bg-card">
      <div
        className="absolute"
        style={{
          left: `${state.custom.translateX / 9.6}%`,
          top: `${state.custom.translateY / 7.2}%`,
          width: `${state.custom.scale}%`,
          height: `${state.custom.scale}%`,
        }}
      >
        {content}
      </div>
    </div>
  );
}

export function CoursewareFourByThreeComparison({
  className,
  view = "compare",
}: {
  className?: string;
  view?: "compare" | "native-16x9" | "adapted-4x3";
}) {
  const t = useTranslations("coursewareFourByThree");
  const { source, state } = useCourseware43Context();
  const adaptedPageDoc = useMemo(
    () => source.kind === "page-doc" ? deriveCourseware43PageDoc(source.doc, state) : null,
    [source, state],
  );
  const originalAspect = source.kind === "page-doc"
    ? source.doc.canvas.width / source.doc.canvas.height
    : source.doc.viewport.width / source.doc.viewport.height;

  const original = (
    <section className="min-h-0 min-w-0 bg-paper" aria-label={t("originalLabel")}>
        <CoursewareStageViewport aspect={originalAspect} className="p-3">
          <StagePreview
            doc={source.doc}
            bindingUrls={source.bindingUrls}
            stageMode="natural"
            className="size-full"
            interactive={false}
            playAutoInteractions={false}
          />
        </CoursewareStageViewport>
    </section>
  );
  const adapted = (
    <section className="min-h-0 min-w-0 bg-paper" aria-label={t("adaptedLabel")}>
        <CoursewareStageViewport aspect={4 / 3} className="p-3">
          {source.kind === "page-doc" && adaptedPageDoc ? (
            <StagePreview
              doc={adaptedPageDoc}
              bindingUrls={source.bindingUrls}
              stageMode="natural"
              className="size-full"
              interactive={false}
              playAutoInteractions={false}
            />
          ) : source.kind === "source-runtime" ? (
            <SourceRuntimeAdaptedPreview doc={source.doc} bindingUrls={source.bindingUrls} state={state} />
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
