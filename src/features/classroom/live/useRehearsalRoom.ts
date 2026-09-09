"use client";

import { useEffect, useState } from "react";
import type { CoursewarePage } from "../types";
import { SessionEventLog } from "../sync/eventlog";
import { attachRehearsalTransports, rehearsalRoomId } from "../sync/rehearsal";
import type { P2PHealth } from "../sync/transports";
import { emptyStarLedger } from "../stars";
import { reduceEvent, type LiveState } from "./liveState";

export function useRehearsalRoom(userId: string, resourceId: string, pages: CoursewarePage[], enabled: boolean) {
  const [log, setLog] = useState<SessionEventLog | null>(null);
  const [connected, setConnected] = useState(false);
  const [health, setHealth] = useState<P2PHealth>({ state: "signaling", peers: 0, latencyMs: null });
  const [baseline] = useState<LiveState>(() => ({
    pages, currentPage: 0, starLedger: emptyStarLedger(), started: false, ended: false,
    hands: {}, boards: {}, games: {}, video: {}, docSteps: {}, openTool: null, quiz: null, answers: {},
  }));
  const [state, setState] = useState(baseline);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let activeLog: SessionEventLog | null = null;
    void SessionEventLog.create(rehearsalRoomId(userId, "activity", resourceId), userId, { ephemeral: true }).then((eventLog) => {
      if (disposed) { eventLog.close(); return; }
      activeLog = eventLog;
      eventLog.subscribe(() => setState(eventLog.rehearsalEvents.reduce(reduceEvent, baseline)));
      attachRehearsalTransports(eventLog, {
        onHealth: (value) => { if (!disposed) setHealth(value); },
        onStatus: (value) => { if (!disposed) setConnected(value); },
      });
      setLog(eventLog);
    });
    return () => { disposed = true; activeLog?.close(); };
  }, [baseline, enabled, resourceId, userId]);
  return { log, state, connected, health };
}
