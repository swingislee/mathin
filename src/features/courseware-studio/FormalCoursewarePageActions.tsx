"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CoursewareWorkbenchDeletePageDialog, CoursewareWorkbenchPageActions } from "@/features/courseware-doc/CoursewareEditorWorkbench";
import { useRouter } from "@/i18n/navigation";
import { deleteFormalCoursewarePageAction, reorderFormalCoursewarePagesAction } from "./formal-page-management-actions";

export function FormalCoursewarePageActions({ lectureId, items, selectedIndex }: {
  lectureId: string; items: { id: string; href: string }[]; selectedIndex: number;
}) {
  const t = useTranslations("coursewareWorkspace.pageManagement");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const mutationRef = useRef(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const move = (direction: -1 | 1) => {
    const target = selectedIndex + direction;
    if (mutationRef.current || pending || !items[selectedIndex] || !items[target]) return;
    const order = items.map((item) => item.id);
    [order[selectedIndex], order[target]] = [order[target], order[selectedIndex]];
    mutationRef.current = true;
    startTransition(async () => {
      try {
        const result = await reorderFormalCoursewarePagesAction({ lectureId, pageIds: order });
        setMessage(result.ok ? t("orderSaved") : t("failed", { code: result.code }));
        if (result.ok) { router.replace(items[selectedIndex].href); router.refresh(); }
      } catch { setMessage(t("failed", { code: "NETWORK" })); }
      finally { mutationRef.current = false; }
    });
  };
  const remove = () => {
    if (mutationRef.current || pending || !deleteId || items.length <= 1) return;
    const index = items.findIndex((item) => item.id === deleteId);
    const next = items[index + 1] ?? items[index - 1];
    if (!next) return;
    mutationRef.current = true;
    startTransition(async () => {
      try {
        const result = await deleteFormalCoursewarePageAction({ pageDocId: deleteId });
        setMessage(result.ok ? t("deleted") : t("failed", { code: result.code }));
        if (result.ok) { setDeleteId(null); router.replace(next.href); router.refresh(); }
      } catch { setMessage(t("failed", { code: "NETWORK" })); }
      finally { mutationRef.current = false; }
    });
  };
  return <>
    <CoursewareWorkbenchPageActions selectedIndex={selectedIndex} total={items.length} disabled={pending}
      canDelete={items.length > 1} onMove={move} onDelete={() => setDeleteId(items[selectedIndex]?.id ?? null)} />
    {message && <p role="status" className="px-3 pb-2 text-xs text-muted">{message}</p>}
    <CoursewareWorkbenchDeletePageDialog open={deleteId !== null} onOpenChange={(open) => { if (!pending && !open) setDeleteId(null); }} onConfirm={remove} pending={pending} />
  </>;
}
