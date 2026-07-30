"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

const HIGHLIGHT_CLASSES = ["ring-2", "ring-crater", "ring-offset-2", "ring-offset-paper"];

export function NotificationFocus({ target }: { target?: string }) {
  const t = useTranslations("changes");

  useEffect(() => {
    if (!target) return;
    const element = Array.from(document.querySelectorAll<HTMLElement>("[data-notification-target]"))
      .find((candidate) => candidate.dataset.notificationTarget === target);
    if (!element) {
      toast.info(t("focusUnavailable"));
      return;
    }

    element.classList.add(...HIGHLIGHT_CLASSES);
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.focus({ preventScroll: true });
    toast.success(t("focusFound"));
    const timer = window.setTimeout(() => element.classList.remove(...HIGHLIGHT_CLASSES), 5000);
    return () => {
      window.clearTimeout(timer);
      element.classList.remove(...HIGHLIGHT_CLASSES);
    };
  }, [t, target]);

  return null;
}
