"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { Shapes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTeachingWorkbench } from "../courseware/useTeachingWorkbench";
import type { NetLiveSnapshot, NetTeachingCommand } from "../courseware/workbench-classroom-contract";
import type { CubeNetTeachingSnapshot } from "../courseware/spatial-teaching-content";
import type { PaperFoldingSnapshot } from "../paper-folding/contract";
import type { SolidNetsSnapshot } from "../solid-nets/contract";
import { CubeIconButton } from "../spatial-lab/CubeWorkbenchControls";
import { netInitialState, type NetTeachingInitial, type NetTeachingState, type NetTeachingMode } from "./contract";
import { createNetTeachingInitial } from "./defaults";

const Net = dynamic(() => import("../spatial-lab/CubeNetFoldWorkspace").then((m) => m.CubeNetFoldWorkspace), { ssr: false });
const Paper = dynamic(() => import("../paper-folding/PaperFoldingWorkspace").then((m) => m.PaperFoldingWorkspace), { ssr: false });
const SolidNet = dynamic(() => import("../solid-nets/SolidNetsWorkspace").then((m) => m.SolidNetsWorkspace), { ssr: false });
type Runtime = { state?: NetTeachingState; onChange?: (next: NetTeachingState) => Promise<void> };

function StandardNet({ initial, runtime, onSnapshot, selector, readOnly, locale }: {
  initial: CubeNetTeachingSnapshot; runtime?: { state?: Extract<NetTeachingState, { mode: "standard" }>["data"]; onChange?: (next: Extract<NetTeachingState, { mode: "standard" }>["data"]) => Promise<void> };
  onSnapshot: (next: CubeNetTeachingSnapshot | null) => void; selector: ReactNode; readOnly: boolean; locale: "zh" | "en";
}) {
  const start = useMemo<NetLiveSnapshot>(() => ({ ...initial, judgment: null, galleryOpen: false }), [initial]);
  const host = useTeachingWorkbench<NetLiveSnapshot, NetTeachingCommand>(start, runtime);
  return <>{host.failed && <p role="alert" className="absolute left-3 top-14 z-40 text-xs text-rose">{locale === "zh" ? "本次操作未保存，请重试。" : "This action was not saved. Please retry."}</p>}
    <Net key={host.key} locale={locale} initial={host.initial} classroom={runtime ? host.port : undefined}
      onSnapshot={onSnapshot} modeSelector={selector} courseware readOnly={readOnly} />
  </>;
}

function ModeWorkspace({ initial, current, runtime, selector, readOnly, locale, captureNet, capturePaper, captureSolid }: {
  initial: NetTeachingInitial; current: NetTeachingState; runtime?: Runtime; selector: ReactNode; readOnly: boolean; locale: "zh" | "en";
  captureNet: (data: CubeNetTeachingSnapshot | null) => void; capturePaper: (data: PaperFoldingSnapshot | null) => void;
  captureSolid: (data: SolidNetsSnapshot | null) => void;
}) {
  // 每次进入方式时固定该次起点，课堂更新仍通过 runtime 驱动，避免重建纸片场景。
  const [origin] = useState(initial);
  if (origin.mode === "standard") return <StandardNet locale={locale} initial={origin.data} selector={selector} onSnapshot={captureNet} readOnly={readOnly}
    runtime={runtime ? { state: current.mode === "standard" ? current.data : undefined, onChange: runtime.onChange ? (data) => runtime.onChange!({ mode: "standard", data }) : undefined } : undefined} />;
  if (origin.mode === "solid-net") return <SolidNet locale={locale} initial={origin.data} workspaceSelector={selector} onSnapshot={captureSolid} readOnly={readOnly} courseware
    runtime={runtime ? { state: current.mode === "solid-net" ? current.data : undefined, onChange: runtime.onChange ? (data) => runtime.onChange!({ mode: "solid-net", data }) : undefined } : undefined} />;
  return <Paper locale={locale} initial={origin.data} workspaceSelector={selector} onSnapshot={capturePaper} readOnly={readOnly} courseware
    runtime={runtime ? { state: current.mode === "free-paper" ? current.data : undefined, onChange: runtime.onChange ? (data) => runtime.onChange!({ mode: "free-paper", data }) : undefined } : undefined} />;
}

function ReadyWorkspace({ initial, runtime, onSnapshot, readOnly = false }: {
  initial: NetTeachingInitial; runtime?: Runtime; onSnapshot?: (next: NetTeachingInitial | null) => void; readOnly?: boolean;
}) {
  const locale = useLocale() === "en" ? "en" : "zh";
  const [local, setLocal] = useState(initial), [switching, setSwitching] = useState(false), [failed, setFailed] = useState(false), [menu, setMenu] = useState(false);
  const [childBusy, setChildBusy] = useState(false);
  const [cache, setCache] = useState<Partial<Record<NetTeachingMode, NetTeachingInitial>>>({ [initial.mode]: initial });
  const current = runtime?.state ?? netInitialState(local), mode = current.mode;
  const starting = cache[mode] ?? (current.mode === "standard" ? { mode: "standard", data: current.data.snapshot } : current);
  const interactionDisabled = readOnly || switching || Boolean(runtime && !runtime.onChange);
  const disabled = interactionDisabled || childBusy;
  const capture = useCallback((next: NetTeachingInitial | null) => {
    setChildBusy(next === null);
    if (next) setCache((previous) => previous[next.mode] === next ? previous : { ...previous, [next.mode]: next });
    onSnapshot?.(switching ? null : next);
  }, [onSnapshot, switching]);
  const captureNet = useCallback((data: CubeNetTeachingSnapshot | null) => capture(data ? { mode: "standard", data } : null), [capture]);
  const capturePaper = useCallback((data: PaperFoldingSnapshot | null) => capture(data ? { mode: "free-paper", data } : null), [capture]);
  const captureSolid = useCallback((data: SolidNetsSnapshot | null) => capture(data ? { mode: "solid-net", data } : null), [capture]);
  const changeMode = async (next: NetTeachingMode) => {
    if (disabled || next === mode) return;
    setSwitching(true); setFailed(false); onSnapshot?.(null);
    try {
      const value = cache[next] ?? await createNetTeachingInitial(next);
      setCache((previous) => ({ ...previous, [next]: value }));
      if (runtime?.onChange) await runtime.onChange(netInitialState(value)); else setLocal(value);
      setMenu(false);
    } catch { setFailed(true); } finally { setSwitching(false); }
  };
  const labels = locale === "zh" ? { title: "展开方式", standard: "正方体展开", "free-paper": "自由拼纸", "solid-net": "长方体与三棱柱" } : { title: "Folding workspace", standard: "Cube nets", "free-paper": "Free paper", "solid-net": "Cuboid and prism" };
  const selector = <Popover open={menu} onOpenChange={setMenu}><PopoverTrigger asChild>
    <CubeIconButton label={labels.title} disabled={disabled}><Shapes aria-hidden /></CubeIconButton>
  </PopoverTrigger><PopoverContent align="start" className="w-44 space-y-1 p-2" aria-label={labels.title}>
    {(["standard", "free-paper", "solid-net"] as const).map((id) => <Button key={id} className="w-full justify-start" size="sm" variant={mode === id ? "secondary" : "ghost"}
      aria-pressed={mode === id} disabled={disabled} onClick={() => void changeMode(id)}>{labels[id]}</Button>)}
  </PopoverContent></Popover>;
  return <section className="relative size-full min-h-0" data-net-teaching-mode={mode} aria-busy={switching}>
    {failed && <p role="alert" className="absolute left-3 top-14 z-40 text-xs text-rose">{locale === "zh" ? "切换未保存，请重试。" : "The change was not saved. Please retry."}</p>}
    <ModeWorkspace key={mode} initial={starting} current={current} runtime={runtime} selector={selector} readOnly={interactionDisabled} locale={locale}
      captureNet={captureNet} capturePaper={capturePaper} captureSolid={captureSolid} />
  </section>;
}

export function NetTeachingWorkspace(props: { initial?: NetTeachingInitial; runtime?: Runtime; onSnapshot?: (next: NetTeachingInitial | null) => void; readOnly?: boolean }) {
  const locale = useLocale();
  const [defaultInitial, setDefault] = useState<NetTeachingInitial | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => { if (props.initial) return; let active = true;
    void createNetTeachingInitial("standard").then((value) => { if (active) setDefault(value); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [props.initial]);
  const initial = props.initial ?? defaultInitial;
  return initial ? <ReadyWorkspace {...props} initial={initial} /> : failed ? <p role="alert">{locale === "en" ? "Unable to load folding workspace." : "展开图工作台加载失败，请刷新重试。"}</p> : <Skeleton className="size-full" />;
}
