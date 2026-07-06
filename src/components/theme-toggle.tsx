"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";

type Theme = "light" | "dark" | "system";

export function ThemeToggle({ initialTheme }: { initialTheme: Theme }) {
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
  return <button type="button" aria-label="切换主题" title={`Theme: ${theme}`} onClick={changeTheme} className="rounded-full border bg-[var(--card)] p-2.5 transition hover:-translate-y-0.5"><Icon size={18} /></button>;
}
