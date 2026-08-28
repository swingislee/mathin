"use client";

import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Link, useRouter } from "@/i18n/navigation";
import type { ActionResult } from "@/lib/action-result";
import {
  bookActivityAction,
  createActivityAction,
  deleteActivityAction,
  markActivityResultAction,
  searchStudentsForActivity,
  updateActivityAction,
  type ActivityInput,
} from "./activity-actions";
import { ACTIVITY_KINDS } from "./activity-kinds";
import type { ActivityRow } from "./activities";
import { inputClass } from "./controls";
import { DashboardCommandActions, DashboardCommandPanel, DashboardPage } from "./dashboard-page";

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
}: {
  title: string;
  activities: ActivityRow[];
  canManage: boolean;
}) {
  const t = useTranslations("school.activities");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<ActivityRow | null | "new">(null);
  const [deleteTarget, setDeleteTarget] = useState<ActivityRow | null>(null);
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
  const upcoming = activities.filter((activity) => new Date(activity.scheduledAt) >= new Date());
  const past = activities.filter((activity) => new Date(activity.scheduledAt) < new Date()).reverse();

  return <DashboardPage
    title={title}
    commandPanel={canManage ? <DashboardCommandPanel>
      <DashboardCommandActions>
        <Button size="sm" onClick={() => setEditing("new")} className="gap-1"><Plus size={15} />{t("new")}</Button>
      </DashboardCommandActions>
    </DashboardCommandPanel> : undefined}
  >
    <div className="space-y-6">
      <Group title={t("upcoming")} rows={upcoming} canManage={canManage} pending={pending} edit={setEditing} requestDelete={setDeleteTarget} run={run} />
      <details>
        <summary className="cursor-pointer text-sm text-muted">{t("past", { count: past.length })}</summary>
        <div className="mt-4"><Group title="" rows={past} canManage={canManage} pending={pending} edit={setEditing} requestDelete={setDeleteTarget} run={run} /></div>
      </details>
    </div>
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

function Group({
  title,
  rows,
  canManage,
  pending,
  edit,
  requestDelete,
  run,
}: {
  title: string;
  rows: ActivityRow[];
  canManage: boolean;
  pending: boolean;
  edit: (activity: ActivityRow) => void;
  requestDelete: (activity: ActivityRow) => void;
  run: RunAction;
}) {
  const t = useTranslations("school.activities");
  return <section>
    {title && <h2 className="text-base font-medium text-ink">{title}</h2>}
    {rows.length === 0
      ? <p className="mt-3 rounded-2xl border border-line bg-card p-5 text-sm text-muted">{t("empty")}</p>
      : <div className="mt-3 grid gap-4">
        {rows.map((activity) => <article key={activity.id} className="rounded-2xl border border-line bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Badge variant="outline">{t(`kind_${activity.kind}`)}</Badge>
              <h3 className="mt-2 font-medium">{activity.title}</h3>
              <p className="mt-1 text-xs text-muted">
                {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(activity.scheduledAt))}
                {` · ${activity.location || "—"} · ${t("counts", {
                  booked: activity.registrations.filter((registration) => registration.status === "booked" || registration.status === "attended").length,
                  attended: activity.registrations.filter((registration) => registration.status === "attended").length,
                  capacity: activity.capacity ?? "∞",
                })}`}
              </p>
            </div>
            {canManage && <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => edit(activity)}>{t("edit")}</Button>
              <Button size="sm" variant="secondary" className="text-rose" aria-label={t("delete")} disabled={pending} onClick={() => requestDelete(activity)}><Trash2 size={15} /></Button>
            </div>}
          </div>
          <RegistrationList activity={activity} pending={pending} run={run} />
        </article>)}
      </div>}
  </section>;
}

function RegistrationList({ activity, pending, run }: { activity: ActivityRow; pending: boolean; run: RunAction }) {
  const t = useTranslations("school.activities");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ id: string; name: string; grade: number | null }>>([]);
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});

  return <div className="mt-4 border-t border-line pt-3">
    <Input
      value={query}
      onChange={(event) => {
        const nextQuery = event.target.value;
        setQuery(nextQuery);
        if (nextQuery.trim()) void searchStudentsForActivity(nextQuery).then(setResults);
        else setResults([]);
      }}
      placeholder={t("searchStudent")}
      className={inputClass}
    />
    {results.length > 0 && <div className="mt-2 flex flex-wrap gap-2">
      {results.map((student) => <Button
        key={student.id}
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => run(
          () => bookActivityAction(activity.id, student.id),
          t("bookSuccess"),
          () => { setResults([]); setQuery(""); },
        )}
      >+ {student.name}</Button>)}
    </div>}
    <ul className="mt-3 divide-y divide-line">
      {activity.registrations.map((registration) => <li key={registration.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
        <Link href={`/dashboard/students/${registration.studentId}`} className="font-medium hover:underline">{registration.studentName}</Link>
        <span className="text-xs text-muted">{t(`status_${registration.status}`)}</span>
        <Input
          value={outcomes[registration.id] ?? registration.outcome}
          onChange={(event) => setOutcomes((current) => ({ ...current, [registration.id]: event.target.value }))}
          placeholder={t("outcome")}
          maxLength={1_000}
          className={`${inputClass} min-w-0 grow basis-40`}
        />
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(
          () => markActivityResultAction(registration.id, "attended", outcomes[registration.id] ?? registration.outcome),
          t("resultMarked"),
        )}>{t("attended")}</Button>
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(
          () => markActivityResultAction(registration.id, "no_show", outcomes[registration.id] ?? registration.outcome),
          t("resultMarked"),
        )}>{t("noShow")}</Button>
      </li>)}
    </ul>
  </div>;
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
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{ACTIVITY_KINDS.map((kind) => <SelectItem key={kind} value={kind}>{t(`kind_${kind}`)}</SelectItem>)}</SelectContent>
          </Select>
        </Label>
        <Label className="grid gap-1 text-xs font-normal text-muted">{t("titleLabel")}<Input value={form.title} onChange={(event) => set("title", event.target.value)} maxLength={100} className={inputClass} /></Label>
        <p className="rounded-xl bg-paper px-3 py-2 text-xs text-muted sm:col-span-2">{t(`kindHint_${form.kind}`)}</p>
        <Label className="grid gap-1 text-xs font-normal text-muted">{t("time")}<DateTimePicker mode="datetime" value={form.scheduledAt} onValueChange={(value) => set("scheduledAt", value)} className={inputClass} /></Label>
        <Label className="grid gap-1 text-xs font-normal text-muted">{t("duration")}<Input type="number" min={1} max={32_767} value={form.durationMin ?? ""} onChange={(event) => set("durationMin", event.target.value ? Number(event.target.value) : null)} className={inputClass} /></Label>
        <Label className="grid gap-1 text-xs font-normal text-muted">{t("location")}<Input value={form.location} onChange={(event) => set("location", event.target.value)} maxLength={100} className={inputClass} /></Label>
        <Label className="grid gap-1 text-xs font-normal text-muted">{t("capacity")}<Input type="number" min={1} max={32_767} value={form.capacity ?? ""} onChange={(event) => set("capacity", event.target.value ? Number(event.target.value) : null)} className={inputClass} /></Label>
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
