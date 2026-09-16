"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { newId } from "@/lib/uuid";
import type { TeachingWorkbenchPort, TeachingWorkbenchState } from "./workbench-classroom-contract";

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.entries(a), right = Object.keys(b);
  return left.length === right.length && left.every(([key, value]) => Object.hasOwn(b, key) && same(value, (b as Record<string, unknown>)[key]));
}

/** 共用课堂宿主：持久写入后执行、自己不重播、远端重建、终态对齐和失败回退。 */
export function useTeachingWorkbench<S, C>(initial: S, runtime?: {
  state?: TeachingWorkbenchState<S, C>; onChange?: (state: TeachingWorkbenchState<S, C>) => Promise<void>;
}) {
  const [mount, setMount] = useState(() => ({ key: "initial", state: runtime?.state ?? { id: "initial", snapshot: initial, motion: null, settles: null } }));
  const [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
  const callbacks = useRef(runtime); const starting = useRef(initial);
  useEffect(() => { callbacks.current = runtime; starting.current = initial; }, [runtime, initial]);
  const confirmed = useRef(mount.state), current = useRef(mount.state.snapshot);
  const lastInput = useRef(runtime?.state?.id), owned = useRef(new Set<string>());
  const observed = useRef({ snapshot: mount.state.snapshot, camera: 0 });
  const active = useRef<string | null>(mount.state.motion ? mount.state.id : null);
  const busySeen = useRef(false), completed = useRef(false);
  const awaiting = useRef(false), executed = useRef(false);
  const suspended = useRef(false);
  const completion = useRef<TeachingWorkbenchState<S, C> | null>(null);
  const generation = useRef(0), writes = useRef(0), queue = useRef(Promise.resolve());
  const remount = useCallback((state: TeachingWorkbenchState<S, C>) => {
    generation.current++;
    confirmed.current = state; current.current = state.snapshot; observed.current = { snapshot: state.snapshot, camera: 0 };
    active.current = state.motion ? state.id : null; busySeen.current = false; completed.current = false; completion.current = null;
    awaiting.current = false; executed.current = false;
    setMount({ key: newId(), state });
  }, []);
  const settle = useCallback((state: TeachingWorkbenchState<S, C>) => {
    if (!same(current.current, state.snapshot)) { remount(state); return; }
    confirmed.current = state; observed.current = { ...observed.current, snapshot: state.snapshot };
    active.current = null; completion.current = null; completed.current = false; busySeen.current = false; executed.current = false;
  }, [remount]);
  useEffect(() => {
    const next = runtime?.state;
    if (!next || next.id === lastInput.current) return;
    lastInput.current = next.id;
    if (owned.current.has(next.id)) { owned.current.delete(next.id); return; }
    // 终态可能比展示端动画更早到达。完成原动作后核对终态，避免截断动画。
    if (!next.motion && next.settles && next.settles === active.current) {
      completion.current = next; confirmed.current = next;
      if (completed.current) settle(next);
      return;
    }
    remount(next);
  }, [runtime?.state, remount, settle]);
  useEffect(() => () => { generation.current++; }, []);

  const send = useCallback((state: TeachingWorkbenchState<S, C>, after?: () => void | Promise<void>) => {
    const writer = callbacks.current?.onChange;
    if (!writer) return;
    const token = generation.current;
    owned.current.add(state.id);
    while (owned.current.size > 128) owned.current.delete(owned.current.values().next().value!);
    writes.current++; setPending(true); setFailed(false);
    queue.current = queue.current.then(async () => {
      if (generation.current !== token) return;
      await writer(state);
      if (generation.current !== token) return;
      confirmed.current = state;
      await after?.();
    }).catch(() => {
      if (generation.current === token) {
        // 恢复已持久化动作，但等待下一次教师操作再写，避免终态写入失败后自动重播/重试循环。
        suspended.current = true; remount(confirmed.current); setFailed(true);
      }
    }).finally(() => { writes.current--; if (writes.current === 0) setPending(false); });
  }, [remount]);
  const capture = useCallback((snapshot: S | null, camera = 0) => {
    if (awaiting.current) return;
    if (!snapshot) { busySeen.current = true; return; }
    const changed = !same(observed.current, { snapshot, camera });
    current.current = snapshot;
    if (active.current && (busySeen.current || changed || executed.current)) {
      completed.current = true;
      if (completion.current) {
        settle(completion.current);
        return;
      }
    }
    if (!changed && !(active.current && completed.current)) return;
    observed.current = { snapshot, camera };
    if (!callbacks.current?.onChange || suspended.current) return;
    const settles = active.current;
    active.current = null; busySeen.current = false; executed.current = false;
    send({ id: newId(), snapshot, motion: null, settles });
  }, [send, settle]);
  const command = useCallback((value: C, execute: () => void | Promise<void>) => {
    if (!callbacks.current?.onChange || writes.current) return;
    suspended.current = false;
    const id = newId(); active.current = id; busySeen.current = false; completed.current = false; completion.current = null;
    awaiting.current = true; executed.current = false;
    send({ id, snapshot: current.current, motion: { command: value, startedAt: Date.now() }, settles: null }, async () => {
      awaiting.current = false; executed.current = true;
      await execute();
    });
  }, [send]);
  const reset = useCallback(() => {
    if (!callbacks.current?.onChange || writes.current) return;
    suspended.current = false;
    const state: TeachingWorkbenchState<S, C> = { id: newId(), snapshot: starting.current, motion: null, settles: null };
    send(state, () => remount(state));
  }, [send, remount]);
  const cancel = useCallback(() => {
    if (!callbacks.current?.onChange || writes.current || !active.current) return;
    active.current = null; busySeen.current = false; executed.current = false;
    send({ id: newId(), snapshot: current.current, motion: null, settles: null });
  }, [send]);
  const port: TeachingWorkbenchPort<S, C> = { pending, replay: mount.state.motion, capture, command, reset, cancel };
  return { key: mount.key, initial: mount.state.snapshot, port, failed, clearError: () => setFailed(false) };
}
