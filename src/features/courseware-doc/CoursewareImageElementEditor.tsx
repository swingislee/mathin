"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { DocNode } from "./schema";

type ImageTransformPatch = Partial<Pick<DocNode["transform"], "x" | "y" | "width" | "height">>;

export function isCoursewareImageElement(node: DocNode | null | undefined): boolean {
  return Boolean(node?.resources.some((resource) => resource.kind === "image"));
}

export function CoursewareImageElementInspector({
  node,
  onPatch,
  onTransformChange,
}: {
  node: DocNode;
  onPatch: (updater: (node: DocNode) => void) => void;
  onTransformChange: (patch: ImageTransformPatch) => void;
}) {
  const t = useTranslations("coursewareImageEditor");
  const fits = [
    ["contain", t("fitContain")],
    ["cover", t("fitCover")],
    ["fill", t("fitFill")],
    ["none", t("fitNone")],
  ] as const;
  const geometry = [
    ["x", t("x")],
    ["y", t("y")],
    ["width", t("width")],
    ["height", t("height")],
  ] as const;

  return (
    <div data-courseware-image-element-inspector className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-ink">{t("fit")}</p>
        <div className="grid grid-cols-2 gap-1.5">
          {fits.map(([value, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant="secondary"
              aria-pressed={node.style.objectFit === value}
              className={cn("justify-center", node.style.objectFit === value && "border-crater bg-moon/30")}
              onClick={() => onPatch((item) => { item.style.objectFit = value; })}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium text-ink">{t("positionAndSize")}</p>
        <div className="grid grid-cols-2 gap-2">
          {geometry.map(([key, label]) => (
            <Label key={key} className="grid gap-1.5">
              <span>{label}</span>
              <Input
                type="number"
                min={key === "width" || key === "height" ? 1 : undefined}
                value={node.transform[key]}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!Number.isFinite(value) || ((key === "width" || key === "height") && value <= 0)) return;
                  onTransformChange({ [key]: value });
                }}
              />
            </Label>
          ))}
        </div>
      </div>

      <p className="text-xs leading-5 text-muted">{t("localOnlyHint")}</p>
    </div>
  );
}
