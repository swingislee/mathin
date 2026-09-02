"use client";

import { AlignCenter, AlignLeft, AlignRight, Grid3X3 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { CoursewareEditorToolbarButton } from "./CoursewareEditorWorkbench";
import {
  coursewareTextValue,
  setCoursewareTextValue,
} from "./courseware-text-value";
import type { DocNode } from "./schema";

export {
  coursewareTextValue,
  isCoursewareTextElement,
  setCoursewareTextValue,
} from "./courseware-text-value";

function richTextCssValue(node: DocNode, property: string) {
  if (node.content?.kind !== "rich_text") return null;
  const match = node.content.html?.match(new RegExp(`${property}\\s*:\\s*([^;"']+)`, "i"));
  return match?.[1]?.trim() ?? null;
}

function inferredFontSize(node: DocNode) {
  if (node.style.fontSize != null) return node.style.fontSize;
  const value = richTextCssValue(node, "font-size")?.match(/-?\d+(?:\.\d+)?/)?.[0];
  return value ? Number(value) : null;
}

function cssColorToHex(value: string | null) {
  if (!value) return null;
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1];
  if (hex?.length === 3) return `#${[...hex].map((part) => `${part}${part}`).join("")}`;
  if (hex) return `#${hex.slice(0, 6)}`;
  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgb) return null;
  return `#${rgb.slice(1, 4).map((part) => Math.min(255, Number(part)).toString(16).padStart(2, "0")).join("")}`;
}

function inferredColor(node: DocNode) {
  return node.style.color ?? cssColorToHex(richTextCssValue(node, "color")) ?? "#2d2a26";
}

function inferredAlignment(node: DocNode): "left" | "center" | "right" {
  if (node.style.textAlign === "center" || node.style.textAlign === "right") return node.style.textAlign;
  if (node.style.textAlign === "left") return "left";
  const value = richTextCssValue(node, "text-align");
  return value === "center" || value === "right" ? value : "left";
}

export function CoursewareGridSnapToggle({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const t = useTranslations("coursewareTextEditor");
  return (
    <CoursewareEditorToolbarButton
      selected={checked}
      aria-pressed={checked}
      aria-label={t("snapToGrid")}
      title={`${t("snapToGrid")} · ${t("snapHint")}`}
      onClick={() => onCheckedChange(!checked)}
    >
      <Grid3X3 className="size-4" />
    </CoursewareEditorToolbarButton>
  );
}

export function CoursewareTextElementInspector({
  node,
  onPatch,
}: {
  node: DocNode;
  onPatch: (updater: (node: DocNode) => void) => void;
}) {
  const t = useTranslations("coursewareTextEditor");
  const text = coursewareTextValue(node);
  const alignment = inferredAlignment(node);
  const alignments = [
    ["left", AlignLeft, t("alignLeft")],
    ["center", AlignCenter, t("alignCenter")],
    ["right", AlignRight, t("alignRight")],
  ] as const;

  return (
    <div data-courseware-text-element-inspector className="space-y-4">
      <Label className="grid gap-1.5">
        <span>{t("content")}</span>
        <Textarea
          value={text}
          rows={5}
          className="resize-y text-sm leading-6"
          onChange={(event) => onPatch((item) => setCoursewareTextValue(item, event.target.value))}
        />
      </Label>

      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-2">
        <Label className="grid gap-1.5">
          <span>{t("fontSize")}</span>
          <Input
            type="number"
            min={8}
            max={240}
            value={inferredFontSize(node) ?? ""}
            placeholder={t("keepSourceTypography")}
            onChange={(event) => onPatch((item) => {
              const value = Number(event.target.value);
              item.style.fontSize = Number.isFinite(value) && event.target.value !== "" ? value : null;
            })}
          />
        </Label>
        <Label className="grid gap-1.5">
          <span>{t("color")}</span>
          <Input
            type="color"
            className="h-10 cursor-pointer p-1"
            value={inferredColor(node)}
            onChange={(event) => onPatch((item) => { item.style.color = event.target.value; })}
          />
        </Label>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium text-ink">{t("alignment")}</p>
        <div className="grid grid-cols-3 gap-1.5">
          {alignments.map(([value, Icon, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant="secondary"
              aria-label={label}
              aria-pressed={alignment === value}
              className={cn("justify-center", alignment === value && "border-crater bg-moon/30")}
              onClick={() => onPatch((item) => { item.style.textAlign = value; })}
            >
              <Icon className="size-4" />
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
