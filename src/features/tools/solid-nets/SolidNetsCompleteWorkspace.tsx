"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { SolidNetsWorkspace } from "./SolidNetsWorkspace";
import { CurvedNetsWorkspace } from "./CurvedNetsWorkspace";
import { useToolSnapshot } from "../scenes/useToolSnapshot";
import { createDefaultSolidNetsPolyhedraSnapshot, solidNetsPolyhedraSnapshotSchema, type AnySolidNetsSnapshot } from "./contract";
import { createCurvedNet, createDefaultSolidNetsComplete, solidNetsCompleteInitialSchema, solidNetsCompleteSnapshotSchema, type CurvedNetSnapshot, type SolidNetsCompleteSnapshot } from "./curved-contract";

const kinds = ["cube", "cuboid", "triangular-prism", "square-pyramid", "cylinder", "cone"] as const;
export function SolidNetsCompleteWorkspace({ initial, runtime, onSnapshot, readOnly }: {
  initial?: SolidNetsCompleteSnapshot; runtime?: { state?: SolidNetsCompleteSnapshot; onChange?: (next: SolidNetsCompleteSnapshot) => Promise<void> };
  onSnapshot?: (next: SolidNetsCompleteSnapshot | null) => void; readOnly?: boolean;
}) {
  const locale = useLocale() === "en" ? "en" : "zh", zh = locale === "zh";
  const [start] = useState(() => solidNetsCompleteInitialSchema.parse(initial ?? createDefaultSolidNetsComplete()));
  const { snapshot, update, publishing, failed } = useToolSnapshot(start, runtime);
  const [childBusy, setChildBusy] = useState(false), [candidate, setCandidate] = useState<SolidNetsCompleteSnapshot | null>(start);
  const readonly = Boolean(readOnly || runtime && !runtime.onChange);
  const capturePoly = useCallback((data: AnySolidNetsSnapshot | null) => { setChildBusy(data === null); setCandidate(data ? { mode: "polyhedron", data: solidNetsPolyhedraSnapshotSchema.parse(data) } : null); }, []);
  const captureCurved = useCallback((data: CurvedNetSnapshot | null) => { setChildBusy(data === null); setCandidate(data ? { mode: "curved", data } : null); }, []);
  useEffect(() => { onSnapshot?.(publishing || childBusy || !candidate || candidate.mode !== snapshot.mode || candidate.data.kind !== snapshot.data.kind ? null : candidate); }, [onSnapshot, publishing, childBusy, candidate, snapshot.mode, snapshot.data.kind]);
  const change = useCallback(async (next: SolidNetsCompleteSnapshot) => {
    const parsed = solidNetsCompleteSnapshotSchema.parse(next);
    if (runtime) { if (!runtime.onChange) throw new Error("READ_ONLY_SCENE"); await runtime.onChange(parsed); }
    else update(parsed);
  }, [runtime, update]);
  const polyRuntime = useMemo(() => snapshot.mode === "polyhedron" ? { state: snapshot.data, onChange: readonly ? undefined : (data: AnySolidNetsSnapshot) => change({ mode: "polyhedron", data: solidNetsPolyhedraSnapshotSchema.parse(data) }) } : undefined, [snapshot, readonly, change]);
  const curvedRuntime = useMemo(() => snapshot.mode === "curved" ? { state: snapshot.data, onChange: readonly ? undefined : (data: CurvedNetSnapshot) => change({ mode: "curved", data }) } : undefined, [snapshot, readonly, change]);
  const selector = <div className="flex flex-wrap gap-1" aria-label={zh ? "选择立体" : "Choose a solid"}>{kinds.map((kind, i) => <Button key={kind} size="sm" variant={snapshot.data.kind === kind ? "secondary" : "ghost"} aria-pressed={snapshot.data.kind === kind}
    disabled={readonly || publishing || childBusy} onClick={() => { if (snapshot.data.kind === kind) return; setCandidate(null); update(kind === "cone" || kind === "cylinder" ? { mode: "curved", data: createCurvedNet(kind) } : { mode: "polyhedron", data: createDefaultSolidNetsPolyhedraSnapshot(kind) }); }}>
    {(zh ? ["正方体", "长方体", "三棱柱", "四棱锥", "圆柱", "圆锥"] : ["Cube", "Cuboid", "Triangular prism", "Square pyramid", "Cylinder", "Cone"])[i]}</Button>)}</div>;
  return <section className="relative flex size-full min-h-0 min-w-0 flex-1 flex-col" data-solid-nets-complete>
    {snapshot.mode === "polyhedron" ? <SolidNetsWorkspace key="polyhedron" locale={locale} initial={snapshot.data} runtime={polyRuntime} onSnapshot={capturePoly} readOnly={readonly || publishing} courseware shapeSelector={selector} onReset={() => update(start)} />
      : <CurvedNetsWorkspace key={snapshot.data.kind} locale={locale} initial={snapshot.data} runtime={curvedRuntime} onSnapshot={captureCurved} readOnly={readonly || publishing} shapeSelector={selector} onReset={() => update(start)} />}
    {failed && <p className="absolute bottom-2 left-2 rounded bg-paper p-2 text-xs" role="status">{zh ? "同步失败，请重试。" : "Sync failed. Please retry."}</p>}
  </section>;
}
