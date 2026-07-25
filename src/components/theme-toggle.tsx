"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

export type Theme = "light" | "dark" | "system";

export function ThemeToggle({ initialTheme }: { initialTheme: Theme }) {
  const t = useTranslations("common");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  function changeTheme() {
    document.documentElement.classList.remove("light", "dark");
    if (next !== "system") document.documentElement.classList.add(next);
    document.documentElement.dataset.theme = next;
    document.cookie = `mathin-theme=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setTheme(next);
  }
  return <button type="button" aria-label={t("toggleTheme")} title={t("toggleTheme")} onClick={changeTheme} className="edge-control"><Icon size={18} /></button>;
}
