"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, GitBranch, LoaderCircle, Plus, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DashboardSection } from "@/features/school/dashboard-page";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  forkTeacherMicrocourseVariantAction,
  selectTeacherMicrocourseVariantAction,
} from "./actions";
import type {
  TeacherMicrocourseSessionContext,
  TeacherMicrocourseSummary,
  TeacherMicrocourseTopic,
} from "./data";
import { MicrocourseStartPanel } from "./MicrocourseStartPanel";

export function MicrocourseVariantSwitcher({
  session,
  variants,
  activeVariant,
  topics,
}: {
  session: TeacherMicrocourseSessionContext;
  variants: TeacherMicrocourseSummary[];
  activeVariant: TeacherMicrocourseSummary | null;
  topics: TeacherMicrocourseTopic[];
}) {
  const t = useTranslations("teacherMicrocourses");
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [forkOpen, setForkOpen] = useState(false);
  const [forkName, setForkName] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const locked = Boolean(session.coursewareFrozenAt || session.startedAt);

  const lineage = useMemo(() => {
    if (!activeVariant?.basedOnVariantName) return null;
    return t("variantBasedOn", { name: activeVariant.basedOnVariantName });
  }, [activeVariant, t]);

  const openFork = () => {
    if (!activeVariant) return;
    setForkName(t("forkVariantDefault", { name: activeVariant.variantName }));
    setMessage("");
    setForkOpen(true);
  };

  const fork = () => startTransition(async () => {
    if (!activeVariant) return;
    const result = await forkTeacherMicrocourseVariantAction({
      microcourseId: activeVariant.id,
      variantName: forkName,
    });
    if (!result.ok) {
      setMessage(t("actionFailed", { code: result.code }));
      return;
    }
    setForkOpen(false);
    router.replace(`/dashboard/sessions/${session.id}/microcourse?variant=${result.data.microcourseId}`);
  });

  const select = () => startTransition(async () => {
    if (!activeVariant) return;
    const result = await selectTeacherMicrocourseVariantAction({
      sessionId: session.id,
      microcourseId: activeVariant.id,
    });
    setMessage(result.ok ? t("variantSelected") : t("actionFailed", { code: result.code }));
    if (result.ok) router.refresh();
  });

  return <>
    <DashboardSection
      title={t("variantWorkspaceTitle")}
      description={t("variantWorkspaceDescription")}
      actions={session.canCreate && !locked ? <Button type="button" size="sm" variant="secondary" onClick={() => setCreateOpen(true)}><Plus className="size-4" />{t("createBlankVariant")}</Button> : undefined}
      contentClassName="space-y-3"
      data-testid="microcourse-variant-switcher"
    >
        <div className="flex gap-2 overflow-x-auto pb-1">
          {variants.map((variant) => <Link
            key={variant.id}
            href={`/dashboard/sessions/${session.id}/microcourse?variant=${variant.id}`}
            className={cn(
              buttonVariants({ size: "sm", variant: variant.id === activeVariant?.id ? "primary" : "secondary" }),
              "h-auto min-w-48 shrink-0 justify-start px-3 py-2 text-left",
            )}
          >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 truncate">
                  {variant.selectedForSession && <Check className="size-3.5 shrink-0" />}
                  <span className="truncate">{variant.variantName}</span>
                </span>
                <span className={cn("mt-0.5 block truncate text-xs font-normal", variant.id === activeVariant?.id ? "text-white/75" : "text-muted")}>
                  {variant.authorName} · {t("variantPageCount", { count: variant.pageCount })}
                </span>
              </span>
          </Link>)}
        </div>
        {activeVariant && <div className="flex flex-wrap items-center justify-between gap-3 bg-moon/15 px-3 py-2">
          <div className="min-w-0 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{activeVariant.variantName}</span>
              {activeVariant.selectedForSession && <Badge>{t("selectedForClass")}</Badge>}
              {activeVariant.canEdit && <Badge variant="secondary">{t("editableVariant")}</Badge>}
              {!activeVariant.canEdit && <Badge variant="outline">{t("readOnlyVariant")}</Badge>}
            </div>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted">
              <UserRound className="size-3.5" />{activeVariant.authorName}
              {lineage && <><span>·</span><GitBranch className="size-3.5" />{lineage}</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!activeVariant.canEdit && session.canCreate && !locked && <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={openFork}>
              <GitBranch className="size-4" />{t("editAsBranch")}
            </Button>}
            {session.canSelect && !locked && !activeVariant.selectedForSession && <Button type="button" size="sm" disabled={pending || activeVariant.pageCount === 0} onClick={select}>
              {pending && <LoaderCircle className="size-4 animate-spin" />}{t("selectForClass")}
            </Button>}
          </div>
        </div>}
        {locked && <p className="text-xs text-muted">{t("variantSelectionLocked")}</p>}
        {message && <p role="status" className="text-sm text-muted">{message}</p>}
    </DashboardSection>

    <Dialog open={createOpen} onOpenChange={setCreateOpen}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto p-4">
        <DialogHeader className="sr-only">
          <DialogTitle>{t("createBlankVariant")}</DialogTitle>
          <DialogDescription>{t("startDescription")}</DialogDescription>
        </DialogHeader>
        <MicrocourseStartPanel sessionId={session.id} sessionTitle={session.title} topics={topics} />
      </DialogContent>
    </Dialog>

    <Dialog open={forkOpen} onOpenChange={setForkOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("forkVariantTitle")}</DialogTitle>
          <DialogDescription>{t("forkVariantDescription")}</DialogDescription>
        </DialogHeader>
        <Label className="grid gap-1.5">
          <span>{t("variantName")}</span>
          <Input value={forkName} onChange={(event) => setForkName(event.target.value)} maxLength={120} />
        </Label>
        {message && <p role="alert" className="text-sm text-rose">{message}</p>}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setForkOpen(false)}>{t("cancel")}</Button>
          <Button type="button" disabled={pending || !forkName.trim()} onClick={fork}>
            {pending && <LoaderCircle className="size-4 animate-spin" />}{t("createBranch")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
