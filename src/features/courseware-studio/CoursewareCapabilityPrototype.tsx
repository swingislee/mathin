"use client";

import { useEffect, useState } from "react";
import {
  CircleAlert,
  Eye,
  FileCode2,
  Gamepad2,
  ImageIcon,
  ImagePlus,
  LayoutTemplate,
  RotateCcw,
  Shapes,
  Sigma,
  Type,
  Undo2,
  Wrench,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CoursewareEditorActionGrid,
  CoursewareInsertionToolbar,
} from "@/features/courseware-doc/CoursewareEditorWorkbench";
import { cn } from "@/lib/utils";

const LAYOUT_STRATEGIES = ["A", "B", "C", "D", "E", "F", "custom"] as const;
const REPLACEMENT_SCOPES = ["page", "lecture", "variant", "family", "all"] as const;

type PrototypeTab = "adjust" | "layout" | "replace";
type LayoutStrategy = (typeof LAYOUT_STRATEGIES)[number];
type ReplacementScope = (typeof REPLACEMENT_SCOPES)[number];

interface PrototypeAction {
  id: number;
  label: string;
  detail: string;
}

function SelectableButton({
  selected,
  children,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { selected?: boolean }) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      aria-pressed={selected}
      className={cn(
        "h-auto min-h-9 justify-start rounded-lg px-3 py-2 text-left leading-4",
        selected && "border-crater bg-moon/45 text-ink",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
}

function CapabilityNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function CoursewareCapabilityPrototype({
  sourceType,
  activeCanvas,
  hasAdaptedPreview,
  toolbarTargetId,
  tabsTargetId,
}: {
  sourceType: string;
  activeCanvas: "compare" | "native-16x9" | "adapted-4x3";
  hasAdaptedPreview: boolean;
  toolbarTargetId: string;
  tabsTargetId: string;
}) {
  const t = useTranslations("coursewareWorkspace");
  const [activeTab, setActiveTab] = useState<PrototypeTab>("adjust");
  const [adjustTool, setAdjustTool] = useState("text");
  const [syncContent, setSyncContent] = useState(true);
  const [layoutStrategy, setLayoutStrategy] = useState<LayoutStrategy>(
    sourceType === "source-runtime-page-v1" ? "E" : "C",
  );
  const [replacementKind, setReplacementKind] = useState("background");
  const [replacementScope, setReplacementScope] = useState<ReplacementScope>("page");
  const [history, setHistory] = useState<PrototypeAction[]>([]);
  const [toolbarTarget, setToolbarTarget] = useState<HTMLElement | null>(null);
  const [tabsTarget, setTabsTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setToolbarTarget(document.getElementById(toolbarTargetId));
      setTabsTarget(document.getElementById(tabsTargetId));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [tabsTargetId, toolbarTargetId]);

  const sourceRuntime = sourceType === "source-runtime-page-v1";
  const composition = sourceType === "courseware-composition-v1";
  const pageDoc = sourceType === "page-doc-v1";
  const knownSource = sourceRuntime || composition || pageDoc;
  const canAdjustContent = pageDoc || composition;
  const canInsertContent = pageDoc || composition;

  const record = (label: string, detail: string) => {
    setHistory((current) => [...current, {
      id: (current.at(-1)?.id ?? 0) + 1,
      label,
      detail,
    }].slice(-4));
  };

  const adjustTools = [
    { value: "text", label: t("prototypeAdjustText") },
    { value: "image", label: t("prototypeAdjustImage") },
    { value: "position", label: t("prototypeAdjustPosition") },
    { value: "layer", label: t("prototypeAdjustLayer") },
  ];
  const insertTools = [
    { value: "text", label: t("prototypeInsertText"), Icon: Type },
    { value: "formula", label: t("prototypeInsertFormula"), Icon: Sigma },
    { value: "shape", label: t("prototypeInsertShape"), Icon: Shapes },
    { value: "image", label: t("prototypeInsertImage"), Icon: ImagePlus },
    { value: "game", label: t("prototypeInsertGame"), Icon: Gamepad2 },
    { value: "h5", label: t("prototypeInsertH5"), Icon: FileCode2 },
    { value: "tool", label: t("prototypeInsertTool"), Icon: Wrench },
  ];

  const insertToolbar = (
    <>
      <span id="courseware-insert-prototype-hint" className="sr-only">{t("prototypeInsertionSyncGate")}</span>
      <CoursewareInsertionToolbar
        aria-label={t("contentInsertion")}
        aria-describedby="courseware-insert-prototype-hint"
        actions={insertTools.map(({ value, label, Icon }) => ({
          id: value,
          label,
          icon: Icon,
          disabled: !canInsertContent,
          onSelect: () => record(
              t("prototypeHistoryInsertion"),
              t("prototypeHistoryInsertionDetail", { kind: label }),
            ),
        }))}
      />
    </>
  );

  return (
    <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as PrototypeTab)}>
      {toolbarTarget ? createPortal(insertToolbar, toolbarTarget) : null}
      {tabsTarget ? createPortal(
        <TabsList className="grid h-8 w-full grid-cols-3">
          <TabsTrigger value="adjust" className="px-2 text-xs">{t("prototypeTabAdjust")}</TabsTrigger>
          <TabsTrigger value="layout" className="px-2 text-xs">{t("prototypeTabLayout")}</TabsTrigger>
          <TabsTrigger value="replace" className="px-2 text-xs">{t("prototypeTabReplace")}</TabsTrigger>
        </TabsList>,
        tabsTarget,
      ) : null}
      <div data-courseware-step2-prototype data-persistence="none" className="space-y-4 py-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="secondary">{t("prototypeBadge")}</Badge>
          <span className="text-[11px] text-muted">{t("prototypeSessionOnly")}</span>
        </div>
        <p className="text-xs leading-5 text-muted">
          {sourceRuntime
            ? t("prototypeSourceRuntimeHint")
            : knownSource
              ? t("prototypeEditableSourceHint")
              : t("prototypeUnknownSourceHint")}
        </p>
      </div>

        <TabsContent value="adjust" className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-medium text-ink">
            <Type className="size-4 text-crater" />
            {t("contentEditing")}
          </div>
          {canAdjustContent ? (
            <>
              <CoursewareEditorActionGrid>
                {adjustTools.map((tool) => (
                  <SelectableButton
                    key={tool.value}
                    selected={adjustTool === tool.value}
                    onClick={() => setAdjustTool(tool.value)}
                  >
                    {tool.label}
                  </SelectableButton>
                ))}
              </CoursewareEditorActionGrid>
              <label className="flex items-start gap-2 text-xs leading-5 text-ink">
                <Checkbox
                  checked={syncContent}
                  onCheckedChange={(checked) => setSyncContent(checked === true)}
                  aria-label={t("prototypeSyncContent")}
                />
                <span>
                  {t("prototypeSyncContent")}
                  <span className="block text-muted">{t("prototypeSyncContentHint")}</span>
                </span>
              </label>
              <Button
                type="button"
                size="sm"
                className="w-full"
                onClick={() => record(
                  t("prototypeHistoryAdjust"),
                  t("prototypeHistoryAdjustDetail", {
                    tool: adjustTools.find((tool) => tool.value === adjustTool)?.label ?? "—",
                    link: syncContent ? t("prototypeLinked") : t("prototypeCurrentTrack"),
                  }),
                )}
              >
                <Eye className="size-4" />
                {t("prototypePreviewSelection")}
              </Button>
            </>
          ) : (
            <CapabilityNotice>{t(sourceRuntime ? "prototypeAdjustSourceBlocked" : "prototypeUnknownBlocked")}</CapabilityNotice>
          )}
        </TabsContent>

        <TabsContent value="layout" className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-xs font-medium text-ink">
              <LayoutTemplate className="size-4 text-crater" />
              {t("layoutAdaptation")}
            </span>
            <Badge variant="outline">{t("prototypeOnly43")}</Badge>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {LAYOUT_STRATEGIES.map((strategy) => {
              const sourceBlocked = sourceRuntime && strategy !== "E" && strategy !== "custom";
              return (
                <SelectableButton
                  key={strategy}
                  selected={layoutStrategy === strategy}
                  disabled={!knownSource || sourceBlocked}
                  className="justify-center px-2"
                  onClick={() => setLayoutStrategy(strategy)}
                >
                  {strategy === "custom" ? t("prototypeLayoutCustomShort") : strategy}
                </SelectableButton>
              );
            })}
          </div>
          <p className="text-xs leading-5 text-muted">
            {t(`prototypeLayout${layoutStrategy === "custom" ? "Custom" : layoutStrategy}`)}
          </p>
          {sourceRuntime ? <CapabilityNotice>{t("prototypeLayoutSourceLimit")}</CapabilityNotice> : null}
          {!hasAdaptedPreview ? <CapabilityNotice>{t("prototypeNoAdaptedDraft")}</CapabilityNotice> : null}
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={!knownSource || sourceRuntime && layoutStrategy !== "E" && layoutStrategy !== "custom"}
            onClick={() => record(
              t("prototypeHistoryLayout"),
              t("prototypeHistoryLayoutDetail", {
                strategy: layoutStrategy === "custom" ? t("prototypeLayoutCustomShort") : layoutStrategy,
              }),
            )}
          >
            <Eye className="size-4" />
            {t("prototypePreviewLayout")}
          </Button>
        </TabsContent>

        <TabsContent value="replace" className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-medium text-ink">
            <ImageIcon className="size-4 text-crater" />
            {t("resourceReplacement")}
          </div>
          <CoursewareEditorActionGrid>
            <SelectableButton selected={replacementKind === "background"} onClick={() => setReplacementKind("background")}>
              {t("prototypeReplaceBackground")}
            </SelectableButton>
            <SelectableButton selected={replacementKind === "image"} onClick={() => setReplacementKind("image")}>
              {t("prototypeReplaceImage")}
            </SelectableButton>
          </CoursewareEditorActionGrid>
          <div className="space-y-2">
            <p className="text-xs font-medium text-ink">{t("prototypeReplacementScope")}</p>
            <div className="flex flex-wrap gap-2">
              {REPLACEMENT_SCOPES.map((scope) => (
                <SelectableButton
                  key={scope}
                  selected={replacementScope === scope}
                  className="min-h-8 rounded-full px-3 py-1.5"
                  onClick={() => setReplacementScope(scope)}
                >
                  {t(`prototypeScope${scope[0].toUpperCase()}${scope.slice(1)}`)}
                </SelectableButton>
              ))}
            </div>
          </div>
          <CapabilityNotice>{t("prototypeReplacementDryRunOnly")}</CapabilityNotice>
          <Button
            type="button"
            size="sm"
            className="w-full"
            onClick={() => record(
              t("prototypeHistoryReplacement"),
              t("prototypeHistoryReplacementDetail", {
                kind: t(replacementKind === "background" ? "prototypeReplaceBackground" : "prototypeReplaceImage"),
                scope: t(`prototypeScope${replacementScope[0].toUpperCase()}${replacementScope.slice(1)}`),
              }),
            )}
          >
            <Eye className="size-4" />
            {t("prototypePreviewImpact")}
          </Button>
        </TabsContent>

      <section className="border-t border-line pt-4" aria-label={t("prototypeHistoryTitle")}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-ink">{t("prototypeHistoryTitle")}</h3>
          <Badge variant="outline">{t("prototypeHistoryCount", { count: history.length })}</Badge>
        </div>
        {history.length > 0 ? (
          <ol className="mt-2 divide-y divide-line/70">
            {history.map((action) => (
              <li key={action.id} className="py-2 text-xs">
                <p className="font-medium text-ink">{action.label}</p>
                <p className="mt-0.5 leading-5 text-muted">{action.detail}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-xs leading-5 text-muted">{t("prototypeHistoryEmpty")}</p>
        )}
        <p className="mt-2 text-[11px] leading-4 text-muted">
          {t("prototypeUndoExpectation", {
            canvas: t(activeCanvas === "compare"
              ? "canvasCompare"
              : activeCanvas === "adapted-4x3"
                ? "canvasAdapted"
                : "canvasNative"),
          })}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={history.length === 0}
            onClick={() => setHistory((current) => current.slice(0, -1))}
          >
            <Undo2 className="size-4" />
            {t("prototypeUndo")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={history.length === 0}
            onClick={() => setHistory([])}
          >
            <RotateCcw className="size-4" />
            {t("prototypeReset")}
          </Button>
        </div>
      </section>
      </div>
    </Tabs>
  );
}
