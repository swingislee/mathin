"use client";

import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/** 本项目没用 next-themes，主题走 mathin-theme cookie（见 theme-toggle.tsx），theme 由调用方传入。 */
export function Toaster({ theme = "system", ...props }: ToasterProps) {
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: "group toast group-[.toaster]:border-line group-[.toaster]:bg-card group-[.toaster]:text-ink group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted",
          actionButton: "group-[.toast]:bg-rose group-[.toast]:text-white",
          cancelButton: "group-[.toast]:bg-line/60 group-[.toast]:text-muted",
          success: "group-[.toast]:[&_[data-icon]]:text-leaf-deep",
          error: "group-[.toast]:[&_[data-icon]]:text-rose",
        },
      }}
      {...props}
    />
  );
}
