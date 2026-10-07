"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { Tag } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { setClassStudentLabelAction } from "./student-labels-actions";
import { STUDENT_LABELS, studentLabelColors, studentLabelMessages, type StudentLabel, type StudentLabelState } from "./student-labels-contract";

/** A separate control beside the name preserves its existing profile and drag actions. */
export function StudentLabelControl({ state, studentName, disabled = false, className, onOpenChange }: {
  state?: StudentLabelState; studentName: string; disabled?: boolean; className?: string;
  onOpenChange?: (enrollmentId: string, open: boolean) => void;
}) {
  const m = studentLabelMessages(useLocale());
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<{ base: StudentLabelState; value: StudentLabelState } | null>(null);
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const current = saved && saved.base === state ? saved.value : state;
  const enrollmentId = state?.enrollmentId;
  useEffect(() => () => {
    if (enrollmentId) onOpenChange?.(enrollmentId, false);
  }, [enrollmentId, onOpenChange]);
  const changeOpen = (value: boolean) => {
    setOpen(value);
    if (enrollmentId) onOpenChange?.(enrollmentId, value);
  };
  if (!current || !current.label && !current.canEdit) return null;
  const badgeClass = cn("flex size-3.5 shrink-0 items-center justify-center rounded-sm text-[10px] font-semibold leading-none",
    current.label ? studentLabelColors[current.label] : "border border-dashed border-muted/60 bg-card text-muted");
  const badge = <span className={badgeClass} aria-hidden="true">{current.label ?? <Tag className="size-2.5" />}</span>;

  const save = async (label: StudentLabel | null) => {
    if (!state || saving.current) return;
    if (label === current.label) { changeOpen(false); return; }
    saving.current = true; setPending(true); setError(null);
    try {
      const result = await setClassStudentLabelAction({ enrollmentId: current.enrollmentId, label });
      if (!result.ok) {
        setError(["FORBIDDEN", "UNAUTHENTICATED"].includes(result.code) ? m.forbidden
          : ["CLASS_MEMBERSHIP_NOT_ACTIVE", "CLASS_NOT_EDITABLE"].includes(result.code) ? m.changed : m.error);
        return;
      }
      setSaved({ base: state, value: result.data });
      changeOpen(false);
      router.refresh();
    } catch { setError(m.error); }
    finally { saving.current = false; setPending(false); }
  };

  return <span data-placement-action className={cn("absolute right-0 top-0 z-30", className)} onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
    {current.canEdit ? <Popover open={open} onOpenChange={value => { if (!saving.current) { changeOpen(value); setError(null); } }}>
      <PopoverTrigger asChild><button type="button" disabled={disabled || pending}
        aria-label={m.edit(studentName, current.label)} title={m.edit(studentName, current.label)} aria-busy={pending}
        className="flex size-6 items-start justify-end rounded-sm p-0.5 focus-visible:outline-2 focus-visible:outline-crater disabled:opacity-50">
        {badge}
      </button></PopoverTrigger>
      <PopoverContent data-placement-action align="end" sideOffset={2} className="w-auto max-w-72 space-y-2 p-3" aria-label={`${studentName} · ${m.title}`}>
        <p className="text-xs font-medium">{studentName} · {m.title}</p>
        <div role="group" aria-label={m.title} className="flex gap-2">
          {STUDENT_LABELS.map(label => <button key={label} type="button" disabled={pending} aria-pressed={current.label === label}
            aria-label={m.read(studentName, label)} onClick={() => void save(label)}
            className={cn("flex size-9 items-center justify-center rounded-md text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crater disabled:opacity-50", studentLabelColors[label], current.label === label && "ring-2 ring-ink ring-offset-2 ring-offset-card")}>
            {label}
          </button>)}
        </div>
        <button type="button" disabled={pending || current.label === null} onClick={() => void save(null)} className="min-h-8 text-xs text-muted underline underline-offset-4 disabled:opacity-40">{m.clear}</button>
        {pending && <p role="status" className="text-xs text-muted">{m.saving}</p>}
        {error && <p role="alert" className="text-xs text-rose">{error}</p>}
      </PopoverContent>
    </Popover> : <span role="img" aria-label={m.read(studentName, current.label!)} title={m.read(studentName, current.label!)} className="block p-0.5">{badge}</span>}
    <span role="status" className="sr-only">{saved ? m.saved : ""}</span>
  </span>;
}
