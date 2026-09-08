"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useCoursewarePageActionsDisabled } from "@/features/courseware-doc/CoursewareEditorWorkbench";
import type { CoursewareTrack } from "./data";
import { loadFormalPublicationStateAction, type FormalPublicationState } from "./formal-publication-actions";

const DecisionRailContent = dynamic(() => import("@/features/school/curriculum/DecisionRailContent").then((module) => module.DecisionRailContent));

export function FormalCoursewarePublicationDialog({ lectureId, track }: { lectureId: string; track: CoursewareTrack }) {
  const t = useTranslations("coursewareWorkspace.publication");
  const workspace = useTranslations("coursewareWorkspace");
  const editing = useCoursewarePageActionsDisabled();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FormalPublicationState | null>(null);
  const [error, setError] = useState(false);
  const request = useRef(0);

  async function reload() {
    const id = ++request.current;
    setState(null);
    setError(false);
    try {
      const result = await loadFormalPublicationStateAction({ lectureId });
      if (id !== request.current) return;
      if (result.ok) setState(result.data);
      else setError(true);
    } catch { if (id === request.current) setError(true); }
  }
  const trackState = state?.tracks.find((item) => item.track === track);
  const trackLabel = workspace(track === "adapted-4x3" ? "canvasAdapted" : "canvasNative");

  return <Dialog open={open} onOpenChange={(next) => {
    setOpen(next);
    if (next) void reload();
    else { request.current += 1; setState(null); }
  }}>
    <DialogTrigger asChild>
      <Button type="button" size="sm" variant="secondary" className="shrink-0 gap-1.5"
        data-courseware-publication-trigger disabled={editing} title={editing ? t("saveFirst") : t("title")}>
        <Send className="size-3.5" /><span>{t("title")}</span>
      </Button>
    </DialogTrigger>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{t("title")} · {trackLabel}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>
      {error || (state && !trackState) ? <div role="alert" className="space-y-2 text-sm text-rose">
        <p>{t("loadFailed")}</p><Button variant="secondary" size="sm" onClick={() => void reload()}>{t("retry")}</Button>
      </div> : !state || !trackState ? <p role="status" className="text-sm text-muted">{t("loading")}</p> : <>
        <div className="space-y-1 border-b border-line pb-3 text-xs text-muted" role="status">
          <p>{trackState.currentReleaseNo ? t("released", { version: trackState.currentReleaseNo }) : t("unreleased")}</p>
          <p>{t(trackState.hasUnpublishedChanges ? "unpublishedChanges" : "noUnpublishedChanges")}</p>
        </div>
        <DecisionRailContent lectureId={lectureId} trackState={trackState}
          capabilities={state.capabilitiesByTrack[track]} emergencyPublishEnabled={state.policy.emergencyPublishEnabled}
          history={state.history} onChanged={() => void reload()} />
      </>}
    </DialogContent>
  </Dialog>;
}
