"use client";

import { Grip, MoveDiagonal2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { ResolvedBindingUrls } from "./resolve";
import {
  updateCoursewareCompositionPlacement,
} from "./composition-page-layout";
import type {
  CoursewareCompositionBlock,
  CoursewareCompositionPage,
  CoursewareCompositionPlacement,
} from "./composition-page-schema";
import CoursewareCompositionStage from "./CoursewareCompositionStage";
import { cn } from "@/lib/utils";

interface GridGesture {
  blockId: string;
  mode: "move" | "resize";
  pointerId: number;
  startX: number;
  startY: number;
  origin: CoursewareCompositionPlacement;
  base: CoursewareCompositionPage;
}

export function CoursewareCompositionGridEditor({
  doc,
  bindingUrls,
  selectedBlockId,
  onSelectBlock,
  onChange,
}: {
  doc: CoursewareCompositionPage;
  bindingUrls: ResolvedBindingUrls;
  selectedBlockId: string | null;
  onSelectBlock: (blockId: string) => void;
  onChange: (doc: CoursewareCompositionPage) => void;
}) {
  const t = useTranslations("teacherMicrocourses");
  const canvasRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<CoursewareCompositionPage | null>(null);
  const [gesture, setGesture] = useState<GridGesture | null>(null);
  const [draft, setDraft] = useState<CoursewareCompositionPage | null>(null);
  const displayed = gesture && draft ? draft : doc;
  const labelFor = (block: CoursewareCompositionBlock) => {
    if (block.type === "game") return t("componentGame");
    if (block.type === "h5") return t("componentH5");
    const node = displayed.overlay.nodes.find((item) => item.id === block.nodeId);
    if (node?.adapter === "image") return t("componentImage");
    if (node?.adapter === "rich_text") return t("componentFormula");
    if (node?.adapter === "shape") return t("componentShape");
    return t("componentText");
  };

  const begin = (
    event: PointerEvent<HTMLElement>,
    blockId: string,
    mode: GridGesture["mode"],
  ) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const block = displayed.layout.blocks.find((item) => item.id === blockId);
    if (!block) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectBlock(blockId);
    const base = structuredClone(displayed);
    draftRef.current = base;
    setDraft(base);
    setGesture({
      blockId,
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: block.placement,
      base,
    });
  };

  const move = (event: PointerEvent<HTMLElement>) => {
    if (!gesture || gesture.pointerId !== event.pointerId || !canvasRef.current) return;
    event.preventDefault();
    const bounds = canvasRef.current.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const deltaColumn = Math.round((event.clientX - gesture.startX) / (bounds.width / 12));
    const deltaRow = Math.round((event.clientY - gesture.startY) / (bounds.height / 9));
    const origin = gesture.origin;
    const placement: CoursewareCompositionPlacement = gesture.mode === "move"
      ? {
          ...origin,
          column: Math.max(0, Math.min(12 - origin.columnSpan, origin.column + deltaColumn)),
          row: Math.max(0, Math.min(9 - origin.rowSpan, origin.row + deltaRow)),
        }
      : {
          ...origin,
          columnSpan: Math.max(1, Math.min(12 - origin.column, origin.columnSpan + deltaColumn)),
          rowSpan: Math.max(1, Math.min(9 - origin.row, origin.rowSpan + deltaRow)),
        };
    const next = updateCoursewareCompositionPlacement(gesture.base, gesture.blockId, placement);
    draftRef.current = next;
    setDraft(next);
  };

  const finish = (event: PointerEvent<HTMLElement>) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const next = draftRef.current;
    if (next && JSON.stringify(next.layout.blocks) !== JSON.stringify(doc.layout.blocks)) onChange(next);
    setGesture(null);
    setDraft(null);
    draftRef.current = null;
  };

  const cancel = (event: PointerEvent<HTMLElement>) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    setGesture(null);
    setDraft(null);
    draftRef.current = null;
  };

  const moveWithKeyboard = (event: KeyboardEvent<HTMLDivElement>, blockId: string) => {
    const delta = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (!delta) return;
    const block = doc.layout.blocks.find((item) => item.id === blockId);
    if (!block) return;
    event.preventDefault();
    const next = updateCoursewareCompositionPlacement(doc, blockId, {
      ...block.placement,
      column: Math.max(0, Math.min(12 - block.placement.columnSpan, block.placement.column + delta[0])),
      row: Math.max(0, Math.min(9 - block.placement.rowSpan, block.placement.row + delta[1])),
    });
    if (next !== doc) onChange(next);
  };

  return (
    <div
      ref={canvasRef}
      className="relative aspect-[4/3] w-full touch-none overflow-hidden bg-white"
      data-courseware-composition-grid-editor
      data-grid-visible={gesture ? "true" : "false"}
    >
      <CoursewareCompositionStage doc={displayed} bindingUrls={bindingUrls} interactive={false} />
      <div
        className="absolute inset-0 grid"
        style={{
          gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
          gridTemplateRows: "repeat(9, minmax(0, 1fr))",
          backgroundImage: gesture
            ? "linear-gradient(to right, rgb(111 139 72 / 0.22) 1px, transparent 1px), linear-gradient(to bottom, rgb(111 139 72 / 0.22) 1px, transparent 1px)"
            : "none",
          backgroundSize: `${100 / 12}% ${100 / 9}%`,
        }}
      >
        {displayed.layout.blocks.map((block) => {
          const selected = block.id === selectedBlockId;
          const label = labelFor(block);
          return (
            <div
              key={block.id}
              role="button"
              tabIndex={0}
              aria-label={t("gridMoveBlock", { type: label })}
              aria-pressed={selected}
              className={cn(
                "group relative z-10 m-1 cursor-move rounded-xl border-2 bg-transparent outline-none transition-[border-color] focus-visible:ring-2 focus-visible:ring-rose",
                selected ? "border-rose" : "border-transparent hover:border-crater/70",
                gesture?.blockId === block.id && "border-rose-deep",
              )}
              style={{
                gridColumn: `${block.placement.column + 1} / span ${block.placement.columnSpan}`,
                gridRow: `${block.placement.row + 1} / span ${block.placement.rowSpan}`,
              }}
              onClick={() => onSelectBlock(block.id)}
              onKeyDown={(event) => moveWithKeyboard(event, block.id)}
              onPointerCancel={cancel}
              onPointerDown={(event) => begin(event, block.id, "move")}
              onPointerMove={move}
              onPointerUp={finish}
            >
              <span className={cn(
                "pointer-events-none absolute left-1 top-1 inline-flex items-center gap-1 rounded-full bg-ink/85 px-2 py-1 text-[10px] text-white opacity-0 transition-opacity",
                (selected || gesture?.blockId === block.id) && "opacity-100",
              )}>
                <Grip className="size-3" />{label}
              </span>
              <button
                type="button"
                data-classroom-input="drag"
                aria-label={t("gridResizeBlock", { type: label })}
                className={cn(
                  "absolute bottom-0 right-0 grid size-7 cursor-nwse-resize place-items-center rounded-tl-xl bg-rose text-white opacity-0 transition-opacity",
                  selected && "opacity-100",
                )}
                onPointerCancel={cancel}
                onPointerDown={(event) => begin(event, block.id, "resize")}
                onPointerMove={move}
                onPointerUp={finish}
              >
                <MoveDiagonal2 className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
