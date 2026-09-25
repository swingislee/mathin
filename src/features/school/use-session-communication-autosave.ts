"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { newId } from "@/lib/uuid";
import { saveSessionCommunication } from "./session-communication-actions";
import type { CommunicationDraft, SessionCommunications } from "./session-communication-contract";
import { sessionCommunicationMessages } from "./session-communication-messages";

type Entry = {
  draft: CommunicationDraft; saved: CommunicationDraft | null; revision: number;
  state: "saved" | "saving" | "invalid" | "error"; dirty: boolean; error?: string;
  // 请求失败时先重试相同内容，确认服务端是否收到，再发送继续输入的内容。
  request?: { draft: CommunicationDraft; revision: number };
};
const same = (a: CommunicationDraft, b: CommunicationDraft | null) => JSON.stringify(a) === JSON.stringify(b);
const meaningful = (draft: CommunicationDraft) => Boolean(draft.content.trim() || draft.nextAction.trim() || draft.nextFollowUpOn || draft.outcome === "not_needed");
const valid = (draft: CommunicationDraft) => z.iso.date().safeParse(draft.occurredOn).success
  && Boolean(draft.content.trim() || draft.outcome === "not_needed")
  && (draft.outcome !== "follow_up" || Boolean(draft.nextAction.trim() && z.iso.date().safeParse(draft.nextFollowUpOn).success));

export function useSessionCommunicationAutosave(sessionId: string, initial: SessionCommunications, locale: string, today: string) {
  const [communications, setCommunications] = useState(initial);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const entriesRef = useRef(entries);
  const mounted = useRef(true);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const queue = useRef(new Set<string>());
  const running = useRef<Promise<void> | null>(null);
  const drainRef = useRef<() => Promise<void>>(async () => {});
  const publish = useCallback(() => { if (mounted.current) setEntries({ ...entriesRef.current }); }, []);
  const clearTimer = useCallback((key: string) => { clearTimeout(timers.current.get(key)); timers.current.delete(key); }, []);
  const drain = useCallback(async () => {
    if (running.current) return running.current;
    const run = async () => {
      const m = sessionCommunicationMessages(locale);
      while (queue.current.size) {
        const key = queue.current.values().next().value!;
        queue.current.delete(key);
        const entry = entriesRef.current[key];
        if (!entry?.dirty) continue;
        if (!entry.request && !valid(entry.draft)) {
          entriesRef.current[key] = { ...entry, state: "invalid", error: m.validation }; publish(); continue;
        }
        const request = entry.request ?? { draft: entry.draft, revision: entry.revision };
        entriesRef.current[key] = { ...entry, request, state: "saving", error: undefined }; publish();
        const draft = request.draft;
        try {
          const result = await saveSessionCommunication({ ...draft, sessionId, studentId: key === "class" ? null : key,
            content: draft.content.trim() || m.notNeededNote, expectedRevision: request.revision,
            nextAction: draft.outcome === "follow_up" ? draft.nextAction : "", nextFollowUpOn: draft.outcome === "follow_up" ? draft.nextFollowUpOn : null });
          if (!result.ok) {
            entriesRef.current[key] = { ...entriesRef.current[key],
              request: ["VALIDATION", "FORBIDDEN", "UNAUTHENTICATED", "SUBMISSION_CONFLICT"].includes(result.code) ? undefined : request,
              state: "error", error: result.code === "SUBMISSION_CONFLICT" ? m.concurrent : result.code === "VALIDATION" ? m.validation : m.failed };
            queue.current.delete(key); publish(); continue;
          }
          const current = entriesRef.current[key];
          const dirty = !same(current.draft, draft);
          entriesRef.current[key] = { ...current, saved: draft, revision: result.data.revision, request: undefined, dirty, state: dirty ? "saving" : "saved", error: undefined };
          if (mounted.current) setCommunications(result.data.communications);
          if (dirty) { clearTimer(key); queue.current.add(key); }
          publish();
        } catch {
          entriesRef.current[key] = { ...entriesRef.current[key], state: "error", error: m.failed };
          queue.current.delete(key); publish();
        }
      }
    };
    running.current = run();
    try { await running.current; } finally { running.current = null; }
  }, [sessionId, locale, publish, clearTimer]);
  useEffect(() => { drainRef.current = drain; }, [drain]);
  const flush = useCallback(async (key?: string) => {
    for (const target of key ? [key] : Object.keys(entriesRef.current)) {
      clearTimer(target);
      if (entriesRef.current[target]?.dirty) queue.current.add(target);
    }
    await drainRef.current();
    return key ? !entriesRef.current[key]?.dirty : !Object.values(entriesRef.current).some(entry => entry.dirty);
  }, [clearTimer]);
  useEffect(() => {
    mounted.current = true;
    const online = () => { void flush(); };
    window.addEventListener("online", online);
    return () => { mounted.current = false; window.removeEventListener("online", online); void flush(); };
  }, [flush]);
  const open = (key: string) => {
    if (!initial.canWrite || entriesRef.current[key]) return;
    entriesRef.current[key] = { draft: { id: newId(), occurredOn: today, channel: key === "class" ? "class_group" : "wechat",
      outcome: "contacted", content: "", nextAction: "", nextFollowUpOn: "" }, saved: null, revision: 0, state: "saved", dirty: false };
    publish();
  };
  const change = (key: string, patch: Partial<CommunicationDraft>) => {
    const entry = entriesRef.current[key];
    if (!entry || !initial.canWrite) return;
    const draft = { ...entry.draft, ...patch };
    const dirty = Boolean(entry.request) || (entry.saved ? !same(draft, entry.saved) : meaningful(draft));
    entriesRef.current[key] = { ...entry, draft, dirty, state: dirty ? "saving" : "saved", error: undefined };
    clearTimer(key);
    if (dirty) timers.current.set(key, setTimeout(() => { queue.current.add(key); void drainRef.current(); }, 1000));
    publish();
  };
  const discard = (key: string) => {
    const entry = entriesRef.current[key];
    // 未确认收到响应的请求保留原 ID 与内容供重试，避免误把已上传记录当成可丢弃草稿。
    if (!entry || entry.request) return;
    clearTimer(key); queue.current.delete(key);
    if (entry.saved) entriesRef.current[key] = { ...entry, draft: entry.saved, dirty: false, state: "saved", error: undefined };
    else delete entriesRef.current[key];
    publish();
  };
  const addAnother = (key: string) => {
    if (entriesRef.current[key]?.dirty) return;
    delete entriesRef.current[key]; open(key);
  };
  return { communications, entries, open, change, flush, discard, addAnother, dirty: Object.values(entries).some(entry => entry.dirty) };
}
