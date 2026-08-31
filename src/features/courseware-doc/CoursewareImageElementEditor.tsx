"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">{t("appearance")}</p>
        <div className="grid grid-cols-2 gap-2">
          <Label className="grid gap-1.5">
            <span>{t("opacity")}</span>
            <Input
              type="number"
              min={0}
              max={100}
              step={5}
              value={Math.round(node.transform.opacity * 100)}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                onPatch((item) => { item.transform.opacity = Math.min(1, Math.max(0, value / 100)); });
              }}
            />
          </Label>
          <Label className="grid gap-1.5">
            <span>{t("layer")}</span>
            <Input
              type="number"
              value={node.zIndex}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                onPatch((item) => { item.zIndex = Math.round(value); });
              }}
            />
          </Label>
        </div>
        <Label className="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5">
          <Checkbox
            checked={node.visible}
            onCheckedChange={(checked) => onPatch((item) => { item.visible = checked === true; })}
          />
          <span>{t("visible")}</span>
        </Label>
      </div>

      <p className="text-xs leading-5 text-muted">{t("localOnlyHint")}</p>
    </div>
  );
}
