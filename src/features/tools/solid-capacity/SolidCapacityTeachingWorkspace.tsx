"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { SpatialActionButton } from "../spatial-interaction/SpatialActionButton";
import { useSceneCapture } from "../courseware/useSceneCapture";
import { useToolSnapshot } from "../scenes/useToolSnapshot";
import type { SolidCapacityInitial, SolidCapacitySnapshot } from "./solid-capacity-contract";
import type { DisplacementInitial, DisplacementSnapshot } from "./displacement-contract";
import { createDefaultSolidCapacityTeachingInitial, solidCapacityTeachingInitial, solidCapacityTeachingSnapshot, solidCapacityTeachingSnapshotSchema, type SolidCapacityTeachingInitial, type SolidCapacityTeachingSnapshot } from "./solid-capacity-teaching-contract";
import { displacementMessages } from "./displacement-messages";

const Pour = dynamic(() => import("./SolidCapacityWorkspace").then((m) => m.SolidCapacityWorkspace), { ssr: false, loading: () => <Skeleton className="size-full" /> });
const Displacement = dynamic(() => import("./DisplacementWorkspace").then((m) => m.DisplacementWorkspace), { ssr: false, loading: () => <Skeleton className="size-full" /> });
export interface SolidCapacityTeachingWorkspaceProps {
  initial?: SolidCapacityTeachingInitial; onSnapshot?: (initial: SolidCapacityTeachingInitial | null) => void; readOnly?: boolean;
  classroom?: { state?: SolidCapacityTeachingSnapshot; onChange?: (next: SolidCapacityTeachingSnapshot) => Promise<void> };
}
/** 两个教学现场共享一个工具身份，各自保存条件；课堂/备课继续走同一入口。 */
export function SolidCapacityTeachingWorkspace({ initial, onSnapshot, readOnly = false, classroom }: SolidCapacityTeachingWorkspaceProps) {
  const m = displacementMessages(useLocale());
  const origin = useMemo(() => initial ?? createDefaultSolidCapacityTeachingInitial(), [initial]);
  const start = useMemo(() => solidCapacityTeachingSnapshot(origin), [origin]), host = useToolSnapshot(start, classroom), snapshot = host.snapshot;
  const [menu, setMenu] = useState(false), [childBusy, setChildBusy] = useState(false);
  const viewer = readOnly || Boolean(classroom && !classroom.onChange), disabled = viewer || childBusy || host.publishing;
  const capture = useMemo(() => solidCapacityTeachingInitial(snapshot), [snapshot]);
  useSceneCapture(disabled ? null : capture, onSnapshot);
  const childCapture = useCallback((state: SolidCapacityInitial | DisplacementInitial | null) => setChildBusy(state === null), []);
  const write = useCallback(async (next: SolidCapacityTeachingSnapshot) => {
    const parsed = solidCapacityTeachingSnapshotSchema.parse(next);
    if (classroom) { if (!classroom.onChange) throw new Error("READ_ONLY"); await classroom.onChange(parsed); }
    else host.update(parsed);
  }, [classroom, host]);
  const changePour = useCallback((next: SolidCapacitySnapshot) => write({ ...snapshot, pour: next }), [write, snapshot]);
  const changeDisplacement = useCallback((next: DisplacementSnapshot) => write({ ...snapshot, displacement: next }), [write, snapshot]);
  const selector = <Popover open={menu} onOpenChange={setMenu}><PopoverTrigger asChild><SpatialActionButton action="demonstrate" label={m.modes} disabled={disabled} /></PopoverTrigger>
    <PopoverContent align="start" className="w-44 space-y-1 p-2" aria-label={m.modes}>
      {(["pour", "displacement"] as const).map((mode) => <Button key={mode} className="w-full justify-start" size="sm" variant={snapshot.mode === mode ? "secondary" : "ghost"} aria-pressed={snapshot.mode === mode} disabled={disabled}
        onClick={() => { if (host.update({ ...snapshot, mode })) { setMenu(false); setChildBusy(false); } }}>{m[mode]}</Button>)}
    </PopoverContent>
  </Popover>;
  return <section className="relative flex size-full min-h-0 min-w-0 flex-1 flex-col" data-capacity-teaching-mode={snapshot.mode}>
    {snapshot.mode === "pour" ? <Pour initial={origin.pour} workspaceSelector={selector} onSnapshot={childCapture} readOnly={viewer || host.publishing}
      classroom={{ state: snapshot.pour, onChange: viewer ? undefined : changePour }} />
      : <Displacement initial={origin.displacement} workspaceSelector={selector} onSnapshot={childCapture} readOnly={viewer || host.publishing}
        classroom={{ state: snapshot.displacement, onChange: viewer ? undefined : changeDisplacement }} />}
    {host.failed && <p role="alert" className="absolute bottom-14 left-3 z-40 text-xs text-rose">{m.syncError}</p>}
  </section>;
}
