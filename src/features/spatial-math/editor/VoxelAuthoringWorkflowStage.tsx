"use client";

import { useCallback, useEffect, useState } from "react";
import { Boxes } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  buildVoxelAuthoringPage,
  replaceVoxelAuthoringLesson,
  replaceVoxelAuthoringModel,
  type SpatialPageDoc,
  type VoxelAuthoringDraft,
  type VoxelLessonPlan,
  type VoxelSceneAdapterInput,
} from "../domain";
import {
  VoxelLessonEditorStage,
  type VoxelLessonEditorMessages,
} from "./VoxelLessonEditorStage";
import {
  VoxelTemplateEditorStage,
  type VoxelTemplateEditorMessages,
} from "./VoxelTemplateEditorStage";
import {
  applyVoxelAuthoringWorkflowAction,
  createVoxelAuthoringWorkflowState,
  type VoxelAuthoringWorkflowAction,
} from "./voxel-authoring-workflow";
import type { VoxelTemplateEditorBounds } from "./voxel-template-editor";

export interface VoxelAuthoringWorkflowMessages {
  readonly workflowTitle: string;
  readonly workflowDescription: string;
  readonly panelsLabel: string;
  readonly modelTab: string;
  readonly lessonTab: string;
  readonly modelEditor: VoxelTemplateEditorMessages;
  readonly lessonEditor: VoxelLessonEditorMessages;
}

export interface VoxelAuthoringWorkflowStageProps {
  readonly initialDraft: VoxelAuthoringDraft;
  readonly bounds?: VoxelTemplateEditorBounds;
  readonly locale: "zh" | "en";
  readonly messages: VoxelAuthoringWorkflowMessages;
  readonly onDraftChange?: (draft: VoxelAuthoringDraft) => void;
  readonly onReadyPage?: (page: SpatialPageDoc) => void;
  readonly materialColors?: Readonly<Record<string, string>>;
  readonly className?: string;
}

export function VoxelAuthoringWorkflowStage({
  initialDraft,
  bounds,
  locale,
  messages,
  onDraftChange,
  onReadyPage,
  materialColors,
  className,
}: VoxelAuthoringWorkflowStageProps) {
  const [workflow, setWorkflow] = useState(() =>
    createVoxelAuthoringWorkflowState(initialDraft, bounds),
  );
  const apply = useCallback((action: VoxelAuthoringWorkflowAction) => {
    setWorkflow((current) => applyVoxelAuthoringWorkflowAction(current, action));
  }, []);
  const buildModelPage = useCallback((modelInput: VoxelSceneAdapterInput) => {
    return buildVoxelAuthoringPage(replaceVoxelAuthoringModel(workflow.draft, modelInput));
  }, [workflow.draft]);
  const buildLessonPage = useCallback((
    modelInput: VoxelSceneAdapterInput,
    lessonPlan: VoxelLessonPlan,
  ) => {
    const withModel = replaceVoxelAuthoringModel(workflow.draft, modelInput);
    return buildVoxelAuthoringPage(replaceVoxelAuthoringLesson(withModel, lessonPlan));
  }, [workflow.draft]);

  useEffect(() => {
    onDraftChange?.(workflow.draft);
  }, [onDraftChange, workflow.draft]);

  return (
    <section
      className={cn("space-y-4", className)}
      data-spatial-editor="voxel-authoring-workflow-v1"
      data-layout-profile="standard-4x3"
      data-active-panel={workflow.panel}
      aria-label={messages.workflowTitle}
    >
      <Tabs
        value={workflow.panel}
        onValueChange={(value) => {
          if (value === "model" || value === "lesson") {
            apply({ kind: "panel.select", panel: value });
          }
        }}
      >
        <Card>
          <CardHeader className="gap-3 p-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <Boxes aria-hidden="true" className="size-4 text-leaf-deep" />
                {messages.workflowTitle}
              </CardTitle>
              <CardDescription>{messages.workflowDescription}</CardDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <TabsList aria-label={messages.panelsLabel}>
                <TabsTrigger value="model">{messages.modelTab}</TabsTrigger>
                <TabsTrigger value="lesson">{messages.lessonTab}</TabsTrigger>
              </TabsList>
              <Badge variant="outline">standard-4x3</Badge>
            </div>
          </CardHeader>
        </Card>

        {workflow.panel === "model" ? (
          <TabsContent value="model" className="mt-4">
            <VoxelTemplateEditorStage
              initialInput={workflow.draft.model}
              bounds={bounds}
              editorState={workflow.modelEditor}
              onEditorAction={(action) => apply({ kind: "model.apply", action })}
              pageBuilder={buildModelPage}
              locale={locale}
              messages={messages.modelEditor}
              onReadyPage={onReadyPage}
              materialColors={materialColors}
            />
          </TabsContent>
        ) : (
          <TabsContent value="lesson" className="mt-4">
            <VoxelLessonEditorStage
              modelInput={workflow.draft.model}
              initialPlan={workflow.draft.lesson}
              editorState={workflow.lessonEditor}
              onEditorAction={(action) => apply({ kind: "lesson.apply", action })}
              pageBuilder={buildLessonPage}
              requirePredictPrompt
              locale={locale}
              messages={messages.lessonEditor}
              onReadyPage={onReadyPage}
              materialColors={materialColors}
            />
          </TabsContent>
        )}
      </Tabs>
    </section>
  );
}
