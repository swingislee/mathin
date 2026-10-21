"use client";

import { LoaderCircle, PanelRightClose } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, Suspense, lazy } from "react";
import { Button } from "@/components/ui/button";
import { Student360SplitLayout } from "./Student360SplitLayout";
import { cn } from "@/lib/utils";
import { getStudent360Action } from "./actions/student-360";
import { STUDENT_360_REFRESH_EVENT, type Student360FallbackIdentity, type Student360Snapshot, type Student360SubjectRef } from "./student-360-contract";

const Student360PanelBody = lazy(() => import("./Student360PanelBody").then(module => ({ default: module.Student360PanelBody })));

interface Student360WorkspaceContextValue {
  openStudent: (subject: Student360SubjectRef, fallback: Student360FallbackIdentity) => void;
}

interface ActiveStudent360 {
  subject: Student360SubjectRef;
  fallback: Student360FallbackIdentity;
}

const Student360WorkspaceContext = createContext<Student360WorkspaceContextValue | null>(null);

/**
 * Dashboard 级学生档案工作区。
 *
 * 宽屏时档案栏参与真实水平布局，主业务页因此缩窄但仍保持完整交互；窄屏没有可靠的
 * 并排空间，才退化成覆盖层。Provider 放在 DashboardShell 而不是每一张业务表里，
 * 这样切换学生时只有一份档案状态，也不会为每一行挂一套抽屉 Portal。
 */
export function Student360Workspace({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const [active, setActive] = useState<ActiveStudent360 | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [snapshot, setSnapshot] = useState<Student360Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestVersion = useRef(0);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  const loadSnapshot = useCallback((subject: Student360SubjectRef, resetSnapshot: boolean) => {
    const version = ++requestVersion.current;
    if (resetSnapshot) setSnapshot(null);
    setError(null);
    setLoading(true);
    void getStudent360Action(subject).then((result) => {
      if (requestVersion.current !== version) return;
      setLoading(false);
      if (result.ok) {
        setSnapshot(result.data);
        setError(null);
        return;
      }
      if (resetSnapshot) setSnapshot(null);
      setError(result.code);
    }).catch(() => {
      if (requestVersion.current !== version) return;
      setLoading(false);
      if (resetSnapshot) setSnapshot(null);
      setError("UNKNOWN");
    });
  }, []);

  const openStudent = useCallback((subject: Student360SubjectRef, fallback: Student360FallbackIdentity) => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setActive({ subject, fallback });
    setExpanded(true);
    loadSnapshot(subject, true);
  }, [loadSnapshot]);

  const close = useCallback(() => {
    requestVersion.current += 1;
    setExpanded(false);
    setLoading(false);
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setActive(null);
      setSnapshot(null);
      setError(null);
      closeTimer.current = null;
    }, 200);
  }, []);

  const retry = useCallback(() => {
    if (active) loadSnapshot(active.subject, true);
  }, [active, loadSnapshot]);

  const refresh = useCallback(() => {
    if (active) loadSnapshot(active.subject, false);
  }, [active, loadSnapshot]);

  useEffect(() => {
    window.addEventListener(STUDENT_360_REFRESH_EVENT, refresh);
    return () => window.removeEventListener(STUDENT_360_REFRESH_EVENT, refresh);
  }, [refresh]);

  const contextValue = useMemo<Student360WorkspaceContextValue>(() => ({ openStudent }), [openStudent]);

  return (
    <Student360WorkspaceContext.Provider value={contextValue}>
      <Student360SplitLayout
        active={Boolean(active)}
        expanded={expanded}
        close={close}
        sidePage={active ? (
          <Suspense fallback={<Student360PanelLoading close={close} />}><Student360PanelBody
            snapshot={snapshot}
            fallback={active.fallback}
            locale={locale}
            loading={loading}
            error={error}
            retry={retry}
            refresh={refresh}
            close={close}
          /></Suspense>
        ) : null}
      >
        {children}
      </Student360SplitLayout>
    </Student360WorkspaceContext.Provider>
  );
}

export function Student360Trigger({
  subject,
  fallback,
  children,
  className,
}: {
  subject: Student360SubjectRef;
  fallback: Student360FallbackIdentity;
  children?: ReactNode;
  className?: string;
}) {
  const t = useTranslations("school.student360");
  const workspace = useContext(Student360WorkspaceContext);

  if (!workspace) throw new Error("Student360Trigger must be rendered inside Student360Workspace");

  return (
    <button
      type="button"
      className={cn(
        "min-w-0 rounded-sm text-left font-medium text-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crater focus-visible:ring-offset-2 focus-visible:ring-offset-card",
        className,
      )}
      aria-label={t("openFor", { name: fallback.name })}
      onClick={(event) => {
        event.stopPropagation();
        workspace.openStudent(subject, fallback);
      }}
    >
      {children ?? fallback.name}
    </button>
  );
}

function Student360PanelLoading({ close }: { close: () => void }) {
  const t = useTranslations("school.student360");
  return <div className="space-y-4 p-5">
    <div className="flex items-center justify-between gap-3"><h2 id="student-360-heading" className="text-sm font-medium">{t("loading")}</h2>
      <Button variant="ghost" size="sm" aria-label={t("close")} onClick={close}><PanelRightClose className="size-4" /></Button></div>
    <p role="status" className="flex items-center gap-2 text-sm text-muted"><LoaderCircle className="size-4 animate-spin" />{t("loading")}</p>
  </div>;
}
