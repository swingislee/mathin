"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "@/i18n/navigation";
import { startSessionPreparationAction } from "./actions/classes";

/** Entering the preparation stage is the start action; there is no second confirmation button. */
export function SessionPrepAutostart({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void startSessionPreparationAction(sessionId).then((result) => {
      if (result.ok) router.refresh();
    });
  }, [router, sessionId]);

  return null;
}
