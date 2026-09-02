"use client";

import type { ReactNode } from "react";
import {
  Crop,
  Eye,
  Layers3,
  LockKeyhole,
  ScanLine,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { CoursewareCompactChoiceGroup } from "@/features/courseware-doc/CoursewareCompactChoiceGroup";
import { cn } from "@/lib/utils";

export type SourceRuntimeHostPreviewMode = "original" | "overlay" | "mask" | "crop";

export function SourceRuntimeHostPreview({
  mode,
  children,
}: {
  mode: SourceRuntimeHostPreviewMode;
  children: ReactNode;
}) {
  const t = useTranslations("coursewareWorkspace");

  return (
    <div
      data-source-runtime-host-preview={mode}
      className="relative size-full overflow-hidden bg-paper"
    >
      <div
        className={cn(
          "size-full origin-center transition-transform duration-200 motion-reduce:transition-none",
          mode === "crop" && "scale-[1.14]",
        )}
      >
        {children}
      </div>

      {mode === "overlay" ? (
        <div className="pointer-events-none absolute inset-0 z-20" aria-hidden="true">
          <div className="absolute left-[6%] top-[7%] flex items-center gap-2 rounded-full border border-rose/70 bg-card/95 px-3 py-1.5 text-xs font-medium text-ink shadow-sm">
            <Layers3 className="size-3.5 text-rose" />
            {t("sourcePrototypeOverlayMarker")}
          </div>
        </div>
      ) : null}

      {mode === "mask" ? (
        <div className="pointer-events-none absolute inset-0 z-20" aria-hidden="true">
          <div className="absolute inset-x-[9%] bottom-[8%] grid h-[19%] place-items-center rounded-xl border border-dashed border-crater bg-paper/95 px-3 text-center text-xs font-medium text-ink shadow-sm">
            {t("sourcePrototypeMaskMarker")}
          </div>
        </div>
      ) : null}

      {mode === "crop" ? (
        <div className="pointer-events-none absolute inset-[5%] z-20 rounded-lg border border-dashed border-rose/80" aria-hidden="true">
          <span className="absolute left-2 top-2 rounded-full bg-card/95 px-2 py-1 text-[11px] font-medium text-ink shadow-sm">
            {t("sourcePrototypeCropMarker")}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function SourceRuntimeHostCapabilityPrototype({
  mode,
  onModeChange,
}: {
  mode: SourceRuntimeHostPreviewMode;
  onModeChange: (mode: SourceRuntimeHostPreviewMode) => void;
}) {
  const t = useTranslations("coursewareWorkspace");
  const copy = {
    original: {
      label: t("sourcePrototypeOriginal"),
      description: t("sourcePrototypeOriginalDescription"),
    },
    overlay: {
      label: t("sourcePrototypeOverlay"),
      description: t("sourcePrototypeOverlayDescription"),
    },
    mask: {
      label: t("sourcePrototypeMask"),
      description: t("sourcePrototypeMaskDescription"),
    },
    crop: {
      label: t("sourcePrototypeCrop"),
      description: t("sourcePrototypeCropDescription"),
    },
  } satisfies Record<SourceRuntimeHostPreviewMode, { label: string; description: string }>;
  const choices = [
    { value: "original" as const, icon: <Eye className="size-4" />, meta: t("sourcePrototypeOriginalShort") },
    { value: "overlay" as const, icon: <Layers3 className="size-4" />, meta: t("sourcePrototypeOverlayShort") },
    { value: "mask" as const, icon: <ScanLine className="size-4" />, meta: t("sourcePrototypeMaskShort") },
    { value: "crop" as const, icon: <Crop className="size-4" />, meta: t("sourcePrototypeCropShort") },
  ].map((choice) => ({ ...choice, label: copy[choice.value].label }));
  const active = copy[mode];

  return (
    <section data-source-runtime-capability-prototype className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-xs font-medium text-ink">
            <Layers3 className="size-4 text-crater" />
            {t("sourcePrototypeTitle")}
          </h3>
          <Badge variant="outline">{t("sourcePrototypeSessionOnly")}</Badge>
        </div>
        <p className="text-xs leading-5 text-muted">{t("sourcePrototypeDescription")}</p>
      </div>

      <CoursewareCompactChoiceGroup
        value={mode}
        choices={choices}
        ariaLabel={t("sourcePrototypeChoiceLabel")}
        onValueChange={onModeChange}
      />

      <div className="space-y-1 text-xs leading-5">
        <p className="font-medium text-ink">{active.label}</p>
        <p className="text-muted">{active.description}</p>
      </div>

      <div className="space-y-2 border-t border-line pt-4">
        <p className="text-xs font-medium text-ink">{t("sourcePrototypeHostBoundaryTitle")}</p>
        <p className="text-xs leading-5 text-muted">{t("sourcePrototypeHostBoundaryDescription")}</p>
      </div>

      <div className="space-y-2 border-t border-line pt-4">
        <p className="flex items-center gap-2 text-xs font-medium text-ink">
          <LockKeyhole className="size-4 text-crater" />
          {t("sourcePrototypePatchBoundaryTitle")}
        </p>
        <p className="text-xs leading-5 text-muted">{t("sourcePrototypePatchBoundaryDescription")}</p>
        <ul className="divide-y divide-line text-xs text-muted">
          <li className="py-2">{t("sourcePrototypePatchText")}</li>
          <li className="py-2">{t("sourcePrototypePatchNodes")}</li>
          <li className="py-2">{t("sourcePrototypePatchInteractions")}</li>
        </ul>
      </div>

      <div className="space-y-2 border-t border-line pt-4">
        <p className="text-xs font-medium text-ink">{t("sourcePrototypeDecisionTitle")}</p>
        <p className="text-xs leading-5 text-muted">{t("sourcePrototypeDecisionDescription")}</p>
      </div>
    </section>
  );
}
