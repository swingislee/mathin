import type { InteractionTrigger } from "@/features/courseware-doc/interactions";
import type { GameMirrorState } from "@/features/games/types";
import type { StrokeItem } from "@/features/whiteboard/types";
import type { CoursewarePage, SessionEvent } from "../types";
import type { VideoCtl } from "./VideoStage";

// 课堂实时状态原语（原 LiveShell.tsx 内联，P4G-7 拆巨石时抽出的纯逻辑层）：
// 事件流经 reduceEvent 折叠成 LiveState，可回放、可离线补同步，无 hook 无副作用。

export type Role = "control" | "display" | "viewer";
export type Phase = "prep" | "live";

export interface LiveState {
  pages: CoursewarePage[];
  currentPage: number;
  stars: Record<string, number>;
  started: boolean;
  ended: boolean;
  hands: Record<string, boolean>;
  boards: Record<string, StrokeItem[]>;
  games: Record<string, GameMirrorState>;
  video: Record<string, VideoCtl>;
  /** doc 页点击步进流（P6-5）：pageId → 有序触发列表，回放可收敛舞台状态。 */
  docSteps: Record<string, InteractionTrigger[]>;
  openTool: string | null;
  quiz: { id: string; options: number } | null;
  answers: Record<string, Record<string, number>>;
}

export function reduceEvent(state: LiveState, ev: SessionEvent): LiveState {
  switch (ev.type) {
    case "page": {
      const page = Number(ev.payload.page);
      return Number.isFinite(page) ? { ...state, currentPage: page } : state;
    }
    case "page_insert": {
      const page = ev.payload.page as CoursewarePage | undefined;
      if (!page || typeof page !== "object" || !page.id || !page.type) return state;
      if (state.pages.some((item) => item.id === page.id)) return state;
      const raw = Number(ev.payload.index);
      const index = Number.isFinite(raw) ? Math.max(0, Math.min(state.pages.length, raw)) : state.pages.length;
      const pages = [...state.pages];
      pages.splice(index, 0, page);
      return { ...state, pages };
    }
    case "star": {
      const studentId = String(ev.payload.studentId ?? "");
      if (!studentId) return state;
      return { ...state, stars: { ...state.stars, [studentId]: (state.stars[studentId] ?? 0) + 1 } };
    }
    case "star_undo": {
      const studentId = String(ev.payload.studentId ?? "");
      if (!studentId) return state;
      return { ...state, stars: { ...state.stars, [studentId]: Math.max(0, (state.stars[studentId] ?? 0) - 1) } };
    }
    case "session_ctl": {
      const action = ev.payload.action;
      // start 同时清 ended：重新开课复用同一事件，按时间序回放后收敛到最后一次状态
      if (action === "start") return { ...state, started: true, ended: false };
      if (action === "end") return { ...state, ended: true };
      if (action === "quiz_open") {
        const quizId = String(ev.payload.quizId ?? "");
        const options = Number(ev.payload.options);
        if (!quizId || !Number.isFinite(options)) return state;
        return { ...state, quiz: { id: quizId, options: Math.max(2, Math.min(4, options)) } };
      }
      if (action === "quiz_close") return { ...state, quiz: null };
      return state;
    }
    case "board_snapshot": {
      const pageKey = String(ev.payload.pageKey ?? "");
      const items = ev.payload.items;
      if (!pageKey || !Array.isArray(items)) return state;
      return { ...state, boards: { ...state.boards, [pageKey]: items as StrokeItem[] } };
    }
    case "game_state": {
      const pageId = String(ev.payload.pageId ?? "");
      const mirror = ev.payload.state as GameMirrorState | undefined;
      if (!pageId || !mirror || !Array.isArray(mirror.values)) return state;
      return { ...state, games: { ...state.games, [pageId]: mirror } };
    }
    case "doc_step": {
      const pageId = String(ev.payload.pageId ?? "");
      if (!pageId) return state;
      const scope = ev.payload.scope === "node" ? "node" as const : "page" as const;
      const id = scope === "node" ? String(ev.payload.id ?? "") : null;
      if (scope === "node" && !id) return state;
      const steps = state.docSteps[pageId] ?? [];
      return { ...state, docSteps: { ...state.docSteps, [pageId]: [...steps, { scope, id }] } };
    }
    case "video_ctl": {
      const pageId = String(ev.payload.pageId ?? "");
      const action = ev.payload.action;
      const time = Number(ev.payload.time);
      if (!pageId || (action !== "play" && action !== "pause" && action !== "seek") || !Number.isFinite(time)) return state;
      return { ...state, video: { ...state.video, [pageId]: { action, time, evId: ev.id } } };
    }
    case "tool_ctl": {
      if (ev.payload.action === "open") {
        const toolId = String(ev.payload.toolId ?? "");
        return toolId ? { ...state, openTool: toolId } : state;
      }
      return { ...state, openTool: null };
    }
    case "hand":
      return { ...state, hands: { ...state.hands, [ev.userId]: Boolean(ev.payload.up) } };
    case "answer": {
      const quizId = String(ev.payload.quizId ?? "");
      const choice = Number(ev.payload.choice);
      if (!quizId || !Number.isFinite(choice)) return state;
      return { ...state, answers: { ...state.answers, [quizId]: { ...state.answers[quizId], [ev.userId]: choice } } };
    }
    default:
      return state;
  }
}

export const OPTION_LABELS = ["A", "B", "C", "D"];
/** 星数不超过此值时直接摆星星图标（更直观）；超出退回单星+数字（08-§3.5）。 */
export const MAX_INLINE_STARS = 5;
