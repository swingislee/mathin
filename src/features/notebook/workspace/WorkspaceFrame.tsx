"use client";

import { Home, X } from "lucide-react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import type { NoteMeta, WorkspaceTone } from "../types";
import { useNotebookStore } from "../store";
import { NotebookSync } from "./NotebookSync";
import { NoteTree } from "./NoteTree";
import { TrashPopover } from "./TrashPopover";
import { WorkspaceTopbar } from "./WorkspaceTopbar";

const MIN_SIDEBAR = 240;
const MAX_SIDEBAR = 480;

export function WorkspaceFrame({ userId, initialNotes, children }: { userId: string; initialNotes: NoteMeta[]; children: React.ReactNode }) {
  const t = useTranslations("notebook.workspace");
  const params = useParams<{ noteId?: string }>();
  const activeId = params.noteId ?? null;
  const hydrate = useNotebookStore((state) => state.hydrate);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [tone, setTone] = useState<WorkspaceTone>("night");

  useEffect(() => hydrate(userId, initialNotes), [hydrate, initialNotes, userId]);
  useEffect(() => {
    const savedTone = localStorage.getItem("mathin.ws-tone") as WorkspaceTone | null;
    // Local preferences are only available after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (savedTone && ["night", "leaf", "rose", "crater"].includes(savedTone)) setTone(savedTone);
    const width = Number(localStorage.getItem("mathin.ws-sidebar"));
    if (Number.isFinite(width) && width >= MIN_SIDEBAR && width <= MAX_SIDEBAR) setSidebarWidth(width);
  }, []);

  const setWorkspaceTone = (next: WorkspaceTone) => {
    setTone(next);
    localStorage.setItem("mathin.ws-tone", next);
  };

  const resizeHandlers = {
    onPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
      const startX = event.clientX;
      const startWidth = sidebarWidth;
      event.currentTarget.setPointerCapture(event.pointerId);
      const move = (moveEvent: PointerEvent) => {
        const width = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, startWidth + moveEvent.clientX - startX));
        setSidebarWidth(width);
      };
      const stop = () => {
        localStorage.setItem("mathin.ws-sidebar", String(getNotebookSidebarWidth()));
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
    },
  };

  function getNotebookSidebarWidth() {
    const element = document.querySelector<HTMLElement>("[data-notebook-sidebar]");
    return element?.offsetWidth ?? sidebarWidth;
  }

  return (
    <NotebookSync userId={userId}>
      <main data-workspace data-ws-tone={tone} className="min-h-dvh bg-[var(--ws-window)] p-0 lg:p-8 lg:px-16">
        <div className="mx-auto flex h-dvh max-w-[1600px] flex-col overflow-hidden bg-[var(--ws-panel)] shadow-sm lg:h-[calc(100dvh-4rem)] lg:rounded-3xl">
          <WorkspaceTopbar activeId={activeId} tone={tone} onToneChange={setWorkspaceTone} onMenu={() => setSidebarOpen(true)} />
          <div className="relative flex min-h-0 flex-1">
            {sidebarOpen && <button type="button" aria-label={t("closeSidebar")} onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-30 bg-ink/35 lg:hidden" />}
            <aside
              data-notebook-sidebar
              className={`fixed inset-y-0 left-0 z-40 flex w-[min(86vw,360px)] flex-col bg-[var(--ws-panel)] pt-3 transition-transform duration-200 lg:static lg:z-auto lg:w-auto lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
              style={{ width: `${sidebarWidth}px` }}
            >
              <div className="mb-4 flex items-center justify-between px-5 text-[var(--ws-panel-ink)]">
                <Link href="/" aria-label={t("backHome")} className="rounded-full p-2 hover:bg-[var(--ws-sheet)]/10"><Home size={18} /></Link>
                <strong className="font-display">Mathin</strong>
                <button type="button" aria-label={t("closeSidebar")} onClick={() => setSidebarOpen(false)} className="rounded-full p-2 hover:bg-[var(--ws-sheet)]/10 lg:hidden"><X size={18} /></button>
              </div>
              <NoteTree activeId={activeId} onNavigate={() => setSidebarOpen(false)} />
              <TrashPopover />
              <button
                type="button"
                aria-label={t("resizeSidebar")}
                {...resizeHandlers}
                className="absolute inset-y-0 right-0 hidden w-1 cursor-col-resize bg-[var(--ws-panel-ink)]/0 transition-colors hover:bg-[var(--ws-panel-ink)]/20 lg:block"
              />
            </aside>
            <section className="relative min-w-0 flex-1 overflow-y-auto rounded-t-2xl bg-[var(--ws-sheet)] lg:mr-2 lg:mb-2 lg:rounded-2xl">
              {children}
            </section>
          </div>
        </div>
      </main>
    </NotebookSync>
  );
}
