"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable
    || target.matches("input, textarea, select, button, [role='dialog'], [role='textbox']");
}

/** 兼容键盘与白板演示笔：方向键、PageUp/PageDown 和空格翻页。 */
export function PreviewKeyboardNavigation({
  previousHref,
  nextHref,
}: {
  previousHref: string | null;
  nextHref: string | null;
}) {
  const router = useRouter();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target)) return;
      const href = event.key === "ArrowLeft" || event.key === "PageUp"
        ? previousHref
        : event.key === "ArrowRight" || event.key === "PageDown" || event.key === " "
          ? nextHref
          : null;
      if (!href) return;
      event.preventDefault();
      router.push(href);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [nextHref, previousHref, router]);
  return null;
}
