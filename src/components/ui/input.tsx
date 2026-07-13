import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn("h-10 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink shadow-sm outline-none transition placeholder:text-muted focus-visible:border-crater focus-visible:ring-2 focus-visible:ring-crater/25 disabled:cursor-not-allowed disabled:opacity-50", className)} {...props} />;
}
