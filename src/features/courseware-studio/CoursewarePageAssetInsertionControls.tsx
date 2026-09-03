"use client";

import { ImagePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { Input } from "@/components/ui/input";
import { CoursewareH5AuthoringDialog } from "@/features/courseware-doc/CoursewareH5AuthoringDialog";
import { CoursewareEditorToolbarLabel } from "@/features/courseware-doc/CoursewareEditorWorkbench";
import {
  createCoursewarePageH5Action,
  uploadCoursewarePageImageAction,
} from "./actions";
import type { CoursewareTrack } from "./data";

export interface InsertedCoursewareAsset {
  bindingKey: string;
  url: string;
}

export function CoursewarePageImageInsertionControl({
  pageDocId,
  track,
  onInserted,
  onError,
}: {
  pageDocId: string;
  track: CoursewareTrack;
  onInserted: (asset: InsertedCoursewareAsset) => void;
  onError: (code: string) => void;
}) {
  const t = useTranslations("coursewareWorkspace");
  const [pending, startTransition] = useTransition();
  return (
    <CoursewareEditorToolbarLabel aria-label={t("prototypeInsertImage")} title={t("prototypeInsertImage")}>
      <Input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="sr-only"
        disabled={pending}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          event.target.value = "";
          if (!file) return;
          startTransition(async () => {
            const result = await uploadCoursewarePageImageAction({ pageDocId, track, file });
            if (!result.ok) onError(result.code);
            else onInserted(result.data);
          });
        }}
      />
      <ImagePlus className="size-4" />
    </CoursewareEditorToolbarLabel>
  );
}

export function CoursewarePageH5InsertionControl({
  pageDocId,
  track,
  onInserted,
}: {
  pageDocId: string;
  track: CoursewareTrack;
  onInserted: (asset: InsertedCoursewareAsset) => void;
}) {
  return (
    <CoursewareH5AuthoringDialog
      iconOnly
      submit={async (html) => {
        const result = await createCoursewarePageH5Action({ pageDocId, track, html });
        return result.ok
          ? { ok: true, data: result.data }
          : { ok: false, code: result.code };
      }}
      onSaved={onInserted}
    />
  );
}
