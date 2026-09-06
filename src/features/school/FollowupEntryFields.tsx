"use client";

import { Children, type ReactNode } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { NextContactReminderField } from "./NextContactReminderField";

/** 首联与邀约共用的填写顺序；业务模块只提供自己的字段，备注与提交只有一个位置。 */
export function FollowupEntryFields({
  id, note, onNoteChange, placeholder, disabled = false, pending = false,
  reminder, hint, children, tools, saveDisabled = false, onSave, canAdvance = false,
  readOnly = false, noteLabel, noteMaxLength = 2000,
}: {
  id: string;
  note: string;
  onNoteChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  pending?: boolean;
  reminder?: { value: string | null | undefined; onChange: (value: string | null) => void; disabled?: boolean };
  hint?: ReactNode;
  children?: ReactNode;
  tools?: ReactNode;
  saveDisabled?: boolean;
  onSave?: (advance: boolean) => void;
  canAdvance?: boolean;
  readOnly?: boolean;
  noteLabel?: string;
  noteMaxLength?: number;
}) {
  const t = useTranslations("school.followupEntry");
  const hasBusiness = Children.toArray(children).length > 0;
  return <div data-followup-entry-fields className={cn("grid min-w-0 items-start gap-6",
    hasBusiness && "@[50rem]/followup-entry:grid-cols-[minmax(0,1fr)_19rem] @[72rem]/followup-entry:grid-cols-[minmax(0,1fr)_22rem]")}
    onKeyDown={(event) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.repeat) return;
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (!readOnly && !disabled && !pending && !saveDisabled) onSave?.(false);
    }
  }}>
    {hasBusiness ? <div data-followup-business className="min-w-0 space-y-5">{children}</div> : null}
    <aside data-followup-notes className={cn("min-w-0 space-y-3", hasBusiness
      ? "@[50rem]/followup-entry:sticky @[50rem]/followup-entry:top-2"
      : "w-full max-w-3xl")}>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-note`} className="text-xs font-medium text-ink">{noteLabel ?? t("note")}</Label>
        {readOnly ? <p id={`${id}-note`} className="min-h-28 whitespace-pre-wrap text-sm leading-6">{note || '—'}</p> : <Textarea id={`${id}-note`} value={note} onChange={(event) => onNoteChange?.(event.target.value)}
          rows={4} maxLength={noteMaxLength} disabled={disabled || pending}
          placeholder={placeholder ?? t("notePlaceholder")}
          className="min-h-28 resize-y bg-card text-sm leading-6" />}
      </div>
      {!readOnly && (reminder || hasBusiness) ? <div data-followup-reminder-slot className={cn(hasBusiness && "min-h-18")}>
        {reminder ? <NextContactReminderField id={`${id}-reminder`} value={reminder.value}
          onChange={reminder.onChange} disabled={disabled || pending || reminder.disabled}
          compact className="w-full max-w-72" /> : null}
      </div> : null}
      <div data-followup-entry-actions className="flex min-w-0 flex-wrap items-center gap-2 pt-1">
        {hint ? <p className="w-full text-xs leading-5 text-muted" role="status">{hint}</p> : null}
        {tools ? <div className="flex w-full min-w-0 flex-wrap items-center gap-2">{tools}</div> : null}
        {!readOnly ? <Button type="button" size="sm" variant={canAdvance ? "secondary" : "primary"}
          className="h-auto min-h-9 whitespace-normal rounded-md px-3 py-1.5 text-xs"
          disabled={disabled || pending || saveDisabled} onClick={() => onSave?.(false)} aria-keyshortcuts="Control+Enter Meta+Enter">
          {pending ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : <Check className="size-3.5" />}
          {t("save")}<kbd className="text-[10px]">Ctrl ↵</kbd>
        </Button> : null}
        {!readOnly && canAdvance ? <Button type="button" size="sm" className="h-auto min-h-9 whitespace-normal rounded-md px-3 py-1.5 text-xs"
          disabled={disabled || pending || saveDisabled} onClick={() => onSave?.(true)}>{t("saveAndNext")}</Button> : null}
      </div>
    </aside>
  </div>;
}
