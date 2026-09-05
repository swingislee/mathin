"use client";

import { ArrowRight, ChevronDown, ChevronRight, LoaderCircle, Plus, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Link, useRouter } from "@/i18n/navigation";
import type { ActionResult } from "@/lib/action-result";
import {
  createActivityAction,
  deleteActivityAction,
  updateActivityAction,
  type ActivityInput,
} from "./activity-actions";
import { ACTIVITY_KINDS } from "./activity-kinds";
import type { ActivityRow } from "./activities";
import { inputClass } from "./controls";
import { DashboardInlineEntry } from "./dashboard-page/DashboardInlineEntry";
import type { PublicClassRegistrationData } from "./public-class-registration-contract";
const PublicClassRegistrationPanel = dynamic(() => import("./PublicClassRegistrationPanel"));
import {
  DashboardCommandActions,
  DashboardCommandPanel,
  DashboardPage,
  DashboardSection,
  DashboardTableShell,
  StatusStrip,
} from "./dashboard-page";

const empty: ActivityInput = {
  kind: "trial_class",
  title: "",
  scheduledAt: "",
  durationMin: 60,
  location: "",
  capacity: null,
  remark: "",
};

type RunAction = (
  action: () => Promise<ActionResult>,
  successMessage: string,
  onSuccess?: () => void,
) => void;

export function ActivitiesManager({
  title,
  activities,
  canManage,
  initialActivityId,
  teachingActivityIds,
  initialRegistrationData,
}: {
  title: string;
  activities: ActivityRow[];
  canManage: boolean;
  initialActivityId?: string;
  teachingActivityIds: string[];
  initialRegistrationData?: PublicClassRegistrationData;
}) {
  const t = useTranslations("school.activities");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<ActivityRow | null | "new">(null);
  const [deleteTarget, setDeleteTarget] = useState<ActivityRow | null>(null);
  const [activeActivityId, setActiveActivityId] = useState<string | null>(initialActivityId ?? null);
  const toggleActivity = (activityId: string) => setActiveActivityId((current) => current === activityId ? null : activityId);
  const run: RunAction = (action, successMessage, onSuccess) => startTransition(async () => {
    const result = await action();
    if (result.ok) {
      toast.success(successMessage);
      onSuccess?.();
      router.refresh();
    } else {
      toast.error(result.code === "ACTIVITY_FULL" ? t("full") : t("actionFailed"));
    }
  });
  const registrations = activities.flatMap((activity) => activity.registrations);
  const funnel = {
    booked: registrations.filter((registration) => registration.status !== "cancelled").length,
    attended: registrations.filter((registration) => registration.status === "attended").length,
    assessed: registrations.filter((registration) => registration.assessment !== null).length,
    awaitingRoute: registrations.filter((registration) =>
      registration.status === "attended" && registration.assessment !== null && registration.route === null
    ).length,
  };

  return <DashboardPage
    title={title}
    description={t("intro")}
    commandPanel={canManage ? <DashboardCommandPanel>
      <DashboardCommandActions>
        <Button size="sm" onClick={() => setEditing("new")} className="gap-1"><Plus size={15} />{t("new")}</Button>
      </DashboardCommandActions>
    </DashboardCommandPanel> : undefined}
  >
    <DashboardSection title={t("workspaceListTitle")} description={t("workspaceListHint")}>
      <StatusStrip
        className="mb-3"
        items={[
          { label: t("funnelBooked"), value: funnel.booked },
          { label: t("funnelAttended"), value: funnel.attended },
          { label: t("funnelAssessed"), value: funnel.assessed },
          { label: t("awaitingRoute"), value: funnel.awaitingRoute },
        ]}
      />
      <DashboardTableShell>
        <Table containerClassName="max-h-[calc(100dvh-15rem)] overflow-auto">
          <TableHeader className="sticky top-0 z-30 bg-card">
            <TableRow>
              <TableHead>{t("time")}</TableHead>
              <TableHead>{t("activity")}</TableHead>
              <TableHead>{t("participation")}</TableHead>
              <TableHead>{t("assessment")}</TableHead>
              <TableHead>{t("awaitingRoute")}</TableHead>
              <TableHead className="text-right">{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activities.map((activity) => {
              const booked = activity.registrations.filter((registration) => registration.status !== "cancelled").length;
              const attended = activity.registrations.filter((registration) => registration.status === "attended").length;
              const assessed = activity.registrations.filter((registration) => registration.assessment).length;
              const awaitingRoute = activity.registrations.filter((registration) =>
                registration.status === "attended" && registration.assessment !== null && registration.route === null
              ).length;
              const expanded = activeActivityId === activity.id;
              const publicClass = activity.kind === "public_class";
              return <Fragment key={activity.id}><TableRow aria-expanded={publicClass ? expanded : undefined} className={publicClass ? `cursor-pointer ${expanded ? "bg-moon/10 hover:bg-moon/10" : ""}` : undefined} onClick={publicClass ? () => toggleActivity(activity.id) : undefined}>
                <TableCell className="whitespace-nowrap text-sm">
                  {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(activity.scheduledAt))}
                </TableCell>
                <TableCell>
                  {publicClass ? <Button size="sm" variant="ghost" className="h-auto justify-start gap-1 p-0 text-left text-ink" onClick={(event) => { event.stopPropagation(); toggleActivity(activity.id); }}>{expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}{activity.title}</Button> : <Link href={`/dashboard/activities/${activity.id}`} className="font-medium text-ink hover:underline">
                    {activity.title}
                  </Link>}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Badge variant="outline">{t(`kind_${activity.kind}`)}</Badge>
                    <span>{activity.location || "—"}</span>
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">{t("participationCounts", { booked, attended })}</TableCell>
                <TableCell className="tabular-nums">{assessed}</TableCell>
                <TableCell className="tabular-nums">{awaitingRoute}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
                    {canManage ? <>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(activity)}>{t("edit")}</Button>
                      <Button size="sm" variant="ghost" className="text-rose" aria-label={t("delete")} disabled={pending} onClick={() => setDeleteTarget(activity)}><Trash2 size={15} /></Button>
                    </> : null}
                    {publicClass ? <Button size="sm" variant="secondary" onClick={() => toggleActivity(activity.id)}>{t("inlineRegistration")}</Button> : null}
                    {!publicClass || teachingActivityIds.includes(activity.id) ? <Link href={`/dashboard/activities/${activity.id}${publicClass ? "?view=teaching" : ""}`} className={buttonVariants({ size: "sm", variant: "secondary" })}>
                      {t(publicClass ? "teacherWorkspace" : "openWorkspace")}<ArrowRight size={15} />
                    </Link> : null}
                  </div>
                </TableCell>
              </TableRow>{publicClass && expanded ? <TableRow className="hover:bg-transparent"><TableCell colSpan={6} className="p-0"><DashboardInlineEntry flush title={activity.title} onClose={() => setActiveActivityId(null)} closeLabel={t("closeRegistration")}><PublicClassRegistrationPanel activityId={activity.id} initialData={initialRegistrationData?.activity.id === activity.id ? initialRegistrationData : undefined} /></DashboardInlineEntry></TableCell></TableRow> : null}</Fragment>;
            })}
            {activities.length === 0 ? <TableRow><TableCell colSpan={6} className="h-40 text-center text-muted">{t("empty")}</TableCell></TableRow> : null}
          </TableBody>
        </Table>
      </DashboardTableShell>
    </DashboardSection>
    {editing && <ActivityDialog
      initial={editing === "new" ? null : editing}
      pending={pending}
      close={() => setEditing(null)}
      save={(input) => run(
        () => editing === "new" ? createActivityAction(input) : updateActivityAction(editing.id, input),
        editing === "new" ? t("activityCreated") : t("activitySaved"),
        () => setEditing(null),
      )}
    />}
    <ConfirmDialog
      open={deleteTarget !== null}
      onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      title={t("delete")}
      description={t("deleteConfirm")}
      confirmLabel={t("delete")}
      cancelLabel={t("cancel")}
      pending={pending}
      onConfirm={() => {
        const target = deleteTarget;
        setDeleteTarget(null);
        if (target) run(() => deleteActivityAction(target.id), t("activityDeleted"));
      }}
    />
  </DashboardPage>;
}

function ActivityDialog({
  initial,
  pending,
  close,
  save,
}: {
  initial: ActivityRow | null;
  pending: boolean;
  close: () => void;
  save: (input: ActivityInput) => void;
}) {
  const t = useTranslations("school.activities");
  const [form, setForm] = useState<ActivityInput>(initial ? {
    kind: initial.kind,
    title: initial.title,
    scheduledAt: initial.scheduledAt.slice(0, 16),
    durationMin: initial.durationMin,
    location: initial.location,
    capacity: initial.capacity,
    remark: initial.remark,
  } : empty);
  const set = <K extends keyof ActivityInput>(key: K, value: ActivityInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>{initial ? t("edit") : t("new")}</DialogTitle></DialogHeader>
      <p className="rounded-xl border border-line bg-moon/20 px-3 py-2 text-sm text-muted">{t("creationBoundary")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label className="grid gap-1 text-xs font-normal text-muted">
          {t("kind")}
          <Select value={form.kind} onValueChange={(value) => set("kind", value as ActivityInput["kind"])}>
            <SelectTrigger className="h-9 rounded-md shadow-none"><SelectValue /></SelectTrigger>
            <SelectContent>{ACTIVITY_KINDS.map((kind) => <SelectItem key={kind} value={kind}>{t(`kind_${kind}`)}</SelectItem>)}</SelectContent>
          </Select>
        </Label>
        <Label className="grid gap-1 text-xs font-normal text-muted">{t("titleLabel")}<Input value={form.title} onChange={(event) => set("title", event.target.value)} maxLength={100} className={`${inputClass} h-9 rounded-md py-1.5 shadow-none`} /></Label>
        <p className="rounded-xl bg-paper px-3 py-2 text-xs text-muted sm:col-span-2">{t(`kindHint_${form.kind}`)}</p>
        <Label className="grid gap-1 text-xs font-normal text-muted">{t("time")}<DateTimePicker mode="datetime" value={form.scheduledAt} onValueChange={(value) => set("scheduledAt", value)} className={`${inputClass} h-9 rounded-md py-1.5 shadow-none`} /></Label>
        <Label className="grid gap-1 text-xs font-normal text-muted">{t("duration")}<Input type="number" min={1} max={32_767} value={form.durationMin ?? ""} onChange={(event) => set("durationMin", event.target.value ? Number(event.target.value) : null)} className={`${inputClass} h-9 rounded-md py-1.5 shadow-none`} /></Label>
        <Label className="grid gap-1 text-xs font-normal text-muted">{t("location")}<Input value={form.location} onChange={(event) => set("location", event.target.value)} maxLength={100} className={`${inputClass} h-9 rounded-md py-1.5 shadow-none`} /></Label>
        <Label className="grid gap-1 text-xs font-normal text-muted">{t("capacity")}<Input type="number" min={1} max={32_767} value={form.capacity ?? ""} onChange={(event) => set("capacity", event.target.value ? Number(event.target.value) : null)} className={`${inputClass} h-9 rounded-md py-1.5 shadow-none`} /></Label>
      </div>
      <Textarea value={form.remark} onChange={(event) => set("remark", event.target.value)} placeholder={t("remark")} maxLength={1_000} />
      <DialogFooter>
        <Button size="sm" variant="secondary" onClick={close}>{t("cancel")}</Button>
        <Button size="sm" disabled={pending || !form.title.trim() || !form.scheduledAt} onClick={() => save(form)}>
          {pending && <LoaderCircle size={15} className="animate-spin" />}{t("save")}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
