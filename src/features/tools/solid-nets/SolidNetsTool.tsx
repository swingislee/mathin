"use client";

import { useCallback, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { SolidNetsWorkspace } from "./SolidNetsWorkspace";
import { createDefaultSolidNetsTeachingSnapshot, solidNetsTeachingSnapshotSchema, type AnySolidNetsSnapshot, type SolidNetsTeachingSnapshot } from "./contract";

export function SolidNetsTool({ initial, runtime, onSnapshot, readOnly }: {
  initial?: SolidNetsTeachingSnapshot;
  runtime?: { state?: SolidNetsTeachingSnapshot; onChange?: (next: SolidNetsTeachingSnapshot) => Promise<void> };
  onSnapshot?: (next: SolidNetsTeachingSnapshot | null) => void;
  readOnly?: boolean;
}) {
  const locale = useLocale() === "en" ? "en" : "zh";
  const [start] = useState(() => initial ?? createDefaultSolidNetsTeachingSnapshot());
  const capture = useCallback((next: AnySolidNetsSnapshot | null) => onSnapshot?.(next ? solidNetsTeachingSnapshotSchema.parse(next) : null), [onSnapshot]);
  const port = useMemo(() => runtime && ({ state: runtime.state,
    onChange: runtime.onChange ? (next: AnySolidNetsSnapshot) => runtime.onChange!(solidNetsTeachingSnapshotSchema.parse(next)) : undefined,
  }), [runtime]);
  return <SolidNetsWorkspace locale={locale} initial={start} runtime={port} onSnapshot={capture} readOnly={readOnly} courseware />;
}
