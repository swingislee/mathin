"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Hand, Star, X } from "lucide-react";
import { GameBoard } from "@/features/games/boards";
import { games } from "@/features/games/registry";
import type { GameMirrorState } from "@/features/games/types";
import { ToolView } from "@/features/tools/components";
import { getTool, tools } from "@/features/tools/registry";
import { CanvasSurface } from "@/features/whiteboard/CanvasSurface";
import type { WhiteboardStore } from "@/features/whiteboard/store";
import type { StrokeItem } from "@/features/whiteboard/types";
import { cn } from "@/lib/utils";
import type { SessionEventLog } from "../sync/eventlog";
import type { CoursewarePage } from "../types";
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
  onStore,
}: {
  log: SessionEventLog | null;
  boardKey: string;
  editable: boolean;
  initialItems: StrokeItem[] | undefined;
  strokeWidthBasis?: number;
  onStore: (store: WhiteboardStore) => void;
}) {
  const { store, bus } = useClassBoard(log, boardKey, editable, initialItems);
  useEffect(() => {
    onStore(store);
  }, [store, onStore]);
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <CanvasSurface editable={editable} store={store} bus={bus} strokeWidthBasis={strokeWidthBasis} />
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
    <div className="size-full overflow-auto p-4">
      <GameBoard
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
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-paper">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <Icon size={15} className="text-muted" />
        <span className="text-sm font-medium">{tTools(`items.${tool.id}.name`)}</span>
        {onClose && (
          <button
            type="button"
            aria-label={t("closeTool")}
            onClick={onClose}
            className="ml-auto rounded-full p-1.5 text-muted transition-colors hover:bg-moon/30 hover:text-ink"
          >
            <X size={16} />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
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

/** 学生卡（08-§3.5 加星面板）：点卡 +1 星、长按撤销最新一颗；触控目标 ≥44px。 */
export function StudentCard({
  name,
  count,
  hand,
  online,
  answerLabel,
  interactive,
  undoHint,
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

  const content = (
    <>
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", online ? "bg-leaf" : "bg-line")}
      />
      <span className="min-w-0 flex-1 truncate text-left text-sm">{name}</span>
      {hand && <Hand size={14} className="shrink-0 text-crater motion-safe:animate-bounce" />}
      {answerLabel && (
        <span className="shrink-0 rounded-full bg-line/50 px-1.5 py-0.5 font-mono text-[10px] leading-none">
          {answerLabel}
        </span>
      )}
      {/* 空间允许时直接摆出对应数量的星星（更直观）；超出才退回数字标识（用户 2026-07-08 要求） */}
      {count === 0 ? (
        <Star size={12} className="shrink-0 text-line" />
      ) : count <= MAX_INLINE_STARS ? (
        <span key={count} className="flex shrink-0 items-center gap-0.5 motion-safe:[animation:star-pop_.35s_ease-out]">
          {Array.from({ length: count }, (_, i) => (
            <Star key={i} size={12} className="shrink-0 text-crater" />
          ))}
        </span>
      ) : (
        <span key={count} className="flex shrink-0 items-center gap-1 motion-safe:[animation:star-pop_.35s_ease-out]">
          <Star size={13} className="shrink-0 text-crater" />
          <span className="font-mono text-xs">{count}</span>
        </span>
      )}
    </>
  );

  if (!interactive) {
    return <li className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3">{content}</li>;
  }

  return (
    <li>
      <button
        type="button"
        title={undoHint}
        className="flex min-h-11 w-full touch-none select-none items-center gap-2 rounded-xl border border-line px-3 transition-colors hover:bg-moon/30"
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
    </li>
  );
}
