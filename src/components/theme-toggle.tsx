"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  return <button suppressHydrationWarning type="button" aria-label="切换主题" title={`Theme: ${theme ?? "system"}`} onClick={() => setTheme(next)} className="rounded-full border bg-[var(--card)] p-2.5 transition hover:-translate-y-0.5"><Icon size={18} /></button>;
}
