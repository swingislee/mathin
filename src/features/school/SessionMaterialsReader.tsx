"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, FileText, Film, PenLine, RefreshCw, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter } from "@/i18n/navigation";
import { DashboardCommandActions, DashboardCommandPanel, DashboardCommandState } from "./dashboard-page";
import { MATERIAL_KINDS, materialMessages, materialSummarySchema, type MaterialContent, type MaterialKind, type MaterialSummary } from "./session-materials-contract";
import { readClassSessionResource } from "./class-session-resource";
import { materialSupplementMessages } from "./session-material-supplement-contract";

const Content = dynamic(() => import("./SessionMaterialContent").then(module => module.SessionMaterialContent), {
  ssr: false, loading: () => <Skeleton className="h-32 w-full" />,
});
const Supplement = dynamic(() => import("./SessionMaterialSupplement").then(module => module.SessionMaterialSupplement), {
  ssr: false, loading: () => <Skeleton className="h-40 w-full" />,
});
const icons = { lesson_plan: FileText, solution: PenLine, rehearsal_video: Film, courseware: BookOpen };

export function SessionMaterialsReader({ sessionId, classroomId, locale, timeZone, onDirtyChange }: {
  sessionId: string; classroomId: string; locale: string; timeZone: string; onDirtyChange?: (dirty: boolean) => void;
}) {
  const m = materialMessages(locale);
  const supplementM = materialSupplementMessages(locale);
  const router = useRouter();
  const [supplementOpen, setSupplementOpen] = useState(false);
  const [summary, setSummary] = useState<MaterialSummary | null>(null);
  const [active, setActive] = useState<MaterialKind | null>(null);
  const [contents, setContents] = useState<Partial<Record<MaterialKind, MaterialContent>>>({});
  const [error, setError] = useState<"forbidden" | "failed" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loaded = useRef(new Map<MaterialKind, number>());
  const panels = useRef<Partial<Record<MaterialKind, HTMLDivElement | null>>>({});
  const scrolls = useRef<Partial<Record<MaterialKind, number>>>({});
  const read = useCallback(async (kind: MaterialKind | "summary", signal: AbortSignal) => {
    return readClassSessionResource<unknown>(`/${locale}/dashboard/classes/session-materials`, { sessionId, classroomId, kind }, signal);
  }, [classroomId, locale, sessionId]);
  useEffect(() => {
    const controller = new AbortController();
    void read("summary", controller.signal)
      .then(data => { if (!controller.signal.aborted) setSummary(materialSummarySchema.parse(data)); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error && cause.message === "forbidden" ? "forbidden" : "failed"); });
    return () => controller.abort();
  }, [attempt, read]);
  useEffect(() => {
    if (!active || Date.now() - (loaded.current.get(active) ?? 0) < 10 * 60 * 1000) return;
    const controller = new AbortController();
    void read(active, controller.signal)
      .then(data => { if (!controller.signal.aborted) {
        loaded.current.set(active, Date.now()); setContents(current => ({ ...current, [active]: data as MaterialContent }));
      } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error && cause.message === "forbidden" ? "forbidden" : "failed"); });
    return () => controller.abort();
  }, [active, attempt, read]);
  const choose = (kind: MaterialKind | null) => {
    if (active) scrolls.current[active] = panels.current[active]?.scrollTop ?? 0;
    setError(null); setActive(kind);
    if (kind) requestAnimationFrame(() => { const panel = panels.current[kind]; if (panel) panel.scrollTop = scrolls.current[kind] ?? 0; });
  };
  const retry = () => { if (active) { loaded.current.delete(active); setContents(current => ({ ...current, [active]: undefined })); } setError(null); setAttempt(value => value + 1); };
  const hint = (kind: MaterialKind) => {
    if (!summary || kind === "courseware") return null;
    if (kind === "lesson_plan") return summary.lessonPlanCount ? m.available : m.empty;
    if (kind === "solution") return summary.solutionCount ? m.available : summary.hasSolutionNotes ? m.savedNotes : m.empty;
    return summary.hasVideo ? m.available : m.empty;
  };
  const completion = summary?.completionTimes.find(record => record.kind === active);
  const formatTime = (value: string) => new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  return <section className="min-w-0" aria-label={m.title} data-session-materials>
    <DashboardCommandPanel className="min-h-10 py-1">
      <DashboardCommandState>
        <span className="mr-1 text-xs text-muted">{m.title}</span>
        {MATERIAL_KINDS.map(kind => {
          const Icon = icons[kind]; const label = hint(kind);
          return <Button key={kind} size="sm" variant={active === kind ? "secondary" : "ghost"} aria-expanded={active === kind} aria-controls={`materials-${sessionId}-${kind}`} onClick={() => choose(active === kind ? null : kind)}>
            <Icon size={14} />{m[kind]}{label && <span className="text-[11px] font-normal text-muted">{label}</span>}
          </Button>;
        })}
      </DashboardCommandState>
      {summary?.canSupplement && <DashboardCommandActions><Button size="sm" variant="secondary" aria-expanded={supplementOpen} disabled={supplementOpen} onClick={() => setSupplementOpen(true)}><Upload size={14} />{supplementM.open}</Button></DashboardCommandActions>}
    </DashboardCommandPanel>
    {supplementOpen && <Supplement sessionId={sessionId} locale={locale} timeZone={timeZone} onDirtyChange={onDirtyChange} onClose={() => setSupplementOpen(false)} onSaved={() => {
      loaded.current.clear(); setContents({}); setError(null); setAttempt(value => value + 1); router.refresh();
    }} />}
    {error && <p role="alert" className="flex items-center gap-2 py-2 text-xs text-muted">{m[error]}<Button size="sm" variant="ghost" onClick={retry}>{m.retry}</Button></p>}
    {(active || Object.values(contents).some(Boolean)) && <div className="py-2" hidden={!active}>
      <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-sm font-medium">{summary?.title || m.untitled}<span className="ml-2 text-xs font-normal text-muted">{[
          summary?.classroomName,
          summary?.scheduledAt && new Intl.DateTimeFormat(locale, { timeZone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(summary.scheduledAt)),
          active && m[active], m.readOnly,
        ].filter(Boolean).join(" · ")}</span></p>
        <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={retry}><RefreshCw size={13} />{m.refresh}</Button><Button size="sm" variant="ghost" onClick={() => choose(null)} aria-label={m.close}><X size={14} /></Button></div>
      </div>
      {completion?.completedAt && <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>{m.completedAt} <time dateTime={completion.completedAt}>{formatTime(completion.completedAt)}</time></span>
        <span>{m.submittedAt} <time dateTime={completion.submittedAt}>{formatTime(completion.submittedAt)}</time></span>
      </p>}
      {active && !contents[active] && !error && <p role="status" className="py-6 text-xs text-muted">{m.loading}</p>}
      {MATERIAL_KINDS.filter(kind => contents[kind]).map(kind => <div key={kind} id={`materials-${sessionId}-${kind}`} ref={element => { panels.current[kind] = element; }} hidden={active !== kind} className="max-h-[70dvh] overflow-y-auto overscroll-contain pr-2">
        <Content content={contents[kind]!} locale={locale} timeZone={timeZone} sessionId={sessionId} onRetry={retry} />
      </div>)}
    </div>}
  </section>;
}
