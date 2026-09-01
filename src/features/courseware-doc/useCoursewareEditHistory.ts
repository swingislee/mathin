"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

const DEFAULT_HISTORY_LIMIT = 20;
const DEFAULT_COALESCE_MS = 650;

export function useCoursewareEditHistory<T>({
  currentRef,
  restore,
  limit = DEFAULT_HISTORY_LIMIT,
  coalesceMs = DEFAULT_COALESCE_MS,
}: {
  currentRef: MutableRefObject<T>;
  restore: (value: T) => void;
  limit?: number;
  coalesceMs?: number;
}) {
  const pastRef = useRef<T[]>([]);
  const futureRef = useRef<T[]>([]);
  const lastRecordRef = useRef<{ group: string; at: number } | null>(null);
  const [availability, setAvailability] = useState({ canUndo: false, canRedo: false });

  const syncAvailability = useCallback(() => {
    setAvailability({
      canUndo: pastRef.current.length > 0,
      canRedo: futureRef.current.length > 0,
    });
  }, []);

  const clear = useCallback(() => {
    pastRef.current = [];
    futureRef.current = [];
    lastRecordRef.current = null;
    syncAvailability();
  }, [syncAvailability]);

  const record = useCallback((previous: T, group = "document") => {
    const now = Date.now();
    const last = lastRecordRef.current;
    if (!last || last.group !== group || now - last.at > coalesceMs) {
      pastRef.current.push(structuredClone(previous));
      if (pastRef.current.length > limit) pastRef.current.shift();
    }
    lastRecordRef.current = { group, at: now };
    futureRef.current = [];
    syncAvailability();
  }, [coalesceMs, limit, syncAvailability]);

  const undo = useCallback(() => {
    const previous = pastRef.current.pop();
    if (!previous) return;
    futureRef.current.push(structuredClone(currentRef.current));
    if (futureRef.current.length > limit) futureRef.current.shift();
    lastRecordRef.current = null;
    restore(structuredClone(previous));
    syncAvailability();
  }, [currentRef, limit, restore, syncAvailability]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(structuredClone(currentRef.current));
    if (pastRef.current.length > limit) pastRef.current.shift();
    lastRecordRef.current = null;
    restore(structuredClone(next));
    syncAvailability();
  }, [currentRef, limit, restore, syncAvailability]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.target instanceof HTMLElement && event.target.closest('[role="dialog"]')) return;
      const key = event.key.toLowerCase();
      const wantsUndo = key === "z" && !event.shiftKey;
      const wantsRedo = (key === "z" && event.shiftKey) || key === "y";
      if (!wantsUndo && !wantsRedo) return;
      event.preventDefault();
      if (wantsUndo) undo();
      else redo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, undo]);

  return {
    canUndo: availability.canUndo,
    canRedo: availability.canRedo,
    record,
    undo,
    redo,
    clear,
    limit,
  };
}
