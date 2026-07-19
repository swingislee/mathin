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
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { GameMirrorState } from "@/features/games/types";
import { CanvasSurface } from "@/features/whiteboard/CanvasSurface";
import { Toolbar } from "@/features/whiteboard/Toolbar";
import type { WhiteboardStore } from "@/features/whiteboard/store";

import type { InteractionTrigger } from "@/features/courseware-doc/interactions";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import { Link, useRouter } from "@/i18n/navigation";
import { createIsolatedRealtimeClient } from "@/lib/supabase/client";
import { newId } from "@/lib/uuid";
import { cn } from "@/lib/utils";
import { endClassSession, getClassSession, reopenClassSession, saveCourseware, setSessionPage, startClassSession } from "../actions";
import {
  buildDocBindingUrls,
  collectDocObjectHashes,
  collectH5PackageHashes,
  countH5Pages,
  fetchH5Manifest,
  loadObjectBlob,
  loadSessionDocsBundle,
  preheatH5Package,
} from "../courseware/doc-preload";
import { getSessionAssetUrls, type SessionPageDoc } from "../courseware/session-assets";
import { downloadCoursewareAsset } from "../courseware/upload";
import { DocCoursewarePage } from "./DocCoursewarePage";
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
import { VideoStage } from "./VideoStage";
import { GamePage, MainBoard, StudentCard, ToolOverlay, ToolPicker } from "./LivePanels";
import { OPTION_LABELS, reduceEvent, type LiveState, type Phase, type Role } from "./liveState";

// 上课页（08-§3.4/§5）：候课（预载/自检）→ 上课 全程页内状态切换，零路由跳转。
// P4-5 正式舞台：4:3 课件/主板书 + 副板书 + 学生名录；主板书按页 uuid 隔离、
// 副板书全课一块；游戏页 game_state 镜像、视频 video_ctl 同步、工具快捷窗、
// 上课中临时插白板页、加星长按撤销、举手/发题/作答、presence 在线名单。

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
  /** 离线演练：保留可靠 outbox，但主动禁用 T2 与服务端写入，退出后验证补同步。 */
  offlineDrill?: boolean;
}

export function LiveShell({ session, classId, members, myRole, userId, initialEvents, role, rehearsal = false, offlineDrill = false }: Props) {
  const router = useRouter();
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
      docSteps: {},
    };
    for (const ev of initialEvents) state = reduceEvent(state, ev);
    return state;
  }, [session, initialEvents]);

  const [state, setState] = useState(initialState);
  // 从 state.pages（而非 props）取媒体页：学生开课后补取的冻结页也要进预载
  const mediaPages = useMemo(
    () => state.pages.filter((page): page is Extract<CoursewarePage, { path: string }> =>
      page.type === "image" || page.type === "video",
    ),
    [state.pages],
  );
  const [phase, setPhase] = useState<Phase>(rehearsal || role === "viewer" || initialState.started ? "live" : "prep");
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [preload, setPreload] = useState(() => ({ done: 0, total: mediaPages.length, failed: 0 }));
  // --- doc 页（P6-5）：页束 + bindingKey→URL 表（blob objectURL / H5 垫片入口） ---
  const [docBundle, setDocBundle] = useState<SessionPageDoc[] | null>(null);
  const [docUrls, setDocUrls] = useState<ResolvedBindingUrls>({});
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
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(false);
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
    let tryFlush: (() => void) | null = null;
    let onHide: (() => void) | null = null;

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
      if (!offlineDrill) {
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
      }
      setLog(eventLog);
      if (offlineDrill) {
        void pendingCount(session.id).then((count) => {
          if (!disposed) setPending(count);
        }).catch(() => undefined);
      }

      tryFlush = () => {
        flushOutbox(session.id)
          .then(() => pendingCount(session.id))
          .then((count) => {
            if (!disposed) setPending(count);
          })
          .catch(() => undefined);
      };
      if (!offlineDrill) {
        tryFlush();
        flushTimer = setInterval(tryFlush, 15000);
        window.addEventListener("online", tryFlush);
        onHide = () => tryFlush?.();
        document.addEventListener("visibilitychange", onHide);
        window.addEventListener("pagehide", onHide);
      }
    };
    void setup();

    return () => {
      disposed = true;
      if (flushTimer) clearInterval(flushTimer);
      if (tryFlush) window.removeEventListener("online", tryFlush);
      if (onHide) {
        document.removeEventListener("visibilitychange", onHide);
        window.removeEventListener("pagehide", onHide);
      }
      logRef.current?.close();
      logRef.current = null;
      setLog(null);
    };
    // initialEvents/selfName/myRole 仅首帧使用，不追踪
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, userId, rehearsal, offlineDrill]);

  // --- 课件预载（IndexedDB 命中则直接建 objectURL）-----------------------
  // 板书插页等 pages 数组重建不应重跑预载（会撤销在用的 objectURL），
  // 媒体页内容以路径串为准。
  const mediaKey = mediaPages.map((page) => page.path).join("|");
  useEffect(() => {
    const tick = ++preloadTick.current;
    const urls: string[] = [];
    const isLive = () => preloadTick.current === tick;

    const run = async () => {
      // doc 页束先行（P6-5，D4）：挂讲次的课次统一走 release 页束——
      // 冻结课次取冻结 pin 的 release，候课/试讲回退 current release。
      let docPages: SessionPageDoc[] = [];
      let docHashes: string[] = [];
      if (session.lectureId) {
        try {
          docPages = await loadSessionDocsBundle(session.id);
          docHashes = collectDocObjectHashes(docPages);
        } catch {
          // 束取不到（离线首进且无缓存）：doc 页降级提示，媒体页照常预载
        }
        if (!isLive()) return;
        setDocBundle(docPages);
      }
      setPreload({ done: 0, total: mediaPages.length + docHashes.length, failed: 0 });

      for (const page of mediaPages) {
        if (!isLive()) return;
        try {
          let blob = await idbGet<Blob>(STORE_ASSETS, page.path);
          if (!blob) {
            blob = await downloadCoursewareAsset(page.path);
            await idbPut(STORE_ASSETS, page.path, blob);
          }
          // await 之后必须复查 tick：StrictMode 双跑 effect 时旧一轮会在此重复计数
          if (!isLive()) return;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          setAssetUrls((prev) => ({ ...prev, [page.path]: url }));
          setPreload((prev) => ({ ...prev, done: prev.done + 1 }));
        } catch {
          if (!isLive()) return;
          setPreload((prev) => ({ ...prev, failed: prev.failed + 1 }));
        }
      }

      if (docPages.length === 0) return;

      // H5 先行：入口取公开桶 manifest 的 entryPath，同时按清单做 HTTP 缓存
      // 预热——只是加速，不改变候课单黄灯语义（D4）
      const h5EntryByHash = new Map<string, string>();
      const h5Hashes = collectH5PackageHashes(docPages);
      for (const hash of h5Hashes) {
        if (!isLive()) return;
        try {
          const manifest = await fetchH5Manifest(hash);
          h5EntryByHash.set(hash, manifest.entryPath);
          void preheatH5Package(hash, manifest, isLive);
        } catch {
          // manifest 取不到：该包的 doc 节点渲染可见的降级块
        }
      }

      // 非 H5 对象：IndexedDB 命中免签发（离线可续课）；缺的批签一次（D3）。
      // URL 表逐对象增量刷新——开课中途加入的学生不必等全部对象下完。
      let signedByHash = new Map<string, string>();
      const missing: string[] = [];
      for (const hash of docHashes) {
        if (!(await idbGet<Blob>(STORE_ASSETS, `cw:${hash}`))) missing.push(hash);
      }
      if (!isLive()) return;
      if (missing.length > 0) {
        try {
          const signed = await getSessionAssetUrls(session.id);
          signedByHash = new Map(signed.map((item) => [item.objectHash, item.signedUrl]));
        } catch {
          // 批签失败（离线）：仅 IndexedDB 命中的对象可用
        }
        if (!isLive()) return;
      }
      const urlByObjectHash = new Map<string, string>();
      setDocUrls(buildDocBindingUrls(docPages, urlByObjectHash, h5EntryByHash));
      for (const hash of docHashes) {
        if (!isLive()) return;
        try {
          const blob = await loadObjectBlob(hash, signedByHash.get(hash));
          if (!isLive()) return;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          urlByObjectHash.set(hash, url);
          setDocUrls(buildDocBindingUrls(docPages, urlByObjectHash, h5EntryByHash));
          setPreload((prev) => ({ ...prev, done: prev.done + 1 }));
        } catch {
          if (!isLive()) return;
          setPreload((prev) => ({ ...prev, failed: prev.failed + 1 }));
        }
      }
    };
    void run();

    return () => {
      preloadTick.current += 1;
      for (const url of urls) URL.revokeObjectURL(url);
    };
    // mediaPages 的内容由 mediaKey 代表（见上）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaKey, session.id, session.lectureId]);

  // --- 学生端开课补取（P6-5）：挂讲次课次的 courseware 在开课冻结时才落库，
  // 早于开课进入等待页的学生 pages 为空，收到 start 后拉一次冻结基线。
  useEffect(() => {
    if (isController || !state.started || state.pages.length > 0 || !session.lectureId) return;
    let cancelled = false;
    void getClassSession(session.id)
      .then((fresh) => {
        if (cancelled || !fresh || fresh.courseware.length === 0) return;
        setState((prev) => (prev.pages.length > 0 ? prev : { ...prev, pages: fresh.courseware }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isController, state.started, state.pages.length, session.id, session.lectureId]);

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
    if (rehearsal || offlineDrill) return;
    void setSessionPage(session.id, clamped).catch(() => undefined);
  }, [append, session.id, rehearsal, offlineDrill]);

  const startClass = useCallback(async () => {
    // 挂了讲次的课次要先在服务端 resolve 模板+覆盖层冻结 courseware，
    // 成功后才广播 session_ctl:start（10-§5.4）；失败则留在候课页重试。
    setStarting(true);
    setStartError(false);
    try {
      await startClassSession(session.id);
    } catch {
      setStarting(false);
      setStartError(true);
      return;
    }
    append("session_ctl", { action: "start" });
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
    void setSessionPage(session.id, index).catch(() => undefined);
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

  const endClass = useCallback(async () => {
    append("session_ctl", { action: "end" });
    try {
      await endClassSession(session.id);
      router.push(`/classroom/${classId}/session/${session.id}/report`);
    } finally {
      setEndOpen(false);
    }
  }, [append, classId, router, session.id]);

  const reopenClass = useCallback(() => {
    append("session_ctl", { action: "start" });
    void reopenClassSession(session.id).catch(() => undefined);
  }, [append, session.id]);

  // --- 派生 ----------------------------------------------------------------
  const page = state.pages[state.currentPage] as CoursewarePage | undefined;
  const assetsReady = preload.done >= preload.total;
  const docsById = useMemo(
    () => new Map((docBundle ?? []).map((item) => [item.pageDocId, item.doc])),
    [docBundle],
  );
  const h5PageCount = useMemo(() => countH5Pages(docBundle ?? []), [docBundle]);
  const onDocStep = useCallback((pageId: string, trigger: InteractionTrigger) => {
    append("doc_step", { pageId, scope: trigger.scope, id: trigger.id });
  }, [append]);
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
  ) : offlineDrill ? (
    <div className="flex items-center gap-2 text-xs">
      <Badge variant="secondary" className="bg-moon/40 text-ink">{t("offlineDrillBadge")}</Badge>
      {pending > 0 && (
        <Badge variant="secondary" className="bg-moon/40 text-ink" title={t("pendingHint")}>
          {t("pending", { count: pending })}
        </Badge>
      )}
    </div>
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
      // 含 H5 的 doc 页无法 blob 预载（多文件包），单列「需在线」黄灯——
      // 预热只改善在线首开速度，不算进已预载（doc 16 §3 D4，不糊弄成绿灯）
      ...(h5PageCount > 0
        ? [{
            key: "h5",
            ok: false,
            warn: true,
            label: tPrep("h5Online", { count: h5PageCount }),
            hint: tPrep("h5OnlineHint"),
          }]
        : []),
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
                disabled={!assetsReady || starting}
                onClick={() => void startClass()}
                className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2 text-sm text-paper transition-opacity hover:opacity-85 disabled:opacity-40"
              >
                {starting ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : <MonitorPlay size={15} />}
                {tPrep("start")}
              </button>
              {startError && <p className="text-xs text-rose">{tPrep("startFailed")}</p>}
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
            ) : page.type === "doc" ? (
              <DocCoursewarePage
                key={`doc-${page.id}`}
                doc={docsById.get(page.docId) ?? null}
                bindingUrls={docUrls}
                isController={isController}
                steps={state.docSteps[page.id]}
                onStep={(trigger) => onDocStep(page.id, trigger)}
                videoCtl={state.video[page.id]}
                onVideoCtl={(action, time) => append("video_ctl", { pageId: page.id, action, time })}
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
