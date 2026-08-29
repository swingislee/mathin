"use client";

import dynamic from "next/dynamic";
import { ImagePlus, LayoutGrid, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { GamePageDoc } from "@/features/courseware-doc/game-page-schema";
import { cn } from "@/lib/utils";
import {
  addGamePageGridBlock,
  applyGamePageGridTemplate,
  GAME_PAGE_GRID_MAX_BLOCKS,
  removeGamePageGridBlock,
  resolveGamePageGridLayout,
  type GamePageGridBlock,
  type GamePageGridTemplate,
} from "./game-page-layout";

const SudokuGamePageEditor = dynamic(
  () => import("../sudoku/SudokuGamePageEditor").then((module) => module.SudokuGamePageEditor),
  { loading: () => <Skeleton className="h-80 w-full rounded-xl" /> },
);

export function GamePageEditor({
  doc,
  onChange,
  selectedBlockId = "game",
  onSelectBlock = () => undefined,
  onUploadImage,
}: {
  doc: GamePageDoc;
  onChange: (doc: GamePageDoc) => void;
  selectedBlockId?: string;
  onSelectBlock?: (blockId: string) => void;
  onUploadImage?: (file: File) => Promise<{ bindingKey: string }>;
}) {
  const t = useTranslations("teacherMicrocourses");
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [uploading, startUpload] = useTransition();
  const layout = resolveGamePageGridLayout(doc.layout);
  const selectedBlock = layout.blocks.find((block) => block.id === selectedBlockId) ?? layout.blocks[0];
  const companionCount = layout.blocks.length - 1;
  const nextId = (type: "text" | "image") => {
    let suffix = 1;
    while (layout.blocks.some((block) => block.id === `${type}-${suffix}`)) suffix += 1;
    return `${type}-${suffix}`;
  };
  const changeLayout = (nextLayout: typeof layout, nextSelectedId?: string) => {
    onChange({ ...doc, layout: nextLayout });
    if (nextSelectedId) onSelectBlock(nextSelectedId);
  };
  const applyTemplate = (template: GamePageGridTemplate) => {
    const next = applyGamePageGridTemplate(layout, template);
    changeLayout(next, next.blocks.find((block) => block.type !== "game")?.id ?? "game");
  };
  const addText = () => {
    const id = nextId("text");
    const block: Extract<GamePageGridBlock, { type: "text" }> = {
      id,
      type: "text",
      text: t("gridDefaultText"),
      align: "left",
      placement: { column: 0, row: 0, columnSpan: 4, rowSpan: 9 },
    };
    changeLayout(addGamePageGridBlock(layout, block), id);
  };
  const uploadImage = () => {
    if (!file || !onUploadImage) return;
    startUpload(async () => {
      setMessage("");
      try {
        const uploaded = await onUploadImage(file);
        const id = nextId("image");
        const block: Extract<GamePageGridBlock, { type: "image" }> = {
          id,
          type: "image",
          bindingKey: uploaded.bindingKey,
          alt: file.name.slice(0, 200),
          fit: "contain",
          placement: { column: 0, row: 0, columnSpan: 4, rowSpan: 9 },
        };
        changeLayout(addGamePageGridBlock(layout, block), id);
        setFile(null);
      } catch {
        setMessage(t("gridImageUploadFailed"));
      }
    });
  };
  const patchSelected = (patch: Partial<GamePageGridBlock>) => {
    const next = structuredClone(layout);
    const index = next.blocks.findIndex((block) => block.id === selectedBlock.id);
    if (index < 0) return;
    next.blocks[index] = { ...next.blocks[index], ...patch } as GamePageGridBlock;
    changeLayout(next);
  };

  const layoutControls = (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <LayoutGrid className="size-4 text-leaf-deep" />
          <h3 className="text-sm font-medium">{t("gridLayoutTitle")}</h3>
        </div>
        <p className="mt-1 text-xs text-muted">{t("gridLayoutHint")}</p>
        <div className="mt-2 grid grid-cols-2 gap-1">
          {(["text-left", "text-right", "text-top", "text-bottom"] as const).map((template) => (
            <Button key={template} type="button" size="sm" variant="secondary" className="h-auto min-h-9 text-xs" onClick={() => applyTemplate(template)}>
              {t(`gridTemplate_${template}`)}
            </Button>
          ))}
          <Button type="button" size="sm" variant="secondary" className="col-span-2 h-auto min-h-9 text-xs" disabled={companionCount > 0} onClick={() => applyTemplate("full")}>
            {t("gridTemplate_full")}
          </Button>
        </div>
      </div>

      <div>
        <p className="text-xs text-muted">{t("gridComponents")}</p>
        <div className="mt-2 grid grid-cols-2 gap-1">
          <Button type="button" size="sm" variant="secondary" disabled={layout.blocks.length >= GAME_PAGE_GRID_MAX_BLOCKS} onClick={addText}>
            <Plus className="size-3.5" />{t("gridAddText")}
          </Button>
          <Label className={cn("inline-flex cursor-pointer", layout.blocks.length >= GAME_PAGE_GRID_MAX_BLOCKS && "pointer-events-none opacity-50")}>
            <Input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" disabled={!onUploadImage || layout.blocks.length >= GAME_PAGE_GRID_MAX_BLOCKS} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            <span className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-full border border-line bg-card px-3 text-xs hover:bg-moon/30">
              <ImagePlus className="size-3.5" />{t("gridChooseImage")}
            </span>
          </Label>
        </div>
        {file ? (
          <Button type="button" size="sm" className="mt-2 w-full" disabled={uploading || !onUploadImage} onClick={uploadImage}>
            {uploading ? t("gridUploadingImage") : t("gridInsertImage", { name: file.name })}
          </Button>
        ) : null}
        {message ? <p role="alert" className="mt-2 text-xs text-rose">{message}</p> : null}
      </div>

      <div className="space-y-1">
        <p className="text-xs text-muted">{t("gridComponentList")}</p>
        {layout.blocks.map((block) => (
          <Button key={block.id} type="button" size="sm" variant={selectedBlock.id === block.id ? "primary" : "ghost"} className="w-full justify-start" onClick={() => onSelectBlock(block.id)}>
            {t(`gridBlock_${block.type}`)}
          </Button>
        ))}
      </div>

      {selectedBlock.type === "text" ? (
        <div className="space-y-2 border-t border-line pt-3">
          <Label className="grid gap-1 text-sm font-normal">
            <span>{t("gridTextContent")}</span>
            <Textarea value={selectedBlock.text} rows={5} maxLength={4_000} onChange={(event) => patchSelected({ text: event.target.value })} />
          </Label>
          <div className="grid grid-cols-2 gap-1">
            {(["left", "center"] as const).map((align) => (
              <Button key={align} type="button" size="sm" variant={selectedBlock.align === align ? "primary" : "secondary"} onClick={() => patchSelected({ align })}>
                {t(`gridTextAlign_${align}`)}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {selectedBlock.type === "image" ? (
        <div className="space-y-2 border-t border-line pt-3">
          <Label className="grid gap-1 text-sm font-normal">
            <span>{t("gridImageAlt")}</span>
            <Input value={selectedBlock.alt} maxLength={200} onChange={(event) => patchSelected({ alt: event.target.value })} />
          </Label>
          <div className="grid grid-cols-2 gap-1">
            {(["contain", "cover"] as const).map((fit) => (
              <Button key={fit} type="button" size="sm" variant={selectedBlock.fit === fit ? "primary" : "secondary"} onClick={() => patchSelected({ fit })}>
                {t(`gridImageFit_${fit}`)}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {selectedBlock.type !== "game" ? (
        <Button type="button" size="sm" variant="ghost" className="w-full text-rose" onClick={() => changeLayout(removeGamePageGridBlock(layout, selectedBlock.id), "game")}>
          <Trash2 className="size-4" />{t("gridDeleteComponent")}
        </Button>
      ) : null}
    </div>
  );

  switch (`${doc.gameId}:${doc.contentVersion}`) {
    case "sudoku:sudoku-authored-v1":
    case "sudoku:sudoku-authored-v2":
      return <div className="space-y-5">{layoutControls}<Separator /><SudokuGamePageEditor doc={doc} onChange={onChange} /></div>;
    default:
      return <p className="text-sm text-rose">{t("unsupportedGamePage")}</p>;
  }
}
