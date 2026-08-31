"use client";

import { useRef, useState } from "react";
import {
  CircleAlert,
  Eye,
  ImageIcon,
  LayoutTemplate,
  Plus,
  RotateCcw,
  Type,
  Undo2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CoursewareEditorActionGrid } from "@/features/courseware-doc/CoursewareEditorWorkbench";
import { cn } from "@/lib/utils";

const LAYOUT_STRATEGIES = ["A", "B", "C", "D", "E", "F", "custom"] as const;
const REPLACEMENT_SCOPES = ["page", "lecture", "variant", "family", "all"] as const;

type PrototypeTab = "adjust" | "layout" | "replace" | "insert";
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
}: {
  sourceType: string;
  activeCanvas: "compare" | "native-16x9" | "adapted-4x3";
  hasAdaptedPreview: boolean;
}) {
  const t = useTranslations("coursewareWorkspace");
  const actionId = useRef(0);
  const [activeTab, setActiveTab] = useState<PrototypeTab>("adjust");
  const [adjustTool, setAdjustTool] = useState("text");
  const [syncContent, setSyncContent] = useState(true);
  const [layoutStrategy, setLayoutStrategy] = useState<LayoutStrategy>(
    sourceType === "source-runtime-page-v1" ? "E" : "C",
  );
  const [replacementKind, setReplacementKind] = useState("background");
  const [replacementScope, setReplacementScope] = useState<ReplacementScope>("page");
  const [insertKind, setInsertKind] = useState("h5");
  const [history, setHistory] = useState<PrototypeAction[]>([]);

  const sourceRuntime = sourceType === "source-runtime-page-v1";
  const composition = sourceType === "courseware-composition-v1";
  const pageDoc = sourceType === "page-doc-v1";
  const knownSource = sourceRuntime || composition || pageDoc;
  const canAdjustContent = pageDoc || composition;
  const canInsertContent = pageDoc || composition;

  const record = (label: string, detail: string) => {
    actionId.current += 1;
    setHistory((current) => [...current, { id: actionId.current, label, detail }].slice(-4));
  };

  const adjustTools = [
    { value: "text", label: t("prototypeAdjustText") },
    { value: "image", label: t("prototypeAdjustImage") },
    { value: "position", label: t("prototypeAdjustPosition") },
    { value: "layer", label: t("prototypeAdjustLayer") },
  ];
  const insertKinds = [
    { value: "text", label: t("prototypeInsertText") },
    { value: "image", label: t("prototypeInsertImage") },
    { value: "game", label: t("prototypeInsertGame") },
    { value: "h5", label: t("prototypeInsertH5") },
    { value: "repeat", label: t("prototypeInsertRepeat") },
    { value: "tool", label: t("prototypeInsertTool") },
  ];

  return (
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

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as PrototypeTab)}>
        <TabsList className="grid h-auto w-full grid-cols-4">
          <TabsTrigger value="adjust" className="px-1.5 text-xs">{t("prototypeTabAdjust")}</TabsTrigger>
          <TabsTrigger value="layout" className="px-1.5 text-xs">{t("prototypeTabLayout")}</TabsTrigger>
          <TabsTrigger value="replace" className="px-1.5 text-xs">{t("prototypeTabReplace")}</TabsTrigger>
          <TabsTrigger value="insert" className="px-1.5 text-xs">{t("prototypeTabInsert")}</TabsTrigger>
        </TabsList>

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

        <TabsContent value="insert" className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-medium text-ink">
            <Plus className="size-4 text-crater" />
            {t("contentInsertion")}
          </div>
          {canInsertContent ? (
            <>
              <CoursewareEditorActionGrid>
                {insertKinds.map((kind) => (
                  <SelectableButton
                    key={kind.value}
                    selected={insertKind === kind.value}
                    onClick={() => setInsertKind(kind.value)}
                  >
                    {kind.label}
                  </SelectableButton>
                ))}
              </CoursewareEditorActionGrid>
              <CapabilityNotice>{t("prototypeInsertionSyncGate")}</CapabilityNotice>
              <Button
                type="button"
                size="sm"
                className="w-full"
                onClick={() => record(
                  t("prototypeHistoryInsertion"),
                  t("prototypeHistoryInsertionDetail", {
                    kind: insertKinds.find((kind) => kind.value === insertKind)?.label ?? "—",
                  }),
                )}
              >
                <Eye className="size-4" />
                {t("prototypePreviewInsertion")}
              </Button>
            </>
          ) : (
            <CapabilityNotice>{t(sourceRuntime ? "prototypeInsertSourceBlocked" : "prototypeUnknownBlocked")}</CapabilityNotice>
          )}
        </TabsContent>
      </Tabs>

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
  );
}
