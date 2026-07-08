"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Hand,
  ListTodo,
  LoaderCircle,
  MonitorPlay,
  PenLine,
  SquareCheckBig,
  Star,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { games } from "@/features/games/registry";
import type { GameMirrorState } from "@/features/games/types";
import { getTool, tools } from "@/features/tools/registry";
import { CanvasSurface } from "@/features/whiteboard/CanvasSurface";
import { Toolbar } from "@/features/whiteboard/Toolbar";
import type { WhiteboardStore } from "@/features/whiteboard/store";
import type { StrokeItem } from "@/features/whiteboard/types";
import { Link } from "@/i18n/navigation";
import { createClient, createIsolatedRealtimeClient } from "@/lib/supabase/client";
import { newId } from "@/lib/uuid";
import { cn } from "@/lib/utils";
import { endClassSession, reopenClassSession, saveCourseware, startClassSession } from "../actions";
import { downloadCoursewareAsset } from "../courseware/upload";
import { SessionEventLog } from "../sync/eventlog";
import { flushOutbox, pendingCount } from "../sync/flush";
import { STORE_ASSETS, idbGet, idbPut } from "../sync/idb";
import {
  createLocalTransport,
  createP2PSignalBus,
  createP2PTransport,
  createRealtimeTransport,
  type P2PHealth,
  type PresencePeer,
} from "../sync/transports";
import type { ClassroomMember, ClassSessionRecord, CoursewarePage, SessionEvent } from "../types";
import { useClassBoard } from "./useClassBoard";
import { VideoStage, type VideoCtl } from "./VideoStage";

// 上课页（08-§3.4/§5）：候课（预载/自检）→ 上课 全程页内状态切换，零路由跳转。
// P4-5 正式舞台：4:3 课件/主板书 + 副板书 + 学生名录；主板书按页 uuid 隔离、
// 副板书全课一块；游戏页 game_state 镜像、视频 video_ctl 同步、工具快捷窗、
// 上课中临时插白板页、加星长按撤销、举手/发题/作答、presence 在线名单。

type Role = "control" | "display" | "viewer";
type Phase = "prep" | "live";

interface Props {
  session: ClassSessionRecord;
  classId: string;
  members: ClassroomMember[];
  myRole: "teacher" | "student";
  userId: string;
  initialEvents: SessionEvent[];
  role: Role;
  /** 试讲：教师本地预演/复盘——事件不落库不同步，随时可进（包括已下课的课次）。 */
  rehearsal?: boolean;
}

interface LiveState {
  pages: CoursewarePage[];
  currentPage: number;
  stars: Record<string, number>;
  started: boolean;
  ended: boolean;
  hands: Record<string, boolean>;
  boards: Record<string, StrokeItem[]>;
  games: Record<string, GameMirrorState>;
  video: Record<string, VideoCtl>;
  openTool: string | null;
  quiz: { id: string; options: number } | null;
  answers: Record<string, Record<string, number>>;
}

function reduceEvent(state: LiveState, ev: SessionEvent): LiveState {
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

const OPTION_LABELS = ["A", "B", "C", "D"];
/** 星数不超过此值时直接摆星星图标（更直观）；超出退回单星+数字（08-§3.5）。 */
const MAX_INLINE_STARS = 5;

export function LiveShell({ session, classId, members, myRole, userId, initialEvents, role, rehearsal = false }: Props) {
  const t = useTranslations("classroom.live");
  const tPrep = useTranslations("classroom.prep");
  const students = useMemo(() => members.filter((member) => member.role === "student"), [members]);
  const selfName = useMemo(
    () => members.find((member) => member.userId === userId)?.displayName ?? "",
    [members, userId],
  );

  const initialState = useMemo<LiveState>(() => {
    let state: LiveState = {
      pages: session.courseware,
      currentPage: session.currentPage,
      stars: {},
      started: Boolean(session.startedAt),
      ended: Boolean(session.endedAt),
      hands: {},
      boards: {},
      games: {},
      video: {},
      openTool: null,
      quiz: null,
      answers: {},
    };
    for (const ev of initialEvents) state = reduceEvent(state, ev);
    return state;
  }, [session, initialEvents]);

  const mediaPages = useMemo(
    () => session.courseware.filter((page): page is Extract<CoursewarePage, { path: string }> =>
      page.type === "image" || page.type === "video",
    ),
    [session.courseware],
  );

  const [state, setState] = useState(initialState);
  const [phase, setPhase] = useState<Phase>(rehearsal || role === "viewer" || initialState.started ? "live" : "prep");
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [preload, setPreload] = useState(() => ({ done: 0, total: mediaPages.length, failed: 0 }));
  const [wakeLockState, setWakeLockState] = useState<"pending" | "ok" | "unavailable">("pending");
  const [t2Connected, setT2Connected] = useState(false);
  const [p2pHealth, setP2PHealth] = useState<P2PHealth>({ state: "signaling", peers: 0, latencyMs: null });
  const [pending, setPending] = useState(0);
  const [log, setLog] = useState<SessionEventLog | null>(null);
  const [onlinePeers, setOnlinePeers] = useState<PresencePeer[]>([]);
  const [mainStore, setMainStore] = useState<WhiteboardStore | null>(null);
  const [activeArea, setActiveArea] = useState<"main" | "side">("main");
  const [endOpen, setEndOpen] = useState(false);
  const [stageWidth, setStageWidth] = useState(0);
  // 副板书/名录默认展开（用户 2026-07-08 要求可折叠腾空间给对方或主板书）
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [rosterCollapsed, setRosterCollapsed] = useState(false);
  const logRef = useRef<SessionEventLog | null>(null);
  const preloadTick = useRef(0);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const isController = role === "control" && myRole === "teacher";
  // 试讲不受「已下课」限制：复盘已结束的课次也可随手写画（本地临时，不留痕）
  const editable = isController && (rehearsal || !state.ended);
  // 展示窗/学生端跟随 start 事件进入上课（派生而非 effect，避免级联渲染）
  const effectivePhase: Phase = phase === "live" || (state.started && !isController) ? "live" : "prep";

  // --- 事件层与传输层 ---------------------------------------------------
  useEffect(() => {
    let disposed = false;
    let flushTimer: ReturnType<typeof setInterval> | null = null;

    const setup = async () => {
      const eventLog = await SessionEventLog.create(session.id, userId, { ephemeral: rehearsal });
      if (disposed) {
        eventLog.close();
        return;
      }
      // 试讲：事件只在本窗口内存生效，不挂 T0/T1/T2、不回传——预演/复盘零副作用
      if (rehearsal) {
        logRef.current = eventLog;
        eventLog.subscribe((ev) => setState((prev) => reduceEvent(prev, ev)));
        setLog(eventLog);
        return;
      }
      eventLog.markSeen(initialEvents.map((ev) => ev.id));
      const p2pSignals = createP2PSignalBus();
      logRef.current = eventLog;
      eventLog.subscribe((ev) => setState((prev) => reduceEvent(prev, ev)));
      eventLog.attach(createLocalTransport(session.id, eventLog.ingest, eventLog.ingestFx));
      eventLog.attach(createP2PTransport(
        p2pSignals,
        eventLog.deviceId,
        role === "control" && myRole === "teacher",
        eventLog.ingest,
        eventLog.ingestFx,
        (health) => { if (!disposed) setP2PHealth(health); },
      ));
      eventLog.attach(createRealtimeTransport(
        createIsolatedRealtimeClient(),
        session.id,
        eventLog.ingest,
        setT2Connected,
        eventLog.ingestFx,
        {
          key: eventLog.deviceId,
          meta: { userId, name: selfName, role: myRole },
          onPeers: (peers) => {
            if (!disposed) setOnlinePeers(peers);
          },
        },
        p2pSignals,
      ));
      setLog(eventLog);

      const tryFlush = () => {
        flushOutbox(session.id)
          .then(() => pendingCount(session.id))
          .then((count) => {
            if (!disposed) setPending(count);
          })
          .catch(() => undefined);
      };
      tryFlush();
      flushTimer = setInterval(tryFlush, 15000);
      window.addEventListener("online", tryFlush);
      const onHide = () => tryFlush();
      document.addEventListener("visibilitychange", onHide);
      window.addEventListener("pagehide", onHide);
    };
    void setup();

    return () => {
      disposed = true;
      if (flushTimer) clearInterval(flushTimer);
      logRef.current?.close();
      logRef.current = null;
      setLog(null);
    };
    // initialEvents/selfName/myRole/rehearsal 仅首帧使用（rehearsal 来自 URL，整页生命周期不变），不追踪
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, userId]);

  // --- 课件预载（IndexedDB 命中则直接建 objectURL）-----------------------
  useEffect(() => {
    const tick = ++preloadTick.current;
    const urls: string[] = [];

    const run = async () => {
      for (const page of mediaPages) {
        if (preloadTick.current !== tick) return;
        try {
          let blob = await idbGet<Blob>(STORE_ASSETS, page.path);
          if (!blob) {
            blob = await downloadCoursewareAsset(page.path);
            await idbPut(STORE_ASSETS, page.path, blob);
          }
          // await 之后必须复查 tick：StrictMode 双跑 effect 时旧一轮会在此重复计数
          if (preloadTick.current !== tick) return;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          setAssetUrls((prev) => ({ ...prev, [page.path]: url }));
          setPreload((prev) => ({ ...prev, done: prev.done + 1 }));
        } catch {
          if (preloadTick.current !== tick) return;
          setPreload((prev) => ({ ...prev, failed: prev.failed + 1 }));
        }
      }
    };
    void run();

    return () => {
      preloadTick.current += 1;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [mediaPages]);

  // --- Wake Lock（非安全上下文没有该 API，降级为人工提示）-----------------
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const request = async () => {
      const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
      if (!wakeLock) {
        setWakeLockState("unavailable");
        return;
      }
      try {
        lock = await wakeLock.request("screen");
        setWakeLockState("ok");
      } catch {
        setWakeLockState("unavailable");
      }
    };
    void request();
    const onVisible = () => {
      if (document.visibilityState === "visible" && wakeLockState !== "unavailable") void request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
    };
    // 仅挂载时申请一次；重申请由 visibilitychange 驱动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- 舞台宽度（线宽换算的统一参照，08-§3.2 追加）------------------------
  // 主板书自身宽度即为参照；副板书借同一个值，让同屏两块板上的同一支笔粗细一致。
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setStageWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [effectivePhase]);

  // --- 副板书（全课一块，pageKey="side"）---------------------------------
  const sideBoard = useClassBoard(log, "side", editable, initialState.boards["side"]);

  // --- 操作 ----------------------------------------------------------------
  const append = useCallback((type: Parameters<SessionEventLog["append"]>[0], payload: Record<string, unknown>) => {
    void logRef.current?.append(type, payload).then(() => {
      if (!rehearsal) void pendingCount(session.id).then(setPending).catch(() => undefined);
    });
  }, [session.id, rehearsal]);

  const gotoPage = useCallback((page: number, total: number) => {
    const clamped = Math.max(0, Math.min(total - 1, page));
    append("page", { page: clamped });
    // 在线时顺手更新 DB 基线（晚加入者用）；离线静默失败。试讲不改共享基线。
    if (rehearsal) return;
    void createClient().from("class_sessions").update({ current_page: clamped }).eq("id", session.id)
      .then(() => undefined, () => undefined);
  }, [append, session.id, rehearsal]);

  const startClass = useCallback(() => {
    append("session_ctl", { action: "start" });
    void startClassSession(session.id).catch(() => undefined);
    setPhase("live");
  }, [append, session.id]);

  const insertBoardPage = useCallback(() => {
    const index = Math.min(state.currentPage + 1, state.pages.length);
    const page: CoursewarePage = { id: newId(), type: "board", title: t("boardPageTitle") };
    append("page_insert", { index, page });
    append("page", { page: index });
    // 在线时把新排布与页码写回 DB（晚加入者基线）；离线静默失败，事件流已足够还原
    const nextPages = [...state.pages];
    nextPages.splice(index, 0, page);
    void saveCourseware(session.id, nextPages).catch(() => undefined);
    void createClient().from("class_sessions").update({ current_page: index }).eq("id", session.id)
      .then(() => undefined, () => undefined);
  }, [state.currentPage, state.pages, append, session.id, t]);

  // 游戏镜像：全量轻状态防抖 350ms（08-§3.6 game_state，单写者）
  const mirrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onGameMirror = useCallback((pageId: string, mirror: GameMirrorState) => {
    if (mirrorTimer.current) clearTimeout(mirrorTimer.current);
    mirrorTimer.current = setTimeout(() => {
      append("game_state", { pageId, state: mirror });
    }, 350);
  }, [append]);
  useEffect(() => () => {
    if (mirrorTimer.current) clearTimeout(mirrorTimer.current);
  }, []);

  // 主/副板书工具态双向同步：选一次笔全场生效（翻页重建的主板书也继承当前工具），
  // 切「选择」时两块板同时放行指针，才能点到板书下层的游戏/视频。
  useEffect(() => {
    if (!mainStore) return;
    const side = sideBoard.store;
    const sideState = side.getState();
    mainStore.setState({ tool: sideState.tool, color: sideState.color, sizeNorm: sideState.sizeNorm });
    const link = (from: WhiteboardStore, to: WhiteboardStore) =>
      from.subscribe((next, prev) => {
        if (next.tool === prev.tool && next.color === prev.color && next.sizeNorm === prev.sizeNorm) return;
        const target = to.getState();
        if (target.tool !== next.tool || target.color !== next.color || target.sizeNorm !== next.sizeNorm) {
          to.setState({ tool: next.tool, color: next.color, sizeNorm: next.sizeNorm });
        }
      });
    const unlinkA = link(mainStore, side);
    const unlinkB = link(side, mainStore);
    return () => {
      unlinkA();
      unlinkB();
    };
  }, [mainStore, sideBoard.store]);

  const endClass = useCallback(() => {
    append("session_ctl", { action: "end" });
    void endClassSession(session.id).catch(() => undefined);
    setEndOpen(false);
  }, [append, session.id]);

  const reopenClass = useCallback(() => {
    append("session_ctl", { action: "start" });
    void reopenClassSession(session.id).catch(() => undefined);
  }, [append, session.id]);

  // --- 派生 ----------------------------------------------------------------
  const page = state.pages[state.currentPage] as CoursewarePage | undefined;
  const assetsReady = preload.done >= preload.total;
  const onlineIds = useMemo(() => new Set(onlinePeers.map((peer) => peer.userId)), [onlinePeers]);
  const toolbarStore = activeArea === "side" ? sideBoard.store : mainStore;
  // 清空对话框目标：默认勾选主板书，副板书可选加入（用户 2026-07-08 要求）
  const clearTargets = useMemo(
    () => (mainStore
      ? [
          { key: "main", label: t("clearMain"), store: mainStore, defaultChecked: true },
          { key: "side", label: t("clearSide"), store: sideBoard.store, defaultChecked: false },
        ]
      : undefined),
    [mainStore, sideBoard.store, t],
  );
  const myAnswer = state.quiz ? state.answers[state.quiz.id]?.[userId] : undefined;
  const tally = useMemo(() => {
    if (!state.quiz) return [];
    const bucket = new Array<number>(state.quiz.options).fill(0);
    for (const choice of Object.values(state.answers[state.quiz.id] ?? {})) {
      if (choice >= 0 && choice < bucket.length) bucket[choice] += 1;
    }
    return bucket;
  }, [state.quiz, state.answers]);
  const showControlBar = isController || (myRole === "student" && role === "viewer") || Boolean(state.quiz);

  const connectionBadges = rehearsal ? (
    // 试讲没有任何同步通道，连接徽标只会误导——换成单一模式标识
    <span className="rounded-full bg-moon/40 px-2 py-0.5 text-xs text-ink" title={t("rehearsalHint")}>
      {t("rehearsalBadge")}
    </span>
  ) : (
    <div className="flex items-center gap-2 text-xs">
      <span className="rounded-full bg-leaf/15 px-2 py-0.5 text-leaf-deep">{t("localChannel")}</span>
      <span className={`rounded-full px-2 py-0.5 ${t2Connected ? "bg-leaf/15 text-leaf-deep" : "bg-line/50 text-muted"}`}>
        {t2Connected ? t("online") : t("offline")}
      </span>
      <span className={`rounded-full px-2 py-0.5 ${p2pHealth.peers > 0 ? "bg-leaf/15 text-leaf-deep" : "bg-line/50 text-muted"}`}>
        {p2pHealth.peers > 0
          ? t("p2pConnected", { count: p2pHealth.peers, latency: p2pHealth.latencyMs ?? 0 })
          : t("p2pWaiting")}
      </span>
      {pending > 0 && (
        <span className="rounded-full bg-moon/40 px-2 py-0.5 text-ink" title={t("pendingHint")}>
          {t("pending", { count: pending })}
        </span>
      )}
    </div>
  );

  // --- 候课 ----------------------------------------------------------------
  if (effectivePhase === "prep") {
    const checklist: Array<{ key: string; ok: boolean; warn?: boolean; label: string; hint?: string }> = [
      {
        key: "assets",
        ok: assetsReady && preload.failed === 0,
        warn: preload.failed > 0,
        label: tPrep("assets", { done: preload.done, total: preload.total }),
        hint: preload.failed > 0 ? tPrep("assetsFailed", { count: preload.failed }) : undefined,
      },
      {
        key: "local",
        ok: typeof BroadcastChannel !== "undefined",
        label: tPrep("localChannel"),
        hint: tPrep("localHint"),
      },
      {
        key: "p2p",
        ok: p2pHealth.peers > 0 && (p2pHealth.latencyMs === null || p2pHealth.latencyMs < 300),
        warn: p2pHealth.state === "failed" || p2pHealth.state === "unsupported"
          || (p2pHealth.latencyMs !== null && p2pHealth.latencyMs >= 300),
        label: p2pHealth.peers > 0
          ? tPrep("p2pOk", { count: p2pHealth.peers, latency: p2pHealth.latencyMs ?? 0 })
          : p2pHealth.state === "unsupported"
            ? tPrep("p2pUnsupported")
            : p2pHealth.state === "failed"
              ? tPrep(`p2pFailure.${p2pHealth.reason ?? "ice-failed"}`)
              : tPrep("p2pWaiting"),
        hint: p2pHealth.peers > 0
          ? tPrep("p2pOfflineReady")
          : p2pHealth.state === "failed"
            ? tPrep("p2pFailureHint", { candidates: p2pHealth.candidateTypes?.join(", ") || "—" })
            : tPrep("p2pHint"),
      },
      {
        key: "server",
        ok: t2Connected,
        warn: !t2Connected,
        label: t2Connected ? tPrep("serverOk") : tPrep("serverOff"),
        hint: t2Connected ? undefined : tPrep("serverHint"),
      },
      {
        key: "wake",
        ok: wakeLockState === "ok",
        warn: wakeLockState === "unavailable",
        label: wakeLockState === "ok" ? tPrep("wakeOk") : tPrep("wakeMissing"),
      },
      { key: "roster", ok: true, label: tPrep("roster", { count: students.length }) },
    ];

    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-6 py-10">
        <div className="flex items-center gap-3">
          <Link
            href={`/classroom/${classId}/session/${session.id}`}
            aria-label={t("exit")}
            className="rounded-full p-2 text-muted transition-colors hover:bg-moon/30 hover:text-ink"
          >
            <ArrowLeft size={18} />
          </Link>
          <h1 className="min-w-0 flex-1 truncate font-display text-2xl">{session.title || t("untitled")}</h1>
          {connectionBadges}
        </div>

        <h2 className="mt-8 text-sm font-medium text-muted">{tPrep("title")}</h2>
        <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
          {checklist.map((item) => (
            <li key={item.key} className="flex items-start gap-3 px-4 py-3">
              {item.ok ? (
                <Check size={16} className="mt-0.5 shrink-0 text-leaf-deep" />
              ) : item.warn ? (
                <TriangleAlert size={16} className="mt-0.5 shrink-0 text-crater" />
              ) : (
                <LoaderCircle size={16} className="mt-0.5 shrink-0 animate-spin text-muted motion-reduce:animate-none" />
              )}
              <div className="min-w-0">
                <p className="text-sm">{item.label}</p>
                {item.hint && <p className="mt-0.5 text-xs text-muted">{item.hint}</p>}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
          <CircleAlert size={13} className="shrink-0" />
          {tPrep("noReloadWarning")}
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          {isController ? (
            <>
              <button
                type="button"
                onClick={() => window.open(`${window.location.pathname}?role=display`, "_blank")}
                className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm text-muted transition-colors hover:bg-moon/30 hover:text-ink"
              >
                <ExternalLink size={15} />
                {tPrep("openDisplay")}
              </button>
              <button
                type="button"
                disabled={!assetsReady}
                onClick={startClass}
                className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2 text-sm text-paper transition-opacity hover:opacity-85 disabled:opacity-40"
              >
                <MonitorPlay size={15} />
                {tPrep("start")}
              </button>
            </>
          ) : (
            <p className="inline-flex items-center gap-2 text-sm text-muted">
              <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" />
              {tPrep("waiting")}
            </p>
          )}
        </div>
      </div>
    );
  }

  // --- 上课 ----------------------------------------------------------------
  return (
    <div className="flex h-dvh flex-col overflow-hidden px-3 py-2">
      <header className="flex shrink-0 flex-wrap items-center gap-2">
        <Link
          href={`/classroom/${classId}/session/${session.id}`}
          aria-label={t("exit")}
          className="rounded-full p-1.5 text-muted transition-colors hover:bg-moon/30 hover:text-ink"
        >
          <ArrowLeft size={17} />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{session.title || t("untitled")}</h1>
        {connectionBadges}
        {isController && !state.ended && !rehearsal && (
          <button
            type="button"
            onClick={() => setEndOpen(true)}
            className="rounded-full border border-line px-3 py-1 text-xs text-muted transition-colors hover:bg-rose/10 hover:text-rose"
          >
            {t("endClass")}
          </button>
        )}
        <span className="font-mono text-xs text-muted">
          {state.pages.length === 0 ? "0 / 0" : `${state.currentPage + 1} / ${state.pages.length}`}
        </span>
      </header>

      {state.ended && !rehearsal && (
        <div className="mt-2 flex shrink-0 items-center justify-center gap-3 rounded-xl bg-moon/40 px-3 py-1.5 text-xs">
          <span>{t("ended")}</span>
          {isController && (
            <button
              type="button"
              onClick={reopenClass}
              className="rounded-full border border-line bg-card px-3 py-0.5 transition-colors hover:bg-moon/50"
            >
              {t("reopenClass")}
            </button>
          )}
        </div>
      )}

      <div className="mt-2 flex min-h-0 flex-1 gap-3">
        {/* 左：4:3 课件层 + 主板书覆盖层，尽量占满可压缩空间（08-§3.2 归一化坐标） */}
        <main className="relative flex min-w-0 flex-1 items-center justify-center">
          <div
            ref={stageRef}
            className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-line bg-card"
            style={{ width: "min(100%, calc((100dvh - 6rem) * 4 / 3))" }}
            onPointerDownCapture={() => setActiveArea("main")}
          >
            {!page ? (
              <p className="grid size-full place-items-center text-sm text-muted">{t("noPages")}</p>
            ) : page.type === "image" ? (
              assetUrls[page.path] ? (
                // 离线舞台：预载 blob 直出，不走 next/image 优化器（08-§3.6 豁免）
                // eslint-disable-next-line @next/next/no-img-element
                <img src={assetUrls[page.path]} alt={page.title} className="size-full object-contain" />
              ) : (
                <p className="grid size-full place-items-center text-sm text-muted">{t("assetMissing")}</p>
              )
            ) : page.type === "video" ? (
              assetUrls[page.path] ? (
                <VideoStage
                  pageId={page.id}
                  src={assetUrls[page.path]}
                  controller={isController}
                  ctl={state.video[page.id]}
                  onCtl={(action, time) => append("video_ctl", { pageId: page.id, action, time })}
                  log={log}
                />
              ) : (
                <p className="grid size-full place-items-center text-sm text-muted">{t("assetMissing")}</p>
              )
            ) : page.type === "game" ? (
              <GamePage
                key={`game-${page.id}`}
                page={page}
                isController={isController}
                mirror={state.games[page.id] ?? null}
                onMirror={onGameMirror}
              />
            ) : null}

            {page && (
              <MainBoard
                key={`board-${page.id}`}
                log={log}
                boardKey={page.id}
                editable={editable}
                initialItems={state.boards[page.id]}
                strokeWidthBasis={stageWidth}
                onStore={setMainStore}
              />
            )}

            {state.openTool && (
              <ToolOverlay
                toolId={state.openTool}
                onClose={isController ? () => append("tool_ctl", { action: "close" }) : undefined}
              />
            )}
          </div>

          {isController && toolbarStore && (
            <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-1">
              <span className="rounded-full bg-ink/70 px-2 py-0.5 text-[10px] leading-none text-paper">
                {activeArea === "side" ? t("boardSide") : t("boardMain")}
              </span>
              <Toolbar title={`${session.title || t("untitled")}-${page?.title ?? ""}`} store={toolbarStore} clearTargets={clearTargets} />
            </div>
          )}
        </main>

        {/* 右：副板书（长条，固定宽，用户 2026-07-08 要求加宽一倍）+ 学生名录（固定宽，容纳多人）+ 控制条，三段式 */}
        <div className="flex w-[29rem] shrink-0 flex-col gap-2 xl:w-[33rem]">
          <div className="flex min-h-0 flex-1 gap-2">
            {/* 副板书：默认展开固定宽；折叠为窄条腾出空间；名录折叠时改吃 flex-1（用户 2026-07-08 要求可折叠） */}
            <div
              className={cn(
                "relative shrink-0 overflow-hidden rounded-2xl border border-line bg-card transition-[width] duration-150",
                sideCollapsed ? "w-9" : rosterCollapsed ? "flex-1" : "w-64 sm:w-72",
              )}
              onPointerDownCapture={() => !sideCollapsed && setActiveArea("side")}
            >
              <button
                type="button"
                onClick={() => {
                  setSideCollapsed((collapsed) => !collapsed);
                  // 收起时若工具条正指向副板书，收回主板书——不留一个看不见的操作目标
                  setActiveArea((area) => (area === "side" ? "main" : area));
                }}
                aria-label={sideCollapsed ? t("expandSide") : t("collapseSide")}
                title={sideCollapsed ? t("expandSide") : t("collapseSide")}
                className="absolute right-1 top-1 z-10 rounded-full bg-card/90 p-1 text-muted shadow-sm transition-colors hover:bg-moon/40 hover:text-ink"
              >
                {sideCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
              </button>
              {!sideCollapsed && (
                <CanvasSurface editable={editable} store={sideBoard.store} bus={sideBoard.bus} strokeWidthBasis={stageWidth} />
              )}
            </div>
            {/* 名录：默认展开吃满剩余宽度；折叠为窄条，副板书自动接手空间 */}
            <div
              className={cn(
                "flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line transition-[width] duration-150",
                rosterCollapsed ? "w-9 shrink-0" : "flex-1",
              )}
            >
              <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
                {!rosterCollapsed && (
                  <p className="min-w-0 flex-1 truncate text-xs text-muted">{t("roster", { count: students.length })}</p>
                )}
                <button
                  type="button"
                  onClick={() => setRosterCollapsed((collapsed) => !collapsed)}
                  aria-label={rosterCollapsed ? t("expandRoster") : t("collapseRoster")}
                  title={rosterCollapsed ? t("expandRoster") : t("collapseRoster")}
                  className="ml-auto shrink-0 rounded-full p-1 text-muted transition-colors hover:bg-moon/40 hover:text-ink"
                >
                  {rosterCollapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
                </button>
              </div>
              {!rosterCollapsed && (
                <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5">
                  {students.map((student) => {
                    const count = state.stars[student.userId] ?? 0;
                    const answered = state.quiz ? state.answers[state.quiz.id]?.[student.userId] : undefined;
                    return (
                      <StudentCard
                        key={student.userId}
                        name={student.displayName || t("anonymous")}
                        count={count}
                        hand={Boolean(state.hands[student.userId])}
                        online={onlineIds.has(student.userId)}
                        answerLabel={
                          answered === undefined ? null : isController ? OPTION_LABELS[answered] ?? "?" : "✓"
                        }
                        interactive={editable}
                        undoHint={t("undoStar")}
                        onStar={() => append("star", { studentId: student.userId })}
                        onUndo={() => {
                          if (count > 0) append("star_undo", { studentId: student.userId });
                        }}
                      />
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* 控制条：翻页/插页/工具/发题（教师）或举手/作答（学生），紧贴副板书+名录下方，老师操作更方便 */}
          {showControlBar && (
            <div className="flex shrink-0 flex-col gap-1.5 rounded-2xl border border-line p-2">
              {isController && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    aria-label={t("prevPage")}
                    disabled={state.currentPage <= 0}
                    onClick={() => gotoPage(state.currentPage - 1, state.pages.length)}
                    className="grid size-10 place-items-center rounded-full border border-line text-ink transition-colors hover:bg-moon/30 disabled:opacity-30"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("nextPage")}
                    disabled={state.currentPage >= state.pages.length - 1}
                    onClick={() => gotoPage(state.currentPage + 1, state.pages.length)}
                    className="grid size-10 place-items-center rounded-full border border-line text-ink transition-colors hover:bg-moon/30 disabled:opacity-30"
                  >
                    <ChevronRight size={18} />
                  </button>
                  {!state.ended && (
                    <>
                      <button
                        type="button"
                        onClick={insertBoardPage}
                        className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line px-3 text-xs text-muted transition-colors hover:bg-moon/30 hover:text-ink"
                      >
                        <PenLine size={14} />
                        {t("insertBoard")}
                      </button>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line px-3 text-xs text-muted transition-colors hover:bg-moon/30 hover:text-ink"
                          >
                            <Wrench size={14} />
                            {t("openTool")}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent side="top" className="w-auto p-1.5">
                          <ToolPicker
                            onPick={(toolId) => append("tool_ctl", { action: "open", toolId })}
                          />
                        </PopoverContent>
                      </Popover>
                      {state.quiz ? (
                        <button
                          type="button"
                          onClick={() => append("session_ctl", { action: "quiz_close", quizId: state.quiz?.id })}
                          className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-ink px-3 text-xs text-paper transition-opacity hover:opacity-85"
                        >
                          <SquareCheckBig size={14} />
                          {t("quizClose")}
                        </button>
                      ) : (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line px-3 text-xs text-muted transition-colors hover:bg-moon/30 hover:text-ink"
                            >
                              <ListTodo size={14} />
                              {t("quizOpen")}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent side="top" className="w-auto p-1.5">
                            <div className="flex items-center gap-1">
                              {[2, 3, 4].map((options) => (
                                <button
                                  key={options}
                                  type="button"
                                  onClick={() => append("session_ctl", { action: "quiz_open", quizId: newId(), options })}
                                  className="rounded-lg px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-moon/30 hover:text-ink"
                                >
                                  {t("quizOptions", { last: OPTION_LABELS[options - 1] })}
                                </button>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                    </>
                  )}
                </div>
              )}

              {myRole === "student" && role === "viewer" && !state.ended && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => append("hand", { up: !state.hands[userId] })}
                    className={cn(
                      "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm transition-colors",
                      state.hands[userId]
                        ? "border-crater/50 bg-crater/10 text-crater"
                        : "border-line text-muted hover:bg-moon/30 hover:text-ink",
                    )}
                  >
                    <Hand size={15} />
                    {state.hands[userId] ? t("handDown") : t("handUp")}
                  </button>
                  {state.quiz && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="w-full text-xs text-muted">{t("answerPrompt")}</span>
                      {Array.from({ length: state.quiz.options }, (_, choice) => (
                        <button
                          key={choice}
                          type="button"
                          onClick={() => append("answer", { quizId: state.quiz?.id, choice })}
                          className={cn(
                            "grid size-11 place-items-center rounded-full border text-sm font-medium transition-colors",
                            myAnswer === choice
                              ? "border-ink/60 bg-ink text-paper"
                              : "border-line text-ink hover:bg-moon/30",
                          )}
                        >
                          {OPTION_LABELS[choice]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {state.quiz && (
                <div className="flex flex-wrap items-center gap-1 text-xs">
                  <span className="text-muted">{t("quizTally")}</span>
                  {tally.map((count, choice) => (
                    <span key={choice} className="rounded-full bg-line/50 px-2 py-0.5 font-mono">
                      {OPTION_LABELS[choice]} {count}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Dialog open={endOpen} onOpenChange={setEndOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("endClass")}</DialogTitle>
            <DialogDescription>{t("endConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setEndOpen(false)}>{t("cancel")}</Button>
            <Button size="sm" onClick={endClass}>{t("endClass")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 主板书：按页 uuid 隔离，key 换页时整体重建并从最近快照水合。 */
function MainBoard({
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
function GamePage({
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
  const Board = game.Board;
  return (
    <div className="size-full overflow-auto p-4">
      <Board
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
function ToolOverlay({ toolId, onClose }: { toolId: string; onClose?: () => void }) {
  const t = useTranslations("classroom.live");
  const tTools = useTranslations("tools");
  const tool = getTool(toolId);
  if (!tool) return null;
  const Component = tool.Component;
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
        <Component embedded />
      </div>
    </div>
  );
}

function ToolPicker({ onPick }: { onPick: (toolId: string) => void }) {
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
function StudentCard({
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
