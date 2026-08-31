"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Fits a read-only courseware stage into the exact remaining workspace area.
 * Step 1 only needs sizing; editing, selection, and persistence stay outside
 * this leaf until the product layout is accepted.
 */
export function FittedCoursewareCanvas({
  aspect,
  children,
  className,
}: {
  aspect: number;
  children: ReactNode;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const fit = () => {
      const rect = host.getBoundingClientRect();
      setWidth(Math.max(0, Math.floor(Math.min(rect.width, rect.height * aspect))));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    fit();
    return () => observer.disconnect();
  }, [aspect]);

  return (
    <div ref={hostRef} className={cn("flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden p-3", className)}>
      <div
        className="shrink-0 overflow-hidden bg-card"
        style={{ width: width === null ? "100%" : width, aspectRatio: String(aspect) }}
      >
        {children}
      </div>
    </div>
  );
}
