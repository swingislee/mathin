"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Hand, Star, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GameBoard } from "@/features/games/boards";
import { games } from "@/features/games/registry";
import type { GameMirrorState } from "@/features/games/types";
import { ToolView } from "@/features/tools/components";
import { getTool, tools } from "@/features/tools/registry";
import {
  CanvasSurface,
  type CanvasSurfaceInputMode,
  type CanvasSurfaceInputPort,
} from "@/features/whiteboard/CanvasSurface";
import type { WhiteboardStore } from "@/features/whiteboard/store";
import type { BoardItem } from "@/features/whiteboard/types";
import { cn } from "@/lib/utils";
import type { SessionEventLog } from "../sync/eventlog";
import type { BoardCheckpointStatus, SessionBoardCheckpoint } from "../checkpoint/types";
import type { CoursewarePage } from "../types";
import { classroomInputProviderAttributes } from "../input/provider";
import { useClassBoard } from "./useClassBoard";
import { MAX_INLINE_STARS } from "./liveState";

// 课堂实时首屏的展示型子组件（原 LiveShell.tsx 尾部模块级函数，P4G-7 拆出）。
// 它们各自 props 驱动、不与 LiveShell 主体共享闭包，是天然接缝。

export function MainBoard({
  log,
  boardKey,
  editable,
  initialItems,
  strokeWidthBasis,
  cursorName,
  checkpointV2Writer,
  initialCheckpoint,
  inputMode,
  onInputPort,
  onCheckpointStatus,
  onCheckpointFlush,
  onStore,
  foreground = false,
}: {
  log: SessionEventLog | null;
  boardKey: string;
  editable: boolean;
  initialItems: BoardItem[] | undefined;
  strokeWidthBasis?: number;
  cursorName: string;
  checkpointV2Writer: boolean;
  initialCheckpoint?: SessionBoardCheckpoint;
  inputMode?: CanvasSurfaceInputMode;
  onInputPort?: (port: CanvasSurfaceInputPort | null) => void;
  onCheckpointStatus?: (boardKey: string, status: BoardCheckpointStatus) => void;
  onCheckpointFlush?: (boardKey: string, flush: (() => Promise<void>) | null) => void;
  onStore: (store: WhiteboardStore) => void;
  /** Audited tool overlays sit below the render-only board so routed ink stays visible. */
  foreground?: boolean;
}) {
  const { store, bus, flushCheckpoint } = useClassBoard(log, boardKey, editable, initialItems, {
    cursorName,
    checkpointV2Writer,
    initialCheckpoint,
    onCheckpointStatus,
  });
  useEffect(() => {
    onStore(store);
  }, [store, onStore]);
  useEffect(() => {
    if (!onCheckpointFlush) return;
    onCheckpointFlush(boardKey, flushCheckpoint);
    return () => onCheckpointFlush(boardKey, null);
  }, [boardKey, flushCheckpoint, onCheckpointFlush]);
  return (
    <div className={cn("pointer-events-none absolute inset-0", foreground ? "z-40" : "z-10")}>
      <CanvasSurface
        editable={editable}
        store={store}
        bus={bus}
        strokeWidthBasis={strokeWidthBasis}
        renderProfile="classroom"
        inputMode={inputMode}
        onInputPort={onInputPort}
      />
    </div>
  );
}

/** 游戏课件页：题面由 seed 确定性推导，教师操作经 game_state 镜像（08-§3.6）。 */
export function GamePage({
  page,
  isController,
  mirror,
  onMirror,
}: {
  page: Extract<CoursewarePage, { type: "game" }>;
  isController: boolean;
  mirror: GameMirrorState | null;
  onMirror: (pageId: string, mirror: GameMirrorState) => void;
}) {
  const t = useTranslations("classroom.live");
  // 主控端只在挂载时取一次镜像（断线重进恢复现场），此后本地即权威，防事件回环
  const [initialMirror] = useState(() => mirror);
  const game = games.find((item) => item.id === page.gameId);
  if (!game) return <p className="grid size-full place-items-center text-sm text-muted">{t("gameMissing")}</p>;
  return (
    <div
      className="size-full overflow-auto p-4"
      {...classroomInputProviderAttributes(game.id, game.classroomInput)}
    >
      <GameBoard
        key={`${page.id}:${page.seed}:${page.difficulty}`}
        id={game.id}
        seed={page.seed}
        difficulty={page.difficulty}
        finished={false}
        onComplete={() => undefined}
        mirror={isController ? initialMirror : mirror}
        onMirror={isController ? (state) => onMirror(page.id, state) : undefined}
        readOnly={!isController}
      />
    </div>
  );
}

/** 工具快捷窗（用户 2026-07-08 要求）：本仓组件直接渲染，零网络、天然离线；
 *  开/关由教师经 tool_ctl 镜像，窗内操作各端本地交互（学生可跟着摆弄）。 */
export function ToolOverlay({ toolId, onClose }: { toolId: string; onClose?: () => void }) {
  const t = useTranslations("classroom.live");
  const tTools = useTranslations("tools");
  const tool = getTool(toolId);
  if (!tool) return null;
  const Icon = tool.icon;
  const auditedInput = Boolean(tool.classroomInput);
  return (
    <div
      className="absolute inset-0 z-30 flex flex-col bg-paper"
      data-classroom-tool={tool.id}
      data-classroom-input={auditedInput ? "ink" : undefined}
      {...classroomInputProviderAttributes(`tool:${tool.id}`, tool.classroomInput)}
    >
      <div
        className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3"
        data-classroom-input={auditedInput ? "native" : undefined}
      >
        <Icon size={15} className="text-muted" />
        <span className="text-sm font-medium">{tTools(`items.${tool.id}.name`)}</span>
        {onClose && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t("closeTool")}
            data-classroom-input={auditedInput ? "click" : undefined}
            onClick={onClose}
            className="ml-auto rounded-full p-1.5 text-muted transition-colors hover:bg-moon/30 hover:text-ink"
          >
            <X size={16} />
          </Button>
        )}
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto"
        data-classroom-input={auditedInput ? "native" : undefined}
      >
        <ToolView id={tool.id} embedded />
      </div>
    </div>
  );
}

export function ToolPicker({ onPick }: { onPick: (toolId: string) => void }) {
  const tTools = useTranslations("tools");
  return (
    <div className="flex flex-col gap-0.5">
      {tools.map((tool) => {
        const Icon = tool.icon;
        return (
          <button
            key={tool.id}
            type="button"
            onClick={() => onPick(tool.id)}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-moon/30 hover:text-ink"
          >
            <Icon size={15} />
            {tTools(`items.${tool.id}.name`)}
          </button>
        );
      })}
    </div>
  );
}

export function StudentStarDisplay({ count, label, compact = false }: {
  count: number;
  label: string;
  compact?: boolean;
}) {
  const iconSize = compact ? 8 : 12;
  const remainder = Math.max(0, count - MAX_INLINE_STARS);

  return (
    <span
      key={count}
      role="img"
      aria-label={label}
      className={cn(
        "shrink-0 items-center motion-safe:[animation:star-pop_.35s_ease-out]",
        compact && count <= MAX_INLINE_STARS
          ? "grid min-h-3 max-w-full grid-cols-5 gap-px"
          : compact
            ? "flex min-h-3 max-w-full gap-px overflow-hidden"
            : "flex gap-0.5",
      )}
      data-star-display={count > MAX_INLINE_STARS ? "ten-seal-remainder" : "individual"}
    >
      {count === 0 ? (
        <Star aria-hidden size={iconSize} className="shrink-0 text-line" />
      ) : count <= MAX_INLINE_STARS ? (
        Array.from({ length: count }, (_, index) => (
          <Star key={index} aria-hidden size={iconSize} className="shrink-0 fill-crater/15 text-crater" />
        ))
      ) : (
        <>
          <span className="inline-flex shrink-0 items-center rounded-full border border-crater/40 bg-crater/10 px-1 font-mono text-[9px] font-semibold leading-4 text-crater" aria-hidden>
            10★
          </span>
          <span className="inline-flex shrink-0 items-center gap-px font-mono text-[10px] text-crater" aria-hidden>
            +{remainder}<Star size={8} className="fill-crater/15" />
          </span>
        </>
      )}
    </span>
  );
}

/** 学生卡（08-§3.5 加星面板）：点卡 +1 星、长按撤销最新一颗；触控目标 ≥44px。 */
export function StudentCard({
  name,
  count,
  hand,
  online,
  answerLabel,
  interactive,
  undoHint,
  starTotalLabel,
  awardStarLabel,
  undoStarLabel,
  seatLabel,
  compact = false,
  onStar,
  onUndo,
}: {
  name: string;
  count: number;
  hand: boolean;
  online: boolean;
  answerLabel: string | null;
  interactive: boolean;
  undoHint: string;
  starTotalLabel?: string;
  awardStarLabel?: string;
  undoStarLabel?: string;
  seatLabel?: string;
  compact?: boolean;
  onStar: () => void;
  onUndo: () => void;
}) {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);

  const clearPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const totalLabel = starTotalLabel ?? `${name}: ${count}`;
  const content = compact ? (
    <>
      <span className="flex min-w-0 max-w-full items-center gap-1">
        {seatLabel && <span className="shrink-0 font-mono text-[9px] text-muted">{seatLabel}</span>}
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-full", online ? "bg-leaf" : "bg-line")}
        />
        <span className="min-w-0 flex-1 truncate text-left text-[11px] leading-tight" title={name}>{name}</span>
        {hand && <Hand aria-hidden size={11} className="shrink-0 text-crater motion-safe:animate-bounce" />}
        {answerLabel && (
          <span className="shrink-0 rounded-full bg-line/50 px-1 font-mono text-[9px] leading-4">{answerLabel}</span>
        )}
      </span>
      <StudentStarDisplay count={count} label={totalLabel} compact />
    </>
  ) : (
    <>
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", online ? "bg-leaf" : "bg-line")}
      />
      <span className="min-w-0 flex-1 truncate text-left text-sm" title={name}>{name}</span>
      {hand && <Hand aria-hidden size={14} className="shrink-0 text-crater motion-safe:animate-bounce" />}
      {answerLabel && (
        <span className="shrink-0 rounded-full bg-line/50 px-1.5 py-0.5 font-mono text-[10px] leading-none">
          {answerLabel}
        </span>
      )}
      <StudentStarDisplay count={count} label={totalLabel} />
    </>
  );

  if (!interactive) {
    return (
      <li className={cn(
        "rounded-xl border border-line",
        compact ? "flex min-h-11 min-w-0 flex-col justify-center gap-0.5 overflow-hidden px-1.5 py-1" : "flex min-h-11 items-center gap-2 px-3",
      )}>
        {content}
      </li>
    );
  }

  return (
    <li className={cn(compact && "relative min-h-11 min-w-0")}>
      <button
        type="button"
        title={undoHint}
        aria-label={awardStarLabel ?? name}
        className={cn(
          "flex min-h-11 w-full touch-none select-none rounded-xl border border-line transition-colors hover:bg-moon/30",
          compact ? "min-w-0 flex-col items-stretch justify-center gap-0.5 overflow-hidden py-1 pl-1.5 pr-7" : "items-center gap-2 px-3",
        )}
        onPointerDown={() => {
          longFired.current = false;
          clearPress();
          pressTimer.current = setTimeout(() => {
            longFired.current = true;
            onUndo();
          }, 550);
        }}
        onPointerUp={clearPress}
        onPointerLeave={clearPress}
        onPointerCancel={clearPress}
        onContextMenu={(event) => event.preventDefault()}
        onClick={() => {
          if (longFired.current) {
            longFired.current = false;
            return;
          }
          onStar();
        }}
      >
        {content}
      </button>
      {compact && count > 0 && (
        <button
          type="button"
          aria-label={undoStarLabel ?? undoHint}
          title={undoStarLabel ?? undoHint}
          onClick={onUndo}
          className="absolute bottom-0.5 right-0.5 grid size-6 place-items-center rounded-full bg-paper/90 text-muted shadow-sm transition-colors hover:bg-moon/50 hover:text-ink focus-visible:ring-2 focus-visible:ring-crater"
        >
          <Undo2 aria-hidden size={11} />
        </button>
      )}
    </li>
  );
}
