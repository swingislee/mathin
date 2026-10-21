"use client";

import dynamic from "next/dynamic";
import { useLocale } from "next-intl";

function LoadingView() {
  const en = useLocale().startsWith("en");
  return <p role="status" className="py-4 text-sm text-muted">{en ? "Loading…" : "正在加载…"}</p>;
}

// The route selects a view on the server. Keep the other views' client code
// behind a client boundary so opening the roster does not also load them.
export const TeachingProgressMatrix = dynamic(() => import("./teaching-workbench/TeachingProgressMatrix").then(module => module.TeachingProgressMatrix), { loading: LoadingView });
export const TeachingProgressTable = dynamic(() => import("./teaching-workbench/TeachingProgressTable").then(module => module.TeachingProgressTable), { loading: LoadingView });
export const TeachingPeriodPicker = dynamic(() => import("./teaching-workbench/TeachingPeriodPicker").then(module => module.TeachingPeriodPicker), { loading: LoadingView });
