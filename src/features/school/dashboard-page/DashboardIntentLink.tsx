"use client";

import { useState, type ComponentProps } from "react";
import { Link } from "@/i18n/navigation";

/** 常驻侧栏按悬停或键盘聚焦预取，避免首屏为全部工作入口同时发起鉴权。 */
export function DashboardIntentLink({ onMouseEnter, onFocus, ...props }: ComponentProps<typeof Link>) {
  const [intent, setIntent] = useState(false);
  return <Link {...props} prefetch={intent ? null : false}
    onMouseEnter={event => { setIntent(true); onMouseEnter?.(event); }}
    onFocus={event => { setIntent(true); onFocus?.(event); }} />;
}
