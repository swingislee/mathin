"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocale } from "next-intl";
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
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const skipCloseFocus = useRef(false);
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
  const badgeClass = cn("block size-2 shrink-0 rounded-full border",
    current.label ? studentLabelColors[current.label] : "border-muted/50 bg-transparent", "shadow-none");
  const badge = <span className={badgeClass} aria-hidden="true" />;

  const hasFocus = () => document.activeElement === trigger.current || Boolean(content.current?.contains(document.activeElement));
  const adjacentTrigger = (direction: -1 | 1) => {
    const scope = trigger.current?.closest("[data-student-label-scope]");
    if (!scope || !trigger.current) return null;
    const controls = Array.from(scope.querySelectorAll<HTMLButtonElement>("[data-student-label-trigger]:not(:disabled)"))
      .filter(button => button.closest("[data-student-label-scope]") === scope && button.getClientRects().length > 0
        && (button === trigger.current || button.getAttribute("aria-disabled") !== "true")
        && !button.closest('[hidden], [inert], [aria-hidden="true"]'));
    const index = controls.indexOf(trigger.current);
    return index < 0 ? null : controls[index + direction] ?? null;
  };
  const closeAndFocus = (target: HTMLButtonElement | null) => {
    if (open) skipCloseFocus.current = true;
    changeOpen(false);
    if (target?.isConnected && !target.disabled) {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    } else if (hasFocus() && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };
  const finishSave = (keyboard: boolean, label: StudentLabel | null) => {
    if (keyboard && hasFocus()) closeAndFocus((label ? adjacentTrigger(1) : null) ?? trigger.current);
    else changeOpen(false);
  };
  const save = async (label: StudentLabel | null, keyboard = false) => {
    if (!state || !current.canEdit || disabled || saving.current) return;
    if (label === current.label) { finishSave(keyboard, label); return; }
    saving.current = true; setPending(true); setError(null);
    try {
      const result = await setClassStudentLabelAction({ enrollmentId: current.enrollmentId, label });
      if (!result.ok) {
        setError(["FORBIDDEN", "UNAUTHENTICATED"].includes(result.code) ? m.forbidden
          : ["CLASS_MEMBERSHIP_NOT_ACTIVE", "CLASS_NOT_EDITABLE"].includes(result.code) ? m.changed : m.error);
        if (keyboard && hasFocus()) changeOpen(true);
        return;
      }
      setSaved({ base: state, value: result.data });
      finishSave(keyboard, label);
      router.refresh();
    } catch { setError(m.error); if (keyboard && hasFocus()) changeOpen(true); }
    finally { saving.current = false; setPending(false); }
  };
  const keyboardInput = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing
      || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))) return;
    const key = event.key.toUpperCase();
    const label = STUDENT_LABELS.find((value, index) => value === key || String(index + 1) === key);
    const direction = ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : null;
    const clear = event.key === "Delete" || event.key === "Backspace";
    if (!label && !direction && !clear && event.key !== "Escape") return;
    event.preventDefault(); event.stopPropagation();
    if (event.repeat || saving.current || disabled || !current.canEdit) return;
    if (event.key === "Escape") { closeAndFocus(null); return; }
    if (direction) { closeAndFocus(adjacentTrigger(direction) ?? trigger.current); return; }
    // Keep focus while the save disables the menu choices; errors stay on this student.
    event.currentTarget.focus();
    void save(label ?? null, true);
  };

  return <span data-placement-action className={cn("absolute right-0 top-0 z-30", className)} onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
    {current.canEdit ? <Popover open={open} onOpenChange={value => { if (!saving.current) { changeOpen(value); setError(null); } }}>
      <PopoverTrigger asChild><button ref={trigger} type="button" data-student-label-trigger disabled={disabled} aria-disabled={pending || undefined}
        onKeyDown={keyboardInput} aria-keyshortcuts="A B C D 1 2 3 4 ArrowLeft ArrowRight ArrowUp ArrowDown Delete Backspace Escape"
        aria-label={m.edit(studentName, current.label)} title={`${m.edit(studentName, current.label)} · ${m.keyboardHint}`} aria-busy={pending}
        className="flex h-6 w-3 items-start justify-end rounded-sm p-0.5 focus-visible:outline-2 focus-visible:outline-crater disabled:opacity-50">
        {badge}
      </button></PopoverTrigger>
      <PopoverContent ref={content} data-placement-action align="end" sideOffset={2} className="w-auto max-w-72 space-y-2 p-3" aria-label={`${studentName} · ${m.title}`}
        onKeyDown={keyboardInput}
        onEscapeKeyDown={event => { event.preventDefault(); if (!saving.current) closeAndFocus(null); }}
        onCloseAutoFocus={event => { if (skipCloseFocus.current) { event.preventDefault(); skipCloseFocus.current = false; } }}>
        <p className="text-xs font-medium">{studentName} · {m.title}</p>
        <div role="group" aria-label={m.title} className="flex gap-2">
          {STUDENT_LABELS.map(label => <button key={label} type="button" disabled={pending} aria-pressed={current.label === label}
            aria-label={m.read(studentName, label)} onClick={() => void save(label)}
            className={cn("flex size-9 items-center justify-center rounded-md border text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crater disabled:opacity-50", studentLabelColors[label], current.label === label && "ring-2 ring-ink ring-offset-2 ring-offset-card")}>
            {label}
          </button>)}
        </div>
        <button type="button" disabled={pending || current.label === null} onClick={() => void save(null)} className="min-h-8 text-xs text-muted underline underline-offset-4 disabled:opacity-40">{m.clear}</button>
        <p className="max-w-64 text-[11px] leading-4 text-muted">{m.keyboardHint}</p>
        {pending && <p role="status" className="text-xs text-muted">{m.saving}</p>}
        {error && <p role="alert" className="text-xs text-rose">{error}</p>}
      </PopoverContent>
    </Popover> : <span role="img" aria-label={m.read(studentName, current.label!)} title={m.read(studentName, current.label!)} className="block p-0.5">{badge}</span>}
    <span role="status" className="sr-only">{saved ? m.saved : ""}</span>
  </span>;
}
