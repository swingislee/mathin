"use client";

import { useCallback, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { SolidNetsWorkspace } from "./SolidNetsWorkspace";
import { createSolidNetForVersion, preparedSolidNetsSnapshotSchema, SOLID_NETS_POLYHEDRA_VERSION, type AnySolidNetsSnapshot, type PreparedSolidNetsSnapshot } from "./contract";

export function SolidNetsTool({ initial, runtime, onSnapshot, readOnly, version = SOLID_NETS_POLYHEDRA_VERSION }: {
  initial?: PreparedSolidNetsSnapshot;
  version?: PreparedSolidNetsSnapshot["version"];
  runtime?: { state?: PreparedSolidNetsSnapshot; onChange?: (next: PreparedSolidNetsSnapshot) => Promise<void> };
  onSnapshot?: (next: PreparedSolidNetsSnapshot | null) => void;
  readOnly?: boolean;
}) {
  const locale = useLocale() === "en" ? "en" : "zh";
  const [start] = useState(() => initial ?? createSolidNetForVersion(version, "cube"));
  const capture = useCallback((next: AnySolidNetsSnapshot | null) => onSnapshot?.(next ? preparedSolidNetsSnapshotSchema.parse(next) : null), [onSnapshot]);
  const port = useMemo(() => runtime && ({ state: runtime.state,
    onChange: runtime.onChange ? (next: AnySolidNetsSnapshot) => runtime.onChange!(preparedSolidNetsSnapshotSchema.parse(next)) : undefined,
  }), [runtime]);
  return <SolidNetsWorkspace locale={locale} initial={start} runtime={port} onSnapshot={capture} readOnly={readOnly} courseware />;
}
