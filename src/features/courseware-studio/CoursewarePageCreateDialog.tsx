"use client";

import { useState, useTransition } from "react";
import { Box, FilePlus2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SPATIAL_COURSEWARE_TEMPLATE_ID } from "@/features/spatial-math/presets/courseware-template-contract";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import type { CoursewareTrack } from "./data";
import {
  createBlankCoursewarePageAction,
  createSpatialCoursewareTemplatePageAction,
} from "./actions";

type PageKind = "blank" | typeof SPATIAL_COURSEWARE_TEMPLATE_ID;

export function CoursewarePageCreateDialog({
  lectureId,
  afterPageDocId,
  track,
  disabled = false,
}: {
  lectureId: string;
  afterPageDocId: string | null;
  track: CoursewareTrack;
  disabled?: boolean;
}) {
  const t = useTranslations("coursewareStudio");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<PageKind>(SPATIAL_COURSEWARE_TEMPLATE_ID);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const create = () => startTransition(async () => {
    setMessage("");
    const result = kind === "blank"
      ? await createBlankCoursewarePageAction({
          lectureId,
          afterPageDocId,
          title: t("newPage"),
        })
      : await createSpatialCoursewareTemplatePageAction({
          lectureId,
          afterPageDocId,
          templateId: kind,
        });
    if (!result.ok) {
      setMessage(t("insertFailed", { code: result.code }));
      return;
    }
    setOpen(false);
    router.push(`/studio/courseware/${lectureId}?track=${track}&page=${result.data.pageId}`);
  });

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (!pending) setOpen(next);
      if (next) setMessage("");
    }}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          title={disabled ? t("insertSaveFirst") : undefined}
        >
          <Plus className="size-4" />
          {t("insertPage")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("createPageTitle")}</DialogTitle>
          <DialogDescription>{t("createPageDescription")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3" role="group" aria-label={t("createPageKindLabel")}>
          <Button
            type="button"
            variant={kind === SPATIAL_COURSEWARE_TEMPLATE_ID ? "primary" : "secondary"}
            className="h-auto min-h-20 justify-start whitespace-normal px-4 py-3 text-left"
            aria-pressed={kind === SPATIAL_COURSEWARE_TEMPLATE_ID}
            disabled={pending}
            onClick={() => setKind(SPATIAL_COURSEWARE_TEMPLATE_ID)}
          >
            <Box className="mt-0.5 size-5 shrink-0" />
            <span>
              <span className="block font-medium">{t("spatialTemplateLayeredCountingTitle")}</span>
              <span className="mt-1 block text-xs font-normal opacity-80">
                {t("spatialTemplateLayeredCountingDescription")}
              </span>
            </span>
          </Button>
          <Button
            type="button"
            variant={kind === "blank" ? "primary" : "secondary"}
            className="h-auto min-h-20 justify-start whitespace-normal px-4 py-3 text-left"
            aria-pressed={kind === "blank"}
            disabled={pending}
            onClick={() => setKind("blank")}
          >
            <FilePlus2 className="mt-0.5 size-5 shrink-0" />
            <span>
              <span className="block font-medium">{t("blankPageTitle")}</span>
              <span className="mt-1 block text-xs font-normal opacity-80">{t("blankPageDescription")}</span>
            </span>
          </Button>
        </div>

        <p className="min-h-5 text-sm text-rose" role="status" aria-live="polite">{message}</p>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
            {t("cancelCreatePage")}
          </Button>
          <Button type="button" disabled={pending} onClick={create}>
            {pending ? t("creatingPage") : t("createPage")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
