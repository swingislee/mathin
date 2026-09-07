"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CubeDraftError, cubeDraftContentKey, cubeDraftSnapshot, type CubeDraftErrorCode } from "./cube-structures-draft";
import { createCubeDraftStore, type CubeDraftStore, type CubeSavedDraft, type CubeSavedDraftSummary } from "./cube-structures-draft-store";
import type { CubeWorkbenchSession } from "./cube-structures-session";

function errorCode(error: unknown): CubeDraftErrorCode { return error instanceof CubeDraftError ? error.code : "unavailable"; }
function sortDrafts(drafts: readonly CubeSavedDraftSummary[]) { return [...drafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)); }

export function useCubeDrafts({ prepared, getIdentity, onOpen, locale = "zh", store: suppliedStore }: {
  readonly prepared: CubeWorkbenchSession;
  readonly getIdentity: () => number;
  readonly onOpen: (draft: CubeSavedDraft) => void;
  readonly locale?: "zh" | "en";
  readonly store?: CubeDraftStore;
}) {
  const [store] = useState(() => suppliedStore ?? createCubeDraftStore({ locale }));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<readonly CubeSavedDraftSummary[]>([]);
  const [accountReady, setAccountReady] = useState(false);
  const [current, setCurrent] = useState<CubeSavedDraftSummary | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<CubeDraftErrorCode | null>(null);
  const contentKey = useMemo(() => cubeDraftContentKey(prepared), [prepared]);
  const [savedKey, setSavedKey] = useState<string | null>(contentKey);
  const onOpenRef = useRef(onOpen);
  const running = useRef(false);
  const mounted = useRef(false);
  const dirty = !loading && (savedKey !== contentKey || name.trim() !== (current?.name ?? ""));

  useEffect(() => { onOpenRef.current = onOpen; }, [onOpen]);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    async function restore() {
      try {
        const overview = await store.overview();
        if (!active) return;
        setDrafts(overview.drafts); setAccountReady(true);
        if (overview.lastOpenedId) {
          const draft = await store.read(overview.lastOpenedId);
          if (!active) return;
          onOpenRef.current(draft);
          setCurrent(draft); setName(draft.name); setSavedKey(cubeDraftContentKey(draft.snapshot.session));
        }
      } catch (error) { if (active) setError(errorCode(error)); }
      finally { if (active) setLoading(false); }
    }
    void restore();
    return () => { active = false; mounted.current = false; };
  }, [store]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function refresh() {
    if (loading || running.current) return;
    running.current = true; setBusy(true);
    try {
      const overview = await store.overview();
      if (!mounted.current) return;
      setDrafts(overview.drafts); setAccountReady(true); setError(null);
    } catch (error) { if (mounted.current) { setError(errorCode(error)); setAccountReady(false); } }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  async function save(asNew = false): Promise<boolean> {
    if (loading || running.current || !accountReady) return false;
    running.current = true; setBusy(true); setError(null);
    const submittedKey = contentKey;
    try {
      const draft = await store.save({ name, snapshot: cubeDraftSnapshot(prepared, getIdentity()),
        ...(current && !asNew ? { id: current.id, expectedRevision: current.revision } : {}) });
      if (!mounted.current) return false;
      store.remember(draft.id);
      setCurrent(draft); setName((value) => value === name ? draft.name : value); setSavedKey(submittedKey);
      setDrafts((items) => sortDrafts([draft, ...items.filter((item) => item.id !== draft.id)]));
      return true;
    } catch (error) { if (mounted.current) { const code = errorCode(error); setError(code); if (["auth-required", "account-security", "account-changed"].includes(code)) setAccountReady(false); } return false; }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  async function open(draftId: string): Promise<boolean> {
    if (loading || running.current) return false;
    running.current = true; setBusy(true); setError(null);
    try {
      const draft = await store.read(draftId);
      store.remember(draftId);
      if (!mounted.current) return false;
      onOpenRef.current(draft);
      setCurrent(draft); setName(draft.name); setSavedKey(cubeDraftContentKey(draft.snapshot.session));
      setDrafts((items) => sortDrafts([draft, ...items.filter((item) => item.id !== draft.id)]));
      return true;
    } catch (error) { if (mounted.current) { const code = errorCode(error); setError(code); if (["auth-required", "account-security", "account-changed"].includes(code)) setAccountReady(false); } return false; }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  function newDraft() { store.remember(null); setCurrent(null); setName(""); setSavedKey(null); }

  return { loading, busy, drafts, current, name, setName, dirty, error, accountReady, save, open, refresh, newDraft };
}

export type CubeDraftLibrary = ReturnType<typeof useCubeDrafts>;
