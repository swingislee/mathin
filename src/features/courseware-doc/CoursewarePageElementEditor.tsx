"use client";

import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Layers3,
  MoveDown,
  MoveUp,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  CoursewareImageElementInspector,
  isCoursewareImageElement,
} from "./CoursewareImageElementEditor";
import {
  CoursewareTextElementInspector,
  isCoursewareTextElement,
} from "./CoursewareTextElementEditor";
import type { DocNode } from "./schema";

export type CoursewareElementTransformPatch = Partial<
  Pick<DocNode["transform"], "x" | "y" | "width" | "height">
>;

export interface CoursewareLayerItem {
  id: string;
  label: string;
  kind: string;
  layer: number;
  visible?: boolean;
  depth?: number;
}

export function CoursewareLayerPanel({
  items,
  selectedId,
  onSelect,
  onLayerChange,
  onVisibilityChange,
}: {
  items: CoursewareLayerItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onLayerChange: (id: string, layer: number) => void;
  onVisibilityChange?: (id: string, visible: boolean) => void;
}) {
  const t = useTranslations("coursewareElementEditor");
  const [expanded, setExpanded] = useState(false);
  const ordered = useMemo(
    () => [...items].sort((left, right) => right.layer - left.layer || left.label.localeCompare(right.label)),
    [items],
  );

  return (
    <section data-courseware-layer-panel className="rounded-lg border border-line/80">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-9 w-full justify-start rounded-lg px-2.5"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <Layers3 className="size-4" />
        <span className="font-medium">{t("layers")}</span>
        <span className="text-xs tabular-nums text-muted">{t("elementCount", { count: items.length })}</span>
        {expanded ? <ChevronUp className="ml-auto size-4" /> : <ChevronDown className="ml-auto size-4" />}
      </Button>

      {expanded ? (
        <div className="border-t border-line/80 p-1.5">
          {ordered.length ? (
            <ol className="max-h-64 space-y-0.5 overflow-y-auto" role="listbox" aria-label={t("layers")}>
              {ordered.map((item) => {
                const selected = item.id === selectedId;
                return (
                  <li
                    key={item.id}
                    role="option"
                    tabIndex={0}
                    aria-selected={selected}
                    data-courseware-layer-item={item.id}
                    data-selected={selected ? "true" : undefined}
                    className={cn(
                      "grid cursor-default grid-cols-[minmax(0,1fr)_3.75rem_auto] items-center gap-1 rounded-md px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-rose",
                      selected ? "bg-moon/25" : "hover:bg-moon/10",
                    )}
                    onClick={() => onSelect(item.id)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onSelect(item.id);
                    }}
                  >
                    <div
                      className="flex h-8 min-w-0 items-center gap-2 px-1.5 text-left text-sm"
                      style={{ paddingInlineStart: `${6 + Math.min(item.depth ?? 0, 4) * 10}px` }}
                    >
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <span className="shrink-0 text-[10px] text-muted">{item.kind}</span>
                    </div>
                    <Input
                      type="number"
                      value={item.layer}
                      aria-label={t("layerFor", { name: item.label })}
                      className="h-7 px-1.5 text-center text-xs tabular-nums"
                      onFocus={() => onSelect(item.id)}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isFinite(value)) onLayerChange(item.id, Math.round(value));
                      }}
                    />
                    <div className="flex items-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="size-7 px-0"
                        aria-label={t("moveForward", { name: item.label })}
                        title={t("moveForward", { name: item.label })}
                        onClick={() => onLayerChange(item.id, item.layer + 1)}
                      >
                        <MoveUp className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="size-7 px-0"
                        aria-label={t("moveBackward", { name: item.label })}
                        title={t("moveBackward", { name: item.label })}
                        onClick={() => onLayerChange(item.id, item.layer - 1)}
                      >
                        <MoveDown className="size-3.5" />
                      </Button>
                      {item.visible != null && onVisibilityChange ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="size-7 px-0"
                          aria-label={item.visible ? t("hide", { name: item.label }) : t("show", { name: item.label })}
                          title={item.visible ? t("hide", { name: item.label }) : t("show", { name: item.label })}
                          onClick={() => onVisibilityChange(item.id, !item.visible)}
                        >
                          {item.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="px-2 py-3 text-xs text-muted">{t("empty")}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function GenericElementInspector({
  node,
  onPatch,
  onTransformChange,
}: {
  node: DocNode;
  onPatch: (updater: (node: DocNode) => void) => void;
  onTransformChange: (patch: CoursewareElementTransformPatch) => void;
}) {
  const t = useTranslations("coursewareElementEditor");
  const geometry = [
    ["x", t("x")],
    ["y", t("y")],
    ["width", t("width")],
    ["height", t("height")],
  ] as const;

  return (
    <div data-courseware-generic-element-inspector className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-ink">{node.name || t("element")}</p>
        <p className="text-xs text-muted">{node.adapter}</p>
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
      {node.adapter === "shape" ? (
        <Label className="grid gap-1.5">
          <span>{t("color")}</span>
          <Input
            type="color"
            className="h-10 cursor-pointer p-1"
            value={node.style.color ?? "#2d2a26"}
            onChange={(event) => onPatch((item) => { item.style.color = event.target.value; })}
          />
        </Label>
      ) : null}
    </div>
  );
}

function CommonElementControls({
  node,
  onPatch,
}: {
  node: DocNode;
  onPatch: (updater: (node: DocNode) => void) => void;
}) {
  const t = useTranslations("coursewareElementEditor");
  return (
    <div data-courseware-common-element-controls className="space-y-2 border-t border-line pt-4">
      <p className="text-sm font-medium text-ink">{t("appearanceAndLayer")}</p>
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
              if (Number.isFinite(value)) onPatch((item) => { item.zIndex = Math.round(value); });
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
  );
}

export function CoursewarePageElementInspector({
  node,
  onPatch,
  onTransformChange,
}: {
  node: DocNode | null;
  onPatch: (updater: (node: DocNode) => void) => void;
  onTransformChange: (patch: CoursewareElementTransformPatch) => void;
}) {
  const t = useTranslations("coursewareElementEditor");
  if (!node) return <p className="text-sm text-muted">{t("selectElement")}</p>;

  return (
    <div data-courseware-page-element-inspector className="space-y-4">
      {isCoursewareTextElement(node) ? (
        <CoursewareTextElementInspector node={node} onPatch={onPatch} />
      ) : isCoursewareImageElement(node) ? (
        <CoursewareImageElementInspector
          node={node}
          onPatch={onPatch}
          onTransformChange={onTransformChange}
        />
      ) : (
        <GenericElementInspector node={node} onPatch={onPatch} onTransformChange={onTransformChange} />
      )}
      <CommonElementControls node={node} onPatch={onPatch} />
    </div>
  );
}
