"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useStore } from "zustand";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Hand,
  LoaderCircle,
  MonitorPlay,
  SquareCheckBig,
  TriangleAlert,
  LocateFixed,
  ZoomIn,
  ZoomOut,
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
import type { GameMirrorState } from "@/features/games/types";
import {
  CLASSROOM_GAME_MIRROR_SYNC_V1,
  classroomInteractionPayloadWithinBudget,
} from "../sync/interaction-provider";
import { AttendanceDrawer } from "@/features/school/AttendanceDrawer";
import type { AttendanceDrawerRow } from "@/features/school/actions/types";
import {
  SessionLearningCheckPanel,
  type LearningCheckSummarySnapshot,
} from "@/features/school/SessionLearningCheckPanel";
import {
  learningCheckIdAfterPageChange,
  learningResultKey,
  type SessionLearningSetup,
} from "@/features/school/session-learning-contract";
import { CanvasSurface, type CanvasSurfaceInputPort } from "@/features/whiteboard/CanvasSurface";
import { Toolbar } from "@/features/whiteboard/Toolbar";
import type { WhiteboardStore } from "@/features/whiteboard/store";
import { isStrokeItem, type StrokeItem } from "@/features/whiteboard/types";

import type { InteractionTrigger } from "@/features/courseware-doc/interactions";
import type { SessionBoardCheckpoint } from "../checkpoint/types";
import { shouldApplyLegacyBoardSnapshot } from "../checkpoint/selection";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import { Link, useRouter } from "@/i18n/navigation";
import { createIsolatedRealtimeClient } from "@/lib/supabase/client";
import { newId } from "@/lib/uuid";
import { cn } from "@/lib/utils";
import {
  endClassSession,
  getClassSession,
  refreshSessionRoster,
  reopenClassSession,
  saveCourseware,
  setSessionPage,
  startClassSession,
} from "../actions";
import {
  buildDocBindingUrls,
  collectH5PackageHashes,
  countH5Pages,
  fetchH5Manifest,
  loadObjectBlob,
  loadSessionDocsBundle,
  preheatH5Package,
  prioritizeDocObjectHashes,
  takePrioritizedDocObjectHash,
} from "../courseware/doc-preload";
import { getSessionAssetUrls, type SessionPageDoc } from "../courseware/session-assets";
import { downloadCoursewareAsset } from "../courseware/upload";
import { DocCoursewarePage } from "./DocCoursewarePage";
import { SessionEventLog } from "../sync/eventlog";
import { flushOutbox, pendingCount } from "../sync/flush";
import { STORE_ASSETS, idbGet, idbPut } from "../sync/idb";
import {
  emptyStarLedger,
  latestActiveAwardId,
  reduceStarLedger,
  starCountForRosterEntry,
} from "../stars";
import {
  createLocalTransport,
  createP2PSignalBus,
  createP2PTransport,
  createRealtimeTransport,
  type P2PHealth,
  type PresencePeer,
} from "../sync/transports";
import type {
  ClassroomMember,
  ClassSessionRecord,
  CoursewarePage,
  SessionEvent,
  SessionRosterEntry,
  SessionRosterState,
} from "../types";
import { countCoursewareH5Frames, resolveClassroomRendererInputProfile } from "../input/capabilities";
import { classroomInputProviderAttributes } from "../input/provider";
import { useClassroomPointerRouter } from "../input/useClassroomPointerRouter";
import { useH5PointerBridge } from "../input/useH5PointerBridge";
import { resolveClassroomRoutingMode } from "../input/router";
import { useClassBoard } from "./useClassBoard";
import { VideoStage } from "./VideoStage";
import { GamePage, MainBoard, StudentCard, ToolOverlay } from "./LivePanels";
import { ClassroomSmartInputToggle } from "./ClassroomSmartInputToggle";
import { ClassroomBackdrop } from "./ClassroomBackdrop";
import { ClassroomCourseInfoBar, ClassroomEndButton } from "./ClassroomCourseInfoBar";
import { ClassroomRosterGrid, type ClassroomRosterStudent } from "./ClassroomRosterGrid";
import { DevelopmentAcceptanceDock } from "./DevelopmentAcceptanceDock";
import { TeacherClassroomControlBar } from "./TeacherClassroomControlBar";
import { ClassroomPageControls, ClassroomToolsMenu } from "./ClassroomControlMenus";
import { resolveClassroomTeachingSurface } from "./classroom-teaching-surface";
import {
  M3_AIXUEXI_H5_FIXTURE_DOC,
  M3_AIXUEXI_H5_FIXTURE_PAGE,
  M3_H5_FIXTURE_DOC,
  M3_H5_FIXTURE_PAGE,
  m3AixuexiH5FixtureBindingUrls,
  m3H5FixtureBindingUrls,
} from "./m3-input-fixtures";
import { buildM4aRosterFixtures, M4A_STAR_STUDENT_ID } from "./m4-roster-fixtures";
import { buildM4bRosterFixtures, buildM4bStarFixtureEvents } from "./m4-layout-fixtures";
import { buildRehearsalLearningSetup } from "./rehearsal-learning";
import { OPTION_LABELS, reduceEvent, type LiveState, type Phase, type Role } from "./liveState";
import {
  INTERACTION_SYNC_FIXTURE_DOC,
  INTERACTION_SYNC_FIXTURE_PAGE,
} from "./interaction-sync-fixtures";

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
  initialCheckpoints: SessionBoardCheckpoint[];
  initialRoster: SessionRosterState;
  /** Writer gate only. The v2 reader remains active during rollback. */
  checkpointV2Writer: boolean;
  /** Independent M3 input gate. Production stays fail-closed until explicitly enabled. */
  inputV2Enabled: boolean;
  /** Independent M3b H5 bridge gate. Production stays fail-closed until explicitly enabled. */
  h5PointerEnabled: boolean;
  /** M4 roster/star writer and control-layout gate. Readers remain dual-version. */
  layoutV2Enabled: boolean;
  /** Development-only visible Gate; accepted milestones stay out of the default surface. */
  acceptanceFixture: "m3b" | "m4a" | "m4b" | "interaction-sync" | null;
  role: Role;
  /** 试讲：教师本地预演/复盘——事件不落库不同步，随时可进（包括已下课的课次）。 */
  rehearsal?: boolean;
  /** 离线演练：保留可靠 outbox，但主动禁用 T2 与服务端写入，退出后验证补同步。 */
  offlineDrill?: boolean;
  /** 正式课次显示点名提醒；试讲/离线演练不显示，且点名状态不阻断开课。 */
  attendanceSuggested: boolean;
  initialAttendanceComplete: boolean;
  initialAttendanceRows: AttendanceDrawerRow[];
  learningSetup: SessionLearningSetup | null;
}

export function LiveShell({
  session,
  classId,
  members,
  myRole,
  userId,
  initialEvents,
  initialCheckpoints,
  initialRoster,
  checkpointV2Writer,
  inputV2Enabled,
  h5PointerEnabled,
  layoutV2Enabled,
  acceptanceFixture,
  role,
  rehearsal = false,
  offlineDrill = false,
  attendanceSuggested,
  initialAttendanceComplete,
  initialAttendanceRows,
  learningSetup,
}: Props) {
  const router = useRouter();
  const t = useTranslations("classroom.live");
  const tPrep = useTranslations("classroom.prep");
  const m4aFixtures = useMemo(() => buildM4aRosterFixtures({
    claimed: t("m4FixtureClaimed"),
    unclaimed: t("m4FixtureUnclaimed"),
    seated: t("m4FixtureSeated"),
    newlyEnrolled: t("m4FixtureNewEnrollment"),
  }), [t]);
  const m4bFixtures = useMemo(() => buildM4bRosterFixtures({
    student: (seat) => t("m4bFixtureStudent", { seat }),
    longName: t("m4bFixtureLongName"),
    unclaimed: t("m4bFixtureUnclaimed"),
  }), [t]);
  const [rosterState, setRosterState] = useState(() => (
    acceptanceFixture === "m4a"
      ? m4aFixtures.base
      : acceptanceFixture === "m4b"
        ? m4bFixtures["20"]
        : initialRoster
  ));
  const students = rosterState.entries;
  const starEventSchema = rehearsal && layoutV2Enabled ? 2 : rosterState.starEventSchema;
  const selfName = useMemo(
    () => members.find((member) => member.userId === userId)?.displayName ?? "",
    [members, userId],
  );
  const checkpointByBoard = useMemo(
    () => new Map(initialCheckpoints.map((checkpoint) => [checkpoint.boardKey, checkpoint])),
    [initialCheckpoints],
  );
  const m4bStarEvents = useMemo(
    () => acceptanceFixture === "m4b" ? buildM4bStarFixtureEvents(session.id, userId) : [],
    [acceptanceFixture, session.id, userId],
  );

  const initialState = useMemo<LiveState>(() => {
    let state: LiveState = {
      pages: session.courseware,
      currentPage: session.currentPage,
      starLedger: emptyStarLedger(),
      started: Boolean(session.startedAt),
      ended: Boolean(session.endedAt),
      hands: {},
      boards: Object.fromEntries(initialCheckpoints.map((checkpoint) => [checkpoint.boardKey, checkpoint.items])),
      games: {},
      video: {},
      openTool: null,
      quiz: null,
      answers: {},
      docSteps: {},
    };
    for (const ev of [...initialEvents, ...m4bStarEvents]) {
      const pageKey = ev.type === "board_snapshot" ? String(ev.payload.pageKey ?? "") : "";
      const checkpoint = pageKey ? checkpointByBoard.get(pageKey) : undefined;
      if (pageKey && !shouldApplyLegacyBoardSnapshot(checkpoint, ev.createdAt)) continue;
      state = reduceEvent(state, ev);
    }
    return state;
  }, [session, initialEvents, initialCheckpoints, checkpointByBoard, m4bStarEvents]);

  const [state, setState] = useState(initialState);
  const starLedgerRef = useRef(initialState.starLedger);
  const starQueueRef = useRef<Promise<void>>(Promise.resolve());
  const activePage = state.pages[state.currentPage];
  const activePageDocId = activePage?.type === "doc" ? activePage.docId : null;
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
  const [smartInputEnabled, setSmartInputEnabled] = useState(true);
  const [m3FixtureEnabled, setM3FixtureEnabled] = useState(() => acceptanceFixture === "m3b");
  const [m3FixtureRenderer, setM3FixtureRenderer] = useState<"mofaxiao" | "aixuexi">("mofaxiao");
  const [m3H5Compatible, setM3H5Compatible] = useState(true);
  const [m4bScenario, setM4bScenario] = useState<"8" | "20" | "30">("20");
  const [endOpen, setEndOpen] = useState(false);
  const [classroomToolsOpen, setClassroomToolsOpen] = useState(false);
  const [stageWidth, setStageWidth] = useState(0);
  // 副板书/名录默认展开（用户 2026-07-08 要求可折叠腾空间给对方或主板书）
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [rosterCollapsed, setRosterCollapsed] = useState(false);
  const [showAllStudents, setShowAllStudents] = useState(myRole !== "student");
  const [sideZoom, setSideZoom] = useState(1);
  const [sideFollow, setSideFollow] = useState(myRole === "student");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(false);
  const [rosterRefreshing, setRosterRefreshing] = useState(false);
  const [rosterRefreshError, setRosterRefreshError] = useState(false);
  const [starWriteError, setStarWriteError] = useState(false);
  const [attendanceSaved, setAttendanceSaved] = useState(initialAttendanceComplete);
  const [learningSummaryState, setLearningSummaryState] = useState<{
    setupKey: string;
    snapshot: LearningCheckSummarySnapshot;
  } | null>(null);
  const [learningSeatState, setLearningSeatState] = useState<{
    setupKey: string;
    positions: ReadonlyMap<string, number>;
  } | null>(null);
  const logRef = useRef<SessionEventLog | null>(null);
  const preloadTick = useRef(0);
  const activePageDocIdRef = useRef(activePageDocId);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const mainInputPortRef = useRef<CanvasSurfaceInputPort | null>(null);
  const sideViewportRef = useRef<HTMLDivElement | null>(null);
  const onMainInputPort = useCallback((port: CanvasSurfaceInputPort | null) => {
    mainInputPortRef.current = port;
  }, []);

  useEffect(() => {
    activePageDocIdRef.current = activePageDocId;
  }, [activePageDocId]);

  const isController = role === "control" && myRole === "teacher";
  const teacherLayoutV2 = layoutV2Enabled && isController;
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
        eventLog.subscribe((ev) => {
          starLedgerRef.current = reduceStarLedger(starLedgerRef.current, ev);
          setState((prev) => reduceEvent(prev, ev));
        });
        setLog(eventLog);
        return;
      }
      eventLog.markSeen(initialEvents.map((ev) => ev.id));
      const p2pSignals = createP2PSignalBus();
      logRef.current = eventLog;
      eventLog.subscribe((ev) => {
        starLedgerRef.current = reduceStarLedger(starLedgerRef.current, ev);
        setState((prev) => reduceEvent(prev, ev));
      });
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
  const docPageKey = state.pages
    .filter((page): page is Extract<CoursewarePage, { type: "doc" }> => page.type === "doc")
    .map((page) => page.docId)
    .join("|");
  useEffect(() => {
    const tick = ++preloadTick.current;
    const urls: string[] = [];
    const isLive = () => preloadTick.current === tick;

    const run = async () => {
      // doc 页束先行（P6-5，D4）：挂讲次的课次统一走 release 页束——
      // 冻结课次取冻结 pin 的 release，候课/试讲回退 current release。
      let docPages: SessionPageDoc[] = [];
      let docHashes: string[] = [];
      if (session.lectureId || docPageKey) {
        try {
          docPages = await loadSessionDocsBundle(session.id);
          docHashes = prioritizeDocObjectHashes(docPages, activePageDocIdRef.current);
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
      const queue = [...docHashes];
      const preloadWorker = async () => {
        for (;;) {
          const hash = takePrioritizedDocObjectHash(queue, docPages, activePageDocIdRef.current);
          if (!hash || !isLive()) return;
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
      await Promise.all(Array.from({ length: Math.min(4, queue.length) }, preloadWorker));
    };
    void run();

    return () => {
      preloadTick.current += 1;
      for (const url of urls) URL.revokeObjectURL(url);
    };
    // mediaPages 的内容由 mediaKey 代表（见上）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docPageKey, mediaKey, session.id, session.lectureId]);

  // --- 学生端开课补取（P6-5）：正式讲次或自由课微课的 courseware 都可能在
  // 开课冻结时才落库，
  // 早于开课进入等待页的学生 pages 为空，收到 start 后拉一次冻结基线。
  useEffect(() => {
    if (isController || !state.started || state.pages.length > 0) return;
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
  const sideBoard = useClassBoard(log, "side", editable, initialState.boards["side"], {
    cursorName: selfName,
    checkpointV2Writer,
    initialCheckpoint: checkpointByBoard.get("side"),
  });

  // 学生端的副板书保持固定纵横比并允许平移/缩放；新笔迹落定后自动把最后一行带回视口。
  useEffect(() => {
    if (isController) return;
    const frames = new Set<number>();
    const focusLastStroke = (behavior: ScrollBehavior) => {
      const frame = window.requestAnimationFrame(() => {
        frames.delete(frame);
        const viewport = sideViewportRef.current;
        const items = sideBoard.store.getState().items;
        const lastItem = items.findLast((item): item is StrokeItem => isStrokeItem(item));
        const lastPoint = lastItem?.points[lastItem.points.length - 1];
        if (!viewport || !lastPoint) return;
        const targetTop = Math.max(0, lastPoint[1] * viewport.scrollHeight - viewport.clientHeight * 0.72);
        viewport.scrollTo({ top: targetTop, behavior });
      });
      frames.add(frame);
    };
    if (sideFollow) focusLastStroke("auto");
    const unsubscribe = sideBoard.store.subscribe((next, previous) => {
      if (sideFollow && next.items !== previous.items) focusLastStroke("smooth");
    });
    return () => {
      unsubscribe();
      for (const frame of frames) window.cancelAnimationFrame(frame);
    };
  }, [isController, sideBoard.store, sideFollow, sideZoom]);

  // --- 操作 ----------------------------------------------------------------
  const append = useCallback((type: Parameters<SessionEventLog["append"]>[0], payload: Record<string, unknown>) => {
    void logRef.current?.append(type, payload).then(() => {
      if (!rehearsal) void pendingCount(session.id).then(setPending).catch(() => undefined);
    });
  }, [session.id, rehearsal]);

  /** Serialize award/revoke decisions so every undo names the latest still-active award. */
  const appendStar = useCallback((student: SessionRosterEntry, action: "award" | "undo") => {
    const run = async () => {
      const eventLog = logRef.current;
      if (!eventLog) return;

      let payload: Record<string, unknown>;
      if (starEventSchema === 2) {
        const awardId = action === "award"
          ? newId()
          : latestActiveAwardId(starLedgerRef.current, student.studentId);
        if (!awardId) return;
        payload = { schemaVersion: 2, studentId: student.studentId, awardId };
      } else {
        if (!student.userId) return;
        if (
          action === "undo"
          && starCountForRosterEntry(starLedgerRef.current, student) === 0
        ) return;
        payload = { studentId: student.userId };
      }

      setStarWriteError(false);
      await eventLog.append(action === "award" ? "star" : "star_undo", payload);
      if (!rehearsal) {
        const count = await pendingCount(session.id);
        setPending(count);
      }
    };

    starQueueRef.current = starQueueRef.current
      .then(run, run)
      .catch(() => {
        setStarWriteError(true);
      });
  }, [rehearsal, session.id, starEventSchema]);

  const gotoPage = useCallback((page: number, total: number) => {
    const clamped = Math.max(0, Math.min(total - 1, page));
    append("page", { page: clamped });
    // 在线时顺手更新 DB 基线（晚加入者用）；离线静默失败。试讲不改共享基线。
    if (rehearsal || offlineDrill) return;
    void setSessionPage(session.id, clamped).catch(() => undefined);
  }, [append, session.id, rehearsal, offlineDrill]);

  useEffect(() => {
    if (!isController || state.pages.length === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (
        target.isContentEditable
        || target.matches("input, textarea, select, button, [role='dialog'], [role='textbox']")
      )) return;
      const direction = event.key === "ArrowLeft" || event.key === "PageUp"
        ? -1
        : event.key === "ArrowRight" || event.key === "PageDown" || event.key === " "
          ? 1
          : 0;
      if (!direction) return;
      const nextPage = Math.max(0, Math.min(state.pages.length - 1, state.currentPage + direction));
      if (nextPage === state.currentPage) return;
      event.preventDefault();
      gotoPage(nextPage, state.pages.length);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [gotoPage, isController, state.currentPage, state.pages.length]);

  const startClass = useCallback(async () => {
    // 挂了讲次的课次要先在服务端 resolve 模板+覆盖层冻结 courseware，
    // 成功后才广播 session_ctl:start（10-§5.4）；失败则留在候课页重试。
    setStarting(true);
    setStartError(false);
    try {
      const frozenRoster = await startClassSession(session.id);
      if (frozenRoster) setRosterState(frozenRoster);
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

  // 游戏镜像：100ms 合并窗口持续送出最新全量轻状态。不能用 trailing debounce：
  // iPad 连续点按若始终快于等待窗口，会让其他设备直到教师停手才看到变化。
  const mirrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMirror = useRef<{ pageId: string; mirror: GameMirrorState } | null>(null);
  const flushGameMirror = useCallback(() => {
    if (mirrorTimer.current) clearTimeout(mirrorTimer.current);
    mirrorTimer.current = null;
    const pendingState = pendingMirror.current;
    pendingMirror.current = null;
    if (pendingState) append("game_state", { pageId: pendingState.pageId, state: pendingState.mirror });
  }, [append]);
  const onGameMirror = useCallback((pageId: string, mirror: GameMirrorState) => {
    if (!classroomInteractionPayloadWithinBudget(CLASSROOM_GAME_MIRROR_SYNC_V1, mirror)) return;
    pendingMirror.current = { pageId, mirror };
    if (!mirrorTimer.current) mirrorTimer.current = setTimeout(flushGameMirror, 100);
  }, [flushGameMirror]);
  useEffect(() => {
    flushGameMirror();
  }, [flushGameMirror, state.currentPage]);
  useEffect(() => () => flushGameMirror(), [flushGameMirror]);

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
      router.push(`/dashboard/sessions/${session.id}?stage=post`);
    } finally {
      setEndOpen(false);
    }
  }, [append, router, session.id]);

  const reopenClass = useCallback(() => {
    append("session_ctl", { action: "start" });
    void reopenClassSession(session.id).catch(() => undefined);
  }, [append, session.id]);

  const confirmRosterRefresh = useCallback(async () => {
    if (!rosterState.hasDifference || rosterRefreshing) return;
    setRosterRefreshing(true);
    setRosterRefreshError(false);
    if (rehearsal && acceptanceFixture === "m4a") {
      setRosterState(m4aFixtures.refreshed);
      setRosterRefreshing(false);
      return;
    }
    try {
      const refreshed = await refreshSessionRoster(session.id, rosterState.currentSourceHash);
      setRosterState(refreshed);
      router.refresh();
    } catch {
      setRosterRefreshError(true);
    } finally {
      setRosterRefreshing(false);
    }
  }, [
    acceptanceFixture,
    m4aFixtures.refreshed,
    rehearsal,
    rosterRefreshing,
    rosterState.currentSourceHash,
    rosterState.hasDifference,
    router,
    session.id,
  ]);

  const resetM4aFixture = useCallback(() => {
    setRosterState(m4aFixtures.base);
    setRosterRefreshError(false);
    setStarWriteError(false);
    starQueueRef.current = starQueueRef.current.then(() => {
      const ledger = emptyStarLedger();
      starLedgerRef.current = ledger;
      setState((previous) => ({ ...previous, starLedger: ledger }));
    });
  }, [m4aFixtures.base]);

  const selectM4bScenario = useCallback((scenario: "8" | "20" | "30") => {
    setM4bScenario(scenario);
    setRosterState(m4bFixtures[scenario]);
    // The 30-seat fixture intentionally combines long copy, pending work and
    // an error indicator to verify that the control layout does not reflow.
    setPending(scenario === "30" ? 7 : 0);
    setStarWriteError(scenario === "30");
  }, [m4bFixtures]);

  const runM4aStarSequence = useCallback(() => {
    const run = async () => {
      const eventLog = logRef.current;
      if (!eventLog) return;
      const ledger = emptyStarLedger();
      starLedgerRef.current = ledger;
      setState((previous) => ({ ...previous, starLedger: ledger }));
      const reversedAwardId = newId();
      const activeAwardId = newId();
      const target = { schemaVersion: 2, studentId: M4A_STAR_STUDENT_ID };
      await eventLog.append("star_undo", { ...target, awardId: reversedAwardId });
      await eventLog.append("star", { ...target, awardId: reversedAwardId });
      await eventLog.append("star", { ...target, awardId: reversedAwardId });
      await eventLog.append("star", { ...target, awardId: activeAwardId });
    };
    starQueueRef.current = starQueueRef.current.then(run, run).catch(() => setStarWriteError(true));
  }, []);

  // --- 派生 ----------------------------------------------------------------
  const page = state.pages[state.currentPage] as CoursewarePage | undefined;
  const usingM3Fixture = rehearsal && inputV2Enabled && m3FixtureEnabled;
  const usingInteractionSyncFixture = acceptanceFixture === "interaction-sync";
  const activeToolId = usingM3Fixture || usingInteractionSyncFixture
    ? null
    : state.openTool;
  const renderPage = usingInteractionSyncFixture
    ? INTERACTION_SYNC_FIXTURE_PAGE
    : usingM3Fixture
      ? m3FixtureRenderer === "aixuexi" ? M3_AIXUEXI_H5_FIXTURE_PAGE : M3_H5_FIXTURE_PAGE
      : page;
  const activeDocBundleEntry = renderPage?.type === "doc"
    && !usingM3Fixture
    && !usingInteractionSyncFixture
    ? docBundle?.find((item) => item.pageDocId === renderPage.docId)
    : undefined;
  const renderDoc = renderPage?.type === "doc"
    ? usingInteractionSyncFixture
      ? INTERACTION_SYNC_FIXTURE_DOC
      : usingM3Fixture
        ? m3FixtureRenderer === "aixuexi" ? M3_AIXUEXI_H5_FIXTURE_DOC : M3_H5_FIXTURE_DOC
        : activeDocBundleEntry?.doc
    : undefined;
  const teachingSurface = resolveClassroomTeachingSurface();
  const renderDocUrls = usingM3Fixture
    ? m3FixtureRenderer === "aixuexi"
      ? m3AixuexiH5FixtureBindingUrls(m3H5Compatible)
      : m3H5FixtureBindingUrls(m3H5Compatible)
    : docUrls;
  const displayedSessionTitle = usingM3Fixture
    ? t("m3FixtureSessionTitle")
    : acceptanceFixture === "m4b" && m4bScenario === "30"
      ? t("m4bLongSessionTitle")
      : session.title || t("untitled");
  const h5FrameCount = countCoursewareH5Frames(renderDoc);
  const mainTool = useStore(mainStore ?? sideBoard.store, (boardState) => boardState.tool);
  const bridgeRoutingMode = resolveClassroomRoutingMode({
    smartEnabled: smartInputEnabled,
    smartAvailable: inputV2Enabled && isController,
    tool: mainTool === "pointer" ? "pointer" : "drawing",
  });
  const activateMainInput = useCallback(() => setActiveArea("main"), []);
  const {
    host: h5PointerBridge,
    status: h5PointerBridgeStatus,
  } = useH5PointerBridge({
    stageRef,
    inputPortRef: mainInputPortRef,
    enabled: h5PointerEnabled && inputV2Enabled && editable && h5FrameCount > 0,
    expectedFrameCount: h5FrameCount,
    mode: bridgeRoutingMode,
    tool: mainTool,
    gestureKey: renderPage?.id ?? "no-page",
    onInkStart: activateMainInput,
  });
  const rendererProfile = useMemo(
    () => resolveClassroomRendererInputProfile(
      renderPage,
      activeToolId,
      renderDoc,
      h5PointerBridgeStatus,
    ),
    [activeToolId, h5PointerBridgeStatus, renderDoc, renderPage],
  );
  const smartInputAvailable = inputV2Enabled && isController && rendererProfile.audited;
  const effectiveRoutingMode = resolveClassroomRoutingMode({
    smartEnabled: smartInputEnabled,
    smartAvailable: smartInputAvailable,
    tool: mainTool === "pointer" ? "pointer" : "drawing",
  });
  useClassroomPointerRouter({
    stageRef,
    inputPortRef: mainInputPortRef,
    enabled: inputV2Enabled
      && editable
      && rendererProfile.audited
      && effectiveRoutingMode === "smart"
      && mainTool === "pen",
    mode: effectiveRoutingMode,
    tool: mainTool,
    profile: rendererProfile,
    gestureKey: renderPage?.id ?? "no-page",
    onInkStart: activateMainInput,
  });
  const assetsReady = preload.done >= preload.total;
  const activeDocBindings = activeDocBundleEntry?.bindings;
  const activeDocAssetsLoading = renderPage?.type === "doc"
    && !usingM3Fixture
    && !usingInteractionSyncFixture
    && (
    !renderDoc
    || Boolean(
      activeDocBindings?.some((binding) => binding.kind !== "h5" && !docUrls[binding.bindingKey])
      && preload.done + preload.failed < preload.total,
    )
  );
  const h5PageCount = useMemo(() => countH5Pages(docBundle ?? []), [docBundle]);
  const onDocStep = useCallback((pageId: string, trigger: InteractionTrigger) => {
    append("doc_step", { pageId, scope: trigger.scope, id: trigger.id });
  }, [append]);
  const onlineIds = useMemo(() => new Set(onlinePeers.map((peer) => peer.userId)), [onlinePeers]);
  const classroomLearningSetup = useMemo(() => rehearsal
    ? buildRehearsalLearningSetup({
        persisted: learningSetup,
        pages: state.pages,
        roster: students,
        fallbackTitle: t("rehearsalLearningCheck"),
      })
    : learningSetup, [learningSetup, rehearsal, state.pages, students, t]);
  const classroomLearningSetupKey = useMemo(() => classroomLearningSetup
    ? [
        classroomLearningSetup.configured ? "configured" : "default",
        classroomLearningSetup.checks.map((check) => `${check.id}:${check.sourcePageId ?? "manual"}`).join(","),
        classroomLearningSetup.students.map((student) => `${student.id}:${student.seatPosition ?? "none"}`).join(","),
        classroomLearningSetup.results.map((result) => `${result.checkId}:${result.studentId}:${result.status}`).join(","),
      ].join("|")
    : "none", [classroomLearningSetup]);
  const initialLearningResults = useMemo(() => new Map(
    classroomLearningSetup?.results.map((result) => [
      learningResultKey(result.checkId, result.studentId),
      result.status,
    ]) ?? [],
  ), [classroomLearningSetup]);
  const activeLearningSummary = learningSummaryState?.setupKey === classroomLearningSetupKey
    ? learningSummaryState.snapshot
    : {
        checkId: classroomLearningSetup
          ? learningCheckIdAfterPageChange(classroomLearningSetup.checks, null, activePageDocId) ?? ""
          : "",
        results: initialLearningResults,
      };
  const initialLearningSeatPositions = useMemo(() => new Map(
    classroomLearningSetup?.students.flatMap((student) => student.seatPosition === null
      ? []
      : [[student.id, student.seatPosition] as const]) ?? [],
  ), [classroomLearningSetup]);
  const activeLearningSeatPositions = learningSeatState?.setupKey === classroomLearningSetupKey
    ? learningSeatState.positions
    : initialLearningSeatPositions;
  const handleLearningSummaryChange = useCallback((snapshot: LearningCheckSummarySnapshot) => {
    setLearningSummaryState({ setupKey: classroomLearningSetupKey, snapshot });
  }, [classroomLearningSetupKey]);
  const handleLearningSeatOrderChange = useCallback((assignments: Array<{ studentId: string; position: number }>) => {
    setLearningSeatState({
      setupKey: classroomLearningSetupKey,
      positions: new Map(assignments.map((assignment) => [assignment.studentId, assignment.position])),
    });
  }, [classroomLearningSetupKey]);
  const visibleStudents = useMemo(
    () => (myRole === "student" && !showAllStudents ? students.filter((student) => student.userId === userId) : students),
    [myRole, showAllStudents, students, userId],
  );
  const rosterGridStudents: ClassroomRosterStudent[] = students.map((student) => {
    const answered = state.quiz && student.userId
      ? state.answers[state.quiz.id]?.[student.userId]
      : undefined;
    return {
      ...student,
      seatPosition: activeLearningSeatPositions.get(student.studentId) ?? student.seatPosition,
      name: student.name || t("anonymous"),
      count: starCountForRosterEntry(state.starLedger, student),
      hand: Boolean(student.userId && state.hands[student.userId]),
      online: Boolean(student.userId && onlineIds.has(student.userId)),
      answerLabel: answered === undefined ? null : isController ? OPTION_LABELS[answered] ?? "?" : "✓",
      learningStatus: activeLearningSummary.checkId
        ? activeLearningSummary.results.get(learningResultKey(activeLearningSummary.checkId, student.studentId)) ?? "unchecked"
        : null,
      interactive: editable && (starEventSchema === 2 || student.userId !== null),
    };
  });
  const m4aStarStudent = students.find((student) => student.studentId === M4A_STAR_STUDENT_ID);
  const m4aStarCount = m4aStarStudent
    ? starCountForRosterEntry(state.starLedger, m4aStarStudent)
    : 0;
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
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full bg-moon/40 px-2 py-0.5 text-ink" title={t("rehearsalHint")}>
        {t("rehearsalBadge")}
      </span>
      {pending > 0 && (
        <span className="rounded-full bg-crater/10 px-2 py-0.5 text-crater" title={t("pendingHint")}>
          {t("pending", { count: pending })}
        </span>
      )}
    </div>
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

  const rosterDifferenceNotice = isController && rosterState.hasDifference ? (
    <section
      className="mt-2 flex shrink-0 flex-wrap items-center gap-3 rounded-xl border border-crater/35 bg-crater/8 px-3 py-2"
      data-m4-roster-difference
      aria-live="polite"
    >
      <TriangleAlert size={17} className="shrink-0 text-crater" />
      <div className="min-w-48 flex-1">
        <p className="text-sm font-medium text-ink">{t("rosterDifferenceTitle")}</p>
        <p className="text-xs text-muted">
          {t("rosterDifferenceBody", {
            revision: rosterState.revision ?? 0,
            count: rosterState.entries.length,
          })}
        </p>
        {rosterRefreshError && <p className="mt-1 text-xs text-rose">{t("rosterRefreshFailed")}</p>}
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={rosterRefreshing}
        onClick={() => void confirmRosterRefresh()}
      >
        {rosterRefreshing && <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" />}
        {t("confirmRosterRefresh")}
      </Button>
    </section>
  ) : null;

  const courseStatusLabel = starWriteError
    ? t("m4bStatusError")
    : pending > 0
      ? t("pending", { count: pending })
      : rehearsal
        ? t("rehearsalBadge")
        : offlineDrill
          ? t("offlineDrillBadge")
          : t2Connected
            ? t("online")
            : t("offline");
  const teacherLayoutAlertContent = starWriteError || rosterState.hasDifference ? (
    <div className="space-y-3" aria-live="polite">
      {starWriteError && (
        <p className="rounded-xl border border-rose/30 bg-rose/5 px-3 py-2 text-xs text-rose" role="alert">
          {t("starWriteFailed")}
        </p>
      )}
      {rosterState.hasDifference && (
        <section className="space-y-2">
          <div>
            <p className="text-sm font-medium text-ink">{t("rosterDifferenceTitle")}</p>
            <p className="text-xs text-muted">
              {t("rosterDifferenceBody", {
                revision: rosterState.revision ?? 0,
                count: rosterState.entries.length,
              })}
            </p>
            {rosterRefreshError && <p className="mt-1 text-xs text-rose">{t("rosterRefreshFailed")}</p>}
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={rosterRefreshing}
            onClick={() => void confirmRosterRefresh()}
          >
            {rosterRefreshing && <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" />}
            {t("confirmRosterRefresh")}
          </Button>
        </section>
      )}
    </div>
  ) : null;

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

        {rosterDifferenceNotice}

        {attendanceSuggested && (
          <section className="mt-8 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-card p-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-medium">{tPrep("attendanceStepTitle")}</h2>
              <p className="mt-1 text-xs text-muted">
                {attendanceSaved ? tPrep("attendanceComplete") : tPrep("attendanceStepBody")}
              </p>
            </div>
            {attendanceSaved
              ? <Badge variant="secondary">{tPrep("attendanceDone")}</Badge>
              : <AttendanceDrawer sessionId={session.id} appearance="primary" onSaved={() => setAttendanceSaved(true)} />}
          </section>
        )}

        <h2 className={attendanceSuggested ? "mt-6 text-sm font-medium text-muted" : "mt-8 text-sm font-medium text-muted"}>{tPrep("title")}</h2>
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
                disabled={starting}
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
    <div className={cn(
      "relative isolate flex h-dvh flex-col overflow-hidden px-3 pt-2",
      teacherLayoutV2 ? "pb-[calc(4.25rem+env(safe-area-inset-bottom))]" : "pb-2",
    )} data-classroom-live-shell>
      <ClassroomBackdrop />

      {!teacherLayoutV2 && <header className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl bg-paper/95 px-1 shadow-sm">
        <Link
          href={`/classroom/${classId}/session/${session.id}`}
          aria-label={t("exit")}
          className="rounded-full p-1.5 text-muted transition-colors hover:bg-moon/30 hover:text-ink"
        >
          <ArrowLeft size={17} />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{displayedSessionTitle}</h1>
        {isController && inputV2Enabled && (
          <ClassroomSmartInputToggle
            enabled={smartInputEnabled}
            available={smartInputAvailable}
            onChange={setSmartInputEnabled}
          />
        )}
        {connectionBadges}
        {isController && !state.ended && !rehearsal && (
          <ClassroomEndButton
            label={t("endClass")}
            onClick={() => setEndOpen(true)}
          />
        )}
        <span className="font-mono text-xs text-muted">
          {state.pages.length === 0 ? "0 / 0" : `${state.currentPage + 1} / ${state.pages.length}`}
        </span>
      </header>}

      {!teacherLayoutV2 && rosterDifferenceNotice}
      {!teacherLayoutV2 && starWriteError && isController && (
        <p className="mt-2 rounded-xl border border-rose/30 bg-rose/5 px-3 py-2 text-xs text-rose" role="alert">
          {t("starWriteFailed")}
        </p>
      )}

      {rehearsal && isController && layoutV2Enabled && acceptanceFixture === "m4a" && (
        <DevelopmentAcceptanceDock
          title={t("m4AcceptanceTitle")}
          collapseLabel={t("acceptanceDockCollapse")}
          expandLabel={t("acceptanceDockExpand")}
        >
          <section aria-label={t("m4AcceptanceTitle")} className="grid gap-2" data-m4-acceptance>
            <div className="rounded-lg bg-leaf/5 p-3" data-m4-roster-identity>
              <p className="font-medium text-ink">{t("m4RosterObjectTitle")}</p>
              <p className="mt-1 text-muted">{t("m4RosterObjectBody")}</p>
              <p className="mt-2 font-mono text-[11px] text-ink">
                {t("m4RosterObjectState", {
                  revision: rosterState.revision ?? 0,
                  count: rosterState.entries.length,
                  seat: m4aStarStudent?.seatPosition ?? "—",
                })}
              </p>
            </div>
            <div className="rounded-lg bg-leaf/5 p-3" data-m4-star-set>
              <p className="font-medium text-ink">{t("m4StarObjectTitle")}</p>
              <p className="mt-1 text-muted">{t("m4StarObjectBody")}</p>
              <p className="mt-2 font-mono text-[11px] text-ink">{t("m4StarObjectState", { count: m4aStarCount })}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" disabled={!log} onClick={runM4aStarSequence}>
                  {t("m4InjectReverseDuplicate")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={!log || !m4aStarStudent || m4aStarCount === 0}
                  onClick={() => m4aStarStudent && appendStar(m4aStarStudent, "undo")}
                >
                  {t("m4UndoConcreteAward")}
                </Button>
              </div>
            </div>
            <div className="rounded-lg bg-leaf/5 p-3" data-m4-roster-refresh>
              <p className="font-medium text-ink">{t("m4RefreshObjectTitle")}</p>
              <p className="mt-1 text-muted">{t("m4RefreshObjectBody")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={rosterState.hasDifference}
                  onClick={() => setRosterState(m4aFixtures.changed)}
                >
                  {t("m4SimulateRosterChange")}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={resetM4aFixture}>
                  {t("m4ResetAcceptance")}
                </Button>
              </div>
            </div>
          </section>
        </DevelopmentAcceptanceDock>
      )}

      {rehearsal && isController && inputV2Enabled && acceptanceFixture === "m3b" && (
        <DevelopmentAcceptanceDock
          title={t("m3AcceptanceTitle")}
          collapseLabel={t("acceptanceDockCollapse")}
          expandLabel={t("acceptanceDockExpand")}
        >
          <section aria-label={t("m3AcceptanceTitle")} className="flex flex-col gap-2" data-m3-acceptance>
          <div className="rounded-lg bg-blue/5 p-2">
            <p className="font-medium text-ink">{t("m3AcceptanceTitle")}</p>
            <p className="mt-0.5 text-muted">{t("m3AcceptanceBody")}</p>
          </div>
          <div
            role="group"
            aria-label={t("m3FixtureGroup")}
            className="flex items-center gap-1.5"
          >
            <Button
              type="button"
              size="sm"
              variant={usingM3Fixture && m3H5Compatible && m3FixtureRenderer === "mofaxiao" ? "primary" : "secondary"}
              aria-pressed={usingM3Fixture && m3H5Compatible && m3FixtureRenderer === "mofaxiao"}
              data-m3-h5-fixture="mofaxiao"
              onClick={() => {
                setM3FixtureEnabled(true);
                setM3FixtureRenderer("mofaxiao");
                setM3H5Compatible(true);
                setSmartInputEnabled(true);
              }}
            >
              {t("h5MofaxiaoFixture")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={usingM3Fixture && m3H5Compatible && m3FixtureRenderer === "aixuexi" ? "primary" : "secondary"}
              aria-pressed={usingM3Fixture && m3H5Compatible && m3FixtureRenderer === "aixuexi"}
              data-m3-h5-fixture="aixuexi"
              onClick={() => {
                setM3FixtureEnabled(true);
                setM3FixtureRenderer("aixuexi");
                setM3H5Compatible(true);
                setSmartInputEnabled(true);
              }}
            >
              {t("h5AixuexiFixture")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={usingM3Fixture && !m3H5Compatible ? "primary" : "secondary"}
              aria-pressed={usingM3Fixture && !m3H5Compatible}
              data-m3-h5-fixture="incompatible"
              onClick={() => {
                setM3FixtureEnabled(true);
                setM3H5Compatible(false);
                setSmartInputEnabled(true);
              }}
            >
              {t("h5UnregisteredFixture")}
            </Button>
          </div>
          <Badge variant={h5PointerBridgeStatus === "ready" ? "default" : "secondary"}>
            {t(`h5BridgeStatus.${h5PointerBridgeStatus}`)}
          </Badge>
          <ol className="grid min-w-0 flex-[2] basis-full gap-1 sm:grid-cols-3 lg:basis-auto">
            <li className="rounded-lg bg-paper/80 px-2 py-1.5 text-muted">
              <span className="mr-1 font-mono text-ink">1</span>
              {t("h5CheckTap")}
            </li>
            <li className="rounded-lg bg-paper/80 px-2 py-1.5 text-muted">
              <span className="mr-1 font-mono text-ink">2</span>
              {t("h5CheckTakeover")}
            </li>
            <li className="rounded-lg bg-paper/80 px-2 py-1.5 text-muted">
              <span className="mr-1 font-mono text-ink">3</span>
              {t("h5CheckReloadFallback")}
            </li>
          </ol>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-m3-fixture-toggle
            onClick={() => {
              setM3FixtureEnabled(false);
            }}
          >
            {t("m3ReturnCourseware")}
          </Button>
          </section>
        </DevelopmentAcceptanceDock>
      )}

      {rehearsal && layoutV2Enabled && acceptanceFixture === "m4b" && (
        <DevelopmentAcceptanceDock
          title={t("m4bAcceptanceTitle")}
          collapseLabel={t("acceptanceDockCollapse")}
          expandLabel={t("acceptanceDockExpand")}
        >
          <section aria-label={t("m4bAcceptanceTitle")} className="space-y-3" data-m4b-acceptance>
            <div className="rounded-lg bg-blue/5 p-2">
              <p className="font-medium text-ink">{t("m4bAcceptanceBody")}</p>
              <p className="mt-1 text-muted">{t("m4bAcceptanceNoReflow")}</p>
            </div>
            <div data-m4b-roster-scenarios>
              <p className="mb-1 font-medium text-ink">{t("m4bRosterScenarios")}</p>
              <div className="flex flex-wrap gap-1.5">
                {(["8", "20", "30"] as const).map((scenario) => (
                  <Button
                    key={scenario}
                    type="button"
                    size="sm"
                    variant={m4bScenario === scenario ? "primary" : "secondary"}
                    aria-pressed={m4bScenario === scenario}
                    onClick={() => selectM4bScenario(scenario)}
                  >
                    {t("m4bStudentScenario", { count: Number(scenario) })}
                  </Button>
                ))}
              </div>
              <p className="mt-1 text-muted">
                {m4bScenario === "30" ? t("m4bStressState") : t("m4bBaselineState", { count: Number(m4bScenario) })}
              </p>
              <p className="mt-1 text-muted">{t("m4bRewardState")}</p>
              <p className="mt-1 text-muted">{t("m4bLearningState")}</p>
              <p className="mt-1 text-muted">{t("m4bInfoState")}</p>
              <p className="mt-1 text-muted">{t("m4bBottomState")}</p>
            </div>
            <div data-m4b-role-isolation>
              <p className="mb-1 font-medium text-ink">{t("m4bRoleIsolation")}</p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  const query = isController
                    ? "?mode=rehearsal&acceptance=m4b&role=display"
                    : "?mode=rehearsal&acceptance=m4b";
                  window.open(`${window.location.pathname}${query}`, "_blank");
                }}
              >
                {isController ? t("m4bOpenDisplay") : t("m4bOpenControl")}
              </Button>
              <p className="mt-1 text-muted">{t("m4bRoleIsolationHint")}</p>
            </div>
          </section>
        </DevelopmentAcceptanceDock>
      )}

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

      <div className={cn(
        "mt-2 min-h-0 flex-1 gap-2",
        teacherLayoutV2
          ? "flex flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_clamp(22rem,31vw,36rem)] lg:gap-3 lg:overflow-hidden"
          : "flex flex-col overflow-y-auto lg:flex-row lg:gap-3 lg:overflow-hidden",
      )}>
        {/* 左：4:3 课件层 + 主板书覆盖层，尽量占满可压缩空间（08-§3.2 归一化坐标） */}
        <main className={cn(
          "relative flex min-w-0 shrink-0 items-center justify-center lg:min-h-0 lg:flex-1 lg:shrink",
          teacherLayoutV2 && "min-h-[min(50dvh,32rem)] [container-type:size] lg:min-h-0",
        )}>
          <div
            ref={stageRef}
            className={cn(
              "relative aspect-[4/3] overflow-hidden rounded-2xl border border-line bg-card",
              teacherLayoutV2 ? "max-h-full max-w-full" : "w-full",
            )}
            data-classroom-stage
            {...classroomInputProviderAttributes(rendererProfile.renderer, rendererProfile.provider)}
            style={{
              ...teachingSurface.surfaceStyle,
              ...(teacherLayoutV2
                ? {
                  width: "min(100cqw, calc(100cqh * 4 / 3))",
                  height: "min(100cqh, calc(100cqw * 3 / 4))",
                }
                : { width: "min(100%, calc((100dvh - 6rem) * 4 / 3))" }),
            }}
            data-classroom-teaching-surface={teachingSurface.theme}
            data-classroom-teaching-surface-scope={teachingSurface.scope}
            onPointerDownCapture={() => setActiveArea("main")}
          >
            {!renderPage ? (
              <p className="grid size-full place-items-center text-sm text-muted">{t("noPages")}</p>
            ) : renderPage.type === "image" ? (
              assetUrls[renderPage.path] ? (
                // 离线舞台：预载 blob 直出，不走 next/image 优化器（08-§3.6 豁免）
                // eslint-disable-next-line @next/next/no-img-element
                <img src={assetUrls[renderPage.path]} alt={renderPage.title} className="size-full object-contain" />
              ) : (
                <p className="grid size-full place-items-center text-sm text-muted">{t("assetMissing")}</p>
              )
            ) : renderPage.type === "video" ? (
              assetUrls[renderPage.path] ? (
                <VideoStage
                  pageId={renderPage.id}
                  src={assetUrls[renderPage.path] ?? ""}
                  controller={isController}
                  ctl={state.video[renderPage.id]}
                  onCtl={(action, time) => append("video_ctl", { pageId: renderPage.id, action, time })}
                  log={log}
                />
              ) : (
                <p className="grid size-full place-items-center text-sm text-muted">{t("assetMissing")}</p>
              )
            ) : renderPage.type === "game" ? (
              <GamePage
                key={`game-${renderPage.id}`}
                page={renderPage}
                isController={isController}
                mirror={state.games[renderPage.id] ?? null}
                onMirror={onGameMirror}
              />
            ) : renderPage.type === "doc" ? (
              activeDocAssetsLoading ? (
                <p className="grid size-full place-items-center text-sm text-muted">
                  <span className="inline-flex items-center gap-2">
                    <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" />
                    {t("assetLoading")}
                  </span>
                </p>
              ) : <DocCoursewarePage
                key={`doc-${renderPage.id}:${usingM3Fixture ? `${m3FixtureRenderer}:${Number(m3H5Compatible)}` : "courseware"}`}
                doc={renderDoc ?? null}
                bindingUrls={renderDocUrls}
                isController={isController}
                steps={state.docSteps[renderPage.id]}
                onStep={(trigger) => onDocStep(renderPage.id, trigger)}
                videoCtl={state.video[renderPage.id]}
                onVideoCtl={(action, time) => append("video_ctl", { pageId: renderPage.id, action, time })}
                onAdvance={() => gotoPage(state.currentPage + 1, state.pages.length)}
                h5PointerBridge={h5PointerBridge}
                gameMirror={state.games[renderPage.id] ?? null}
                onGameMirror={(mirror) => onGameMirror(renderPage.id, mirror)}
              />
            ) : null}

            {renderPage && (
              <MainBoard
                key={`board-${renderPage.id}`}
                log={log}
                boardKey={renderPage.id}
                editable={editable}
                initialItems={state.boards[renderPage.id]}
                strokeWidthBasis={stageWidth}
                cursorName={selfName}
                checkpointV2Writer={checkpointV2Writer}
                initialCheckpoint={checkpointByBoard.get(renderPage.id)}
                inputMode={effectiveRoutingMode}
                onInputPort={onMainInputPort}
                onStore={setMainStore}
                foreground={Boolean(activeToolId) && rendererProfile.audited}
              />
            )}

            {activeToolId && (
              <ToolOverlay
                toolId={activeToolId}
                onClose={isController
                  ? () => append("tool_ctl", { action: "close" })
                  : undefined}
              />
            )}

            {!isController && renderPage?.type === "doc" && <div aria-hidden="true" className="absolute inset-0 z-40 touch-none" />}
          </div>

          {isController && toolbarStore && !teacherLayoutV2 && (
            <div className="absolute bottom-3 left-1/2 z-50 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center">
              <Toolbar
                title={`${displayedSessionTitle}-${renderPage?.title ?? ""}`}
                store={toolbarStore}
                clearTargets={clearTargets}
                swatchStyle={teachingSurface.paletteStyle}
              />
            </div>
          )}
        </main>

        {/* 右：副板书（长条，固定宽，用户 2026-07-08 要求加宽一倍）+ 学生名录（固定宽，容纳多人）+ 控制条，三段式 */}
        <div
          className={cn(
            teacherLayoutV2
              ? "grid min-h-[30rem] w-full flex-none gap-2 bg-transparent lg:min-h-0"
              : "flex min-h-0 w-full flex-1 flex-col gap-2 rounded-2xl bg-paper/95 shadow-sm transition-[width] duration-200 lg:ml-auto lg:flex-none lg:shrink-0",
            // 分栏阈值从 xl 提到 lg（doc 27 §5.1 H4）：1024 横屏是直播课堂最典型的教师终端，
            // 原先落在 xl 之下，主板书、副板书、名录与控制条全部纵向堆叠，上课要滚动才看得到名录。
            // 但 1024 上留 34rem 会把主板书压到 480px，所以两栏全展开时 lg 档先给 26rem，xl 才放到 34rem。
            teacherLayoutV2
              ? sideCollapsed
                ? "grid-rows-[2.5rem_2.75rem_minmax(0,1fr)]"
                : "grid-rows-[2.5rem_minmax(8rem,1fr)_17.5rem]"
              : sideCollapsed && rosterCollapsed
                ? "lg:w-[5.25rem]"
                : sideCollapsed
                  ? "lg:w-[16rem] xl:w-[18rem]"
                  : rosterCollapsed
                    ? "lg:w-[18rem] xl:w-[22rem]"
                    : "lg:w-[26rem] xl:w-[34rem]",
          )}
          data-classroom-right-stack-surface={teacherLayoutV2 ? "transparent" : "paper"}
        >
          {teacherLayoutV2 && (
            <ClassroomCourseInfoBar
              backHref={`/classroom/${classId}/session/${session.id}`}
              exitLabel={t("exit")}
              title={displayedSessionTitle}
              statusLabel={courseStatusLabel}
              statusDetails={connectionBadges}
              pageLabel={state.pages.length === 0 ? "0/0" : `${state.currentPage + 1}/${state.pages.length}`}
              alertLabel={teacherLayoutAlertContent ? t("m4bOpenAlerts") : undefined}
              alertContent={teacherLayoutAlertContent}
              endLabel={t("endClass")}
              endDisabled={rehearsal || state.ended}
              onEnd={() => setEndOpen(true)}
            />
          )}
          <div className={teacherLayoutV2 ? "contents" : "flex min-h-0 flex-1 flex-col gap-2 lg:flex-row lg:justify-end"}>
            {/* 副板书：默认展开固定宽；折叠为窄条腾出空间；名录折叠时改吃 flex-1（用户 2026-07-08 要求可折叠） */}
            <div
              className={cn(
                "relative min-h-0 overflow-hidden rounded-2xl border border-line bg-card transition-[width,height] duration-150",
                teacherLayoutV2
                  ? sideCollapsed ? "h-11" : "h-full"
                  : sideCollapsed
                  ? "h-9 shrink-0 lg:h-auto lg:w-10"
                  : rosterCollapsed
                    ? "flex-1"
                    : "min-h-48 flex-1 lg:w-[14rem] lg:flex-none xl:w-[18rem]",
              )}
              style={teachingSurface.surfaceStyle}
              data-classroom-teaching-surface={teachingSurface.theme}
              onPointerDownCapture={() => !sideCollapsed && setActiveArea("side")}
            >
              {!sideCollapsed && (
                <div
                  ref={sideViewportRef}
                  className="absolute inset-0 overflow-auto overscroll-contain touch-pan-x"
                  data-side-board-viewport
                  onWheelCapture={() => !isController && setSideFollow(false)}
                  onPointerDownCapture={() => !isController && setSideFollow(false)}
                >
                  <div
                    className="relative mx-auto aspect-[2/5] min-h-full min-w-full bg-card"
                    style={{ width: `${sideZoom * 100}%` }}
                  >
                    <CanvasSurface editable={editable} store={sideBoard.store} bus={sideBoard.bus} strokeWidthBasis={stageWidth} renderProfile="classroom" />
                  </div>
                </div>
              )}
              <div className="absolute right-1 top-1 z-10 flex items-center gap-1">
                {!sideCollapsed && (
                  <>
                    {!isController && (
                      <button
                        type="button"
                        aria-pressed={sideFollow}
                        onClick={() => setSideFollow((follow) => !follow)}
                        aria-label={sideFollow ? t("pauseSideFollow") : t("resumeSideFollow")}
                        title={sideFollow ? t("pauseSideFollow") : t("resumeSideFollow")}
                        className={cn(
                          "rounded-full bg-card/90 p-1 shadow-sm transition-colors hover:bg-moon/40 hover:text-ink",
                          sideFollow ? "text-crater" : "text-muted",
                        )}
                      >
                        <LocateFixed size={14} />
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={sideZoom <= 1}
                      onClick={() => setSideZoom((zoom) => Math.max(1, zoom - 0.25))}
                      aria-label={t("zoomOutSide")}
                      title={t("zoomOutSide")}
                      className="rounded-full bg-card/90 p-1 text-muted shadow-sm transition-colors hover:bg-moon/40 hover:text-ink disabled:opacity-35"
                    >
                      <ZoomOut size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={sideZoom >= 2}
                      onClick={() => setSideZoom((zoom) => Math.min(2, zoom + 0.25))}
                      aria-label={t("zoomInSide")}
                      title={t("zoomInSide")}
                      className="rounded-full bg-card/90 p-1 text-muted shadow-sm transition-colors hover:bg-moon/40 hover:text-ink disabled:opacity-35"
                    >
                      <ZoomIn size={14} />
                    </button>
                  </>
                )}
                {myRole === "teacher" && <button
                  type="button"
                  onClick={() => {
                    setSideCollapsed((collapsed) => !collapsed);
                    // 收起时若工具条正指向副板书，收回主板书——不留一个看不见的操作目标
                    setActiveArea((area) => (area === "side" ? "main" : area));
                  }}
                  aria-label={sideCollapsed ? t("expandSide") : t("collapseSide")}
                  title={sideCollapsed ? t("expandSide") : t("collapseSide")}
                  className="rounded-full bg-card/90 p-1 text-muted shadow-sm transition-colors hover:bg-moon/40 hover:text-ink"
                >
                  {sideCollapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
                </button>}
              </div>
            </div>
            {/* 名录：默认展开吃满剩余宽度；折叠为窄条，副板书自动接手空间 */}
            {teacherLayoutV2 ? (
              <ClassroomRosterGrid
                students={rosterGridStudents}
                rosterLabel={t("roster", { count: students.length })}
                emptySeatLabel={(seat) => t("emptySeatLabel", { seat })}
                starTotalLabel={(name, count) => t("studentStarTotal", { name, count })}
                awardStarLabel={(name, count) => t("awardStarLabel", { name, count })}
                undoStarLabel={(name, count) => t("undoStarLabel", { name, count })}
                undoHint={t("undoStar")}
                onStar={(student) => appendStar(student, "award")}
                onUndo={(student) => appendStar(student, "undo")}
              />
            ) : (
            <div
              className={cn(
                "flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line transition-[width,height] duration-150",
                rosterCollapsed ? "h-9 shrink-0 lg:h-auto lg:w-10" : "max-h-28 shrink-0 lg:max-h-none lg:w-44 lg:flex-none xl:w-60",
              )}
            >
              <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
                {!rosterCollapsed && (
                  <p className="min-w-0 flex-1 truncate text-xs text-muted">{t("roster", { count: students.length })}</p>
                )}
                {!rosterCollapsed && myRole === "student" && students.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setShowAllStudents((show) => !show)}
                    className="shrink-0 rounded-full px-2 py-1 text-[11px] text-muted transition-colors hover:bg-moon/30 hover:text-ink"
                  >
                    {showAllStudents ? t("showSelfOnly") : t("showClassmates")}
                  </button>
                )}
                {myRole === "teacher" && <button
                  type="button"
                  onClick={() => setRosterCollapsed((collapsed) => !collapsed)}
                  aria-label={rosterCollapsed ? t("expandRoster") : t("collapseRoster")}
                  title={rosterCollapsed ? t("expandRoster") : t("collapseRoster")}
                  className="ml-auto shrink-0 rounded-full p-1 text-muted transition-colors hover:bg-moon/40 hover:text-ink"
                >
                  {rosterCollapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
                </button>}
              </div>
              {!rosterCollapsed && (
                <ul className="flex min-h-0 flex-1 gap-1.5 overflow-x-auto p-1.5 [&>li]:min-w-48 lg:block lg:space-y-1 lg:overflow-y-auto lg:[&>li]:min-w-0">
                  {visibleStudents.map((student) => {
                    const count = starCountForRosterEntry(state.starLedger, student);
                    const answered = state.quiz && student.userId
                      ? state.answers[state.quiz.id]?.[student.userId]
                      : undefined;
                    return (
                      <StudentCard
                        key={student.studentId}
                        name={student.name || t("anonymous")}
                        count={count}
                        hand={Boolean(student.userId && state.hands[student.userId])}
                        online={Boolean(student.userId && onlineIds.has(student.userId))}
                        answerLabel={
                          answered === undefined ? null : isController ? OPTION_LABELS[answered] ?? "?" : "✓"
                        }
                        interactive={editable && (starEventSchema === 2 || student.userId !== null)}
                        undoHint={t("undoStar")}
                        onStar={() => appendStar(student, "award")}
                        onUndo={() => appendStar(student, "undo")}
                      />
                    );
                  })}
                </ul>
              )}
            </div>
            )}
          </div>

          {/* 控制条：翻页/插页/工具/发题（教师）或举手/作答（学生），紧贴副板书+名录下方，老师操作更方便 */}
          {showControlBar && !teacherLayoutV2 && (
            <div className="flex shrink-0 flex-col gap-1.5 rounded-2xl border border-line p-2" data-classroom-control-bar="panel">
              {isController && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <ClassroomPageControls
                    pages={state.pages}
                    currentPage={state.currentPage}
                    onGoto={(nextPage) => gotoPage(nextPage, state.pages.length)}
                  />
                  {classroomLearningSetup && classroomLearningSetup.checks.length > 0 && (
                    <SessionLearningCheckPanel
                      key={classroomLearningSetupKey}
                      sessionId={session.id}
                      setup={classroomLearningSetup}
                      activePageDocId={activePageDocId}
                      ephemeral={rehearsal}
                      onSummaryChange={handleLearningSummaryChange}
                      onSeatOrderChange={handleLearningSeatOrderChange}
                    />
                  )}
                  {!state.ended && state.quiz && (
                    <button
                      type="button"
                      onClick={() => append("session_ctl", { action: "quiz_close", quizId: state.quiz?.id })}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-ink px-3 text-xs text-paper transition-opacity hover:opacity-85"
                    >
                      <SquareCheckBig size={14} />
                      {t("quizClose")}
                    </button>
                  )}
                  {!state.ended && (
                    <ClassroomToolsMenu
                      open={classroomToolsOpen}
                      quizOpen={Boolean(state.quiz)}
                      onOpenChange={setClassroomToolsOpen}
                      onInsertBoard={() => {
                        setClassroomToolsOpen(false);
                        insertBoardPage();
                      }}
                      onOpenTool={(toolId) => {
                        setClassroomToolsOpen(false);
                        append("tool_ctl", { action: "open", toolId });
                      }}
                      onOpenQuiz={(options) => {
                        setClassroomToolsOpen(false);
                        append("session_ctl", { action: "quiz_open", quizId: newId(), options });
                      }}
                    />
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

      {teacherLayoutV2 && showControlBar && (
        <TeacherClassroomControlBar
          inputControls={inputV2Enabled ? (
            <ClassroomSmartInputToggle
              enabled={smartInputEnabled}
              available={smartInputAvailable}
              onChange={setSmartInputEnabled}
            />
          ) : null}
          utilityControls={(
            <div className="flex shrink-0 items-center gap-0.5" data-classroom-rail-group="classroom-actions">
              {classroomLearningSetup && classroomLearningSetup.checks.length > 0 && (
                <SessionLearningCheckPanel
                  key={classroomLearningSetupKey}
                  sessionId={session.id}
                  setup={classroomLearningSetup}
                  activePageDocId={activePageDocId}
                  attendanceRows={initialAttendanceRows}
                  attendanceIntegrated
                  ephemeral={rehearsal}
                  triggerVariant="rail"
                  onSummaryChange={handleLearningSummaryChange}
                  onSeatOrderChange={handleLearningSeatOrderChange}
                />
              )}
              {!state.ended && state.quiz && (
                <button
                  type="button"
                  title={t("quizClose")}
                  onClick={() => append("session_ctl", { action: "quiz_close", quizId: state.quiz?.id })}
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-moon/60 text-ink transition-colors hover:bg-moon/80"
                  data-classroom-rail-button="quiz-close"
                >
                  <SquareCheckBig aria-hidden size={18} />
                  <span className="sr-only">{t("quizClose")}</span>
                </button>
              )}
              {!state.ended && (
                <ClassroomToolsMenu
                  open={classroomToolsOpen}
                  quizOpen={Boolean(state.quiz)}
                  largeTarget
                  rail
                  align="end"
                  onOpenChange={setClassroomToolsOpen}
                  onInsertBoard={() => {
                    setClassroomToolsOpen(false);
                    insertBoardPage();
                  }}
                  onOpenTool={(toolId) => {
                    setClassroomToolsOpen(false);
                    append("tool_ctl", { action: "open", toolId });
                  }}
                  onOpenQuiz={(options) => {
                    setClassroomToolsOpen(false);
                    append("session_ctl", { action: "quiz_open", quizId: newId(), options });
                  }}
                />
              )}
            </div>
          )}
          drawingControls={toolbarStore ? (
            <Toolbar
              largeTargets
              variant="rail"
              title={`${displayedSessionTitle}-${renderPage?.title ?? ""}`}
              store={toolbarStore}
              clearTargets={clearTargets}
              className="h-11"
              swatchStyle={teachingSurface.paletteStyle}
            />
          ) : null}
          pageControls={(
            <ClassroomPageControls
              pages={state.pages}
              currentPage={state.currentPage}
              largeTargets
              rail
              onGoto={(nextPage) => gotoPage(nextPage, state.pages.length)}
            />
          )}
        />
      )}

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
