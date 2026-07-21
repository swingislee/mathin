"use client";

import type { ReactNode } from "react";
import { ObjectOverlay } from "@/features/school/stage/ObjectOverlay";
import { useRouter } from "@/i18n/navigation";

export function LectureOverlay({ title, children, decisionRail }: { title: string; children: ReactNode; decisionRail: ReactNode }) {
  const router = useRouter();
  return <ObjectOverlay
    open
    onOpenChange={(open) => { if (!open) router.back(); }}
    title={title}
    decisionRail={decisionRail}
  >
    {children}
  </ObjectOverlay>;
}
