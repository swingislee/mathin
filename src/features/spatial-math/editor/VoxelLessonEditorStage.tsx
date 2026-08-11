"use client";

import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckSquare2,
  Eye,
  ListChecks,
  Plus,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  buildVoxelLessonPage,
  canonicalJsonStringify,
  VOXEL_LESSON_LIMITS,
  type CompiledVoxelLessonStep,
  type SpatialPageDoc,
  type SpatialRuntimeState,
  type VoxelLessonCamera,
  type VoxelLessonPageBuildResult,
  type VoxelLessonPlan,
  type VoxelLessonStep,
  type VoxelSceneAdapterInput,
} from "../domain";
import {
  VoxelTeachingStage,
  type VoxelTeachingMessages,
} from "../renderer-r3f/VoxelTeachingStage";
import {
  applyVoxelLessonEditorAction,
  createVoxelLessonEditorState,
  deriveVoxelLessonEditorView,
  type VoxelLessonEditorAction,
  type VoxelLessonEditorState,
  type VoxelLessonEditorStepView,
} from "./voxel-lesson-editor";
import { createVoxelLessonPreviewState } from "./voxel-lesson-preview";
import { assertVoxelEditorStandard4x3Page } from "./voxel-editor-page-contract";

export interface VoxelLessonEditorMessages extends VoxelTeachingMessages {
  readonly editorTitle: string;
  readonly editorDescription: string;
  readonly stepsLabel: string;
  readonly addView: string;
  readonly inspectorLabel: string;
  readonly chinese: string;
  readonly english: string;
  readonly titleLabel: string;
  readonly promptLabel: string;
  readonly titlePlaceholder: string;
  readonly promptPlaceholder: string;
  readonly moveUp: string;
  readonly moveDown: string;
  readonly removeStep: string;
  readonly undo: string;
  readonly redo: string;
  readonly resetDraft: string;
  readonly modified: string;
  readonly saved: string;
  readonly layerOrder: string;
  readonly ascending: string;
  readonly descending: string;
  readonly checkpointTitle: string;
  readonly checkpointDescription: string;
  readonly checkpointRequired: string;
  readonly checkpointOptional: string;
  readonly maxSubmissions: string;
  readonly decreaseSubmissions: string;
  readonly increaseSubmissions: string;
  readonly previewLabel: string;
  readonly previewBuilding: string;
  readonly previewReady: string;
  readonly previewError: string;
  readonly invalidText: string;
  readonly chineseRequiredBeforeEnglish: string;
  readonly englishFallback: string;
  readonly formatCamera: (camera: VoxelLessonCamera) => string;
  readonly formatStepKind: (kind: VoxelLessonStep["kind"]) => string;
  readonly formatStepPosition: (current: number, total: number) => string;
  readonly formatExpandedLayers: (count: number) => string;
}

export interface VoxelLessonEditorStageProps {
  readonly modelInput: VoxelSceneAdapterInput;
  readonly initialPlan?: VoxelLessonPlan;
  readonly editorState?: VoxelLessonEditorState;
  readonly onEditorAction?: (action: VoxelLessonEditorAction) => void;
  readonly pageBuilder?: VoxelLessonEditorPageBuilder;
  readonly requirePredictPrompt?: boolean;
  readonly locale: "zh" | "en";
  readonly messages: VoxelLessonEditorMessages;
  readonly onPlanChange?: (plan: VoxelLessonPlan) => void;
  readonly onReadyPage?: (page: SpatialPageDoc) => void;
  readonly materialColors?: Readonly<Record<string, string>>;
  readonly className?: string;
}

export type VoxelLessonEditorPageBuilder = (
  modelInput: VoxelSceneAdapterInput,
  lessonPlan: VoxelLessonPlan,
) => Promise<VoxelLessonPageBuildResult>;

type BuiltLessonState =
  | { readonly status: "building" }
  | {
      readonly status: "ready";
      readonly key: string;
      readonly builder: VoxelLessonEditorPageBuilder;
      readonly page: SpatialPageDoc;
      readonly compiledSteps: readonly CompiledVoxelLessonStep[];
    }
  | {
      readonly status: "error";
      readonly key: string;
      readonly builder: VoxelLessonEditorPageBuilder;
    };

type PreviewState =
  | { readonly status: "building" }
  | {
      readonly status: "ready";
      readonly key: string;
      readonly builder: VoxelLessonEditorPageBuilder;
      readonly runtime: SpatialRuntimeState;
    }
  | {
      readonly status: "error";
      readonly key: string;
      readonly builder: VoxelLessonEditorPageBuilder;
    };

const PREVIEW_ACTOR = {
  kind: "teacher-controller" as const,
  actorId: "editor.preview.teacher",
};

const ignorePreviewCommand = () => undefined;
const HTML_MARKUP_PATTERN = /<\/?[A-Za-z][^>]*>/;

function localizedText(value: { readonly zh: string; readonly en?: string }, locale: "zh" | "en"): string {
  return locale === "en" ? value.en ?? value.zh : value.zh;
}

function validatePlainText(
  value: string,
  maxLength: number,
  required: boolean,
  messages: VoxelLessonEditorMessages,
): string | null {
  if (required && !value) return messages.invalidText;
  if (value.length > maxLength || HTML_MARKUP_PATTERN.test(value)) return messages.invalidText;
  return null;
}

function describedBy(...ids: readonly (string | null)[]): string | undefined {
  const value = ids.filter((id): id is string => Boolean(id)).join(" ");
  return value || undefined;
}

function LessonTextFields({
  step,
  locale,
  messages,
  onAction,
  requirePredictPrompt,
}: {
  readonly step: VoxelLessonEditorStepView;
  readonly locale: "zh" | "en";
  readonly messages: VoxelLessonEditorMessages;
  readonly onAction: (action: VoxelLessonEditorAction) => void;
  readonly requirePredictPrompt: boolean;
}) {
  const instanceId = useId();
  const [tab, setTab] = useState({ sourceLocale: locale, activeLocale: locale });
  if (tab.sourceLocale !== locale) {
    setTab({ sourceLocale: locale, activeLocale: locale });
  }
  const sourceKey = canonicalJsonStringify({
    id: step.id,
    title: step.title,
    teacherPrompt: step.teacherPrompt,
  });
  const sourceValues = {
    title: { zh: step.title.zh, en: step.title.en ?? "" },
    prompt: { zh: step.teacherPrompt?.zh ?? "", en: step.teacherPrompt?.en ?? "" },
  };
  const [fields, setFields] = useState(() => ({
    sourceKey,
    values: sourceValues,
    errors: {} as Readonly<Record<string, string>>,
  }));
  if (fields.sourceKey !== sourceKey) {
    setFields({ sourceKey, values: sourceValues, errors: {} });
  }
  const setFieldError = (field: string, error: string | null) => {
    setFields((current) => {
      if (error) {
        return current.errors[field] === error
          ? current
          : { ...current, errors: { ...current.errors, [field]: error } };
      }
      if (!current.errors[field]) return current;
      const errors = { ...current.errors };
      delete errors[field];
      return { ...current, errors };
    });
  };
  const updateField = (
    field: "title" | "prompt",
    fieldLocale: "zh" | "en",
    value: string,
  ) => {
    setFields((current) => ({
      ...current,
      values: {
        ...current.values,
        [field]: { ...current.values[field], [fieldLocale]: value },
      },
    }));
  };
  const commitRequired = (
    fieldLocale: "zh" | "en",
    currentValue: string,
    maxLength: number,
  ) => {
    const value = fields.values.title[fieldLocale].trim();
    const field = `title-${fieldLocale}`;
    const error = validatePlainText(value, maxLength, fieldLocale === "zh", messages);
    setFieldError(field, error);
    if (error) return;
    if (value !== currentValue) {
      onAction({ kind: "step.text.set", stepId: step.id, field: "title", locale: fieldLocale, value });
    }
  };
  const commitPrompt = (fieldLocale: "zh" | "en", currentValue: string) => {
    const value = fields.values.prompt[fieldLocale].trim();
    const field = `prompt-${fieldLocale}`;
    const promptIsRequired = requirePredictPrompt && step.kind === "predict" && fieldLocale === "zh";
    const error = validatePlainText(
      value,
      VOXEL_LESSON_LIMITS.maxTextCharacters,
      promptIsRequired,
      messages,
    )
      ?? (fieldLocale === "en" && value && !step.teacherPrompt?.zh
        ? messages.chineseRequiredBeforeEnglish
        : null);
    setFieldError(field, error);
    if (error) return;
    if (value !== currentValue) {
      onAction({ kind: "step.text.set", stepId: step.id, field: "teacherPrompt", locale: fieldLocale, value });
    }
  };
  const titleMaxLength = step.kind === "layer-scan"
    ? VOXEL_LESSON_LIMITS.maxLayerTitleCharacters
    : VOXEL_LESSON_LIMITS.maxTextCharacters;
  return (
    <Tabs value={tab.activeLocale} onValueChange={(value) => setTab((current) => ({ ...current, activeLocale: value as "zh" | "en" }))}>
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="zh">{messages.chinese}</TabsTrigger>
        <TabsTrigger value="en">{messages.english}</TabsTrigger>
      </TabsList>
      {(["zh", "en"] as const).map((fieldLocale) => {
        const title = sourceValues.title[fieldLocale];
        const prompt = sourceValues.prompt[fieldLocale];
        const titleId = `${instanceId}-lesson-title-${step.id}-${fieldLocale}`;
        const promptId = `${instanceId}-lesson-prompt-${step.id}-${fieldLocale}`;
        const titleError = fields.errors[`title-${fieldLocale}`];
        const promptError = fields.errors[`prompt-${fieldLocale}`];
        const titleFallbackId = fieldLocale === "en" && !step.title.en ? `${titleId}-fallback` : null;
        const promptFallbackId = fieldLocale === "en" && !step.teacherPrompt?.en && step.teacherPrompt?.zh
          ? `${promptId}-fallback`
          : null;
        const promptRequired = requirePredictPrompt && step.kind === "predict" && fieldLocale === "zh";
        return (
          <TabsContent key={fieldLocale} value={fieldLocale} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={titleId}>{messages.titleLabel}</Label>
              <Input
                id={titleId}
                value={fields.values.title[fieldLocale]}
                placeholder={messages.titlePlaceholder}
                maxLength={titleMaxLength}
                aria-invalid={Boolean(titleError)}
                aria-describedby={describedBy(titleFallbackId, titleError ? `${titleId}-error` : null)}
                onChange={(event) => updateField("title", fieldLocale, event.currentTarget.value)}
                onBlur={() => commitRequired(fieldLocale, title, titleMaxLength)}
              />
              {titleFallbackId ? (
                <p id={titleFallbackId} className="text-xs text-muted">{messages.englishFallback}: {step.title.zh}</p>
              ) : null}
              {titleError ? <p id={`${titleId}-error`} className="text-xs text-rose-deep" role="alert">{titleError}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={promptId}>{messages.promptLabel}</Label>
              <Textarea
                id={promptId}
                value={fields.values.prompt[fieldLocale]}
                placeholder={messages.promptPlaceholder}
                maxLength={VOXEL_LESSON_LIMITS.maxTextCharacters}
                className="min-h-24"
                aria-invalid={Boolean(promptError)}
                aria-required={promptRequired || undefined}
                aria-describedby={describedBy(promptFallbackId, promptError ? `${promptId}-error` : null)}
                onChange={(event) => updateField("prompt", fieldLocale, event.currentTarget.value)}
                onBlur={() => commitPrompt(fieldLocale, prompt)}
              />
              {promptFallbackId ? (
                <p id={promptFallbackId} className="text-xs text-muted">{messages.englishFallback}: {step.teacherPrompt?.zh}</p>
              ) : null}
              {promptError ? <p id={`${promptId}-error`} className="text-xs text-rose-deep" role="alert">{promptError}</p> : null}
            </div>
          </TabsContent>
        );
      })}
    </Tabs>
  );
}

function CheckpointPromptFields({
  prompt,
  locale,
  messages,
  onAction,
}: {
  readonly prompt: VoxelLessonPlan["checkpoint"]["prompt"];
  readonly locale: "zh" | "en";
  readonly messages: VoxelLessonEditorMessages;
  readonly onAction: (action: VoxelLessonEditorAction) => void;
}) {
  const instanceId = useId();
  const [tab, setTab] = useState({ sourceLocale: locale, activeLocale: locale });
  if (tab.sourceLocale !== locale) {
    setTab({ sourceLocale: locale, activeLocale: locale });
  }
  const sourceKey = canonicalJsonStringify(prompt);
  const sourceValues = { zh: prompt.zh, en: prompt.en ?? "" };
  const [fields, setFields] = useState(() => ({
    sourceKey,
    values: sourceValues,
    errors: {} as Readonly<Record<string, string>>,
  }));
  if (fields.sourceKey !== sourceKey) {
    setFields({ sourceKey, values: sourceValues, errors: {} });
  }
  return (
    <Tabs value={tab.activeLocale} onValueChange={(value) => setTab((current) => ({ ...current, activeLocale: value as "zh" | "en" }))}>
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="zh">{messages.chinese}</TabsTrigger>
        <TabsTrigger value="en">{messages.english}</TabsTrigger>
      </TabsList>
      {(["zh", "en"] as const).map((fieldLocale) => {
        const value = sourceValues[fieldLocale];
        const fieldId = `${instanceId}-checkpoint-prompt-${fieldLocale}`;
        const fieldError = fields.errors[fieldLocale];
        const fallbackId = fieldLocale === "en" && !prompt.en ? `${fieldId}-fallback` : null;
        return (
          <TabsContent key={fieldLocale} value={fieldLocale} className="space-y-1.5">
            <Label htmlFor={fieldId} className="sr-only">{messages.promptLabel}</Label>
            <Textarea
              id={fieldId}
              value={fields.values[fieldLocale]}
              placeholder={messages.promptPlaceholder}
              maxLength={VOXEL_LESSON_LIMITS.maxTextCharacters}
              className="min-h-20"
              aria-invalid={Boolean(fieldError)}
              aria-describedby={describedBy(fallbackId, fieldError ? `${fieldId}-error` : null)}
              onChange={(event) => {
                const next = event.currentTarget.value;
                setFields((current) => ({
                  ...current,
                  values: { ...current.values, [fieldLocale]: next },
                }));
              }}
              onBlur={() => {
                const next = fields.values[fieldLocale].trim();
                const error = validatePlainText(
                  next,
                  VOXEL_LESSON_LIMITS.maxTextCharacters,
                  fieldLocale === "zh",
                  messages,
                );
                setFields((current) => {
                  if (error) return { ...current, errors: { ...current.errors, [fieldLocale]: error } };
                  if (!current.errors[fieldLocale]) return current;
                  const errors = { ...current.errors };
                  delete errors[fieldLocale];
                  return { ...current, errors };
                });
                if (!error && next !== value) {
                  onAction({ kind: "checkpoint.prompt.set", locale: fieldLocale, value: next });
                }
              }}
            />
            {fallbackId ? (
              <p id={fallbackId} className="text-xs text-muted">{messages.englishFallback}: {prompt.zh}</p>
            ) : null}
            {fieldError ? <p id={`${fieldId}-error`} className="text-xs text-rose-deep" role="alert">{fieldError}</p> : null}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}

export function VoxelLessonEditorStage({
  modelInput,
  initialPlan,
  editorState,
  onEditorAction,
  pageBuilder,
  requirePredictPrompt = false,
  locale,
  messages,
  onPlanChange,
  onReadyPage,
  materialColors,
  className,
}: VoxelLessonEditorStageProps) {
  const [uncontrolledEditor, setUncontrolledEditor] = useState(() =>
    createVoxelLessonEditorState(initialPlan, modelInput.teacherPrompt),
  );
  const editor = editorState ?? uncontrolledEditor;
  const [builtLesson, setBuiltLesson] = useState<BuiltLessonState>({ status: "building" });
  const [preview, setPreview] = useState<PreviewState>({ status: "building" });
  const instanceId = useId();
  const view = useMemo(() => deriveVoxelLessonEditorView(editor), [editor]);
  const buildPage = pageBuilder ?? buildVoxelLessonPage;
  const buildKey = useMemo(
    () => canonicalJsonStringify({ modelInput, lessonPlan: editor.plan }),
    [editor.plan, modelInput],
  );
  const readyLesson = builtLesson.status === "ready"
    && builtLesson.key === buildKey
    && builtLesson.builder === buildPage
    ? builtLesson
    : null;
  const previewKey = `${buildKey}\n${readyLesson?.page.sceneHash ?? "pending"}\n${editor.selectedStepId}`;
  const readyPreview = preview.status === "ready"
    && preview.key === previewKey
    && preview.builder === buildPage
    ? preview
    : null;
  const previewFailed = (
    builtLesson.status === "error"
    && builtLesson.key === buildKey
    && builtLesson.builder === buildPage
  ) || (
    preview.status === "error"
    && preview.key === previewKey
    && preview.builder === buildPage
  );
  const previewStatus = previewFailed ? "error" : readyLesson && readyPreview ? "ready" : "building";
  const previousSelectionRef = useRef(editor.selectedStepId);
  const apply = useCallback((action: VoxelLessonEditorAction) => {
    if (editorState !== undefined) {
      onEditorAction?.(action);
      return;
    }
    setUncontrolledEditor((current) => applyVoxelLessonEditorAction(current, action));
  }, [editorState, onEditorAction]);
  const completeLessonBuild = useEffectEvent((
    requestKey: string,
    requestBuilder: VoxelLessonEditorPageBuilder,
    built: VoxelLessonPageBuildResult | null,
  ) => {
    if (requestKey !== buildKey || requestBuilder !== buildPage) return;
    if (!built) {
      setBuiltLesson({ status: "error", key: requestKey, builder: requestBuilder });
      return;
    }
    try {
      assertVoxelEditorStandard4x3Page(built.page);
    } catch {
      setBuiltLesson({ status: "error", key: requestKey, builder: requestBuilder });
      return;
    }
    setBuiltLesson({
      status: "ready",
      key: requestKey,
      builder: requestBuilder,
      page: built.page,
      compiledSteps: built.compiledSteps,
    });
    onReadyPage?.(built.page);
  });
  const startLessonBuild = useEffectEvent((requestKey: string) => {
    let active = true;
    const requestBuilder = buildPage;
    void requestBuilder(modelInput, editor.plan)
      .then((built) => {
        if (!active) return;
        completeLessonBuild(requestKey, requestBuilder, built);
      })
      .catch(() => {
        if (active) completeLessonBuild(requestKey, requestBuilder, null);
      });
    return () => {
      active = false;
    };
  });
  const completeLessonPreview = useEffectEvent((
    requestKey: string,
    requestBuilder: VoxelLessonEditorPageBuilder,
    runtime: SpatialRuntimeState | null,
  ) => {
    if (requestKey !== previewKey || requestBuilder !== buildPage || !readyLesson) return;
    if (requestBuilder !== readyLesson.builder) return;
    if (!runtime) {
      setPreview({ status: "error", key: requestKey, builder: requestBuilder });
      return;
    }
    setPreview({ status: "ready", key: requestKey, builder: requestBuilder, runtime });
  });

  useEffect(() => {
    onPlanChange?.(editor.plan);
  }, [editor.plan, onPlanChange]);

  useEffect(() => {
    if (previousSelectionRef.current === editor.selectedStepId) return;
    previousSelectionRef.current = editor.selectedStepId;
    document.getElementById(`${instanceId}-lesson-step-${editor.selectedStepId}`)?.focus();
  }, [editor.selectedStepId, instanceId]);

  useEffect(() => {
    return startLessonBuild(buildKey);
  }, [buildKey, pageBuilder]);

  useEffect(() => {
    if (!readyLesson) return;
    let active = true;
    const requestKey = previewKey;
    const requestBuilder = readyLesson.builder;
    void createVoxelLessonPreviewState(
      readyLesson.page,
      readyLesson.compiledSteps,
      editor.selectedStepId,
    )
      .then((runtime) => {
        if (active) completeLessonPreview(requestKey, requestBuilder, runtime);
      })
      .catch(() => {
        if (active) completeLessonPreview(requestKey, requestBuilder, null);
      });
    return () => {
      active = false;
    };
  }, [editor.selectedStepId, previewKey, readyLesson]);

  const selected = view.selectedStep;
  const selectedTitle = localizedText(selected.title, locale);
  const layerStep = editor.plan.steps.find((step) => step.kind === "layer-scan");
  const expandedLayerCount = readyLesson?.compiledSteps.find(
    (entry) => entry.lessonStepId === editor.selectedStepId,
  )?.sceneStepIds.length ?? 1;

  return (
    <section
      className={cn("space-y-4", className)}
      data-spatial-editor="voxel-lesson-editor-v1"
      data-layout-profile="standard-4x3"
      aria-label={messages.editorTitle}
    >
      <Card>
        <CardHeader className="gap-3 p-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks aria-hidden="true" className="size-4 text-leaf-deep" />
              {messages.editorTitle}
            </CardTitle>
            <CardDescription>{messages.editorDescription}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">4:3</Badge>
            <Badge variant={view.isDirty ? "default" : "secondary"}>{view.isDirty ? messages.modified : messages.saved}</Badge>
            <Button type="button" size="sm" variant="ghost" className="size-8 p-0" aria-label={messages.undo} disabled={!view.canUndo} onClick={() => apply({ kind: "history.undo" })}>
              <Undo2 aria-hidden="true" className="size-4" />
            </Button>
            <Button type="button" size="sm" variant="ghost" className="size-8 p-0" aria-label={messages.redo} disabled={!view.canRedo} onClick={() => apply({ kind: "history.redo" })}>
              <Redo2 aria-hidden="true" className="size-4" />
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={!view.isDirty} onClick={() => apply({ kind: "draft.reset" })}>
              <RotateCcw aria-hidden="true" className="size-4" />
              {messages.resetDraft}
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="grid items-start gap-4 xl:grid-cols-[19rem_minmax(0,1fr)_21rem]">
        <Card className="overflow-hidden">
          <CardHeader className="p-4">
            <CardTitle className="text-base">{messages.stepsLabel}</CardTitle>
            <CardDescription>{messages.formatStepPosition(selected.index + 1, view.steps.length)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            <div className="space-y-1" role="list" aria-label={messages.stepsLabel}>
              {view.steps.map((step) => (
                <div key={step.id} className={cn("flex items-center gap-1 rounded-xl border p-1", step.selected ? "border-leaf-deep bg-leaf/15" : "border-line")} role="listitem">
                  <Button id={`${instanceId}-lesson-step-${step.id}`} type="button" size="sm" variant="ghost" className="h-auto min-w-0 flex-1 justify-start rounded-lg px-2 py-1.5 text-left" aria-pressed={step.selected} onClick={() => apply({ kind: "step.select", stepId: step.id })}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-ink">{localizedText(step.title, locale)}</span>
                      <span className="block truncate text-[11px] text-muted">{messages.formatStepKind(step.kind)}</span>
                    </span>
                  </Button>
                  {!step.fixed ? (
                    <>
                      <Button type="button" size="sm" variant="ghost" className="size-7 p-0" aria-label={`${messages.moveUp}: ${localizedText(step.title, locale)}`} disabled={!step.canMoveUp} onClick={() => apply({ kind: "step.move", stepId: step.id, direction: "up" })}>
                        <ArrowUp aria-hidden="true" className="size-3.5" />
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="size-7 p-0" aria-label={`${messages.moveDown}: ${localizedText(step.title, locale)}`} disabled={!step.canMoveDown} onClick={() => apply({ kind: "step.move", stepId: step.id, direction: "down" })}>
                        <ArrowDown aria-hidden="true" className="size-3.5" />
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="size-7 p-0 text-rose-deep" aria-label={`${messages.removeStep}: ${localizedText(step.title, locale)}`} disabled={!step.canRemove} onClick={() => apply({ kind: "step.remove", stepId: step.id })}>
                        <Trash2 aria-hidden="true" className="size-3.5" />
                      </Button>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
            {view.canAddView ? (
              <div className="border-t border-line pt-3">
                <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted"><Plus aria-hidden="true" className="size-3.5" />{messages.addView}</p>
                <div className="flex flex-wrap gap-1">
                  {view.availableCameras.map((camera) => (
                    <Button key={camera} type="button" size="sm" variant="secondary" className="h-8 px-2 text-xs" onClick={() => apply({ kind: "step.add-view", camera })}>
                      {messages.formatCamera(camera)}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <CardTitle className="truncate text-base">{messages.previewLabel} · {selectedTitle}</CardTitle>
              <CardDescription role="status" aria-live="polite">{previewStatus === "ready" ? messages.previewReady : previewStatus === "error" ? messages.previewError : messages.previewBuilding}</CardDescription>
            </div>
            {selected.kind === "layer-scan" && previewStatus === "ready" ? <Badge variant="outline">{messages.formatExpandedLayers(expandedLayerCount)}</Badge> : null}
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-line bg-paper" data-editor-preview="standard-4x3">
              {previewStatus === "ready" && readyLesson && readyPreview ? (
                <VoxelTeachingStage className="absolute inset-0 h-full aspect-auto rounded-none border-0 shadow-none" page={readyLesson.page} state={readyPreview.runtime} entityId={modelInput.entityId} actor={PREVIEW_ACTOR} locale={locale} readOnly messages={messages} onCommandIntent={ignorePreviewCommand} materialColors={materialColors} />
              ) : (
                <div className="grid h-full place-items-center p-6 text-center text-sm text-muted">{previewStatus === "error" ? messages.previewError : messages.previewBuilding}</div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="p-4">
              <CardTitle className="flex items-center gap-2 text-base"><Eye aria-hidden="true" className="size-4 text-muted" />{messages.inspectorLabel}</CardTitle>
              <CardDescription>{messages.formatStepKind(selected.kind)}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-4 pt-0">
              <LessonTextFields
                step={selected}
                locale={locale}
                messages={messages}
                onAction={apply}
                requirePredictPrompt={requirePredictPrompt}
              />
              {selected.kind === "layer-scan" && layerStep?.kind === "layer-scan" ? (
                <div className="space-y-2 border-t border-line pt-3">
                  <p className="text-xs font-medium text-muted">{messages.layerOrder}</p>
                  <div className="grid grid-cols-2 gap-1">
                    <Button type="button" size="sm" variant="secondary" className={cn(layerStep.order === "ascending" && "bg-moon/70")} aria-pressed={layerStep.order === "ascending"} onClick={() => apply({ kind: "layers.order.set", order: "ascending" })}>{messages.ascending}</Button>
                    <Button type="button" size="sm" variant="secondary" className={cn(layerStep.order === "descending" && "bg-moon/70")} aria-pressed={layerStep.order === "descending"} onClick={() => apply({ kind: "layers.order.set", order: "descending" })}>{messages.descending}</Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4">
              <CardTitle className="flex items-center gap-2 text-base"><CheckSquare2 aria-hidden="true" className="size-4 text-leaf-deep" />{messages.checkpointTitle}</CardTitle>
              <CardDescription>{messages.checkpointDescription}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0">
              <CheckpointPromptFields prompt={view.checkpoint.prompt} locale={locale} messages={messages} onAction={apply} />
              <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
                <Button type="button" size="sm" variant="secondary" aria-pressed={view.checkpoint.required} onClick={() => apply({ kind: "checkpoint.required.toggle" })}>
                  {view.checkpoint.required ? messages.checkpointRequired : messages.checkpointOptional}
                </Button>
                <div className="flex items-center gap-1" aria-label={messages.maxSubmissions}>
                  <Button type="button" size="sm" variant="ghost" className="size-8 p-0" aria-label={messages.decreaseSubmissions} disabled={view.checkpoint.maxSubmissions <= 1} onClick={() => apply({ kind: "checkpoint.max-submissions.set", value: view.checkpoint.maxSubmissions - 1 })}>−</Button>
                  <span role="status" aria-live="polite"><Badge variant="outline">{view.checkpoint.maxSubmissions}</Badge></span>
                  <Button type="button" size="sm" variant="ghost" className="size-8 p-0" aria-label={messages.increaseSubmissions} disabled={view.checkpoint.maxSubmissions >= 10} onClick={() => apply({ kind: "checkpoint.max-submissions.set", value: view.checkpoint.maxSubmissions + 1 })}>+</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{messages.formatStepPosition(selected.index + 1, view.steps.length)} · {selectedTitle}</p>
    </section>
  );
}
