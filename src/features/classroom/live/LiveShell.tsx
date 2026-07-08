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
  LoaderCircle,
  Minus,
  MonitorPlay,
  Star,
  TriangleAlert,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { games } from "@/features/games/registry";
import { createClient } from "@/lib/supabase/client";
import { startClassSession } from "../actions";
import { downloadCoursewareAsset } from "../courseware/upload";
import { SessionEventLog } from "../sync/eventlog";
import { flushOutbox, pendingCount } from "../sync/flush";
import { STORE_ASSETS, idbGet, idbPut } from "../sync/idb";
import { createLocalTransport, createRealtimeTransport } from "../sync/transports";
import type { ClassroomMember, ClassSessionRecord, CoursewarePage, SessionEvent } from "../types";

// 上课壳（08-§3.4）：候课（预载/自检）→ 上课 全程页内状态切换，零路由跳转。
// P4-4 为最小闭环：课件展示 + 翻页 + 加星；正式舞台布局与互动面板在 P4-5。

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
}

interface LiveState {
  currentPage: number;
  stars: Record<string, number>;
  started: boolean;
}

function reduceEvent(state: LiveState, ev: SessionEvent): LiveState {
  switch (ev.type) {
    case "page": {
      const page = Number(ev.payload.page);
      return Number.isFinite(page) ? { ...state, currentPage: page } : state;
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
    case "session_ctl":
      return ev.payload.action === "start" ? { ...state, started: true } : state;
    default:
      return state;
  }
}

export function LiveShell({ session, classId, members, myRole, userId, initialEvents, role }: Props) {
  const t = useTranslations("classroom.live");
  const tPrep = useTranslations("classroom.prep");
  const pages = session.courseware;
  const students = useMemo(() => members.filter((member) => member.role === "student"), [members]);

  const initialState = useMemo<LiveState>(() => {
    let state: LiveState = { currentPage: session.currentPage, stars: {}, started: Boolean(session.startedAt) };
    for (const ev of initialEvents) state = reduceEvent(state, ev);
    return state;
  }, [session.currentPage, session.startedAt, initialEvents]);

  const mediaPages = useMemo(
    () => pages.filter((page): page is Extract<CoursewarePage, { path: string }> =>
      page.type === "image" || page.type === "video",
    ),
    [pages],
  );

  const [state, setState] = useState(initialState);
  const [phase, setPhase] = useState<Phase>(role === "viewer" || initialState.started ? "live" : "prep");
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [preload, setPreload] = useState(() => ({ done: 0, total: mediaPages.length, failed: 0 }));
  const [wakeLockState, setWakeLockState] = useState<"pending" | "ok" | "unavailable">("pending");
  const [t2Connected, setT2Connected] = useState(false);
  const [pending, setPending] = useState(0);
  const logRef = useRef<SessionEventLog | null>(null);
  const preloadTick = useRef(0);

  const isController = role === "control" && myRole === "teacher";

  // --- 事件层与传输层 ---------------------------------------------------
  useEffect(() => {
    let disposed = false;
    let flushTimer: ReturnType<typeof setInterval> | null = null;

    const setup = async () => {
      const log = await SessionEventLog.create(session.id, userId);
      if (disposed) {
        log.close();
        return;
      }
      log.markSeen(initialEvents.map((ev) => ev.id));
      logRef.current = log;
      log.subscribe((ev) => setState((prev) => reduceEvent(prev, ev)));
      log.attach(createLocalTransport(session.id, log.ingest));
      log.attach(createRealtimeTransport(createClient(), session.id, log.ingest, setT2Connected));

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
    };
    // initialEvents 仅首帧使用，不追踪
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

  // --- 教师操作 -----------------------------------------------------------
  const append = useCallback((type: Parameters<SessionEventLog["append"]>[0], payload: Record<string, unknown>) => {
    void logRef.current?.append(type, payload).then(() => {
      void pendingCount(session.id).then(setPending).catch(() => undefined);
    });
  }, [session.id]);

  const gotoPage = useCallback((page: number) => {
    const clamped = Math.max(0, Math.min(pages.length - 1, page));
    append("page", { page: clamped });
    // 在线时顺手更新 DB 基线（晚加入者用）；离线静默失败
    void createClient().from("class_sessions").update({ current_page: clamped }).eq("id", session.id)
      .then(() => undefined, () => undefined);
  }, [append, pages.length, session.id]);

  const startClass = useCallback(() => {
    append("session_ctl", { action: "start" });
    void startClassSession(session.id).catch(() => undefined);
    setPhase("live");
  }, [append, session.id]);

  // --- 渲染 ----------------------------------------------------------------
  // 展示窗/学生端跟随 start 事件进入上课（派生而非 effect，避免级联渲染）
  const effectivePhase: Phase = phase === "live" || (state.started && !isController) ? "live" : "prep";
  const page = pages[state.currentPage] as CoursewarePage | undefined;
  const assetsReady = preload.done >= preload.total;

  const connectionBadges = (
    <div className="flex items-center gap-2 text-xs">
      <span className="rounded-full bg-leaf/15 px-2 py-0.5 text-leaf-deep">{t("localChannel")}</span>
      <span className={`rounded-full px-2 py-0.5 ${t2Connected ? "bg-leaf/15 text-leaf-deep" : "bg-line/50 text-muted"}`}>
        {t2Connected ? t("online") : t("offline")}
      </span>
      {pending > 0 && (
        <span className="rounded-full bg-moon/40 px-2 py-0.5 text-ink" title={t("pendingHint")}>
          {t("pending", { count: pending })}
        </span>
      )}
    </div>
  );

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

  return (
    <div className="flex min-h-dvh flex-col px-4 py-3">
      <header className="flex flex-wrap items-center gap-3">
        <Link
          href={`/classroom/${classId}/session/${session.id}`}
          aria-label={t("exit")}
          className="rounded-full p-2 text-muted transition-colors hover:bg-moon/30 hover:text-ink"
        >
          <ArrowLeft size={18} />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{session.title || t("untitled")}</h1>
        {connectionBadges}
        <span className="font-mono text-xs text-muted">
          {pages.length === 0 ? "0 / 0" : `${state.currentPage + 1} / ${pages.length}`}
        </span>
      </header>

      <main className="mt-3 flex min-h-0 flex-1 items-center justify-center">
        <div
          className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-line bg-card"
          style={{ width: "min(100%, calc((100dvh - 14rem) * 4 / 3))" }}
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
              <video src={assetUrls[page.path]} controls className="size-full object-contain" />
            ) : (
              <p className="grid size-full place-items-center text-sm text-muted">{t("assetMissing")}</p>
            )
          ) : page.type === "game" ? (
            <GamePage page={page} />
          ) : (
            <p className="grid size-full place-items-center text-sm text-muted">{t("boardComing")}</p>
          )}
        </div>
      </main>

      <footer className="mt-3 flex flex-wrap items-center gap-3">
        {isController && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={t("prevPage")}
              disabled={state.currentPage <= 0}
              onClick={() => gotoPage(state.currentPage - 1)}
              className="grid size-11 place-items-center rounded-full border border-line text-ink transition-colors hover:bg-moon/30 disabled:opacity-30"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              aria-label={t("nextPage")}
              disabled={state.currentPage >= pages.length - 1}
              onClick={() => gotoPage(state.currentPage + 1)}
              className="grid size-11 place-items-center rounded-full border border-line text-ink transition-colors hover:bg-moon/30 disabled:opacity-30"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
        <ul className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {students.map((student) => {
            const count = state.stars[student.userId] ?? 0;
            return (
              <li key={student.userId} className="flex items-center">
                {isController ? (
                  <button
                    type="button"
                    onClick={() => append("star", { studentId: student.userId })}
                    className="flex min-h-11 items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm transition-colors hover:bg-moon/30"
                  >
                    <span className="max-w-24 truncate">{student.displayName || t("anonymous")}</span>
                    <Star size={13} className="text-crater" />
                    <span className="font-mono text-xs">{count}</span>
                  </button>
                ) : (
                  <span className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm">
                    <span className="max-w-24 truncate">{student.displayName || t("anonymous")}</span>
                    <Star size={13} className="text-crater" />
                    <span className="font-mono text-xs">{count}</span>
                  </span>
                )}
                {isController && count > 0 && (
                  <button
                    type="button"
                    aria-label={t("undoStar")}
                    onClick={() => append("star_undo", { studentId: student.userId })}
                    className="ml-1 grid size-7 place-items-center rounded-full text-muted transition-colors hover:bg-rose/10 hover:text-rose"
                  >
                    <Minus size={13} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </footer>
    </div>
  );
}

/** 游戏课件页：题面由 seed 确定性推导，全端一致且零网络（08-§3.6）。P4-5 加互动镜像。 */
function GamePage({ page }: { page: Extract<CoursewarePage, { type: "game" }> }) {
  const t = useTranslations("classroom.live");
  const game = games.find((item) => item.id === page.gameId);
  if (!game) return <p className="grid size-full place-items-center text-sm text-muted">{t("gameMissing")}</p>;
  const Board = game.Board;
  return (
    <div className="size-full overflow-auto p-4">
      <Board seed={page.seed} difficulty={page.difficulty} finished={false} onComplete={() => undefined} />
    </div>
  );
}
