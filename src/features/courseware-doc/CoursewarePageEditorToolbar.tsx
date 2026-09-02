"use client";

import {
  FileCode2,
  Gamepad2,
  Grid3X3,
  ImagePlus,
  RotateCcw,
  Shapes,
  Sigma,
  Type,
  Wrench,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  CoursewareEditorHistoryControls,
  CoursewareInsertionToolbar,
} from "./CoursewareEditorWorkbench";
import { CoursewareGridSnapToggle } from "./CoursewareTextElementEditor";

/** The common PageDoc/source-runtime editing toolbar; adapters only supply state. */
export function CoursewarePageEditorToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  snapToGrid,
  onSnapToGridChange,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  snapToGrid: boolean;
  onSnapToGridChange: (checked: boolean) => void;
}) {
  const t = useTranslations("coursewareWorkspace");
  const elementEditorT = useTranslations("coursewareElementEditor");
  const textEditorT = useTranslations("coursewareTextEditor");
  const deferredHintId = "courseware-page-editor-insert-deferred";

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span id={deferredHintId} className="sr-only">{t("verticalSliceInsertDeferred")}</span>
      <CoursewareInsertionToolbar
        aria-label={t("contentInsertion")}
        aria-describedby={deferredHintId}
        actions={[
          {
            id: "history",
            label: elementEditorT("undoEdit"),
            icon: RotateCcw,
            control: <CoursewareEditorHistoryControls
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={onUndo}
              onRedo={onRedo}
              undoLabel={elementEditorT("undoEdit")}
              redoLabel={elementEditorT("redoEdit")}
            />,
          },
          ...[
            ["text", "prototypeInsertText", Type],
            ["formula", "prototypeInsertFormula", Sigma],
            ["shape", "prototypeInsertShape", Shapes],
            ["image", "prototypeInsertImage", ImagePlus],
            ["game", "prototypeInsertGame", Gamepad2],
            ["h5", "prototypeInsertH5", FileCode2],
            ["tool", "prototypeInsertTool", Wrench],
          ].map(([id, label, icon]) => ({
            id: id as string,
            label: t(label as "prototypeInsertText"),
            icon: icon as typeof Type,
            disabled: true,
          })),
          {
            id: "snap-to-grid",
            label: textEditorT("snapToGrid"),
            icon: Grid3X3,
            control: (
              <CoursewareGridSnapToggle
                checked={snapToGrid}
                onCheckedChange={onSnapToGridChange}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
