"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeHexColor } from "./board-color";
import type { HexColor } from "./types";

export function CustomColorPicker({ resolveInitialColor, onApply }: {
  resolveInitialColor: () => string;
  onApply: (color: HexColor) => void;
}) {
  const t = useTranslations("whiteboard.board.tools");
  const inputId = useId();
  const [draft, setDraft] = useState<string>(() => normalizeHexColor(resolveInitialColor()) ?? "#000000");
  const normalized = normalizeHexColor(draft);
  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3">
      <p className="text-xs font-medium text-ink">{t("customColor")}</p>
      <div className="flex items-end gap-2">
        <Input type="color" aria-label={t("colorPicker")} value={normalized ?? "#000000"}
          onChange={(event) => setDraft(event.target.value)} className="size-11 shrink-0 cursor-pointer p-1" />
        <div className="min-w-0 flex-1">
          <label htmlFor={inputId} className="mb-1 block text-xs text-muted">{t("colorHex")}</label>
          <Input id={inputId} value={draft} placeholder="#RRGGBB" maxLength={7} spellCheck={false}
            autoComplete="off" aria-invalid={!normalized} aria-describedby={!normalized ? `${inputId}-error` : undefined}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && normalized) { event.preventDefault(); onApply(normalized); } }}
            className="h-11 font-mono" />
        </div>
      </div>
      {!normalized ? <p id={`${inputId}-error`} className="text-xs text-rose">{t("colorHexInvalid")}</p> : null}
      <Button type="button" variant="secondary" className="h-11 w-full" disabled={!normalized}
        onClick={() => { if (normalized) onApply(normalized); }}>{t("applyColor")}</Button>
    </div>
  );
}
