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
import type { ReactNode } from "react";
import {
  CoursewareEditorHistoryControls,
  CoursewareInsertionToolbar,
} from "./CoursewareEditorWorkbench";
import { CoursewareGridSnapToggle } from "./CoursewareTextElementEditor";

/** The common PageDoc/source-runtime editing toolbar; adapters only supply state. */
export interface CoursewarePageToolbarInsertions {
  text?: () => void;
  formula?: () => void;
  shape?: () => void;
  image?: ReactNode;
  game?: ReactNode;
  h5?: ReactNode;
  tool?: ReactNode;
}

export function CoursewarePageEditorToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  snapToGrid,
  onSnapToGridChange,
  insertions,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  snapToGrid: boolean;
  onSnapToGridChange: (checked: boolean) => void;
  insertions?: CoursewarePageToolbarInsertions;
}) {
  const t = useTranslations("coursewareWorkspace");
  const elementEditorT = useTranslations("coursewareElementEditor");
  const textEditorT = useTranslations("coursewareTextEditor");
  const insertionActions = [
    { id: "text", label: "prototypeInsertText", icon: Type, onSelect: insertions?.text },
    { id: "formula", label: "prototypeInsertFormula", icon: Sigma, onSelect: insertions?.formula },
    { id: "shape", label: "prototypeInsertShape", icon: Shapes, onSelect: insertions?.shape },
    { id: "image", label: "prototypeInsertImage", icon: ImagePlus, control: insertions?.image },
    { id: "game", label: "prototypeInsertGame", icon: Gamepad2, control: insertions?.game },
    { id: "h5", label: "prototypeInsertH5", icon: FileCode2, control: insertions?.h5 },
    { id: "tool", label: "prototypeInsertTool", icon: Wrench, control: insertions?.tool },
  ].map((action) => ({
    ...action,
    label: t(action.label as "prototypeInsertText"),
    disabled: !action.onSelect && !action.control,
  }));

  return (
    <div className="flex min-w-0 items-center gap-2">
      <CoursewareInsertionToolbar
        aria-label={t("contentInsertion")}
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
          ...insertionActions,
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
