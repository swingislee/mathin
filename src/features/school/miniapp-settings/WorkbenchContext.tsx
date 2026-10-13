"use client";
import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { MiniappSettings } from "../../../../contracts/participant-api/miniapp-settings";

export const WorkbenchContext = createContext<{ previewHost: HTMLElement | null; selectedId: string; select: (id: string) => void; navigate: (tab: string, id?: string) => void; config: MiniappSettings; tab: string; activities: { id: string; title: string }[] } | null>(null);
/** There is one phone surface, owned by the workspace rather than nested editors. */
export function PhonePreview({ children }: { children: ReactNode }) {
  const context = useContext(WorkbenchContext);
  if (!context) return <div>{children}</div>;
  return context.previewHost ? createPortal(children, context.previewHost) : null;
}
