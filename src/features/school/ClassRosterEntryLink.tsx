"use client";

import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { DashboardIntentLink } from "./dashboard-page/DashboardIntentLink";
import { classSessionMessages } from "./class-roster-session-contract";
import type { ClassRosterEntry } from "./class-roster-entry";

export function useClassRosterEntryNow(initialNow: number) {
  const [now, setNow] = useState(initialNow);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return now;
}

export function ClassRosterEntryLink({ entry, locale, canChange, context, label: customLabel }: {
  entry: ClassRosterEntry | null; locale: string; canChange?: () => boolean; context?: string; label?: string;
}) {
  if (!entry) return null;
  const m = classSessionMessages(locale);
  const label = customLabel ?? (entry.mode === "rehearse" ? m.rehearse : entry.mode === "resume" ? m.resume : m.enter);
  const description = [label, context, entry.session.title || m.untitled].filter(Boolean).join(" · ");
  return <DashboardIntentLink data-class-entry-mode={entry.mode} data-class-entry-session={entry.session.id}
    href={entry.href} title={description} aria-label={description}
    className={buttonVariants({ size: "sm", variant: entry.mode === "rehearse" ? "secondary" : "primary", className: "min-h-9 px-2 text-xs" })}
    onClick={event => { event.stopPropagation(); if (canChange && !canChange()) event.preventDefault(); }}>
    {label}
  </DashboardIntentLink>;
}
