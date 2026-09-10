"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ClassroomMember, SessionEvent } from "../types";
import type { SessionEventLog } from "../sync/eventlog";
import {
  CLASSROOM_VIEWPORT_PROTOCOL, CLASSROOM_VIEWPORT_REQUEST, compareViewport, parseClassroomViewport,
  viewportEvent, viewportCenter, type ClassroomViewport, type ClassroomViewportSnapshot,
} from "./classroom-viewport";
import type { useClassroomDisplay } from "./useClassroomDisplay";
import { pagingDialogIsOpen } from "./classroom-paging";

/** 仅教师控制窗发布；其他窗口默认跟随，手动调节后留在自己的视图。 */
export function useClassroomViewport({ log, controller, userId, members, initialEvents, display, connectionKey }: {
  log: SessionEventLog | null;
  controller: boolean;
  userId: string;
  members: readonly ClassroomMember[];
  initialEvents: readonly SessionEvent[];
  display: ReturnType<typeof useClassroomDisplay>;
  connectionKey: string;
}) {
  const [following, setFollowing] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const current = useRef({ display, following });
  useLayoutEffect(() => { current.current = { display, following }; });
  const latest = useRef<ClassroomViewportSnapshot | null>(null);
  const room = useRef<string | null>(null);
  const pending = useRef<ClassroomViewportSnapshot | null>(null);
  const pendingLocal = useRef<ClassroomViewport | null>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef(Promise.resolve());
  const teachers = members.filter((member) => member.role === "teacher").map((member) => member.userId);
  if (controller && !teachers.includes(userId)) teachers.push(userId);
  const teacherKey = teachers.sort().join(",");
  const history = useRef(initialEvents);
  useLayoutEffect(() => { history.current = initialEvents; }, [initialEvents]);

  const commit = useCallback(() => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = null;
    if (!controller) {
      if (pendingLocal.current) current.current.display.rememberViewport(pendingLocal.current);
      pendingLocal.current = null;
      return;
    }
    const snapshot = pending.current;
    if (!snapshot || !log || !controller) return;
    pending.current = null;
    current.current.display.rememberViewport(snapshot);
    queue.current = queue.current.then(async () => {
      try {
        const event = await log.append("session_ctl", { ...snapshot });
        log.rememberViewportState(event);
        setSaveError(false);
      } catch {
        // 保留最终视图供下一次操作／重连重试；本地画面继续可用。
        if (!pending.current || compareViewport(snapshot, pending.current) > 0) pending.current = snapshot;
        setSaveError(true);
      }
    });
  }, [controller, log]);

  const change = useCallback((view: ClassroomViewport, finish = false) => {
    current.current.display.applyViewport(view);
    pendingLocal.current = view;
    if (!controller) {
      current.current.following = false;
      setFollowing(false);
      if (finish) commit();
      return;
    }
    if (!log) return;
    const snapshot: ClassroomViewportSnapshot = { ...view, action: "viewport", version: 1,
      revision: Math.max(Date.now(), (latest.current?.revision ?? 0) + 1), writer: log.deviceId };
    latest.current = snapshot;
    pending.current = snapshot;
    if (!fxTimer.current) fxTimer.current = setTimeout(() => {
      fxTimer.current = null;
      if (latest.current) log.sendFx({ scope: CLASSROOM_VIEWPORT_PROTOCOL, payload: { sessionId: log.sessionId, userId, snapshot: latest.current } });
    }, 80);
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(commit, 250);
    if (finish) commit();
  }, [commit, controller, log, userId]);

  useEffect(() => {
    if (!log) return;
    if (room.current !== log.sessionId) { room.current = log.sessionId; latest.current = null; }
    const allowed = new Set(teacherKey.split(","));
    let replayTimer: ReturnType<typeof setTimeout> | null = null;
    let previewTimer: ReturnType<typeof setTimeout> | null = null;
    const previewSequences = new Map<string, number>();
    const baseline = current.current.display.viewport;
    const accept = (snapshot: ClassroomViewportSnapshot, restore = false) => {
      if (latest.current && compareViewport(snapshot, latest.current) <= 0) return false;
      latest.current = snapshot;
      if ((restore || !controller) && current.current.following) current.current.display.applyViewport(snapshot);
      return true;
    };
    const receiveEvent = (event: SessionEvent, restore = false) => {
      const snapshot = viewportEvent(event);
      if (!snapshot || event.sessionId !== log.sessionId || !allowed.has(event.userId) || snapshot.writer !== event.deviceId) return;
      log.rememberViewportState(event);
      if (previewTimer && (!latest.current || compareViewport(snapshot, latest.current) >= 0)) {
        clearTimeout(previewTimer); previewTimer = null;
      }
      accept(snapshot, restore);
    };
    [...history.current, ...log.recoveredViewportEvents, ...log.rehearsalEvents].forEach((event) => receiveEvent(event, true));
    const offEvent = log.subscribe((event) => receiveEvent(event));
    const offFx = log.onFx((fx) => {
      if (fx.scope === CLASSROOM_VIEWPORT_REQUEST && fx.payload?.version === 1 && controller && !replayTimer) {
        replayTimer = setTimeout(() => { replayTimer = null; commit(); log.rebroadcastViewportState(); }, 100);
      }
      if (fx.scope !== CLASSROOM_VIEWPORT_PROTOCOL || fx.payload?.sessionId !== log.sessionId || !allowed.has(String(fx.payload.userId))) return;
      const snapshot = parseClassroomViewport(fx.payload.snapshot);
      if (!snapshot || controller || (previewSequences.get(snapshot.writer) ?? 0) >= snapshot.revision) return;
      previewSequences.set(snapshot.writer, snapshot.revision);
      if (previewSequences.size > 32) previewSequences.delete(previewSequences.keys().next().value!);
      if (!accept(snapshot)) return;
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = setTimeout(() => {
        previewTimer = null;
        // 临时帧在写者中断后回到最后已保存的位置；晚到的旧帧不占用下一次控制。
        const saved = log.latestViewportEvent && viewportEvent(log.latestViewportEvent);
        latest.current = saved;
        if (current.current.following) current.current.display.applyViewport(saved ?? baseline);
      }, 1500);
    });
    return () => {
      offEvent(); offFx();
      if (replayTimer) clearTimeout(replayTimer);
      if (previewTimer) clearTimeout(previewTimer);
    };
  }, [commit, controller, log, teacherKey]);

  useEffect(() => {
    if (!log) return;
    const request = () => controller ? commit() : log.sendFx({ scope: CLASSROOM_VIEWPORT_REQUEST, payload: { version: 1 } });
    request();
    const timer = setInterval(request, 10000);
    window.addEventListener("online", request);
    return () => { clearInterval(timer); window.removeEventListener("online", request); };
  }, [commit, connectionKey, controller, log]);

  useEffect(() => () => {
    commit();
    if (fxTimer.current) clearTimeout(fxTimer.current);
  }, [commit]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && current.current.display.focused && !event.defaultPrevented && !pagingDialogIsOpen(document)) {
        change({ ...current.current.display.viewport, focused: false }, true);
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [change]);

  return {
    following, saveError, change, commit,
    follow() {
      current.current.following = true;
      setFollowing(true);
      if (latest.current) current.current.display.applyViewport(latest.current);
      log?.sendFx({ scope: CLASSROOM_VIEWPORT_REQUEST, payload: { version: 1 } });
    },
    setFocused(focused: boolean) { change({ ...display.viewport, focused }, true); },
    resize(percent: number) {
      if (!display.focused) { display.resize(percent); return; }
      change({ ...display.viewport, zoom: percent / display.bounds.fitPercent });
    },
    pan(position: number) {
      const height = display.size.width * display.value / 100 * 3 / 4;
      change({ ...display.viewport, centerY: viewportCenter(height, display.size.height, position) });
    },
    reset() {
      display.reset();
      if (display.focused) change({ focused: true, zoom: 1, centerY: 0.5 }, true);
    },
  };
}
