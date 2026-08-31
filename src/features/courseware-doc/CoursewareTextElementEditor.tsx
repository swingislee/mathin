"use client";

import { AlignCenter, AlignLeft, AlignRight, Grid3X3, Type } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { DocNode } from "./schema";

export function isCoursewareTextElement(node: DocNode | null | undefined): boolean {
  return node?.content?.kind === "text" || node?.content?.kind === "rich_text";
}

function fallbackHtmlText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function coursewareTextValue(node: DocNode) {
  if (node.content?.kind === "text") return node.content.text ?? "";
  if (node.content?.kind !== "rich_text") return "";
  return fallbackHtmlText(node.content.html ?? "");
}

/** Replace visible copy while preserving the imported rich-text wrapper and its typography. */
export function setCoursewareTextValue(node: DocNode, value: string) {
  if (node.content?.kind === "text") {
    node.content.text = value;
    return;
  }
  if (node.content?.kind !== "rich_text") return;
  if (typeof document === "undefined") {
    node.content.html = value;
    return;
  }
  const template = document.createElement("template");
  template.innerHTML = node.content.html ?? "";
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current.textContent?.trim()) textNodes.push(current as Text);
  }
  if (textNodes[0]) {
    textNodes[0].textContent = value;
    textNodes.slice(1).forEach((textNode) => { textNode.textContent = ""; });
  } else {
    const span = document.createElement("span");
    span.textContent = value;
    template.content.append(span);
  }
  node.content.html = template.innerHTML;
}

export function CoursewareGridSnapControl({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const t = useTranslations("coursewareTextEditor");
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
      <span className="flex min-w-0 items-start gap-2">
        <Grid3X3 className="mt-0.5 size-4 shrink-0 text-crater" />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink">{t("snapToGrid")}</span>
          <span className="block text-xs leading-5 text-muted">{t("snapHint")}</span>
        </span>
      </span>
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        aria-label={t("snapToGrid")}
      />
    </label>
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
  const alignment = node.style.textAlign ?? "left";
  const alignments = [
    ["left", AlignLeft, t("alignLeft")],
    ["center", AlignCenter, t("alignCenter")],
    ["right", AlignRight, t("alignRight")],
  ] as const;

  return (
    <div data-courseware-text-element-inspector className="space-y-4">
      <div className="inline-flex items-center gap-2 rounded-full bg-rose px-3 py-1.5 text-sm font-medium text-white">
        <Type className="size-4" />
        {t("textElement")}
      </div>

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
            value={node.style.fontSize ?? ""}
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
            value={node.style.color ?? "#2d2a26"}
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
