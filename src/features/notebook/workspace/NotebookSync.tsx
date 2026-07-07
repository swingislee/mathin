"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { listNoteMetas } from "../actions";
import { useNotebookStore } from "../store";
import type { NotebookEvent } from "../types";

const NOTEBOOK_REALTIME_ENABLED = true;

const SyncContext = createContext<(event: NotebookEvent) => void>(() => undefined);

export function useNotebookSync() {
  return useContext(SyncContext);
}

export function NotebookSync({ userId, children }: { userId: string; children: React.ReactNode }) {
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const upsert = useNotebookStore((state) => state.upsert);
  const remove = useNotebookStore((state) => state.remove);
  const patch = useNotebookStore((state) => state.patch);
  const replaceAll = useNotebookStore((state) => state.replaceAll);

  const refresh = useCallback(async () => {
    try {
      replaceAll(await listNoteMetas());
    } catch {
      // Focus refresh is a best-effort degradation path.
    }
  }, [replaceAll]);

  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  useEffect(() => {
    if (!NOTEBOOK_REALTIME_ENABLED || !userId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`notes:${userId}`, { config: { private: true, broadcast: { self: false } } })
      .on("broadcast", { event: "note" }, ({ payload }: { payload: NotebookEvent }) => {
        if (payload.type === "meta") upsert(payload.note);
        if (payload.type === "removed") remove(payload.id);
        if (payload.type === "doc") patch(payload.id, { version: payload.version });
      })
      .subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [patch, remove, upsert, userId]);

  const broadcast = useCallback((event: NotebookEvent) => {
    void channelRef.current?.send({ type: "broadcast", event: "note", payload: event });
  }, []);

  const value = useMemo(() => broadcast, [broadcast]);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
